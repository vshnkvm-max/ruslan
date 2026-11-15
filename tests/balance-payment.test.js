import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.js';
import {digest} from '../lib/auth.js';
import {profileBotToken,signedProfileUser} from './fixtures/profile.js';
const directory=mkdtempSync(join(tmpdir(),'shop-balance-payment-'));let app,base,identity=1000;
before(async()=>{app=createApp({dbPath:join(directory,'shop.db'),botToken:profileBotToken});app.db.prepare("INSERT INTO admins(id,username,password) VALUES (1,'admin','unused')").run();app.db.prepare('INSERT INTO sessions VALUES (?,1,?,?)').run(digest('b'.repeat(64)),'csrf',Date.now()+1000000);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}`;});
after(async()=>{await new Promise(resolve=>app.server.close(resolve));rmSync(directory,{recursive:true,force:true});});
async function request(path,body,method='POST',admin=false){const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(admin?{Cookie:'session='+'b'.repeat(64),'X-CSRF-Token':'csrf'}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
function buyer(balance=1000){const telegramId=++identity;const row=app.db.prepare("INSERT INTO customers(name,username,email,city,joined,referral_code,telegram_id,balance) VALUES ('Buyer','','','','now',?,?,?)").run(randomUUID(),telegramId,balance);return {id:Number(row.lastInsertRowid),init_data:signedProfileUser(telegramId)};}
function product(price=1000){return {id:Number(app.db.prepare("INSERT INTO products(name,sku,category,price,cost,stock,image) VALUES ('Wallet product',?,'',?,100,10,'')").run(randomUUID(),price).lastInsertRowid),price};}
const balance=b=>app.db.prepare('SELECT balance FROM customers WHERE id=?').get(b.id).balance;
const stock=p=>app.db.prepare('SELECT stock FROM products WHERE id=?').get(p.id).stock;
const payload=(b,p,spend,key=randomUUID())=>({init_data:b.init_data,request_key:key,balance_spend:spend,items:[{product_id:p.id,quantity:1,price:p.price}]});
const ledger=b=>app.db.prepare('SELECT amount FROM balance_operations WHERE customer_id=? ORDER BY id').all(b.id).map(row=>row.amount);

test('rubles pay at most half; duplicate confirmations debit stock and balance exactly once',async()=>{
  const b=buyer(),p=product(),body=payload(b,p,500);
  const responses=await Promise.all([request('/storefront/orders',body),request('/storefront/orders',body)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);assert.equal(responses[0].data.order.id,responses[1].data.order.id);
  assert.equal(responses[0].data.order.total,1000);assert.equal(responses[0].data.order.payable,500);assert.equal(responses[0].data.order.balance_spent,500);assert.equal(responses[0].data.order.balance_after,500);
  assert.equal(balance(b),500);assert.equal(stock(p),9);assert.deepEqual(ledger(b),[-500]);
});
test('invalid amounts, spending above 50 percent and insufficient funds change neither stock nor balance',async()=>{
  const b=buyer(100),p=product();
  for(const [amount,status] of [[-1,400],[0.5,400],['50',400],[null,400],[501,400],[200,409]]){
    const response=await request('/storefront/orders',payload(b,p,amount));assert.equal(response.status,status,JSON.stringify(response));assert.equal(balance(b),100);assert.equal(stock(p),10);
  }
  assert.deepEqual(ledger(b),[]);assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_id=?').get(b.id).n,0);
});
test('concurrent different orders cannot overdraw the same wallet',async()=>{
  const b=buyer(600),p=product();
  const responses=await Promise.all([request('/storefront/orders',payload(b,p,400)),request('/storefront/orders',payload(b,p,400))]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);assert.equal(balance(b),200);assert.equal(stock(p),9);assert.deepEqual(ledger(b),[-400]);
});
test('cancel, restore and delete return or debit rubles once; ordinary status changes do not debit again',async()=>{
  const b=buyer(),p=product(),body=payload(b,p,500),id=(await request('/storefront/orders',body)).data.order.id;
  for(const status of ['accepted','completed']){assert.equal((await request('/orders/'+id,{status},'PATCH',true)).status,200);assert.equal(balance(b),500);}
  for(let i=0;i<2;i++)assert.equal((await request('/orders/'+id,{status:'cancelled'},'PATCH',true)).status,200);
  assert.equal(balance(b),1000);assert.equal(stock(p),10);assert.deepEqual(ledger(b),[-500,500]);
  const retry=await request('/storefront/orders',body);assert.equal(retry.data.order.status,'cancelled');assert.equal(retry.data.order.payable,0);assert.equal(balance(b),1000);
  assert.equal((await request('/orders/'+id,{status:'new'},'PATCH',true)).status,200);assert.equal(balance(b),500);assert.equal(stock(p),9);
  assert.equal((await request('/orders/'+id,undefined,'DELETE',true)).status,200);assert.equal(balance(b),1000);assert.equal(stock(p),10);
  assert.equal((await request('/orders/'+id,undefined,'DELETE',true)).status,404);assert.deepEqual(ledger(b),[-500,500,-500,500]);
  assert.equal((await request('/storefront/orders',body)).data.order.status,'cancelled');assert.equal(balance(b),1000);
});
test('failed restoration rolls back stock and balance together',async()=>{
  const b=buyer(),p=product(),id=(await request('/storefront/orders',payload(b,p,500))).data.order.id;
  await request('/orders/'+id,{status:'cancelled'},'PATCH',true);
  app.db.prepare('UPDATE customers SET balance=100 WHERE id=?').run(b.id);
  assert.equal((await request('/orders/'+id,{status:'new'},'PATCH',true)).status,409);assert.equal(balance(b),100);assert.equal(stock(p),10);assert.deepEqual(ledger(b),[-500,500]);
  assert.equal(app.db.prepare('SELECT status FROM orders WHERE id=?').get(id).status,'cancelled');
});
test('odd totals round the maximum down to whole rubles and legacy requests can pay without a wallet',async()=>{
  const b=buyer(),p=product(1001);
  assert.equal((await request('/storefront/orders',payload(b,p,501))).status,400);
  const paid=await request('/storefront/orders',payload(b,p,500));assert.equal(paid.status,201);assert.equal(paid.data.order.payable,501);
  const empty=buyer(0),legacy=payload(empty,p,undefined),order=await request('/storefront/orders',legacy);assert.equal(order.status,201);assert.equal(order.data.order.payable,1001);assert.equal(order.data.order.balance_spent,0);assert.deepEqual(ledger(empty),[]);
});
test('admin ledger uses the remaining payment and notification includes the wallet breakdown',async()=>{
  const b=buyer(),p=product(),response=await request('/storefront/orders',{...payload(b,p,300),total:1,payable:0}),id=response.data.order.id;
  assert.equal(response.data.order.total,1000);assert.equal(response.data.order.payable,700);
  const messages=JSON.parse(app.db.prepare('SELECT messages FROM order_notifications WHERE order_id=?').get(id).messages).join('\n');
  assert.match(messages,/СПИСАНО РУБЛЕЙ: 300 ₽/);assert.match(messages,/К ОПЛАТЕ: 700 ₽/);
  await request('/orders/'+id,{status:'completed'},'PATCH',true);
  const bootstrap=(await request('/bootstrap',undefined,'GET',true)).data;
  assert.equal(bootstrap.transactions.find(t=>t.id==='o'+id).amount,700);assert.equal(bootstrap.orders.find(o=>o.id===id).balance_spent,300);
  const profile=(await request('/storefront/profile',{init_data:b.init_data})).data;assert.equal(profile.stats.total,1000);assert.equal(profile.balance,700);
});
