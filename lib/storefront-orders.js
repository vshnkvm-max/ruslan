import {createTelegramCustomer,telegramCustomerName} from './storefront-referrals.js';
import { verifiedTelegramUser } from './telegram-auth.js';

export function createStorefrontOrders(db, { botToken, fail, referrals }) {
  const receipt = id => {
    const order = db.prepare("SELECT o.id,CASE WHEN o.deleted=1 THEN 'cancelled' ELSE o.status END AS status,o.created_at,o.balance_spent,c.balance AS balance_after FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?").get(id);
    const items = db.prepare('SELECT product_id,name,quantity,price FROM order_items WHERE order_id=? ORDER BY id').all(id);
    const total=items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    return { ...order, items, total, payable:order.status==='cancelled'?0:total-order.balance_spent };
  };
  function create(body) {
    if (!botToken) fail(503, 'Оформление заказов временно недоступно.');
    const user = verifiedTelegramUser(body.init_data, botToken);
    if (!user) fail(401, 'Откройте магазин заново через Telegram, чтобы оформить заказ.');
    if (typeof body.request_key !== 'string' || !/^[a-zA-Z0-9_-]{20,100}$/.test(body.request_key)) fail(400, 'Обновите подтверждение заказа.');
    db.exec('BEGIN IMMEDIATE');
    try {
      let customer = db.prepare('SELECT * FROM customers WHERE telegram_id=?').get(user.id);
      if (customer?.banned || customer?.deleted) fail(403, 'Оформление заказа недоступно. Свяжитесь с менеджером.');
      const existing = customer && db.prepare('SELECT id FROM orders WHERE customer_id=? AND request_key=?').get(customer.id, body.request_key);
      if (existing) { db.exec('COMMIT'); return { order: receipt(existing.id), repeated: true }; }
      const balanceSpend=body.balance_spend===undefined?0:body.balance_spend;
      if(!Number.isSafeInteger(balanceSpend)||balanceSpend<0)fail(400,'Укажите целое неотрицательное количество рублей для списания.');
      if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) fail(400, 'В заказе должно быть от 1 до 100 товаров.');
      const ids = new Set();
      for (const item of body.items) {
        if (!item || !Number.isSafeInteger(item.product_id) || item.product_id <= 0 || ids.has(item.product_id) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) fail(400, 'Проверьте товары и количество.');
        ids.add(item.product_id);
      }
      const items = body.items.map(item => {
        const product = db.prepare('SELECT id,name,price,cost,stock FROM products WHERE id=? AND active=1 AND visible=1 AND deleted=0').get(item.product_id);
        if (!product || product.stock < item.quantity) fail(409, 'Изменилось наличие товара. Обновите каталог и проверьте корзину.');
        if (item.price !== product.price) fail(409, 'Изменилась цена товара. Обновите каталог и проверьте корзину.');
        return { ...product, quantity: item.quantity };
      });
      const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      if (!Number.isSafeInteger(total) || total > 100000000) fail(400, 'Сумма заказа слишком большая. Свяжитесь с менеджером.');
      if(balanceSpend>Math.floor(total/2))fail(400,'Рублями можно оплатить не более 50% стоимости заказа.');
      if(balanceSpend>(customer?.balance??0))fail(409,'На балансе недостаточно рублей. Проверьте сумму списания.');
      if (customer && db.prepare("SELECT COUNT(*) AS count FROM orders WHERE customer_id=? AND stock_managed=1 AND created_at>?").get(customer.id, new Date(Date.now() - 3600000).toISOString()).count >= 20) fail(429, 'Слишком много заказов. Повторите позже или свяжитесь с менеджером.');
      referrals?.track(user);
      const name = telegramCustomerName(user);
      if (!customer) customer = db.prepare('SELECT id FROM customers WHERE telegram_id=?').get(user.id)||createTelegramCustomer(db,user);
      else db.prepare('UPDATE customers SET name=?,username=? WHERE id=?').run(name,user.username,customer.id);
      const result = db.prepare("INSERT INTO orders(customer_id,status,delivery,address,created_at,request_key,stock_managed,reserved,balance_spent,balance_reserved) VALUES (?,'new','Согласование с менеджером','',?,?,1,1,?,?)").run(customer.id, new Date().toISOString(), body.request_key,balanceSpend,Number(balanceSpend>0));
      const id = Number(result.lastInsertRowid);
      if(balanceSpend>0){
        const debit=db.prepare('UPDATE customers SET balance=balance-? WHERE id=? AND balance>=?').run(balanceSpend,customer.id,balanceSpend);
        if(!debit.changes)fail(409,'На балансе недостаточно рублей. Проверьте сумму списания.');
        db.prepare("INSERT INTO balance_operations(customer_id,order_id,kind,amount,created_at) VALUES (?,?,'order_payment',?,?)").run(customer.id,id,-balanceSpend,new Date().toISOString());
      }
      for (const item of items) {
        db.prepare('INSERT INTO order_items(order_id,product_id,name,quantity,price,cost) VALUES (?,?,?,?,?,?)').run(id, item.id, item.name, item.quantity, item.price, item.cost);
        db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(item.quantity, item.id);
      }
      // Persist the notification in the same transaction as the order. Telegram is never on the checkout response path.
      const header = `Заказ #${id}\nДата: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (Москва)\nКлиент: ${name}${user.username ? ' (@' + user.username + ')' : ''}\nTelegram ID: ${user.id}\nСвязаться: tg://user?id=${user.id}\n`;
      const lines = items.map(item => `${item.name}: ${item.quantity} × ${item.price} ₽ = ${item.quantity * item.price} ₽`);
      const messages = []; let message = header;
      for (const line of [...lines, `ТОВАРЫ: ${total} ₽`, `СПИСАНО РУБЛЕЙ: ${balanceSpend} ₽`, `К ОПЛАТЕ: ${total-balanceSpend} ₽`, 'Получение: согласовать с клиентом.']) {
        if (message.length + line.length + 1 > 3500) { messages.push(message); message = `Заказ #${id} (продолжение)\n`; }
        message += '\n' + line;
      }
      messages.push(message);
      db.prepare('INSERT INTO order_notifications(order_id,messages) VALUES (?,?)').run(id, JSON.stringify(messages));
      db.exec('COMMIT');
      return { order: receipt(id), repeated: false };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function update(id, status, deleted = false) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const order = db.prepare('SELECT * FROM orders WHERE id=? AND deleted=0').get(id);
      if (!order) fail(404, 'Заказ не найден.');
      const reserved = !deleted && status !== 'cancelled';
      if (order.stock_managed && Boolean(order.reserved) !== reserved) {
        const items = db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(id);
        for (const item of items) {
          const product = db.prepare('SELECT stock,deleted FROM products WHERE id=?').get(item.product_id);
          if (reserved && (!product || product.deleted || product.stock < item.quantity)) fail(409, 'Недостаточно товара для восстановления заказа. Оформите закупку.');
          db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(reserved ? -item.quantity : item.quantity, item.product_id);
        }
      }
      if(order.balance_spent>0&&Boolean(order.balance_reserved)!==reserved){
        if(reserved){
          const debit=db.prepare('UPDATE customers SET balance=balance-? WHERE id=? AND balance>=?').run(order.balance_spent,order.customer_id,order.balance_spent);
          if(!debit.changes)fail(409,'На балансе клиента недостаточно рублей для восстановления заказа.');
        }else db.prepare('UPDATE customers SET balance=balance+? WHERE id=?').run(order.balance_spent,order.customer_id);
        db.prepare('INSERT INTO balance_operations(customer_id,order_id,kind,amount,created_at) VALUES (?,?,?,?,?)').run(order.customer_id,id,reserved?'order_payment':'order_refund',reserved?-order.balance_spent:order.balance_spent,new Date().toISOString());
      }
      const now=new Date().toISOString();
      db.prepare("UPDATE orders SET status=?,reserved=?,balance_reserved=?,deleted=?,completed_at=CASE WHEN ?='completed' AND completed_at IS NULL THEN ? ELSE completed_at END WHERE id=?").run(status || order.status, order.stock_managed ? Number(reserved) : 0, Number(order.balance_spent>0&&reserved), Number(deleted),status||order.status,now,id);
      if(!deleted&&status==='completed'&&!order.completed_at)referrals?.reward(order,now);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return { create, update };
}
