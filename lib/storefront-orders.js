import {createTelegramCustomer,telegramCustomerName} from './storefront-referrals.js';
import { verifiedTelegramUser } from './telegram-auth.js';
import { changeProductStock, readProductFlavors } from './product-flavors.js';

export const orderCashbackPercent = 5;
export const orderMetroDeliveryFee = 100;
export const orderBalanceSpendStep = 50;
// https://nsk-metro.ru/map
export const orderMetroLines = [
  {
    label: '🔴 Красная ветка · Ленинская',
    color: 'red',
    stations: ['Заельцовская','Гагаринская','Красный проспект','Площадь Ленина','Октябрьская','Речной вокзал','Спортивная','Студенческая','Площадь Маркса']
  },
  {
    label: '🟢 Зелёная ветка · Дзержинская',
    color: 'green',
    stations: ['Площадь Гарина-Михайловского','Сибирская','Маршала Покрышкина','Берёзовая роща','Золотая нива']
  }
];
const deliveryLabels = {
  pickup: 'Самовывоз',
  metro: 'Доставка по метро',
  address: 'Доставка по адресу'
};

export function createStorefrontOrders(db, { botToken, fail, referrals }) {
  function readDelivery(body) {
    const method = body.delivery_method;
    if (method === undefined) return { delivery:'Согласование с менеджером', address:'' };
    if (typeof method !== 'string' || !Object.hasOwn(deliveryLabels,method)) fail(400,'Выберите способ получения заказа.');
    const delivery = deliveryLabels[method];
    if (method === 'pickup') return { delivery, address:'' };
    const location = body.delivery_location;
    const metro = method === 'metro';
    if (typeof location !== 'string' || !location.trim() || location.length > (metro ? 120 : 300) ||
        !location.isWellFormed() || /\p{Cc}/u.test(location)) {
      fail(400,metro ? 'Выберите станцию метро.' : 'Укажите адрес доставки.');
    }
    const address = location.trim();
    if (metro && !orderMetroLines.some(line=>line.stations.includes(address))) fail(400,'Выберите станцию метро из списка.');
    return { delivery, address };
  }
  const receipt = id => {
    const order = db.prepare("SELECT o.id,CASE WHEN o.deleted=1 THEN 'cancelled' ELSE o.status END AS status,o.created_at,o.meeting_date,o.delivery,o.address,o.delivery_fee,o.balance_spent,c.balance AS balance_after FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?").get(id);
    const items = db.prepare('SELECT product_id,name,quantity,price FROM order_items WHERE order_id=? ORDER BY id').all(id);
    const total=items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    return { ...order, items, total, payable:order.status==='cancelled'?0:total+order.delivery_fee-order.balance_spent };
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
      const {delivery,address} = readDelivery(body);
      const deliveryFee = body.delivery_method==='metro' ? orderMetroDeliveryFee : 0;
      if(body.delivery_fee!==undefined&&body.delivery_fee!==deliveryFee)fail(409,'Изменилась стоимость доставки. Проверьте сумму заказа.');
      const meetingDate = body.meeting_date;
      if (meetingDate !== undefined) {
        const today = new Date().toLocaleDateString('sv-SE', {timeZone:'Europe/Moscow'});
        const timestamp = typeof meetingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(meetingDate)
          ? Date.parse(meetingDate) : NaN;
        if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10)!==meetingDate || meetingDate<today) {
          fail(400,'Выберите действительную дату встречи, начиная с сегодняшнего дня.');
        }
      }
      const balanceSpend=body.balance_spend===undefined?0:body.balance_spend;
      if(!Number.isSafeInteger(balanceSpend)||balanceSpend<0||balanceSpend%orderBalanceSpendStep!==0)fail(400,`Списывайте бонусы с шагом ${orderBalanceSpendStep} ₽.`);
      if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) fail(400, 'В заказе должно быть от 1 до 100 товаров.');
      const selections = new Set();
      for (const item of body.items) {
        if (!item || !Number.isSafeInteger(item.product_id) || item.product_id <= 0 ||
            !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999 ||
            (item.flavor !== undefined && (typeof item.flavor !== 'string' || !item.flavor || item.flavor.length > 80))) {
          fail(400, 'Проверьте товары, вкусы и количество.');
        }
        const selection = JSON.stringify([item.product_id,item.flavor]);
        if(selections.has(selection))fail(400,'Один вкус товара должен быть в одной позиции.');
        selections.add(selection);
      }
      const quantities = new Map();
      const items = body.items.map(item => {
        const product = db.prepare('SELECT id,name,price,cost,stock,flavors,flavor_details FROM products WHERE id=? AND active=1 AND visible=1 AND deleted=0').get(item.product_id);
        const quantity = (quantities.get(item.product_id)||0) + item.quantity;
        const stockError = 'Изменилось наличие товара или вкуса. Обновите каталог и проверьте корзину.';
        if (!product || quantity > 999 || item.quantity > product.stock) fail(409, stockError);
        quantities.set(item.product_id,quantity);
        const inventory = readProductFlavors(product);
        const option = inventory.flavors.get(item.flavor);
        const validFlavor = item.flavor !== undefined ? Boolean(option) : inventory.tracked || !inventory.flavors.size;
        if(!validFlavor){
          fail(409,'Изменились вкусы товара. Обновите каталог и проверьте корзину.');
        }
        const price = product.price + (option?.markup ?? 0);
        if (item.price !== price) fail(409, 'Изменилась цена товара. Обновите каталог и проверьте корзину.');
        const stockFlavor = inventory.tracked && option ? option.name : null;
        changeProductStock(db,product,new Map([[stockFlavor,-item.quantity]]),fail,stockError);
        const name = item.flavor ? `${product.name} — ${item.flavor}` : product.name;
        return { ...product, name, price, stockFlavor, quantity:item.quantity };
      });
      const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      if (!Number.isSafeInteger(total) || total + deliveryFee > 100000000) fail(400, 'Сумма заказа слишком большая. Свяжитесь с менеджером.');
      if(balanceSpend>Math.floor(total/2))fail(400,'Рублями можно оплатить не более 50% стоимости товаров.');
      if(balanceSpend>(customer?.balance??0))fail(409,'На балансе недостаточно рублей. Проверьте сумму списания.');
      if (customer && db.prepare("SELECT COUNT(*) AS count FROM orders WHERE customer_id=? AND stock_managed=1 AND created_at>?").get(customer.id, new Date(Date.now() - 3600000).toISOString()).count >= 20) fail(429, 'Слишком много заказов. Повторите позже или свяжитесь с менеджером.');
      referrals?.track(user);
      const name = telegramCustomerName(user);
      if (!customer) customer = db.prepare('SELECT id FROM customers WHERE telegram_id=?').get(user.id)||createTelegramCustomer(db,user);
      else db.prepare('UPDATE customers SET name=?,username=? WHERE id=?').run(name,user.username,customer.id);
      const result = db.prepare("INSERT INTO orders(customer_id,status,delivery,address,created_at,request_key,stock_managed,reserved,balance_spent,balance_reserved,meeting_date,delivery_fee) VALUES (?,'new',?,?,?,?,1,1,?,?,?,?)").run(customer.id,delivery,address,new Date().toISOString(),body.request_key,balanceSpend,Number(balanceSpend>0),meetingDate??null,deliveryFee);
      const id = Number(result.lastInsertRowid);
      if(balanceSpend>0){
        const debit=db.prepare('UPDATE customers SET balance=balance-? WHERE id=? AND balance>=?').run(balanceSpend,customer.id,balanceSpend);
        if(!debit.changes)fail(409,'На балансе недостаточно рублей. Проверьте сумму списания.');
        db.prepare("INSERT INTO balance_operations(customer_id,order_id,kind,amount,created_at) VALUES (?,?,'order_payment',?,?)").run(customer.id,id,-balanceSpend,new Date().toISOString());
      }
      for (const item of items) {
        db.prepare('INSERT INTO order_items(order_id,product_id,name,quantity,price,cost,stock_flavor) VALUES (?,?,?,?,?,?,?)').run(id, item.id, item.name, item.quantity, item.price, item.cost,item.stockFlavor);
      }
      // Persist the notification in the same transaction as the order. Telegram is never on the checkout response path.
      const meeting = meetingDate ? `Дата встречи: ${meetingDate.split('-').reverse().join('.')}\n` : '';
      const fulfillment = body.delivery_method === undefined ? 'Получение: согласовать с клиентом.\n'
        : `Получение: ${delivery}${address ? ' · ' + address : ''}\n`;
      const header = `Заказ #${id}\nДата: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (Москва)\n${meeting}${fulfillment}Клиент: ${name}${user.username ? ' (@' + user.username + ')' : ''}\nTelegram ID: ${user.id}\nСвязаться: tg://user?id=${user.id}\n`;
      const lines = items.map(item => `${item.name}: ${item.quantity} × ${item.price} ₽ = ${item.quantity * item.price} ₽`);
      const messages = []; let message = header;
      const payableLabel = address && !deliveryFee ? 'К ОПЛАТЕ ЗА ТОВАРЫ' : 'К ОПЛАТЕ';
      const deliveryLine = deliveryFee ? [`ДОСТАВКА: ${deliveryFee} ₽`] : [];
      for (const line of [...lines, `ТОВАРЫ: ${total} ₽`, ...deliveryLine, `СПИСАНО РУБЛЕЙ: ${balanceSpend} ₽`, `${payableLabel}: ${total+deliveryFee-balanceSpend} ₽ наличными`]) {
        if (message.length + line.length + 1 > 3500) { messages.push(message); message = `Заказ #${id} (продолжение)\n`; }
        message += '\n' + line;
      }
      messages.push(message);
      db.prepare('INSERT INTO order_notifications(order_id,messages) VALUES (?,?)').run(id, JSON.stringify(messages));
      db.exec('COMMIT');
      return { order: receipt(id), repeated: false };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function syncCashback(order, completed, now) {
    const { earned } = db.prepare(`SELECT COALESCE(SUM(amount),0) AS earned FROM balance_operations
      WHERE order_id=? AND customer_id=? AND kind IN ('cashback','cashback_reversal')`).get(order.id,order.customer_id);
    let target = 0;
    if (completed) {
      const { total } = db.prepare('SELECT COALESCE(SUM(price*quantity),0) AS total FROM order_items WHERE order_id=?').get(order.id);
      target = Math.floor(total * orderCashbackPercent / 100);
    }
    const amount = target - earned;
    if (!amount) return;
    const changed = db.prepare('UPDATE customers SET balance=balance+? WHERE id=? AND balance+?>=0').run(amount,order.customer_id,amount);
    if (!changed.changes) fail(409,'На балансе клиента недостаточно рублей для списания кэшбека за этот заказ.');
    db.prepare('INSERT INTO balance_operations(customer_id,order_id,kind,amount,created_at) VALUES (?,?,?,?,?)')
      .run(order.customer_id,order.id,amount>0?'cashback':'cashback_reversal',amount,now);
  }
  function update(id, status, deleted = false) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const order = db.prepare('SELECT * FROM orders WHERE id=? AND deleted=0').get(id);
      if (!order) fail(404, 'Заказ не найден.');
      const nextStatus = status ?? order.status;
      const reserved = !deleted && nextStatus !== 'cancelled';
      if (order.stock_managed && Boolean(order.reserved) !== reserved) {
        const items = db.prepare('SELECT product_id,quantity,stock_flavor FROM order_items WHERE order_id=?').all(id);
        for (const item of items) {
          const product = db.prepare('SELECT id,stock,deleted,flavors,flavor_details FROM products WHERE id=?').get(item.product_id);
          const message = 'Недостаточно товара или вкуса для восстановления заказа. Оформите закупку.';
          if (!product || (reserved && product.deleted)) fail(409, message);
          changeProductStock(db,product,new Map([[item.stock_flavor,reserved?-item.quantity:item.quantity]]),fail,message);
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
      const completed = !deleted && nextStatus === 'completed';
      if (completed !== (order.status === 'completed')) syncCashback(order,completed,now);
      db.prepare("UPDATE orders SET status=?,reserved=?,balance_reserved=?,deleted=?,completed_at=CASE WHEN ?='completed' AND completed_at IS NULL THEN ? ELSE completed_at END WHERE id=?").run(nextStatus, order.stock_managed ? Number(reserved) : 0, Number(order.balance_spent>0&&reserved), Number(deleted),nextStatus,now,id);
      if(completed&&!order.completed_at)referrals?.reward(order,now);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return { create, update };
}
