import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.js';
import {digest} from '../lib/auth.js';
import {profileBotToken,signedProfileUser} from './fixtures/profile.js';
const directory=mkdtempSync(join(tmpdir(),'shop-customer-balances-')),path=join(directory,'shop.db');let app,base,identity=5000;
async function start(){app=createApp({dbPath:path,botToken:profileBotToken,orderBotToken:''});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}`;}
before(async()=>{await start();app.db.prepare("INSERT INTO admins(id,username,password) VALUES (1,'balance-admin','unused')").run();app.db.prepare('INSERT INTO sessions VALUES (?,1,?,?)').run(digest('c'.repeat(64)),'csrf',Date.now()+1000000);});
after(async()=>{await new Promise(resolve=>app.server.close(resolve));rmSync(directory,{recursive:true,force:true});});
async function request(route,body,method='PATCH',auth='admin'){const response=await fetch(base+'/api'+route,{method,headers:{'Content-Type':'application/json',...(auth==='none'?{}:{Cookie:'session='+'c'.repeat(64)}),...(auth==='admin'?{'X-CSRF-Token':'csrf'}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
function buyer(){const telegramId=++identity;const result=app.db.prepare("INSERT INTO customers(name,username,email,city,joined,referral_code,telegram_id) VALUES ('Balance customer','','','','now',?,?)").run(randomUUID(),telegramId);return {id:Number(result.lastInsertRowid),init_data:signedProfileUser(telegramId)};}
const balance=b=>app.db.prepare('SELECT balance FROM customers WHERE id=?').get(b.id).balance;
const adjustment=(value,expected=0,key=randomUUID())=>({balance:value,expected_balance:expected,request_key:key});
test('manual balance setting requires an administrator and CSRF; invalid amounts cannot change funds',async()=>{
 const b=buyer(),route=`/customers/${b.id}/balance`;
 assert.equal((await request(route,undefined,'GET','none')).status,401);
 assert.equal((await request(route,{...adjustment(100),init_data:b.init_data},'PATCH','none')).status,401);
 assert.equal((await request(route,adjustment(100),'PATCH','no-csrf')).status,403);
 for(const value of [-1,0.5,'100',null,100000001])assert.equal((await request(route,adjustment(value))).status,400);
 for(const body of [{balance:100,request_key:randomUUID()},{...adjustment(100),request_key:'short'}])assert.equal((await request(route,body)).status,400);
 assert.equal(balance(b),0);assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM customer_balance_adjustments WHERE customer_id=?').get(b.id).n,0);
});
test('sets an absolute balance, supports decreases and zero, and records the acting administrator',async()=>{
 const b=buyer(),route=`/customers/${b.id}/balance`;
 assert.equal((await request(route,adjustment(1000))).status,200);assert.equal(balance(b),1000);
 assert.equal((await request(route,adjustment(300,1000))).status,200);assert.equal(balance(b),300);
 const visible=await request('/storefront/balance',{init_data:b.init_data},'POST','none');assert.equal(visible.data.balance,300);
 assert.equal((await request(route,adjustment(0,300))).status,200);assert.equal(balance(b),0);
 const history=(await request(route,undefined,'GET')).data.history;
 assert.deepEqual(history.map(row=>[row.old_balance,row.new_balance,row.amount]),[[300,0,-300],[1000,300,-700],[0,1000,1000]]);
 assert.ok(history.every(row=>row.admin_name==='balance-admin'));
 assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n,0,'virtual rubles are not cash receipts');
 assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_id=?').get(b.id).n,0,'manual balance edits must not create fake orders');
});
test('retries do not overwrite later wallet payments and stale forms cannot erase a concurrent debit',async()=>{
 const b=buyer(),route=`/customers/${b.id}/balance`,body=adjustment(1000);
 const first=await request(route,body);assert.equal(first.status,200);
 const product=app.db.prepare("INSERT INTO products(name,sku,category,price,cost,stock,image) VALUES ('Balance item',?,'',1000,100,5,'')").run(randomUUID());
 const order=await request('/storefront/orders',{init_data:b.init_data,request_key:randomUUID(),balance_spend:500,items:[{product_id:Number(product.lastInsertRowid),quantity:1,price:1000}]},'POST','none');assert.equal(order.status,201);assert.equal(balance(b),500);
 const repeat=await request(route,body);assert.equal(repeat.status,200);assert.equal(repeat.data.repeated,true);assert.equal(repeat.data.balance,500);assert.equal(balance(b),500);
 assert.equal((await request(route,adjustment(2000,1000))).status,409);assert.equal(balance(b),500);
 assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM customer_balance_adjustments WHERE customer_id=?').get(b.id).n,1);
 assert.equal((await request(route,adjustment(2000,500))).status,200);assert.equal(balance(b),2000);
 const other=buyer();assert.equal((await request(`/customers/${other.id}/balance`,body)).status,409);assert.equal(balance(other),0);
 assert.equal((await request(route,{...body,balance:2001})).status,409);assert.equal(balance(b),2000);
});
test('concurrent edits apply one request, deleted clients reject changes, and audit survives restart',async()=>{
 const b=buyer(),route=`/customers/${b.id}/balance`,body=adjustment(1000);
 const results=await Promise.all([request(route,body),request(route,body)]);assert.ok(results.every(result=>result.status===200));assert.equal(balance(b),1000);
 assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM customer_balance_adjustments WHERE customer_id=?').get(b.id).n,1);
 await new Promise(resolve=>app.server.close(resolve));await start();
 assert.equal(balance(b),1000);assert.equal((await request(route,undefined,'GET')).data.history.length,1);
 app.db.prepare('UPDATE customers SET deleted=1 WHERE id=?').run(b.id);
 assert.equal((await request(route,adjustment(0,1000))).status,404);assert.equal(balance(b),1000);
});
