import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.js';
import {digest} from '../lib/auth.js';
import {profileBotToken,signedProfileUser} from './fixtures/profile.js';
import {reviewBuyer,reviewProduct,reviewOrder} from './fixtures/reviews.js';
const directory=mkdtempSync(join(tmpdir(),'shop-history-'));let app,base,identity=1000;
before(async()=>{app=createApp({dbPath:join(directory,'shop.db'),botToken:profileBotToken,orderBotToken:''});app.db.prepare("INSERT INTO admins VALUES (1,'history-admin','unused')").run();app.db.prepare('INSERT INTO sessions VALUES (?,1,?,?)').run(digest('e'.repeat(64)),'csrf',Date.now()+1e7);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}`;});
after(async()=>{await new Promise(resolve=>app.server.close(resolve));rmSync(directory,{recursive:true,force:true});});
async function request(path,body,method='POST',admin=false){const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(admin?{Cookie:'session='+'e'.repeat(64),'X-CSRF-Token':'csrf'}:{})},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
function buyer(){const telegram=++identity,id=reviewBuyer(app.db,telegram);return {id,init_data:signedProfileUser(telegram)};}
async function checkout(b,product,spend=0){return (await request('/storefront/orders',{init_data:b.init_data,request_key:randomUUID(),balance_spend:spend,items:[{product_id:product,price:1000,quantity:2}]})).data.order;}
const owned=(b,extra={})=>({init_data:b.init_data,...extra});
test('order list and details require a signed buyer, exclude deleted orders, and never expose another customer or costs',async()=>{
 const a=buyer(),b=buyer(),p=reviewProduct(app.db),order=await checkout(a,p);const other=await checkout(b,p);reviewOrder(app.db,a.id,p,{deleted:1});
 for(const path of ['/storefront/orders/list',`/storefront/orders/${order.id}`,`/storefront/orders/${order.id}/cancel`,'/storefront/transactions'])assert.equal((await request(path,{init_data:'forged'})).status,401);
 const list=await request('/storefront/orders/list',owned(a,{customer_id:b.id}));assert.deepEqual(list.data.items.map(row=>row.id),[order.id]);
 assert.equal((await request(`/storefront/orders/${other.id}`,owned(a))).status,404);assert.equal((await request(`/storefront/orders/${other.id}/cancel`,owned(a))).status,404);
 const detail=await request(`/storefront/orders/${order.id}`,owned(a));assert.equal(detail.status,200);assert.equal(detail.data.order.items.length,1);assert.equal(detail.data.order.total,2000);assert.equal(detail.data.order.can_cancel,true);assert.doesNotMatch(JSON.stringify(detail.data),/customer_id|telegram_id|"cost"|request_key|referral_code/);
 const fresh={init_data:signedProfileUser(99999)};assert.deepEqual((await request('/storefront/orders/list',fresh)).data,{items:[],next:null});assert.equal((await request(`/storefront/orders/${order.id}`,fresh)).status,404);
});
test('customer cancellation returns stock and wallet once, updates the same admin order and records one refund',async()=>{
 const b=buyer(),p=reviewProduct(app.db);await request(`/customers/${b.id}/balance`,{balance:1000,expected_balance:0,request_key:randomUUID()},'PATCH',true);const order=await checkout(b,p,500);
 assert.equal(app.db.prepare('SELECT stock FROM products WHERE id=?').get(p).stock,98);
 const replies=await Promise.all([request(`/storefront/orders/${order.id}/cancel`,owned(b)),request(`/storefront/orders/${order.id}/cancel`,owned(b))]);assert.ok(replies.every(row=>row.status===200&&row.data.order.status==='cancelled'&&row.data.order.balance_after===1000));
 assert.equal(app.db.prepare('SELECT stock FROM products WHERE id=?').get(p).stock,100);assert.equal(app.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'cancelled');assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM balance_operations WHERE order_id=? AND kind='order_refund'").get(order.id).n,1);
 const history=(await request('/storefront/transactions',owned(b))).data;assert.equal(history.balance,1000);assert.deepEqual(history.items.filter(row=>row.order_id===order.id).map(row=>row.amount).sort((a,b)=>a-b),[-500,500]);assert.ok(history.items.some(row=>row.title===`Списание за заказ #${order.id}`));assert.ok(history.items.some(row=>row.title===`Возврат за заказ #${order.id}`));assert.ok(history.items.some(row=>row.title==='Начислено администратором'&&row.amount===1000));
 await request(`/orders/${order.id}`,undefined,'DELETE',true);const deletedHistory=(await request('/storefront/transactions',owned(b))).data;assert.ok(deletedHistory.items.some(row=>row.title===`Возврат за заказ #${order.id}`&&row.order_id===null),'a deleted order retains its ledger entry without an inaccessible link');
});
test('cancellation is allowed while accepted, rejected after completion or removal, and checks the latest server status',async()=>{
 const b=buyer(),p=reviewProduct(app.db),accepted=await checkout(b,p);await request(`/orders/${accepted.id}`,{status:'accepted'},'PATCH',true);assert.equal((await request(`/storefront/orders/${accepted.id}/cancel`,owned(b))).status,200);
 const completed=await checkout(b,p);await request(`/orders/${completed.id}`,{status:'completed'},'PATCH',true);assert.equal((await request(`/storefront/orders/${completed.id}`,owned(b))).data.order.can_cancel,false);assert.equal((await request(`/storefront/orders/${completed.id}/cancel`,owned(b))).status,409);
 const removed=await checkout(b,p);app.db.prepare('UPDATE orders SET deleted=1 WHERE id=?').run(removed.id);assert.equal((await request(`/storefront/orders/${removed.id}/cancel`,owned(b))).status,404);
 const banned=await checkout(b,p);app.db.prepare('UPDATE customers SET banned=1 WHERE id=?').run(b.id);assert.equal((await request(`/storefront/orders/${banned.id}/cancel`,owned(b))).status,409);
});
test('all orders and balance operations paginate without exposing foreign data or losing same-timestamp entries',async()=>{
 const b=buyer(),other=buyer(),p=reviewProduct(app.db);for(let i=0;i<25;i++)reviewOrder(app.db,b.id,p);reviewOrder(app.db,other.id,p);
 const first=(await request('/storefront/orders/list',owned(b))).data,second=(await request('/storefront/orders/list',owned(b,{before:first.next}))).data;assert.equal(first.items.length,20);assert.equal(second.items.length,5);assert.equal(second.next,null);assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,25);
 for(let i=0;i<25;i++)app.db.prepare("INSERT INTO customer_balance_adjustments(customer_id,admin_id,old_balance,new_balance,amount,request_key,created_at) VALUES (?,1,0,50,50,?,'2026-11-16T00:00:00.000Z')").run(b.id,randomUUID());
 app.db.prepare("INSERT INTO customer_balance_adjustments(customer_id,admin_id,old_balance,new_balance,amount,request_key,created_at) VALUES (?,1,0,999,999,?,'2026-11-17T00:00:00.000Z')").run(other.id,randomUUID());
 const page=(await request('/storefront/transactions',owned(b))).data,rest=(await request('/storefront/transactions',owned(b,{before:page.next}))).data;assert.equal(page.items.length,20);assert.equal(rest.items.length,5);assert.equal(rest.next,null);assert.equal(new Set([...page.items,...rest.items].map(row=>row.id)).size,25);assert.ok([...page.items,...rest.items].every(row=>row.amount===50));assert.doesNotMatch(JSON.stringify(page),/customer_id|admin_id|admin_name|request_key/);
 for(const before of ['',42,'not-a-cursor',Buffer.from('{}').toString('base64url')])assert.equal((await request('/storefront/transactions',owned(b,{before}))).status,400);
 assert.equal((await request('/storefront/orders/list',owned(b,{before:-1}))).status,400);
 assert.deepEqual((await request('/storefront/transactions',{init_data:signedProfileUser(99999)})).data,{balance:0,items:[],next:null});
});
