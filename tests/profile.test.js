import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.js';
import {profileBotToken,signedProfileUser,insertProfileFixtures} from './fixtures/profile.js';
const directory=mkdtempSync(join(tmpdir(),'shop-profile-'));
let app,base;
before(async()=>{app=createApp({dbPath:join(directory,'shop.db'),botToken:profileBotToken});insertProfileFixtures(app.db);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}`;});
after(async()=>{await new Promise(resolve=>app.server.close(resolve));rmSync(directory,{recursive:true,force:true});});
async function profile(body){const response=await fetch(base+'/api/storefront/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json(),headers:response.headers};}
test('profile requires a valid Telegram signature and ignores supplied customer identity',async()=>{
  for(const init_data of ['',signedProfileUser().replace('same_username','tampered')])assert.equal((await profile({init_data,customer_id:1})).status,401);
  const own=await profile({init_data:signedProfileUser(),customer_id:2,telegram_id:202});
  assert.equal(own.status,200);assert.deepEqual(own.data.stats,{orders_count:2,total:6800});assert.match(own.headers.get('cache-control'),/no-store/);
  assert.ok(own.data.orders.every(order=>order.id!==4&&order.id!==5));assert.ok(own.data.orders.some(order=>order.status==='cancelled'));
  assert.ok(own.data.reviews.every(review=>review.id!==24));
  assert.doesNotMatch(JSON.stringify(own.data),/referral_code|telegram_id|customer_id|"cost"|email|phone|request_key/);
});
test('review pagination stays scoped to the Telegram account and includes its moderation statuses',async()=>{
  const first=(await profile({init_data:signedProfileUser()})).data;
  assert.equal(first.reviews_count,23);assert.equal(first.reviews.length,20);assert.deepEqual([...new Set(first.reviews.map(r=>r.status))].sort(),['hidden','pending','published']);
  const second=(await profile({init_data:signedProfileUser(),reviews_before:first.reviews_next})).data;
  assert.equal(second.reviews.length,3);assert.equal(second.reviews_next,null);
  assert.equal(new Set([...first.reviews,...second.reviews].map(r=>r.id)).size,23);
  const other=(await profile({init_data:signedProfileUser(202)})).data;
  assert.deepEqual(other.stats,{orders_count:1,total:50000});assert.deepEqual(other.reviews.map(r=>r.id),[24]);
  for(const reviews_before of [0,-1,'4',1.5])assert.equal((await profile({init_data:signedProfileUser(),reviews_before})).status,400);
});
test('balance is read-only, defaults to zero and is scoped to the signed buyer',async()=>{
  app.db.prepare('UPDATE customers SET balance=1540 WHERE telegram_id=101').run();
  app.db.prepare('UPDATE customers SET balance=99 WHERE telegram_id=202').run();
  async function balance(init_data,extra={}){const response=await fetch(base+'/api/storefront/balance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({init_data,...extra})});return {status:response.status,data:await response.json()};}
  assert.deepEqual(await balance(signedProfileUser(),{telegram_id:202,customer_id:2,balance:999999}),{status:200,data:{balance:1540}});
  assert.deepEqual((await balance(signedProfileUser(202))).data,{balance:99});
  assert.deepEqual((await balance(signedProfileUser(303))).data,{balance:0});
  assert.equal((await balance('')).status,401);
  assert.equal((await profile({init_data:signedProfileUser()})).data.balance,1540);
  assert.equal(app.db.prepare('SELECT balance FROM customers WHERE telegram_id=101').get().balance,1540);
});
test('new or removed customers get an empty profile without creating customer records',async()=>{
  const count=app.db.prepare('SELECT COUNT(*) AS n FROM customers').get().n;
  const fresh=(await profile({init_data:signedProfileUser(303)})).data;
  assert.deepEqual(fresh,{balance:0,stats:{orders_count:0,total:0},orders:[],reviews:[],reviews_count:0,reviews_next:null});
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM customers').get().n,count);
  app.db.prepare('UPDATE customers SET deleted=1 WHERE telegram_id=202').run();
  assert.deepEqual((await profile({init_data:signedProfileUser(202)})).data,fresh);
});
