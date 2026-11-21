import { changeProductStock, flavorKey, flavorName, readProductFlavors, validateFlavorPrice, writeProductFlavors } from './product-flavors.js';

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
 function documentFlavors(kind, product, rows, old){
  if(!Array.isArray(rows)||!rows.length||rows.length>(kind==='sale'?51:50))fail(400,'Проверьте список вкусов товара.');
  const inventory=readProductFlavors(product);
  const names=new Map([...inventory.flavors.keys()].map(name=>[flavorKey(name),name]));
  const seen=new Set();
  let changed=kind==='purchase'&&!inventory.tracked;
  if(kind==='purchase')inventory.tracked=true;
  const result=rows.map(row=>{
   const name=kind==='sale'&&row?.name===null?null:flavorName(row?.name,str,fail);
   const key=name===null?null:flavorKey(name);
   if(seen.has(key))fail(400,'Названия вкусов должны различаться.');
   seen.add(key);
   const quantity=num(row.quantity,'Количество вкуса',1000000);
   if(kind==='sale'){
    if(!inventory.tracked||(name!==null&&!inventory.flavors.has(name)))fail(409,'Список вкусов товара изменился. Обновите документ.');
    return {name,quantity};
   }
   if(names.has(key)&&names.get(key)!==name)fail(409,'Вкус с таким названием уже есть. Используйте его из списка.');
   let option=inventory.flavors.get(name);
   if(!option){
    if(inventory.flavors.size>=50)fail(400,'Добавьте до 50 вкусов.');
    option={name,stock:0,markup:0};
    inventory.flavors.set(name,option);
    names.set(key,name);
    changed=true;
   }
   if(row.markup!==undefined){
    validateFlavorPrice(product.price,row.markup,fail);
    if(option.markup!==row.markup){option.markup=row.markup;changed=true;}
   }
   const markup=row.markup??old?.flavors?.find(entry=>entry.name===name)?.markup??option.markup;
   return {name,quantity,markup};
  });
  if(changed)writeProductFlavors(db,product.id,inventory);
  return result;
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
     const productId=num(line?.product_id,'Товар'),unit=num(line[kind==='sale'?'price':'cost'],kind==='sale'?'Цена продажи':'Цена закупки');
     if(seen.has(productId))fail(400,'Товары в документе не должны повторяться.');
     seen.add(productId);
     const product=db.prepare('SELECT * FROM products WHERE id=?').get(productId),old=oldItems.find(item=>item.product_id===productId);
     if(!product||((product.deleted||!product.active)&&!old))fail(400,'Один из товаров удалён или находится в архиве.');
     if(kind!=='sale'&&line.flavors===undefined&&(old?.flavors||(!old&&JSON.parse(product.flavors).length))){
      fail(400,'Укажите количество каждого вкуса в строке товара.');
     }
     const flavors=line.flavors===undefined?undefined:documentFlavors(kind,product,line.flavors,old);
     const quantity=num(flavors?flavors.reduce((sum,option)=>sum+option.quantity,0):line.quantity,'Количество',1000000);
     if(!quantity&&(posted||!flavors||kind==='sale'))fail(400,'Количество должно быть больше нуля.');
     total+=quantity*unit;if(!Number.isSafeInteger(total)||total>100000000)fail(400,'Сумма документа превышает 100000000 ₽.');
     const item={product_id:productId,name:product.name,sku:product.sku,quantity};
     if(flavors)item.flavors=flavors;
     if(kind==='sale'){item.price=unit;item.cost=old?.cost??product.cost;}else{item.cost=unit;item.previous_cost=old?.previous_cost??product.cost;
      if(old){if(old.previous_purchase_id)item.previous_purchase_id=old.previous_purchase_id;}else{
       const last=previousPurchases.get(productId);if(last?.cost===product.cost)item.previous_purchase_id=last.id;
      }}
     return item;
    });
    if(paid>total)fail(400,'Оплата не может превышать итог документа.');
   }
   const deltas=new Map();
   const add=(item,multiplier)=>{
    const changes=deltas.get(item.product_id)??new Map();
    for(const {name,quantity} of item.flavors??[{name:null,quantity:item.quantity}]){
     changes.set(name,(changes.get(name)||0)+quantity*multiplier);
    }
    deltas.set(item.product_id,changes);
   };
   if(previous?.posted)oldItems.forEach(item=>add(item,-sign));if(posted)items.forEach(item=>add(item,sign));
   for(const [productId,changes] of deltas){
    const product=db.prepare('SELECT id,stock,flavors,flavor_details FROM products WHERE id=?').get(productId);
    if(!product)fail(409,'Товар из документа не найден.');
    changeProductStock(db,product,changes,fail,'Недостаточно остатка товара или выбранного вкуса для изменения документа. Проверьте связанные продажи и закупки.',1000000);
   }
   const now=new Date().toISOString(),postedAt=posted?(previous?.posted_at||now):null;
   if(remove)db.prepare(`UPDATE ${table} SET deleted=1 WHERE id=?`).run(id);
   else if(previous){
    db.prepare(`UPDATE ${table} SET ${kind==='sale'?'customer':'supplier'}=?,posted=?,paid=?,total=?,comment=?,items=?,posted_at=? WHERE id=?`).run(party,Number(posted),paid,total,comment,JSON.stringify(items),postedAt,id);
   }else{
    const store=kind==='sale'?[]:[str(body.store??'','Магазин',200,false)];
    id=Number(db.prepare(`INSERT INTO ${table} (${kind==='sale'?'customer':'supplier,store'},posted,paid,total,comment,items,created_at,posted_at,request_key) VALUES (${Array(kind==='sale'?9:10).fill('?').join(',')})`).run(party,...store,Number(posted),paid,total,comment,JSON.stringify(items),now,postedAt,key).lastInsertRowid);
   }
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
