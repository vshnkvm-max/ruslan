import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { hashPassword,hashPasswordAsync,verifyPasswordAsync } from '../lib/auth.js';
import { openDatabase } from '../lib/database.js';

const directory=mkdtempSync(join(tmpdir(),'shop-loading-'));
let app,base,cookie;
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0a0AAAAASUVORK5CYII=';
function raw(path,headers={}) {
 return new Promise((resolve,reject)=>{
  const req=httpRequest(base,{path,headers},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
  });req.on('error',reject);req.end();
 });
}
before(async()=>{
 app=createApp({dbPath:join(directory,'test.db')});
 app.db.prepare('INSERT INTO admins (username,password) VALUES (?,?)').run('admin',hashPassword('loading-test-password'));
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}`;
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'loading-test-password'})});
 cookie=login.headers.get('set-cookie').split(';')[0];
});
after(async()=>{await new Promise(resolve=>app.server.close(resolve));rmSync(directory,{recursive:true,force:true});});

test('static assets compress and revalidate the correct representation',async()=>{
 for(const path of ['/','/app.js','/styles.css','/miniapp','/miniapp.js','/miniapp.css']){
  const plain=await raw(path,{'Accept-Encoding':'identity'}),compressed=await raw(path,{'Accept-Encoding':'gzip'});
  assert.equal(plain.status,200);assert.equal(compressed.status,200);assert.equal(compressed.headers['content-encoding'],'gzip');
  assert.deepEqual(gunzipSync(compressed.body),plain.body);
  const maxRatio=plain.headers['content-type'].startsWith('text/html')?1:0.6;
  assert.ok(compressed.body.length<plain.body.length*maxRatio,`${path} compressed transfer size`);
  assert.equal(compressed.headers.vary,'Accept-Encoding');assert.notEqual(plain.headers.etag,compressed.headers.etag);
  const cached=await raw(path,{'Accept-Encoding':'gzip','If-None-Match':compressed.headers.etag});
  assert.equal(cached.status,304);assert.equal(cached.body.length,0);
  assert.equal((await raw(path,{'Accept-Encoding':'identity','If-None-Match':compressed.headers.etag})).status,200);
  assert.equal((await raw(path,{'Accept-Encoding':'gzip;q=0'})).headers['content-encoding'],undefined);
 }
 const js=await raw('/app.js',{'Accept-Encoding':'gzip'}),plain=await raw('/app.js');
 console.log(`app.js transfer: ${plain.body.length} -> ${js.body.length} bytes`);
});
test('malformed request URL returns 400 without stopping subsequent requests',async()=>{
 assert.equal((await raw('http://[')).status,400);
 assert.equal((await fetch(base+'/api/health')).status,200);
 assert.equal((await fetch(base+'/miniapp')).status,200);
});
test('HTML uses content-versioned scripts and styles to prevent stale Telegram assets',async()=>{
 for(const page of ['/','/miniapp']){
  const response=await raw(page);assert.equal(response.headers['cache-control'],'no-store');
  const references=[...response.body.toString().matchAll(/(?:src|href)="(\/[^"?]+\.(?:js|css)\?v=[a-f0-9]{16})"/g)].map(match=>match[1]);
  assert.equal(references.length,3);
  for(const reference of references){const asset=await raw(reference);assert.equal(asset.status,200);assert.ok(asset.body.length>0);}
 }
});
test('large API responses compress asynchronously without changing data or private caching rules',async()=>{
 const id=Number(app.db.prepare('INSERT INTO products (name,sku,category,price,cost,stock,image,description) VALUES (?,?,?,?,?,?,?,?)').run('Compressed product','GZIP-TEST','',100,0,1,'','Description '.repeat(150)).lastInsertRowid);
 try {
  for(const path of ['/api/bootstrap','/api/storefront']){
   const plain=await raw(path,{Cookie:cookie,'Accept-Encoding':'identity'});
   const compressed=await raw(path,{Cookie:cookie,'Accept-Encoding':'gzip'});
   assert.equal(compressed.status,200);assert.equal(compressed.headers['content-encoding'],'gzip');
   assert.equal(compressed.headers['cache-control'],'no-store');assert.equal(compressed.headers.vary,'Accept-Encoding');
   assert.deepEqual(JSON.parse(gunzipSync(compressed.body)),JSON.parse(plain.body));
   assert.ok(compressed.body.length<plain.body.length*0.6);
   assert.equal((await raw(path,{Cookie:cookie,'Accept-Encoding':'gzip;q=0'})).headers['content-encoding'],undefined);
  }
 }finally {app.db.prepare('DELETE FROM products WHERE id=?').run(id);}
});
test('banner photographs do not inflate bootstrap and storefront; image edits change URLs and privacy is preserved',async()=>{
 // Seed a large existing image to exercise old databases without an upload or migration.
 const large='data:image/jpeg;base64,'+Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(450000,77)]).toString('base64');
 const id=Number(app.db.prepare('INSERT INTO banners (title,subtitle,color,link,active,image) VALUES (?,?,?,?,?,?)').run('Large banner','','#ffffff','',1,large).lastInsertRowid);
 let image;
 for(const path of ['/api/bootstrap','/api/storefront']){
  const response=await fetch(base+path,{headers:{Cookie:cookie}}),text=await response.text();assert.equal(response.status,200);
  assert.ok(text.length<10000);assert.ok(!text.includes('base64'));image=JSON.parse(text).banners.find(b=>b.id===id).image;
 }
 const media=await fetch(base+image);assert.equal(media.status,200);assert.equal(media.headers.get('content-type'),'image/jpeg');
 assert.equal((await fetch(base+image,{headers:{'If-None-Match':media.headers.get('etag')}})).status,304);
 app.db.prepare('UPDATE banners SET image=? WHERE id=?').run(png,id);
 const replacement=(await (await fetch(base+'/api/storefront')).json()).banners.find(b=>b.id===id).image;
 assert.notEqual(image,replacement);assert.equal((await fetch(base+image)).status,404);
 app.db.prepare('UPDATE banners SET active=0 WHERE id=?').run(id);
 assert.equal((await fetch(base+replacement)).status,404);
 assert.equal((await fetch(base+replacement,{headers:{Cookie:cookie}})).status,200);
});
test('password checks yield to the event loop and keep existing hashes compatible',async()=>{
 const saved=hashPassword('compatible-password');let yielded=false;
 setImmediate(()=>{yielded=true;});assert.equal(await verifyPasswordAsync('compatible-password',saved),true);assert.equal(yielded,true);
 assert.equal(await verifyPasswordAsync('wrong-password',saved),false);
 assert.equal(await verifyPasswordAsync('new-password',await hashPasswordAsync('new-password')),true);
});
test('concurrent login attempts stay bounded while public pages remain available',async()=>{
 const jobs=Array.from({length:12},()=>fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'wrong-password'})}));
 assert.equal((await fetch(base+'/api/health')).status,200);
 assert.equal((await fetch(base+'/miniapp')).status,200);
 const statuses=(await Promise.all(jobs)).map(response=>response.status);
 assert.ok(statuses.includes(429));assert.ok(statuses.every(status=>status===401||status===429));
});
test('a damaged legacy photograph does not prevent the entire app from starting',async()=>{
 const path=join(directory,'damaged.db'),db=openDatabase(path);
 db.prepare('INSERT INTO products (name,sku,category,price,cost,stock,image) VALUES (?,?,?,?,?,?,?)').run('Damaged photo','DAMAGED','',10,0,5,'data:image/png;base64,bad');db.close();
 const recovered=createApp({dbPath:path});await new Promise(resolve=>recovered.server.listen(0,'127.0.0.1',resolve));
 try {
  const response=await fetch(`http://127.0.0.1:${recovered.server.address().port}/api/storefront`),data=await response.json();
  assert.equal(response.status,200);assert.equal(data.products[0].stock,5);assert.equal(data.products[0].image,'');
  assert.equal(recovered.db.prepare('SELECT image FROM products').get().image,'data:image/png;base64,bad');
 }finally {await new Promise(resolve=>recovered.server.close(resolve));}
});
test('purchase payment links migrate without changing amounts, stock or ambiguous records',()=>{
 const path=join(directory,'purchase-links.db'),legacy=openDatabase(path);
 legacy.prepare('INSERT INTO products(name,sku,category,price,cost,stock,image) VALUES (?,?,?,?,?,?,?)').run('Existing','LINK-STOCK','',100,50,5,'');
 const insertPurchase=legacy.prepare('INSERT INTO purchases(supplier,store,posted,paid,total,comment,items,created_at,request_key) VALUES (?,?,?,?,?,?,?,?,?)');
 insertPurchase.run('Supplier A','',1,100,100,'','[{"product_id":1,"quantity":2,"cost":50}]','2026-11-01','link-a');
 insertPurchase.run('Supplier B','',1,50,50,'','[{"product_id":1,"quantity":1,"cost":50}]','2026-11-01','link-b');
 const insertPayment=legacy.prepare('INSERT INTO transactions(type,category,description,amount,created_at) VALUES (?,?,?,?,?)');
 const payment=Number(insertPayment.run('expense','Закупка','Закупка #1 · Supplier A',100,'2026-11-01').lastInsertRowid);
 for(let i=0;i<2;i++)insertPayment.run('expense','Закупка','Закупка #2 · Supplier B',50,'2026-11-01');
 const payments=legacy.prepare('SELECT * FROM transactions ORDER BY id').all();legacy.close();
 for(let i=0;i<2;i++){
  const upgraded=openDatabase(path);
  try{
   assert.equal(upgraded.prepare('SELECT transaction_id FROM purchases WHERE id=1').get().transaction_id,payment);
   assert.equal(upgraded.prepare('SELECT transaction_id FROM purchases WHERE id=2').get().transaction_id,null);
   assert.equal(upgraded.prepare('SELECT stock FROM products WHERE id=1').get().stock,5);
   assert.deepEqual(upgraded.prepare('SELECT * FROM transactions ORDER BY id').all(),payments);
  }finally {upgraded.close();}
 }
});
