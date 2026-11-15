import {randomUUID} from 'node:crypto';
export const reviewPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAKUlEQVR4nO3NsQkAAAzDsPz/c6FPJJvAs5VLpm3vAAAAAAAAAAAAoNgDp+T0Ltwd/VwAAAAASUVORK5CYII=','base64');
export function reviewBuyer(db,telegramId=101){return Number(db.prepare("INSERT INTO customers(name,username,email,city,joined,referral_code,telegram_id) VALUES ('Покупатель Фамилия','buyer','','','now',?,?)").run(randomUUID(),telegramId).lastInsertRowid);}
export function reviewProduct(db,name='Товар для отзыва'){return Number(db.prepare("INSERT INTO products(name,sku,category,price,cost,stock,image) VALUES (?,?,'Категория',1000,100,100,'')").run(name,randomUUID()).lastInsertRowid);}
export function reviewOrder(db,customerId,productId,{age=1000,status='completed',deleted=0}={}){
 const date=new Date(Date.now()-age).toISOString();
 const id=Number(db.prepare("INSERT INTO orders(customer_id,status,delivery,address,created_at,completed_at,deleted) VALUES (?,?,'Самовывоз','',?,?,?)").run(customerId,status,date,status==='completed'?date:null,deleted).lastInsertRowid);
 db.prepare("INSERT INTO order_items(order_id,product_id,name,quantity,price,cost) VALUES (?,?,(SELECT name FROM products WHERE id=?),1,1000,100)").run(id,productId,productId);return id;
}
