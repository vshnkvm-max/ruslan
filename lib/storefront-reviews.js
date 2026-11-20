import { verifiedTelegramUser } from './telegram-auth.js';
export const reviewWindow = 7 * 86400000;

export function createStorefrontReviews(db, { botToken, fail, serialize = rows => rows }) {
  function customer(initData) {
    if(!botToken)fail(503,'Отзывы временно недоступны.');
    const user = verifiedTelegramUser(initData, botToken);
    if (!user) fail(401, 'Откройте магазин заново через Telegram.');
    const row = db.prepare('SELECT * FROM customers WHERE telegram_id=? AND deleted=0 AND banned=0').get(user.id);
    if (!row) fail(403, 'Оставить отзыв можно после выполненного заказа.');
    return { ...row, author: user.first_name.trim().slice(0,80) || 'Покупатель' };
  }
  function purchase(c, orderId, productId) {
    if (!Number.isSafeInteger(orderId) || !Number.isSafeInteger(productId)) fail(400, 'Выберите купленный товар.');
    const order = db.prepare(`SELECT o.completed_at FROM orders o JOIN order_items i ON i.order_id=o.id JOIN products p ON p.id=i.product_id
      WHERE o.id=? AND o.customer_id=? AND o.status='completed' AND o.deleted=0 AND i.product_id=? AND p.deleted=0`).get(orderId,c.id,productId);
    const completed = Date.parse(order?.completed_at);
    if (!Number.isFinite(completed) || completed > Date.now() || Date.now()-completed >= reviewWindow) fail(403, 'Отзыв доступен в течение 7 дней после выполнения заказа.');
    if (db.prepare('SELECT id FROM reviews WHERE customer_id=? AND order_id=? AND product_id=?').get(c.id,orderId,productId)) fail(409,'Вы уже оставили отзыв об этом товаре в заказе.');
    return order;
  }
  function eligible(initData, productId = null, offset = 0) {
    if(!botToken)fail(503,'Отзывы временно недоступны.');
    const user = verifiedTelegramUser(initData, botToken);
    if (!user) fail(401, 'Откройте магазин через Telegram, чтобы оставить отзыв.');
    const c = db.prepare('SELECT id FROM customers WHERE telegram_id=? AND deleted=0 AND banned=0').get(user.id);
    if (!c) return { items:[], next_offset:null, total:0, next_expiry:null };
    const rows = db.prepare(`SELECT o.id AS order_id,i.product_id,CASE WHEN COUNT(DISTINCT i.name)>1 THEN p.name ELSE MIN(i.name) END AS product_name,o.completed_at,COUNT(*) OVER() AS eligible_count,MIN(o.completed_at) OVER() AS earliest_completed
      FROM orders o JOIN order_items i ON i.order_id=o.id JOIN products p ON p.id=i.product_id
      WHERE o.customer_id=? AND o.deleted=0 AND o.status='completed' AND p.deleted=0
      AND julianday(o.completed_at)>julianday(?) AND julianday(o.completed_at)<=julianday(?) AND (? IS NULL OR i.product_id=?)
      AND NOT EXISTS(SELECT 1 FROM reviews r WHERE r.customer_id=o.customer_id AND r.order_id=o.id AND r.product_id=i.product_id)
      GROUP BY o.id,i.product_id ORDER BY o.completed_at DESC,o.id DESC,i.product_id LIMIT 201 OFFSET ?`).all(c.id,new Date(Date.now()-reviewWindow).toISOString(),new Date().toISOString(),productId,productId,offset);
    const more=rows.length>200;if(more)rows.pop();
    return {total:rows[0]?.eligible_count||0,next_expiry:rows[0]?new Date(Date.parse(rows[0].earliest_completed)+reviewWindow).toISOString():null,items:rows.map(({eligible_count,earliest_completed,...row})=>({...row,expires_at:new Date(Date.parse(row.completed_at)+reviewWindow).toISOString()})),next_offset:more?offset+200:null};
  }
  function list({productId=null,sort='newest',media=false,offset=0,limit=20}={}) {
    const orders={newest:'r.created_at DESC,r.id DESC',oldest:'r.created_at,r.id',rating_asc:'r.rating,r.created_at DESC,r.id DESC',rating_desc:'r.rating DESC,r.created_at DESC,r.id DESC'};
    if(!orders[sort])fail(400,'Неизвестная сортировка отзывов.');
    const where="r.status='published' AND p.deleted=0 AND (? IS NULL OR r.product_id=?) AND (?=0 OR EXISTS(SELECT 1 FROM review_media m WHERE m.review_id=r.id))";
    const args=[productId,productId,Number(media)];
    const summary=db.prepare(`SELECT COUNT(*) AS total,COALESCE(AVG(r.rating),0) AS average FROM reviews r JOIN products p ON p.id=r.product_id WHERE ${where}`).get(...args);
    const rows=db.prepare(`SELECT r.id,r.product_id,r.rating,r.text,r.created_at,r.author_name,c.name AS customer_name,p.name AS product_name
      FROM reviews r JOIN customers c ON c.id=r.customer_id JOIN products p ON p.id=r.product_id WHERE ${where}
      ORDER BY ${orders[sort]} LIMIT ? OFFSET ?`).all(...args,limit,offset);
    return {...summary,items:serialize(rows),next_offset:offset+rows.length<summary.total?offset+rows.length:null};
  }
  function create(body) {
    const c=customer(body.init_data);
    if(typeof body.request_key!=='string'||!/^[a-zA-Z0-9_-]{20,100}$/.test(body.request_key))fail(400,'Обновите форму отзыва.');
    const existing=db.prepare('SELECT id,status,order_id,product_id FROM reviews WHERE customer_id=? AND request_key=?').get(c.id,body.request_key);
    if(existing)return {review:existing,repeated:true};
    if(!Number.isInteger(body.rating)||body.rating<1||body.rating>5)fail(400,'Выберите оценку от 1 до 5 звёзд.');
    const text=body.text??'';
    if(typeof text!=='string'||text.length>2000)fail(400,'Текст отзыва — не более 2000 символов.');
    const ids=body.media_ids??[];
    if(!Array.isArray(ids)||ids.length>5||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))fail(400,'Можно приложить до 5 фото или видео.');
    db.exec('BEGIN IMMEDIATE');
    try {
      purchase(c,body.order_id,body.product_id);
      let mediaBytes=0;
      for(const id of ids){
        const file=db.prepare('SELECT * FROM review_media WHERE id=?').get(id);
        if(!file||file.customer_id!==c.id||file.order_id!==body.order_id||file.product_id!==body.product_id||file.review_id!==null)fail(400,'Медиа недоступно. Загрузите файл заново.');
        mediaBytes+=file.size;
      }
      if(mediaBytes>40*1024*1024)fail(400,'Общий размер медиа — не более 40 МБ.');
      const inserted=db.prepare("INSERT INTO reviews(customer_id,product_id,order_id,rating,text,status,created_at,author_name,request_key) VALUES (?,?,?,?,?,'pending',?,?,?)").run(c.id,body.product_id,body.order_id,body.rating,text.trim(),new Date().toISOString(),c.author,body.request_key);
      const id=Number(inserted.lastInsertRowid);
      for(const mediaId of ids)db.prepare('UPDATE review_media SET review_id=? WHERE id=?').run(id,mediaId);
      db.exec('COMMIT');return {review:{id,status:'pending',order_id:body.order_id,product_id:body.product_id},repeated:false};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  return {customer,purchase,eligible,list,create};
}
