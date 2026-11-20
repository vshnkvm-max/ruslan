import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { createApp } from '../server.js';
import { digest } from '../lib/auth.js';
import { createOrderNotifier } from '../lib/order-notifications.js';
const directory = mkdtempSync(join(tmpdir(), 'shop-checkout-')), botToken = 'test-only:main-bot';
let app, base;
function signedUser(id = 702, date = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ user: JSON.stringify({ id, first_name: 'Покупатель', username: 'buyer' }), auth_date: String(date), query_id: 'test' });
  const text = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  params.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(botToken).digest()).update(text).digest('hex'));
  return params.toString();
}
before(async () => {
  app = createApp({ dbPath: join(directory, 'shop.db'), botToken });
  app.db.prepare("INSERT INTO admins(id,username,password) VALUES (1,'admin','unused')").run();
  app.db.prepare('INSERT INTO sessions VALUES (?,1,?,?)').run(digest('a'.repeat(64)), 'csrf', Date.now() + 1000000);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { await new Promise(resolve => app.server.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
async function request(path, method, body, admin = false) {
  const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(admin ? { Cookie: 'session=' + 'a'.repeat(64), 'X-CSRF-Token': 'csrf' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
const product = (stock = 5, price = 200) => Number(app.db.prepare("INSERT INTO products(name,sku,category,price,cost,stock,image) VALUES ('Товар',?,'',?,50,?,'')").run(randomUUID(), price, stock).lastInsertRowid);
const stock = id => app.db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock;
const bodyFor = (id, quantity = 2) => ({ init_data: signedUser(), request_key: randomUUID(), items: [{ product_id: id, quantity, price: 200 }] });
test('checkout authenticates signed Telegram data; invalid and expired identities cannot create orders', async () => {
  const body = bodyFor(product());
  for (const init_data of ['', signedUser().replace('buyer', 'attacker'), signedUser(702, 1)]) assert.equal((await request('/storefront/orders', 'POST', { ...body, init_data })).status, 401);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
});
test('server prices, snapshots and stock are atomic; duplicate and concurrent confirmations return one order', async () => {
  const id = product(), body = bodyFor(id);
  const results = await Promise.all([request('/storefront/orders', 'POST', body), request('/storefront/orders', 'POST', body)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
  assert.equal(results[0].data.order.id, results[1].data.order.id); assert.equal(results[0].data.order.total, 400); assert.equal(stock(id), 3);
  const bootstrap = (await request('/bootstrap', 'GET', undefined, true)).data;
  const order = bootstrap.orders.find(o => o.id === results[0].data.order.id);
  assert.equal(order.status, 'new'); assert.equal(order.customer_name, 'Покупатель'); assert.equal(order.items[0].cost, 50);
  assert.equal(bootstrap.orderNotifications.pending, 1); assert.equal(bootstrap.orderNotifications.configured, false);
  const another = await request('/storefront/orders', 'POST', { ...body, init_data: signedUser(703) });
  assert.equal(another.status, 201); assert.notEqual(another.data.order.id, order.id); assert.equal(stock(id), 1);
});
test('rejects changed prices, hidden/archived products and insufficient stock without partial reservation', async () => {
  const id = product(1), body = bodyFor(id), other = product();
  for (const items of [body.items, [{ product_id: id, quantity: 1, price: 1 }], [{ product_id: other, quantity: 1, price: 200 }, ...body.items]]) {
    assert.equal((await request('/storefront/orders', 'POST', { ...body, items })).status, 409);
    assert.equal(stock(id), 1); assert.equal(stock(other), 5);
  }
  for (const column of ['visible', 'active']) {
    app.db.prepare(`UPDATE products SET ${column}=0 WHERE id=?`).run(other);
    assert.equal((await request('/storefront/orders', 'POST', bodyFor(other, 1))).status, 409);
    app.db.prepare(`UPDATE products SET ${column}=1 WHERE id=?`).run(other);
  }
  for (const items of [[], [null], [{ product_id: id, quantity: -1, price: 200 }], [{ product_id: id, quantity: 1.5, price: 200 }], [body.items[0], body.items[0]]]) assert.equal((await request('/storefront/orders', 'POST', { ...body, items })).status, 400);
});
test('retry after selling the last item returns saved order; cancellation restores only once and reinstatement reserves again', async () => {
  const id = product(2), body = bodyFor(id), created = await request('/storefront/orders', 'POST', body), order = created.data.order.id;
  assert.equal(stock(id), 0); assert.equal((await request('/storefront/orders', 'POST', body)).data.order.id, order);
  for (const status of ['accepted', 'completed']) { assert.equal((await request('/orders/' + order, 'PATCH', { status }, true)).status, 200); assert.equal(stock(id), 0); }
  for (let i = 0; i < 2; i++) { assert.equal((await request('/orders/' + order, 'PATCH', { status: 'cancelled' }, true)).status, 200); assert.equal(stock(id), 2); }
  app.db.prepare('UPDATE products SET stock=1 WHERE id=?').run(id);
  assert.equal((await request('/orders/' + order, 'PATCH', { status: 'new' }, true)).status, 409); assert.equal(stock(id), 1);
  app.db.prepare('UPDATE products SET stock=2 WHERE id=?').run(id);
  await request('/orders/' + order, 'PATCH', { status: 'new' }, true); assert.equal(stock(id), 0);
  await request('/orders/' + order, 'DELETE', undefined, true); assert.equal(stock(id), 2);
  assert.equal((await request('/orders/' + order, 'DELETE', undefined, true)).status, 404); assert.equal(stock(id), 2);
});
test('blocked customer cannot order and matching usernames never merge different Telegram identities', async () => {
  const customer = app.db.prepare('SELECT * FROM customers WHERE telegram_id=702').get();
  app.db.prepare('UPDATE customers SET banned=1 WHERE id=?').run(customer.id);
  assert.equal((await request('/storefront/orders', 'POST', bodyFor(product()))).status, 403);
  app.db.prepare('UPDATE customers SET banned=0 WHERE id=?').run(customer.id);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM customers WHERE username='buyer'").get().n, 2);
});
test('outbox survives delivery failure and resumes from each confirmed message without delaying checkout', async () => {
  const first = app.db.prepare('SELECT order_id FROM order_notifications ORDER BY order_id LIMIT 1').get().order_id;
  app.db.prepare('UPDATE order_notifications SET messages=? WHERE order_id=?').run(JSON.stringify(['part one', 'part two']), first);
  let count = 0;
  const sent = [], notifier = createOrderNotifier(app.db, { token: 'separate:test-token', chatId: '1234', fetchImpl: async (url, options) => {
    assert.match(url, /botseparate:test-token\/sendMessage$/); assert.equal(JSON.parse(options.body).chat_id, '1234');
    count++; if (count === 2) throw new Error('network failure'); sent.push(JSON.parse(options.body).text);
    return { ok: true, json: async () => ({ ok: true }) };
  } });
  await notifier.flush(); notifier.stop();
  let notification = app.db.prepare('SELECT * FROM order_notifications WHERE order_id=?').get(first);
  assert.equal(notification.sent_count, 1); assert.equal(notification.delivered_at, null); assert.equal(notification.attempts, 1); assert.ok(notification.next_attempt_at > Date.now());
  assert.doesNotMatch(notification.last_error, /token|network/);
  app.db.prepare('UPDATE order_notification_deliveries SET next_attempt_at=0 WHERE order_id=?').run(first);
  const restarted = createOrderNotifier(app.db, { token: 'separate:test-token', chatId: '1234', fetchImpl: async (url, options) => { sent.push(JSON.parse(options.body).text); return { ok: true, json: async () => ({ ok: true }) }; } });
  await restarted.flush(); restarted.stop();
  notification = app.db.prepare('SELECT * FROM order_notifications WHERE order_id=?').get(first);
  assert.ok(notification.delivered_at); assert.deepEqual(sent.filter(text => text.startsWith('part ')).map(text => text.split('\n')[0]), ['part one', 'part two']);
});

test('configured flavors reserve shared stock and remain in the order after the catalog changes', async () => {
  const id = product(3);
  const edit = {name:'Товар',category:'',price:200,cost:50,active:true,description:'',flavors:[' Мята ','Ягода']};
  assert.equal((await request('/products/' + id,'PATCH',edit,true)).status,200);
  const {data:catalog} = await request('/storefront','GET');
  assert.deepEqual(catalog.products.find(item=>item.id===id).flavors,['Мята','Ягода']);
  assert.equal((await request('/products/' + id,'PATCH',{...edit,flavors:['Мята','мята']},true)).status,400);
  const body = { ...bodyFor(id), init_data:signedUser(1901) };
  const mint = {...body.items[0],flavor:'Мята'};
  const berry = {...mint,flavor:'Ягода',quantity:1};
  for (const items of [body.items,[{...mint,flavor:'Неизвестный вкус'}],[mint,{...berry,quantity:2}]]){
    assert.equal((await request('/storefront/orders','POST',{...body,items})).status,409);
    assert.equal(stock(id),3);
  }
  assert.equal((await request('/storefront/orders','POST',{...body,items:[mint,mint]})).status,400);
  const payload = {...body,items:[mint,berry]};
  const created = await request('/storefront/orders','POST',payload);
  assert.equal(created.status,201);
  const order = created.data.order;
  assert.deepEqual(order.items.map(item=>[item.name,item.quantity]),[['Товар — Мята',2],['Товар — Ягода',1]]);
  assert.equal(stock(id),0);
  assert.equal((await request('/products/' + id,'PATCH',{...edit,flavors:[]},true)).status,200);
  const retry = await request('/storefront/orders','POST',payload);
  assert.deepEqual(retry.data.order.items,order.items);
  assert.equal((await request('/orders/' + order.id,'PATCH',{status:'cancelled'},true)).status,200);
  assert.equal(stock(id),3);
});

test('validates and preserves the meeting date in the order, history and manager notification', async () => {
  const id = product();
  const body = {...bodyFor(id),init_data:signedUser(1902)};
  for (const meeting_date of ['2000-01-01','2099-02-30','2099-1-10','',19000101]){
    assert.equal((await request('/storefront/orders','POST',{...body,meeting_date})).status,400);
  }
  assert.equal(stock(id),5);
  const meeting_date = new Date(Date.now()+86400000).toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});
  const created = await request('/storefront/orders','POST',{...body,meeting_date});
  assert.equal(created.status,201);
  const order = created.data.order;
  assert.equal(order.meeting_date,meeting_date);
  const retry = await request('/storefront/orders','POST',{...body,meeting_date:'2000-01-01'});
  assert.equal(retry.status,200);
  assert.equal(retry.data.order.meeting_date,meeting_date);
  const history = await request('/storefront/orders/'+order.id,'POST',{init_data:body.init_data});
  assert.equal(history.data.order.meeting_date,meeting_date);
  const text = JSON.parse(app.db.prepare('SELECT messages FROM order_notifications WHERE order_id=?').get(order.id).messages).join('\n');
  assert.ok(text.includes('Дата встречи: '+meeting_date.split('-').reverse().join('.')));
  assert.ok(text.includes('К ОПЛАТЕ: 400 ₽ наличными'));
});
