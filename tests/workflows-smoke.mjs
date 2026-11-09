import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server.js';
import { hashPassword } from '../lib/auth.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory=mkdtempSync(join(tmpdir(),'shop-workflows-'));
const {server,db}=createApp({dbPath:join(directory,'test.db')});
db.prepare('INSERT INTO admins (username,password) VALUES (?,?)').run('admin',hashPassword('workflow-test-password'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try {
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.route('https://telegram.org/**',route=>route.fulfill({contentType:'text/javascript',body:`
 window.fullscreenCalls=0;window.telegramEvents={};window.Telegram={WebApp:{ready(){},expand(){},isVersionAtLeast(){return true;},isFullscreen:false,requestFullscreen(){fullscreenCalls++;},safeAreaInset:{top:10,bottom:5},contentSafeAreaInset:{top:30,bottom:15},onEvent(name,fn){telegramEvents[name]=fn;}}};`}));
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base);
 await page.getByLabel('Логин',{exact:true}).fill('admin');
 await page.getByLabel('Пароль',{exact:true}).fill('workflow-test-password');
 await page.locator('#login-form [type=submit]').click();
 await page.locator('.products-table').waitFor();
 await page.getByRole('button',{name:'Добавить категорию',exact:true}).click();
 await page.getByLabel('Название категории',{exact:true}).fill('Workflow category');
 await page.locator('#category-form [type=submit]').click();
 await page.locator('.modal').waitFor({state:'detached'});
 await page.getByRole('button',{name:'Добавить товар',exact:true}).click();
 assert.equal(await page.locator('#product-form [name=stock]').count(),0);
 assert.equal(await page.getByLabel('Сортировка',{exact:true}).inputValue(),'100');
 await page.getByLabel('Название',{exact:true}).fill('Workflow product');
 await page.locator('#product-form [name=category]').fill('Workflow category');
 await page.getByLabel('Цена, ₽',{exact:true}).fill('1000');
 const makePhoto=async(width,height,color)=>Buffer.from(await page.evaluate(({width,height,color})=>{
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,width,height);
  return canvas.toDataURL('image/png').split(',')[1];
 },{width,height,color}),'base64');
 const portrait=await makePhoto(120,240,'#087fff'),landscape=await makePhoto(240,120,'#ffdd00');
 await page.getByLabel('Фото товара',{exact:true}).setInputFiles([
  {name:'portrait.png',mimeType:'image/png',buffer:portrait},
  {name:'landscape.png',mimeType:'image/png',buffer:landscape}
 ]);
 await page.getByText('Фотографии загружены',{exact:true}).waitFor();
 assert.equal(await page.locator('#product-photo-preview img').count(),2);
 const initial=JSON.parse(await page.locator('#product-form [name=images]').inputValue());
 await page.getByRole('button',{name:'Сделать главным фото 2',exact:true}).click();
 const reordered=JSON.parse(await page.locator('#product-form [name=images]').inputValue());
 assert.deepEqual(reordered,[initial[1],initial[0]]);
 let failOnce=true;const submissions=[];
 await page.route('**/api/products',async route=>{
  if(route.request().method()!=='POST')return route.continue();
  submissions.push(route.request().postDataJSON());
  if(failOnce){failOnce=false;return route.fulfill({status:503,contentType:'text/html',body:'<h1>Temporary gateway error</h1>'});}
  await route.continue();
 });
 await page.locator('#product-form [type=submit]').click();
 await page.locator('#product-form .form-error').filter({hasText:'HTTP 503'}).waitFor();
 assert.ok(await page.locator('#product-form [type=submit]').isEnabled());
 await page.locator('#product-form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
 await page.locator('.modal').waitFor({state:'detached',timeout:5000});
 assert.equal(submissions.length,2,'failed request plus one retry; double submit is blocked');
 assert.equal(submissions[0].request_key,submissions[1].request_key);
 assert.ok(JSON.stringify(submissions[1]).length<5000,'save sends references, not photograph payloads');
 const product=db.prepare('SELECT * FROM products WHERE name=?').get('Workflow product');
 assert.equal(product.stock,0);assert.equal(product.sort_order,100);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products WHERE name=?').get('Workflow product').n,1);
 assert.deepEqual(db.prepare('SELECT id FROM product_images WHERE product_id=? ORDER BY position').all(product.id).map(p=>'/api/images/'+p.id),reordered);
 await page.getByRole('button',{name:'Управление категориями',exact:true}).click();
 await page.getByRole('button',{name:'Удалить категорию Workflow category',exact:true}).click();
 await page.locator('#delete-category-form [type=submit]').click();
 await page.locator('.modal').waitFor({state:'detached'});
 assert.equal(db.prepare('SELECT category FROM products WHERE id=?').get(product.id).category,'');
 assert.equal(await page.locator('[data-action=product-category][data-value="Workflow category"]').count(),0);
 await page.getByRole('button',{name:'Создать документ',exact:true}).click();
 await page.getByRole('button',{name:'Закупка',exact:true}).click();
 assert.equal(await page.locator('[data-action=purchase-add]').count(),0);
 await page.locator('[data-action=purchase-category][data-value=""]').click();
 await page.locator(`[data-action=purchase-add][data-id="${product.id}"]`).click();
 await page.locator('#purchase-form [name=supplier]').fill('Workflow supplier');
 await page.locator('[data-purchase-quantity]').fill('3');
 await page.locator('[data-purchase-cost]').fill('250');
 await page.locator('[data-action=purchase-tab][data-value=payment]').click();
 await page.locator('#purchase-form [name=paid]').fill('500');
 await page.locator('#purchase-form [type=submit]').click();
 await page.locator('.purchase-actions .badge').waitFor();
 assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock,3);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n,1);
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();

 // A nonstandard banner ratio must be preserved in both the admin and Mini App.
 await page.locator('nav a[href="#content"]').click();
 await page.getByRole('button',{name:/Баннеры/}).click();
 await page.getByRole('button',{name:'Добавить первый баннер',exact:true}).click();
 await page.getByLabel('Заголовок',{exact:true}).fill('Workflow banner');
 await page.getByLabel('Изображение баннера',{exact:true}).setInputFiles({name:'banner.png',mimeType:'image/png',buffer:await makePhoto(900,300,'#ee001b')});
 await page.locator('#banner-photo-preview img').waitFor();
 await page.locator('#banner-form [type=submit]').click();
 await page.locator('.modal').waitFor({state:'detached'});
 await page.locator('.banner-cover').waitFor();
 const mini=await context.newPage();mini.on('pageerror',error=>errors.push(error.message));
 await mini.goto(base+'/miniapp');
 await mini.locator(`[data-product="${product.id}"]`).waitFor();
 assert.equal(await mini.locator('#next-category').count(),0);
 assert.equal(await mini.evaluate(()=>fullscreenCalls),1);
 assert.ok(await mini.locator('.miniapp').evaluate(element=>parseFloat(getComputedStyle(element).paddingTop)>=40));
 await mini.getByRole('button',{name:'На весь экран',exact:true}).click();
 assert.equal(await mini.evaluate(()=>fullscreenCalls),2);
 await mini.evaluate(()=>{Telegram.WebApp.isFullscreen=true;telegramEvents.fullscreenChanged();});
 assert.ok(await mini.locator('#fullscreen-button').isHidden());
 await mini.waitForFunction(()=>{const image=document.querySelector('#banner img');return image?.complete&&image.naturalWidth>0;});
 const ratio=await mini.locator('#banner img').evaluate(image=>{
  const rect=image.getBoundingClientRect();return {rendered:rect.width/rect.height,natural:image.naturalWidth/image.naturalHeight};
 });
 assert.ok(Math.abs(ratio.rendered-ratio.natural)<0.01,'banner keeps its own proportions');
 await mini.locator(`[data-product="${product.id}"]`).click();
 await mini.locator('#gallery-track img').first().waitFor();
 assert.equal(await mini.locator('.gallery-slide').count(),2);
 assert.equal(await mini.locator('#gallery-track img').first().evaluate(image=>getComputedStyle(image).objectFit),'contain');
 assert.equal(await mini.locator('#gallery-track img').first().evaluate(image=>getComputedStyle(image).objectPosition),'50% 50%');
 await mini.getByRole('button',{name:'Следующее фото',exact:true}).click();
 await mini.locator('#gallery-counter').filter({hasText:'2 / 2'}).waitFor();
 await mini.getByRole('button',{name:'Предыдущее фото',exact:true}).click();
 await mini.locator('#gallery-counter').filter({hasText:'1 / 2'}).waitFor();
 await mini.locator('.close').click();
 await mini.screenshot({path:'/tmp/shop-workflows-miniapp.png',fullPage:false});
 await mini.close();
 await page.locator('nav a[href="#products"]').click();
 await page.getByRole('button',{name:'Удалить Workflow product',exact:true}).click();
 await page.locator('#delete-records-form [type=submit]').click();
 await page.locator('.modal').waitFor({state:'detached'});
 assert.equal(db.prepare('SELECT deleted FROM products WHERE id=?').get(product.id).deleted,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM purchases').get().n,1,'purchase history survives deletion');
 for(const suffix of ['A','B'])db.prepare('INSERT INTO products (name,sku,category,price,cost,stock,image) VALUES (?,?,?,?,?,?,?)').run('Bulk workflow '+suffix,'BULK-'+suffix,'',10,0,0,'');
 await page.reload();await page.locator('.products-table').waitFor();
 await page.getByRole('searchbox').fill('Bulk workflow');
 await page.locator('#select-all').check();
 await page.getByRole('button',{name:'Удалить (2)',exact:true}).click();
 await page.locator('#delete-records-form [type=submit]').click();
 await page.locator('.modal').waitFor({state:'detached'});
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM products WHERE name LIKE 'Bulk workflow %' AND deleted=0").get().n,0);
 // A catalog with many photographs must still return only small media references.
 const largePhoto=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=800;canvas.height=800;
  const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(800,800);
  crypto.getRandomValues(pixels.data.subarray(0,65536));
  for(let i=65536;i<pixels.data.length;i++)pixels.data[i]=pixels.data[i%65536];
  for(let i=3;i<pixels.data.length;i+=4)pixels.data[i]=255;
  ctx.putImageData(pixels,0,0);return canvas.toDataURL('image/jpeg',0.6);
 });
 for(let i=0;i<50;i++){
  const imageId=randomUUID(),image='/api/images/'+imageId;
  const id=db.prepare('INSERT INTO products (name,sku,category,price,cost,stock,image) VALUES (?,?,?,?,?,?,?)').run('Photo catalog '+i,'CAT-'+i,'Catalog',100,0,0,image).lastInsertRowid;
  db.prepare('INSERT INTO product_images (id,product_id,position,data) VALUES (?,?,?,?)').run(imageId,id,0,largePhoto);
 }
 const metrics=await page.evaluate(async()=>{
  const start=performance.now(),response=await fetch('/api/bootstrap'),body=await response.text();
  const products=JSON.parse(body).products;
  return {status:response.status,bytes:new TextEncoder().encode(body).length,ms:Math.round(performance.now()-start),inline:JSON.stringify(products).includes('data:image/'),products:products.length};
 });
 assert.equal(metrics.status,200);assert.equal(metrics.products,50);assert.equal(metrics.inline,false);assert.ok(metrics.bytes<100000);
 console.log('50-photo catalog metadata:',JSON.stringify(metrics),'photo storage bytes:',largePhoto.length*50);
 // A stuck storefront request must leave the loading state and allow a real retry.
 const stalled=await context.newPage();await stalled.clock.install();
 let release,seen,requests=0;
 const blocked=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{seen=resolve;});
 await stalled.route('**/api/storefront',async route=>{
  if(++requests===1){seen();await blocked;await route.abort().catch(()=>{});}else await route.continue();
 });
 try {
  await stalled.goto(base+'/miniapp',{waitUntil:'domcontentloaded'});await started;
  await stalled.clock.runFor(15001);await stalled.locator('#retry').waitFor();
  await stalled.locator('#retry').click();await stalled.locator('.product').first().waitFor();assert.equal(requests,2);
 }finally {release();await stalled.close();}
 // Network failures must not masquerade as an expired login; startup needs one API call.
 const recovering=await context.newPage();let bootstrapRequests=0,sessionRequests=0;
 recovering.on('request',request=>{if(request.url().endsWith('/api/auth/me'))sessionRequests++;});
 await recovering.route('**/api/bootstrap',route=>++bootstrapRequests===1?route.fulfill({status:503,json:{error:'Temporary outage'}}):route.continue());
 await recovering.goto(base);
 await recovering.getByRole('heading',{name:'Не удалось загрузить магазин',exact:true}).waitFor();
 assert.equal(await recovering.locator('#login-form').count(),0);
 await recovering.getByRole('button',{name:'Повторить',exact:true}).click();
 await recovering.locator('.products-table').waitFor();assert.equal(bootstrapRequests,2);assert.equal(sessionRequests,0);
 await recovering.close();
 console.log('PASS: stuck Mini App request times out and retries; admin recovers from HTTP 503 with one startup request');
 assert.deepEqual(errors,[]);
 console.log('PASS: multiple photos, primary photo, recoverable save errors, double-submit protection, category deletion, category-first purchasing, zero initial stock, fullscreen request, banner proportions, gallery navigation and product deletion');
} finally {
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
 rmSync(directory,{recursive:true,force:true});
}
