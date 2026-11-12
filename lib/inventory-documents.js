export function createInventoryDocuments(db,{fail,str,num,bool,token}) {
 const tableFor=kind=>kind==='sale'?'sales':'purchases';
 function get(kind,id){return db.prepare(`SELECT * FROM ${tableFor(kind)} WHERE id=? AND deleted=0`).get(id);}
 function previousCost(item,seen=new Set()){
  if(!item||seen.has(item.previous_purchase_id))return item?.previous_cost;
  if(!item.previous_purchase_id)return item.previous_cost;
  seen.add(item.previous_purchase_id);
  const source=db.prepare('SELECT items FROM purchases WHERE id=?').get(item.previous_purchase_id);
  const predecessor=source&&JSON.parse(source.items).find(line=>line.product_id===item.product_id);
  return predecessor?previousCost(predecessor,seen)??item.previous_cost:item.previous_cost;
 }
 function run(kind,id,body,remove=false){
  const table=tableFor(kind),sign=kind==='sale'?-1:1;
  db.exec('BEGIN IMMEDIATE');
  try{
   const previous=id?get(kind,id):null;if(id&&!previous)fail(404,'Документ не найден.');
   if(!id&&!remove)str(body.request_key,'Ключ документа',80);
   if(!id&&body.request_key){const existing=db.prepare(`SELECT id,deleted FROM ${table} WHERE request_key=?`).get(body.request_key);if(existing){if(existing.deleted)fail(409,'Документ уже удалён. Откройте новую форму.');db.exec('COMMIT');return {id:existing.id,repeated:true};}}
   const oldItems=previous?JSON.parse(previous.items):[];
   let posted=false,paid=0,total=0,party='',comment='',items=[],key=previous?.request_key;
   if(!remove){
    posted=Boolean(bool(body.posted));paid=num(body.paid,'Оплачено');party=str(body[kind==='sale'?'customer':'supplier'],kind==='sale'?'Покупатель':'Поставщик');comment=str(body.comment??'','Комментарий',2000,false);key=previous?.request_key||str(body.request_key??token(),'Ключ документа',80);
    if(!Array.isArray(body.items)||!body.items.length||body.items.length>100)fail(400,'Добавьте от 1 до 100 товаров.');
    const seen=new Set(),previousPurchases=new Map();
    if(kind!=='sale')for(const document of db.prepare('SELECT id,items FROM purchases WHERE deleted=0 AND posted=1 ORDER BY posted_at DESC,id DESC').all())for(const line of JSON.parse(document.items))if(!previousPurchases.has(line.product_id))previousPurchases.set(line.product_id,{id:document.id,cost:line.cost});
    items=body.items.map(line=>{
     const productId=num(line.product_id,'Товар'),quantity=num(line.quantity,'Количество',1000000),unit=num(line[kind==='sale'?'price':'cost'],kind==='sale'?'Цена продажи':'Цена закупки');
     if(!quantity||seen.has(productId))fail(400,'Количество должно быть больше нуля; товары не должны повторяться.');seen.add(productId);
     const product=db.prepare('SELECT * FROM products WHERE id=?').get(productId),old=oldItems.find(item=>item.product_id===productId);
     if(!product||((product.deleted||!product.active)&&!old))fail(400,'Один из товаров удалён или находится в архиве.');
     total+=quantity*unit;if(!Number.isSafeInteger(total)||total>100000000)fail(400,'Сумма документа превышает 100000000 ₽.');
     const item={product_id:productId,name:product.name,sku:product.sku,quantity};
     if(kind==='sale'){item.price=unit;item.cost=old?.cost??product.cost;}else{item.cost=unit;item.previous_cost=old?.previous_cost??product.cost;
      if(old){if(old.previous_purchase_id)item.previous_purchase_id=old.previous_purchase_id;}else{
       const last=previousPurchases.get(productId);if(last?.cost===product.cost)item.previous_purchase_id=last.id;
      }}
     return item;
    });
    if(paid>total)fail(400,'Оплата не может превышать итог документа.');
   }
   const deltas=new Map(),add=(item,multiplier)=>deltas.set(item.product_id,(deltas.get(item.product_id)||0)+item.quantity*multiplier);
   if(previous?.posted)oldItems.forEach(item=>add(item,-sign));if(posted)items.forEach(item=>add(item,sign));
   for(const [productId,delta] of deltas){const product=db.prepare('SELECT stock FROM products WHERE id=?').get(productId);if(!product)fail(409,'Товар из документа не найден.');const stock=product.stock+delta;if(stock<0||stock>1000000)fail(409,'Недостаточно остатка для изменения документа. Сначала исправьте связанные продажи или закупки.');}
   const now=new Date().toISOString(),postedAt=posted?(previous?.posted_at||now):null;
   if(remove)db.prepare(`UPDATE ${table} SET deleted=1 WHERE id=?`).run(id);
   else if(previous){
    db.prepare(`UPDATE ${table} SET ${kind==='sale'?'customer':'supplier'}=?,posted=?,paid=?,total=?,comment=?,items=?,posted_at=? WHERE id=?`).run(party,Number(posted),paid,total,comment,JSON.stringify(items),postedAt,id);
   }else{
    const store=kind==='sale'?[]:[str(body.store??'','Магазин',200,false)];
    id=Number(db.prepare(`INSERT INTO ${table} (${kind==='sale'?'customer':'supplier,store'},posted,paid,total,comment,items,created_at,posted_at,request_key) VALUES (${Array(kind==='sale'?9:10).fill('?').join(',')})`).run(party,...store,Number(posted),paid,total,comment,JSON.stringify(items),now,postedAt,key).lastInsertRowid);
   }
   for(const [productId,delta] of deltas)if(delta)db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(delta,productId);
   if(kind!=='sale'&&deltas.size){const latestCosts=new Map();for(const row of db.prepare('SELECT items FROM purchases WHERE deleted=0 AND posted=1 ORDER BY posted_at DESC,id DESC').all())for(const item of JSON.parse(row.items))if(!latestCosts.has(item.product_id))latestCosts.set(item.product_id,item);
   for(const productId of deltas.keys()){
    const latest=latestCosts.get(productId);
    const fallback=previousCost(oldItems.find(item=>item.product_id===productId));
    if(latest||fallback!==undefined)db.prepare('UPDATE products SET cost=? WHERE id=?').run(latest?.cost??fallback,productId);
   }}
   const payment=previous?.transaction_id;
   if(!remove&&posted&&paid){
    const args=[kind==='sale'?'income':'expense',kind==='sale'?'Продажа':'Закупка',`${kind==='sale'?'Продажа':'Закупка'} #${id} · ${party}`,paid];
    if(payment)db.prepare('UPDATE transactions SET type=?,category=?,description=?,amount=?,deleted=0 WHERE id=?').run(...args,payment);
    else{const result=db.prepare('INSERT INTO transactions(type,category,description,amount,created_at) VALUES (?,?,?,?,?)').run(...args,now);db.prepare(`UPDATE ${table} SET transaction_id=? WHERE id=?`).run(Number(result.lastInsertRowid),id);}
   }else if(payment)db.prepare('UPDATE transactions SET deleted=1 WHERE id=?').run(payment);
   db.exec('COMMIT');return {id};
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 return {get,save:(kind,id,body)=>run(kind,id,body),remove:(kind,id)=>run(kind,id,{},true)};
}
