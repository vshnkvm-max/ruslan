import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { hashPassword } from '../lib/auth.js';
import { insertTestFixtures } from './fixtures/store.js';

let app,base,cookie,csrf;
const temp=mkdtempSync(join(tmpdir(),'shop-test-'));
const dbPath=join(temp,'test.db');
const password='test-only-password-2026';
async function request(path,{method='GET',body,auth=true,headers={}}={}) {
  const res=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(auth?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {res,data:await res.json()};
}
before(async()=>{
  app=createApp({dbPath});
  app.db.prepare('INSERT INTO admins (username,password) VALUES (?,?)').run('admin',hashPassword(password));
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${app.server.address().port}`;
});
after(async()=>{await new Promise(resolve=>app.server.close(resolve));rmSync(temp,{recursive:true,force:true});});

test('private API rejects unauthenticated requests',async()=>{
  const {res}=await request('/bootstrap',{auth:false});assert.equal(res.status,401);
});
test('invalid credentials are rejected; valid login issues a protected cookie',async()=>{
  assert.equal((await request('/auth/login',{method:'POST',auth:false,body:{username:'admin',password:'wrong'}})).res.status,401);
  const {res,data}=await request('/auth/login',{method:'POST',auth:false,body:{username:'admin',password}});
  assert.equal(res.status,200);assert.equal(data.username,'admin');assert.match(res.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  cookie=res.headers.get('set-cookie').split(';')[0];csrf=data.csrf;
  assert.equal((await request('/auth/me')).data.username,'admin');
});
test('new store starts empty, with blank information and disabled referrals',async()=>{
  const {res,data}=await request('/bootstrap');assert.equal(res.status,200);
  for(const key of ['products','customers','orders','reviews','transactions','referrals','banners']) assert.deepEqual(data[key],[],key);
  assert.deepEqual(data.shop,{name:'',headline:'',description:'',phone:'',address:'',hours:''});
  assert.deepEqual(data.referral,{enabled:false,bonus:0,minPayout:0});
  assert.equal(data.admins,undefined);assert.equal(data.sessions,undefined);
  const storefront=(await request('/storefront',{auth:false})).data;
  assert.deepEqual(storefront.products,[]);assert.deepEqual(storefront.banners,[]);
});
test('empty store remains empty after restart and administrator access is preserved',async()=>{
  await new Promise(resolve=>app.server.close(resolve));
  app=createApp({dbPath});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}`;
  const {res,data}=await request('/bootstrap');assert.equal(res.status,200);
  for(const key of ['products','customers','orders','reviews','transactions','referrals','banners']) assert.deepEqual(data[key],[],key);
  assert.equal((await request('/auth/me')).data.username,'admin');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM admins').get().n,1);
});
test('explicit test-only fixtures prepare business scenarios',async()=>{
  insertTestFixtures(app.db);
  const {res,data}=await request('/bootstrap');assert.equal(res.status,200);
  assert.equal(data.products.length,12);assert.ok(data.orders.every(o=>o.items.length));
  assert.equal(data.customers.length,8);assert.equal(data.reviews.length,6);
});
test('writes require CSRF and reject requests from another origin',async()=>{
  const body={enabled:true,bonus:200,minPayout:1000};
  assert.equal((await request('/settings/referral',{method:'PATCH',body,headers:{'X-CSRF-Token':''}})).res.status,403);
  assert.equal((await request('/settings/referral',{method:'PATCH',body,headers:{Origin:'https://untrusted.example'}})).res.status,403);
});
test('product creation, validation, duplicate SKU, editing and public visibility',async()=>{
  const body={name:'Test product',sku:'TEST-001',category:'Для дома',price:2490,cost:1200,stock:3,active:true,image:'cup',description:'Test description'};
  assert.equal((await request('/products',{method:'POST',body:{...body,price:-1}})).res.status,400);
  assert.equal((await request('/products',{method:'POST',body:{...body,stock:1.5}})).res.status,400);
  const created=await request('/products',{method:'POST',body});assert.equal(created.res.status,201);
  assert.equal((await request('/products',{method:'POST',body})).res.status,409);
  const id=created.data.id;
  let storefront=(await request('/storefront',{auth:false})).data;
  const product=storefront.products.find(p=>p.id===id);assert.equal(product.price,2490);assert.equal(product.cost,undefined);
  assert.equal((await request(`/products/${id}`,{method:'PATCH',body:{...body,name:'Updated product',active:false}})).res.status,200);
  storefront=(await request('/storefront',{auth:false})).data;assert.ok(!storefront.products.some(p=>p.id===id));
  const saved=(await request('/bootstrap')).data.products.find(p=>p.id===id);assert.equal(saved.name,'Updated product');assert.equal(saved.stock,3);
});
test('customer blocking changes status and preserves order history',async()=>{
  assert.equal((await request('/customers/1',{method:'PATCH',body:{banned:true}})).res.status,200);
  const c=(await request('/bootstrap')).data.customers.find(c=>c.id===1);assert.equal(c.banned,1);assert.ok(c.orders_count>0);
});
test('order completion adds revenue exactly once and reverting removes it',async()=>{
  const original=(await request('/bootstrap')).data;
  const order=original.orders.find(o=>o.status==='new');
  const income=data=>data.transactions.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  await request(`/orders/${order.id}`,{method:'PATCH',body:{status:'completed'}});
  assert.equal(income((await request('/bootstrap')).data),income(original)+order.total);
  await request(`/orders/${order.id}`,{method:'PATCH',body:{status:'completed'}});
  assert.equal(income((await request('/bootstrap')).data),income(original)+order.total);
  await request(`/orders/${order.id}`,{method:'PATCH',body:{status:'cancelled'}});
  assert.equal(income((await request('/bootstrap')).data),income(original));
  assert.equal((await request(`/orders/${order.id}`,{method:'PATCH',body:{status:'invalid'}})).res.status,400);
});
test('manual ledger entries validate the amount and persist',async()=>{
  const body={type:'expense',category:'Прочее',description:'Тестовая операция',amount:500};
  assert.equal((await request('/transactions',{method:'POST',body:{...body,amount:0}})).res.status,400);
  assert.equal((await request('/transactions',{method:'POST',body})).res.status,201);
  assert.ok((await request('/bootstrap')).data.transactions.some(t=>t.description===body.description&&t.amount===500));
});
test('review moderation and referral conditions persist',async()=>{
  await request('/reviews/1',{method:'PATCH',body:{status:'hidden'}});
  await request('/settings/referral',{method:'PATCH',body:{enabled:false,bonus:450,minPayout:1500}});
  const data=(await request('/bootstrap')).data;
  assert.equal(data.reviews.find(r=>r.id===1).status,'hidden');assert.deepEqual(data.referral,{enabled:false,bonus:450,minPayout:1500});
});
test('store information and banners appear in public API without private data',async()=>{
  const shop={...(await request('/bootstrap')).data.shop,name:'Test Store',description:'Persisted description'};
  assert.equal((await request('/settings/shop',{method:'PATCH',body:shop})).res.status,200);
  const body={title:'Test banner',subtitle:'Test',color:'#abcdef',link:'/catalog',active:true};
  assert.equal((await request('/banners',{method:'POST',body:{...body,link:'javascript:alert(1)'}})).res.status,400);
  assert.equal((await request('/banners',{method:'POST',body:{...body,color:'bad-color'}})).res.status,400);
  const {data}=await request('/banners',{method:'POST',body});
  let publicData=(await request('/storefront',{auth:false})).data;
  assert.equal(publicData.shop.name,'Test Store');assert.ok(publicData.banners.some(b=>b.id===data.id));
  for(const field of ['customers','orders','transactions','referrals','admins'])assert.equal(publicData[field],undefined);
  await request(`/banners/${data.id}`,{method:'PATCH',body:{...body,active:false}});
  assert.ok(!(await request('/storefront',{auth:false})).data.banners.some(b=>b.id===data.id));
  await request(`/banners/${data.id}`,{method:'DELETE'});
  assert.equal((await request(`/banners/${data.id}`,{method:'DELETE'})).res.status,404);
});

test('product photos validate formats, persist, appear on storefront and can be removed',async()=>{
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0a0AAAAASUVORK5CYII=';
 const product={name:'Photo product',sku:'PHOTO-1',category:'Test',price:10,cost:5,stock:1,active:true,image,description:''};
 const created=await request('/products',{method:'POST',body:product});assert.equal(created.res.status,201);
 const productId=created.data.id;
 assert.equal((await request('/storefront',{auth:false})).data.products.find(p=>p.id===productId).image,image);
 for(const invalid of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YWJj', 'https://example.com/image.jpg','x'.repeat(700001)])assert.equal((await request(`/products/${productId}`,{method:'PATCH',body:{...product,image:invalid}})).res.status,400);
 assert.equal((await request(`/products/${productId}`,{method:'PATCH',body:{...product,image:''}})).res.status,200);
 assert.equal((await request('/bootstrap')).data.products.find(p=>p.id===productId).image,'');
});

test('customer CRUD preserves order history and validates contact fields',async()=>{
 const customer={name:'Новый клиент',username:'test-client',phone:'+7 999 123-45-67',email:'client@example.com',city:'Москва',status:'pending'};
 assert.equal((await request('/customers',{method:'POST',body:{...customer,email:'bad'}})).res.status,400);
 const created=await request('/customers',{method:'POST',body:customer});assert.equal(created.res.status,201);
 const id=created.data.id;let saved=(await request('/bootstrap')).data.customers.find(c=>c.id===id);
 assert.equal(saved.order_total,0);assert.equal(saved.phone,customer.phone);assert.equal(saved.status,'pending');assert.equal(saved.last_order,null);
 const {email:omitted,...withoutEmail}=customer;assert.equal((await request(`/customers/${id}`,{method:'PATCH',body:withoutEmail})).res.status,200);assert.equal((await request('/bootstrap')).data.customers.find(c=>c.id===id).email,customer.email);
 assert.equal((await request(`/customers/${id}`,{method:'PATCH',body:{...customer,name:'Изменён',status:'banned'}})).res.status,200);
 saved=(await request('/bootstrap')).data.customers.find(c=>c.id===id);assert.equal(saved.banned,1);
 const linked=(await request('/bootstrap')).data.customers.find(c=>c.orders_count>0);
 const count=app.db.prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_id=?').get(linked.id).n;
 assert.ok(linked.last_order);assert.equal((await request(`/customers/${linked.id}`,{method:'DELETE'})).res.status,200);
 assert.ok(!(await request('/bootstrap')).data.customers.some(c=>c.id===linked.id));
 assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_id=?').get(linked.id).n,count);
 assert.equal((await request(`/customers/${id}`,{method:'DELETE'})).res.status,200);
});
test('product categories, sorting, review aggregates and deletion retain history',async()=>{
 assert.equal((await request('/categories',{method:'POST',body:{name:'Новая категория'}})).res.status,201);
 assert.ok((await request('/bootstrap')).data.categories.includes('Новая категория'));
 const p=(await request('/bootstrap')).data.products.find(p=>p.review_count>0);assert.ok(p);assert.ok(p.rating>=1&&p.rating<=5);
 assert.equal((await request(`/products/${p.id}`,{method:'PATCH',body:{sort_order:-1}})).res.status,400);
 assert.equal((await request(`/products/${p.id}`,{method:'PATCH',body:{sort_order:5}})).res.status,200);
 assert.equal((await request('/bootstrap')).data.products.find(row=>row.id===p.id).sort_order,5);
 const count=app.db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE product_id=?').get(p.id).n;
 assert.equal((await request(`/products/${p.id}`,{method:'DELETE'})).res.status,200);
 assert.ok(!(await request('/storefront',{auth:false})).data.products.some(row=>row.id===p.id));
 assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE product_id=?').get(p.id).n,count);
});
test('products can be created and edited without a SKU',async()=>{
 const product={name:'Без артикула',category:'Тест',price:100,cost:50,stock:2,active:true,image:'',description:''};
 const first=await request('/products',{method:'POST',body:product}),second=await request('/products',{method:'POST',body:product});
 assert.equal(first.res.status,201);assert.equal(second.res.status,201);
 const before=(await request('/bootstrap')).data.products.find(p=>p.id===first.data.id);
 assert.ok(before.sku);assert.equal((await request(`/products/${first.data.id}`,{method:'PATCH',body:{...product,name:'Обновлён'}})).res.status,200);
 const after=(await request('/bootstrap')).data.products.find(p=>p.id===first.data.id);
 assert.equal(after.sku,before.sku);assert.equal(after.name,'Обновлён');
});
test('archiving and restoring a product preserves its ID and reviews',async()=>{
 const p=(await request('/bootstrap')).data.products.find(p=>p.review_count>0&&p.active);assert.ok(p);
 const reviews=app.db.prepare('SELECT * FROM reviews WHERE product_id=? ORDER BY id').all(p.id);
 assert.equal((await request(`/products/${p.id}`,{method:'PATCH',body:{...p,active:false}})).res.status,200);
 assert.ok(!(await request('/storefront',{auth:false})).data.products.some(row=>row.id===p.id));
 const archived=(await request('/bootstrap')).data.products.find(row=>row.id===p.id);assert.equal(archived.active,0);
 assert.equal((await request(`/products/${p.id}`,{method:'PATCH',body:{...archived,active:true}})).res.status,200);
 const restored=(await request('/bootstrap')).data.products.find(row=>row.id===p.id);
 assert.equal(restored.review_count,p.review_count);assert.equal(restored.rating,p.rating);
 assert.deepEqual(app.db.prepare('SELECT * FROM reviews WHERE product_id=? ORDER BY id').all(p.id),reviews);
 assert.ok((await request('/storefront',{auth:false})).data.products.some(row=>row.id===p.id));
});
test('storefront views count only explicit openings and persist across database reopen',async()=>{
  const product=app.db.prepare("INSERT INTO products (name,sku,category,price,cost,stock,image) VALUES ('Viewed product','VIEW-TEST','Test',100,50,2,'') RETURNING id").get();
  const count=()=>app.db.prepare('SELECT views FROM products WHERE id=?').get(product.id).views;
  assert.equal(count(),0);
  await request('/storefront',{auth:false});
  await request('/bootstrap');
  assert.equal(count(),0);
  for(let i=0;i<3;i++) assert.equal((await request(`/storefront/products/${product.id}/view`,{method:'POST',auth:false})).res.status,200);
  assert.equal(count(),3);
  assert.equal((await request('/bootstrap')).data.products.find(p=>p.id===product.id).views,3);
  app.db.prepare('UPDATE products SET active=0 WHERE id=?').run(product.id);
  assert.equal((await request(`/storefront/products/${product.id}/view`,{method:'POST',auth:false})).res.status,404);
  app.db.prepare('UPDATE products SET active=1,deleted=1 WHERE id=?').run(product.id);
  assert.equal((await request(`/storefront/products/${product.id}/view`,{method:'POST',auth:false})).res.status,404);
  assert.equal((await request('/storefront/products/999999/view',{method:'POST',auth:false})).res.status,404);
  assert.equal(count(),3);
  const {openDatabase}=await import('../lib/database.js');
  const reopened=openDatabase(dbPath);
  try {assert.equal(reopened.prepare('SELECT views FROM products WHERE id=?').get(product.id).views,3);} finally {reopened.close();}
});

test('password change invalidates other sessions and logout revokes current session',async()=>{
  const other=await request('/auth/login',{method:'POST',auth:false,body:{username:'admin',password}});
  const otherCookie=other.res.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/auth/password',{method:'POST',body:{current:'wrong',password:'new-password-123456'}})).res.status,400);
  assert.equal((await request('/auth/password',{method:'POST',body:{current:password,password:'short'}})).res.status,400);
  assert.equal((await request('/auth/password',{method:'POST',body:{current:password,password:'new-password-123456'}})).res.status,200);
  assert.equal((await request('/auth/me',{headers:{Cookie:otherCookie}})).res.status,401);
  assert.equal((await request('/auth/logout',{method:'POST',body:{}})).res.status,200);
  assert.equal((await request('/auth/me')).res.status,401);
});
test('SQLite data survives server restart without reseeding',async()=>{
  const before=app.db.prepare('SELECT * FROM products ORDER BY id').all();
  await new Promise(resolve=>app.server.close(resolve));
  app=createApp({dbPath});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}`;
  const data=(await request('/storefront',{auth:false})).data;
  assert.equal(data.shop.name,'Test Store');assert.ok(app.db.prepare("SELECT value FROM settings WHERE key='categories'").get().value.includes('Новая категория'));
  assert.deepEqual(app.db.prepare('SELECT * FROM products ORDER BY id').all(),before);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM admins').get().n,1);
});
test('login rate limiting activates after repeated failures',async()=>{
  for(let i=0;i<10;i++)assert.equal((await request('/auth/login',{method:'POST',auth:false,body:{username:'unknown',password:'invalid'}})).res.status,401);
  assert.equal((await request('/auth/login',{method:'POST',auth:false,body:{username:'unknown',password:'invalid'}})).res.status,429);
});
