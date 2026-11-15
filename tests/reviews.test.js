import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.js';
import {digest} from '../lib/auth.js';
import {profileBotToken,signedProfileUser} from './fixtures/profile.js';
import {reviewBuyer,reviewProduct,reviewOrder,reviewPng} from './fixtures/reviews.js';
const directory=mkdtempSync(join(tmpdir(),'shop-reviews-')),dbPath=join(directory,'shop.db');let app,base,identity=1000;
const video=readFileSync(new URL('./fixtures/review-video.mp4',import.meta.url));
async function start(){app=createApp({dbPath,botToken:profileBotToken,orderBotToken:''});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}`;}
before(async()=>{await start();app.db.prepare("INSERT INTO admins VALUES (1,'review-admin','unused')").run();app.db.prepare('INSERT INTO sessions VALUES (?,1,?,?)').run(digest('d'.repeat(64)),'csrf',Date.now()+1e7);});
after(async()=>{await new Promise(resolve=>app.server.close(resolve));rmSync(directory,{recursive:true,force:true});});
async function request(path,body,method=body===undefined?'GET':'POST',admin=false){const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(admin?{Cookie:'session='+'d'.repeat(64),'X-CSRF-Token':'csrf'}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
function buyer(){const telegramId=++identity,id=reviewBuyer(app.db,telegramId),product=reviewProduct(app.db),order=reviewOrder(app.db,id,product);return {id,product,order,init_data:signedProfileUser(telegramId)};}
const payload=(b,changes={})=>({init_data:b.init_data,request_key:randomUUID(),order_id:b.order,product_id:b.product,rating:5,text:'Отличный товар',...changes});
const eligible=b=>request('/storefront/reviews/eligible',{init_data:b.init_data});
async function upload(b,bytes=reviewPng,type='image/png'){const response=await fetch(`${base}/api/storefront/reviews/${b.order}/${b.product}/media`,{method:'POST',headers:{'Content-Type':type,'X-Telegram-Init-Data':b.init_data},body:bytes});return {status:response.status,data:await response.json()};}
test('only an authenticated owner of a completed, nondeleted purchase can review within seven days',async()=>{
 const b=buyer();assert.equal((await eligible(b)).data.items[0].order_id,b.order);
 assert.equal((await request('/storefront/reviews/eligible',{init_data:'forged'})).status,401);
 assert.equal((await request('/storefront/reviews',payload(b,{init_data:'forged'}))).status,401);
 const other=buyer();assert.equal((await request('/storefront/reviews',payload(b,{init_data:other.init_data}))).status,403);
 for(const change of ["status='new'","deleted=1","completed_at='2000-01-01'","completed_at='2999-01-01'"]){
  const x=buyer();app.db.exec(`UPDATE orders SET ${change} WHERE id=${x.order}`);assert.deepEqual((await eligible(x)).data.items,[]);assert.equal((await request('/storefront/reviews',payload(x))).status,403);
 }
 const banned=buyer();app.db.prepare('UPDATE customers SET banned=1 WHERE id=?').run(banned.id);assert.deepEqual((await eligible(banned)).data.items,[]);assert.equal((await request('/storefront/reviews',payload(banned))).status,403);
 const expired=buyer();app.db.prepare('UPDATE orders SET completed_at=? WHERE id=?').run(new Date(Date.now()-7*86400000-1).toISOString(),expired.order);assert.equal((await request('/storefront/reviews',payload(expired))).status,403);
 for(const rating of [0,6,1.5,'5'])assert.equal((await request('/storefront/reviews',payload(b,{rating}))).status,400);
 assert.equal((await request('/storefront/reviews',payload(b,{text:'a'.repeat(2001)}))).status,400);
});
test('first completion sets a stable review deadline and repeated status changes do not extend it',async()=>{
 const b=buyer();app.db.prepare("UPDATE orders SET status='new',completed_at=NULL WHERE id=?").run(b.order);
 assert.equal((await request(`/orders/${b.order}`,{status:'completed'},'PATCH',true)).status,200);
 const first=app.db.prepare('SELECT completed_at FROM orders WHERE id=?').get(b.order).completed_at;assert.ok(Date.now()-Date.parse(first)<5000);
 assert.equal((await request(`/orders/${b.order}`,{status:'new'},'PATCH',true)).status,200);
 assert.deepEqual((await eligible(b)).data.items,[]);
 await request(`/orders/${b.order}`,{status:'completed'},'PATCH',true);
 assert.equal(app.db.prepare('SELECT completed_at FROM orders WHERE id=?').get(b.order).completed_at,first);
});
test('one review per product per order; uncertain retries remain idempotent even after the deadline',async()=>{
 const b=buyer(),body=payload(b),first=await request('/storefront/reviews',body);assert.equal(first.status,201);assert.equal(first.data.review.status,'pending');
 assert.deepEqual((await eligible(b)).data.items,[]);assert.equal((await request('/storefront/reviews',payload(b))).status,409);
 app.db.prepare("UPDATE orders SET completed_at='2000-01-01' WHERE id=?").run(b.order);
 const repeat=await request('/storefront/reviews',body);assert.equal(repeat.status,200);assert.equal(repeat.data.review.id,first.data.review.id);assert.equal(repeat.data.repeated,true);
 b.order=reviewOrder(app.db,b.id,b.product);assert.equal((await request('/storefront/reviews',payload(b))).status,201);
 assert.equal(app.db.prepare('SELECT author_name FROM reviews WHERE id=?').get(first.data.review.id).author_name,'Покупатель');
});
test('photo and video uploads stay private before moderation, support playback ranges and survive restart',async()=>{
 const b=buyer(),photo=await upload(b),clip=await upload(b,video,'video/mp4');assert.equal(photo.status,201);assert.equal(clip.status,201);
 const media=[photo.data.media,clip.data.media];
 for(const file of media){assert.equal((await fetch(base+file.url)).status,200);assert.equal((await fetch(base+'/api/review-media/'+file.id)).status,404);}
 const signed=clip.data.media.url;
 const range=await fetch(base+signed,{headers:{Range:'bytes=0-23'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),video.subarray(0,24));assert.match(range.headers.get('content-range'),/^bytes 0-23\//);
 assert.equal((await fetch(base+signed,{headers:{Range:'bytes=999999-'}})).status,416);
 const head=await fetch(base+signed,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(video.length));assert.equal((await head.arrayBuffer()).byteLength,0);
 assert.equal((await fetch(base+signed.replace(/access=[a-f0-9]+/,'access='+'0'.repeat(64)))).status,404);
 const other=buyer();assert.equal((await request('/storefront/reviews',payload(other,{media_ids:media.map(file=>file.id)}))).status,400);
 const sent=await request('/storefront/reviews',payload(b,{media_ids:media.map(file=>file.id)}));assert.equal(sent.status,201);
 const own=(await request('/storefront/profile',{init_data:b.init_data})).data.reviews[0];assert.equal(own.media.length,2);assert.ok(own.media.every(file=>file.url.includes('access=')));
 const path='/api/review-media/'+clip.data.media.id;
 assert.equal((await fetch(base+path,{headers:{Cookie:'session='+'d'.repeat(64)}})).status,200);
 assert.equal((await request(`/reviews/${sent.data.review.id}`,{status:'published'},'PATCH',true)).status,200);
 const feed=(await request(`/storefront/reviews?product_id=${b.product}&media=1`)).data;assert.equal(feed.total,1);assert.equal(feed.items[0].media.length,2);assert.ok(!('customer_name' in feed.items[0])&&!('customer_id' in feed.items[0]));
 assert.equal((await fetch(base+path)).status,200);
 await new Promise(resolve=>app.server.close(resolve));await start();assert.equal((await fetch(base+signed)).status,200);assert.ok(existsSync(join(directory,'review-media',clip.data.media.id+'.bin')));
 await request(`/reviews/${sent.data.review.id}`,{status:'hidden'},'PATCH',true);assert.equal((await fetch(base+path)).status,404);assert.equal((await request(`/storefront/reviews?product_id=${b.product}`)).data.total,0);
});
test('media validates type, signature, count and purchase ownership, without leaving failed uploads',async()=>{
 const b=buyer();assert.equal((await upload(b,Buffer.from('<html/>'),'text/html')).status,415);assert.equal((await upload(b,Buffer.from('not a photograph'))).status,400);
 assert.equal((await upload(b,Buffer.alloc(5*1024*1024+1))).status,413);
 assert.equal((await upload({...b,init_data:'fake'})).status,401);
 assert.equal((await upload({...b,init_data:buyer().init_data})).status,403);
 const file=(await upload(b)).data.media;
 assert.equal((await request('/storefront/reviews',payload(b,{media_ids:[file.id,file.id]}))).status,400);
 assert.equal((await request('/storefront/reviews',payload(b,{media_ids:Array.from({length:6},()=>randomUUID())}))).status,400);
 assert.equal((await request('/storefront/reviews',payload(b,{media_ids:[randomUUID()]}))).status,400);
 assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM review_media WHERE customer_id=?').get(b.id).n,1);
});
test('public product feed sorts, paginates and retains reviews after a product runs out',async()=>{
 const b=buyer(),ids=[];
 for(const [rating,date,status] of [[3,'2026-01-02','published'],[1,'2026-01-03','published'],[5,'2026-01-01','published'],[4,'2026-01-04','pending']])ids.push(Number(app.db.prepare("INSERT INTO reviews(customer_id,product_id,rating,text,status,created_at) VALUES (?, ?,?,'Текст',?,?)").run(b.id,b.product,rating,status,date).lastInsertRowid));
 for(const [sort,expected] of [['newest',[ids[1],ids[0],ids[2]]],['oldest',[ids[2],ids[0],ids[1]]],['rating_asc',[ids[1],ids[0],ids[2]]],['rating_desc',[ids[2],ids[0],ids[1]]]])assert.deepEqual((await request(`/storefront/reviews?product_id=${b.product}&sort=${sort}`)).data.items.map(row=>row.id),expected);
 const paged=(await request(`/storefront/reviews?product_id=${b.product}&limit=2`)).data;assert.equal(paged.total,3);assert.equal(paged.next_offset,2);assert.equal((await request(`/storefront/reviews?product_id=${b.product}&offset=2&limit=2`)).data.items.length,1);
 assert.equal((await request(`/storefront/reviews?product_id=${b.product}&media=1`)).data.total,0);
 assert.equal((await request('/storefront/reviews?sort=SQL')).status,400);assert.equal((await request('/storefront/reviews?offset=-1')).status,400);
 app.db.prepare('UPDATE products SET stock=0,active=0 WHERE id=?').run(b.product);assert.equal((await request(`/storefront/reviews?product_id=${b.product}`)).data.total,3);
 app.db.prepare('UPDATE products SET deleted=1 WHERE id=?').run(b.product);assert.equal((await request(`/storefront/reviews?product_id=${b.product}`)).data.total,0);
});
