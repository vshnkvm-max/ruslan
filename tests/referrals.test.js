import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.js';
import {digest} from '../lib/auth.js';
import {profileBotToken,signedProfileUser} from './fixtures/profile.js';
import {reviewProduct} from './fixtures/reviews.js';

test('signed referral visits are unique and first completed orders issue the monthly reward once',async t=>{
 const {db,server}=createApp({dbPath:':memory:',botToken:profileBotToken,orderBotToken:''});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}/api`;
 db.exec("UPDATE settings SET value=json_set(value,'$.enabled',1) WHERE key='referral'; INSERT INTO admins VALUES (1,'admin','unused')");
 db.prepare('INSERT INTO sessions VALUES (?,1,?,?)').run(digest('a'.repeat(64)),'csrf',Date.now()+100000);
 async function request(path,body,method='POST'){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:'session='+'a'.repeat(64),'X-CSRF-Token':'csrf'},body:JSON.stringify(body)});
  return {status:response.status,data:await response.json()};
 }
 const owner=signedProfileUser(100),other=signedProfileUser(999);
 const link=(await request('/storefront/referrals',{init_data:owner})).data.link;
 const code=new URL(link).searchParams.get('startapp');
 assert.match(code,/^ref_/);
 assert.equal((await request('/storefront/referrals',{init_data:owner+'&start_param='+code})).status,401);
 await request('/storefront/referrals',{init_data:signedProfileUser(100,code)});
 for(let id=101;id<=107;id++)await request('/storefront/referrals',{init_data:signedProfileUser(id,code)});
 await request('/storefront/referrals',{init_data:signedProfileUser(101,code)});
 assert.deepEqual(db.prepare('SELECT reward_percent FROM referrals ORDER BY id').all().map(row=>row.reward_percent),[3,3,5,5,5,7,7]);
 assert.equal((await request('/storefront/referrals',{init_data:other})).data.items.length,0);
 db.prepare('UPDATE referrals SET created_at=? WHERE invitee_id=(SELECT id FROM customers WHERE telegram_id=107)').run(new Date(Date.now()-8*86400000).toISOString());
 const product=reviewProduct(db);
 for(const id of [101,103,106,107,101]){
  const order=await request('/storefront/orders',{init_data:signedProfileUser(id),request_key:randomUUID(),items:[{product_id:product,quantity:1,price:1000}]});
  assert.equal(order.status,201);
  for(let retry=0;retry<2;retry++)assert.equal((await request('/orders/'+order.data.order.id,{status:'completed'},'PATCH')).status,200);
 }
 const successful=(await request('/storefront/referrals',{init_data:owner,status:'successful'})).data;
 assert.equal(successful.count,3);
 assert.equal(successful.earned,150);
 assert.deepEqual(successful.items.map(item=>item.amount).sort((a,b)=>a-b),[30,50,70]);
 assert.equal((await request('/storefront/referrals',{init_data:owner,status:'pending'})).data.items.length,3);
 assert.equal((await request('/storefront/referrals',{init_data:owner,status:'rejected'})).data.items.length,1);
 const balance=(await request('/storefront/transactions',{init_data:owner})).data;
 assert.equal(balance.balance,150);
 assert.equal(balance.items.filter(item=>item.kind==='referral_reward').length,3);
});
