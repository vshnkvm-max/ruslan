import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHmac,createHash} from 'node:crypto';
import {createApp} from '../server.js';
import {hashPassword} from '../lib/auth.js';
const directory=mkdtempSync(join(tmpdir(),'shop-inventory-')),botToken='test-only:telegram-signing-key';
let app,base,cookie,csrf;
before(async()=>{app=createApp({dbPath:join(directory,'test.db'),botToken});app.db.prepare('INSERT INTO admins(username,password) VALUES (?,?)').run('admin',hashPassword('inventory-test-password'));await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}`;const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'inventory-test-password'})});cookie=response.headers.get('set-cookie').split(';')[0];csrf=(await response.json()).csrf;});
after(async()=>{await new Promise(r=>app.server.close(r));rmSync(directory,{recursive:true,force:true});});
async function request(path,method='GET',body,auth=true){const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(auth?{Cookie:cookie,'X-CSRF-Token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json(),headers:response.headers};}
function product(stock=0,cost=10){return Number(app.db.prepare('INSERT INTO products(name,sku,category,price,cost,stock,image) VALUES (?,?,?,?,?,?,?)').run('Inventory item',Math.random().toString(36),'',200,cost,stock,'').lastInsertRowid);}
const saved=id=>app.db.prepare('SELECT * FROM products WHERE id=?').get(id);
test('stock automatically controls visibility independently of archive and manual hiding',async()=>{
 const id=product();assert.equal(saved(id).visible,0);assert.equal(saved(id).active,1);
 const purchase={supplier:'Supplier',posted:true,paid:300,request_key:'visibility-purchase',items:[{product_id:id,quantity:5,cost:100}]};
 const first=await request('/purchases','POST',purchase);assert.equal(first.status,201);assert.equal(saved(id).stock,5);assert.equal(saved(id).visible,1);
 assert.equal((await request(`/products/${id}`,'PATCH',{visible:false})).status,200);assert.equal(saved(id).stock,5);assert.equal(saved(id).active,1);
 assert.ok(!(await request('/storefront','GET',undefined,false)).data.products.some(p=>p.id===id));
 await request(`/products/${id}`,'PATCH',{active:false});
 await request(`/purchases/${first.data.id}`,'PATCH',{...purchase,items:[{product_id:id,quantity:6,cost:100}]});
 assert.equal(saved(id).visible,1);assert.equal(saved(id).active,0);assert.equal(saved(id).stock,6);
 assert.ok(!(await request('/storefront','GET',undefined,false)).data.products.some(p=>p.id===id));
});
test('sales post once, edit atomically, reject overselling and reverse stock/payment on deletion',async()=>{
 const id=product(5,80),body={customer:'Buyer',posted:false,paid:200,request_key:'sale-edit',items:[{product_id:id,quantity:2,price:150}]};
 const created=await request('/sales','POST',body);assert.equal(created.status,201);const saleId=created.data.id;assert.equal(saved(id).stock,5);
 assert.equal((await request(`/sales/${saleId}`,'PATCH',{...body,posted:true})).status,200);assert.equal(saved(id).stock,3);
 assert.equal((await request('/sales','POST',{...body,posted:true})).data.id,saleId);assert.equal(saved(id).stock,3);
 const edit={...body,posted:true,paid:400,items:[{product_id:id,quantity:4,price:160}]};
 assert.equal((await request(`/sales/${saleId}`,'PATCH',edit)).status,200);assert.equal(saved(id).stock,1);
 const sale=app.db.prepare('SELECT * FROM sales WHERE id=?').get(saleId),payment=sale.transaction_id;
 assert.equal(JSON.parse(sale.items)[0].cost,80);assert.equal(app.db.prepare('SELECT amount FROM transactions WHERE id=?').get(payment).amount,400);
 assert.equal((await request(`/transactions/${payment}`,'DELETE')).status,409);
 assert.equal((await request(`/sales/${saleId}`,'PATCH',{...edit,items:[{product_id:id,quantity:6,price:160}]})).status,409);
 assert.equal(saved(id).stock,1);assert.equal(app.db.prepare('SELECT amount FROM transactions WHERE id=?').get(payment).amount,400);
 assert.equal((await request(`/sales/${saleId}`,'DELETE')).status,200);assert.equal(saved(id).stock,5);assert.equal(saved(id).visible,1);
 assert.equal(app.db.prepare('SELECT deleted FROM transactions WHERE id=?').get(payment).deleted,1);
 assert.ok(!(await request('/bootstrap')).data.sales.some(s=>s.id===saleId));
});
test('purchases cannot remove sold stock; subsequent reversal restores quantity and previous cost',async()=>{
 const id=product(),purchase={supplier:'Stock supplier',posted:true,paid:350,request_key:'purchase-reverse',items:[{product_id:id,quantity:5,cost:70}]};
 const p=(await request('/purchases','POST',purchase)).data.id;assert.equal(saved(id).cost,70);
 const s=(await request('/sales','POST',{customer:'Buyer',posted:true,paid:400,request_key:'sold-stock',items:[{product_id:id,quantity:4,price:100}]})).data.id;
 assert.equal(saved(id).stock,1);assert.equal((await request(`/purchases/${p}`,'DELETE')).status,409);
 assert.equal(saved(id).stock,1);assert.equal(app.db.prepare('SELECT deleted FROM purchases WHERE id=?').get(p).deleted,0);
 await request(`/sales/${s}`,'DELETE');assert.equal(saved(id).stock,5);
 assert.equal((await request(`/purchases/${p}`,'PATCH',{...purchase,paid:270,items:[{product_id:id,quantity:3,cost:90}]})).status,200);
 assert.equal(saved(id).stock,3);assert.equal(saved(id).cost,90);
 assert.equal((await request(`/purchases/${p}`,'DELETE')).status,200);assert.equal(saved(id).stock,0);assert.equal(saved(id).visible,0);assert.equal(saved(id).cost,10);
});
test('manual operations can be edited and deleted without leaving stale ledger entries',async()=>{
 const body={type:'income',category:'Other',description:'Manual operation',amount:100},id=(await request('/transactions','POST',body)).data.id;
 assert.equal((await request(`/transactions/${id}`,'PATCH',{...body,type:'expense',amount:150})).status,200);
 assert.equal((await request('/bootstrap')).data.transactions.find(t=>t.id==='t'+id).amount,150);
 assert.equal((await request(`/transactions/${id}`,'DELETE')).status,200);
 assert.ok(!(await request('/bootstrap')).data.transactions.some(t=>t.id==='t'+id));
});
function signedUser(id){const values=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,first_name:'Viewer'}),signature:'test-signature'});const text=[...values].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('\n');values.set('hash',createHmac('sha256',createHmac('sha256','WebAppData').update(botToken).digest()).update(text).digest('hex'));return values.toString();}
test('daily views deduplicate browsers and verified Telegram users across devices',async()=>{
 const id=product(2),view=body=>request(`/storefront/products/${id}/view`,'POST',body,false),a='a'.repeat(64),b='b'.repeat(64);
 assert.equal((await view({visitor_id:a})).data.counted,true);for(let i=0;i<10;i++)assert.equal((await view({visitor_id:a})).data.counted,false);
 assert.equal(saved(id).views,1);assert.equal((await view({visitor_id:b})).data.counted,true);
 const init_data=signedUser(12345);
 assert.equal((await view({visitor_id:'c'.repeat(64),init_data})).data.counted,true);
 assert.equal((await view({visitor_id:'d'.repeat(64),init_data})).data.counted,false);assert.equal(saved(id).views,3);
 const id2=product(1),visitor='e'.repeat(64),yesterday=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()-86400000));
 app.db.prepare('INSERT INTO product_views(product_id,visitor_hash,view_day) VALUES (?,?,?)').run(id2,createHash('sha256').update('browser:'+visitor).digest('hex'),yesterday);app.db.prepare('UPDATE products SET views=1 WHERE id=?').run(id2);
 assert.equal((await request(`/storefront/products/${id2}/view`,'POST',{visitor_id:visitor},false)).data.counted,true);assert.equal(saved(id2).views,2);
});

test('removing purchases in either order restores the original cost and unposting restores stock',async()=>{
 const id=product(0,17),body=(key,cost)=>({supplier:'Supplier',posted:true,paid:0,request_key:key,items:[{product_id:id,quantity:3,cost}]});
 const first=(await request('/purchases','POST',body('cost-first',50))).data.id;
 const second=(await request('/purchases','POST',body('cost-second',90))).data.id;
 assert.equal((await request(`/purchases/${first}`,'DELETE')).status,200);assert.equal(saved(id).cost,90);
 assert.equal((await request(`/purchases/${second}`,'DELETE')).status,200);assert.equal(saved(id).stock,0);assert.equal(saved(id).cost,17);
 const third=(await request('/purchases','POST',body('cost-third',70))).data.id;
 assert.equal((await request(`/purchases/${third}`,'PATCH',{...body('cost-third',70),posted:false})).status,200);
 assert.equal(saved(id).stock,0);assert.equal(saved(id).cost,17);
 assert.equal((await request(`/purchases/${third}`,'PATCH',body('cost-third',70))).status,200);assert.equal(saved(id).stock,3);assert.equal(saved(id).cost,70);
});

test('photo fitting mode is validated, public, and preserved by legacy full-product edits',async()=>{
 const id=product(3);assert.equal(saved(id).image_fit,'auto');
 assert.equal((await request(`/products/${id}`,'PATCH',{image_fit:'contain'})).status,200);
 assert.equal((await request('/storefront','GET',undefined,false)).data.products.find(p=>p.id===id).image_fit,'contain');
 const record=saved(id),body={name:record.name,sku:record.sku,category:record.category,price:record.price,cost:record.cost,active:true,image:'',description:'Edited'};
 assert.equal((await request(`/products/${id}`,'PATCH',body)).status,200);assert.equal(saved(id).image_fit,'contain');
 assert.equal((await request(`/products/${id}`,'PATCH',{image_fit:'invalid'})).status,400);assert.equal(saved(id).image_fit,'contain');
 const created=await request('/products','POST',{...body,sku:'mode-create',image_fit:'cover',request_key:'mode-create'});assert.equal(created.status,201);assert.equal(saved(created.data.id).image_fit,'cover');
});
