import { createHmac } from 'node:crypto';
export const profileBotToken = 'test-only:profile-bot';
export function signedProfileUser(id = 101, startParam) {
  const fields = new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,first_name:'Покупатель',username:'same_username'})});
  if(startParam!==undefined)fields.set('start_param',startParam);
  const text = [...fields].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('\n');
  fields.set('hash',createHmac('sha256',createHmac('sha256','WebAppData').update(profileBotToken).digest()).update(text).digest('hex'));
  return fields.toString();
}
export function insertProfileFixtures(db) {
  for(const [id,telegramId] of [[1,101],[2,202]])db.prepare("INSERT INTO customers(id,name,username,email,city,joined,referral_code,telegram_id) VALUES (?,'Покупатель','same_username','','','2026-11-01',?,?)").run(id,'CODE'+id,telegramId);
  db.prepare("INSERT INTO products(id,name,sku,category,price,cost,stock,image) VALUES (1,'Тестовый товар','PROFILE','Категория',2000,700,25,'')").run();
  for(const [id,customer,status,deleted,lines] of [[1,1,'new',0,[[2,2000],[1,500]]],[2,1,'completed',0,[[1,2300]]],[3,1,'cancelled',0,[[1,9000]]],[4,1,'completed',1,[[1,9999]]],[5,2,'completed',0,[[1,50000]]]]){
    db.prepare("INSERT INTO orders(id,customer_id,status,delivery,address,created_at,deleted) VALUES (?,?,?,'Самовывоз','','2026-11-01',?)").run(id,customer,status,deleted);
    for(const [quantity,price] of lines)db.prepare("INSERT INTO order_items(order_id,product_id,name,quantity,price,cost) VALUES (?,1,'Тестовый товар',?,?,700)").run(id,quantity,price);
  }
  for(let id=1;id<=23;id++)db.prepare("INSERT INTO reviews(id,customer_id,product_id,rating,text,status,created_at) VALUES (?,1,1,5,?,?,'2026-11-01')").run(id,id===1?'<img src=x onerror=alert(1)>':'Мой отзыв '+id,['pending','published','hidden'][id%3]);
  db.prepare("INSERT INTO reviews(id,customer_id,product_id,rating,text,status,created_at) VALUES (24,2,1,4,'Чужой отзыв','published','2026-11-01')").run();
}
