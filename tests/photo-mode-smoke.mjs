import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.js';
import {hashPassword} from '../lib/auth.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const directory=mkdtempSync(join(tmpdir(),'shop-photo-modes-'));
const {server,db}=createApp({dbPath:join(directory,'shop.db')});
db.prepare('INSERT INTO admins(username,password) VALUES (?,?)').run('admin',hashPassword('photo-mode-password'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const admin=await browser.newContext({viewport:{width:1280,height:900}}),page=await admin.newPage();
 const images=await page.evaluate(()=>{
  const device=document.createElement('canvas');device.width=500;device.height=900;const d=device.getContext('2d');
  d.fillStyle='#fff';d.fillRect(0,0,500,900);d.fillStyle='#161923';d.beginPath();d.roundRect(180,80,140,160,20);d.fill();
  d.fillStyle='#126cbd';d.beginPath();d.roundRect(170,180,160,620,24);d.fill();d.fillStyle='#ff2200';d.fillRect(180,190,140,20);d.fillStyle='#00bb33';d.fillRect(180,760,140,20);
  const poster=document.createElement('canvas');poster.width=1000;poster.height=800;const p=poster.getContext('2d');p.fillStyle='#71398d';p.fillRect(0,0,1000,800);p.fillStyle='#ffbb33';p.fillRect(300,50,400,700);
  return [device.toDataURL('image/png'),poster.toDataURL('image/png')];
 });
 for(const [i,image] of images.entries()){
  const imageId=randomUUID();const id=Number(db.prepare('INSERT INTO products(name,sku,category,price,cost,stock,image) VALUES (?,?,?,?,?,?,?)').run(i?'Poster':'Narrow device','FIT-'+i,'Devices',1000,100,3,'/api/images/'+imageId).lastInsertRowid);
  db.prepare('INSERT INTO product_images(id,product_id,position,data) VALUES (?,?,0,?)').run(imageId,id,image);
 }
 await page.goto(base);await page.getByLabel('Логин',{exact:true}).fill('admin');await page.getByLabel('Пароль',{exact:true}).fill('photo-mode-password');await page.locator('#login-form [type=submit]').click();await page.locator('.products-table').waitFor();
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await mobile.route('https://telegram.org/**',route=>route.fulfill({contentType:'text/javascript',body:'window.Telegram={WebApp:{platform:"ios",ready(){},expand(){}}};'}));
 const mini=await mobile.newPage(),errors=[];mini.on('pageerror',e=>errors.push(e.message));
 async function load(){await mini.goto(base+'/miniapp');await mini.waitForFunction(()=>[...document.querySelectorAll('[data-product] img')].every(image=>image.complete&&image.naturalWidth>0)&&document.querySelector('[data-product="1"] img')?.style.objectFit);}
 const fit=id=>mini.locator(`[data-product="${id}"] img`).evaluate(image=>getComputedStyle(image).objectFit);
 await load();assert.equal(await fit(1),'contain','auto preserves the complete narrow device');assert.equal(await fit(2),'cover','auto fills the frame for a poster');
 await mini.waitForFunction(()=>document.getAnimations().every(a=>a.playState==='finished'));await mini.screenshot({path:'/tmp/photo-fit-auto-catalog.png'});
 await mini.locator('[data-product="1"]').tap();await mini.waitForFunction(()=>document.querySelector('dialog .photo img')?.style.objectFit==='contain');
 const preserved=await mini.locator('dialog .photo img').evaluate(image=>{
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const c=canvas.getContext('2d');c.drawImage(image,0,0);const data=c.getImageData(0,0,canvas.width,canvas.height).data;let top=false,bottom=false;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(y<canvas.height/3&&data[i]>180&&data[i+1]<90&&data[i+2]<90)top=true;if(y>canvas.height*2/3&&data[i]<90&&data[i+1]>120&&data[i+2]<100)bottom=true;}
  return top&&bottom;
 });assert.equal(preserved,true,'both end markers remain in the prepared device photo');await mini.locator('.product-close').tap();
 async function setMode(mode){await page.locator('.row-edit[data-action=edit-product][data-id="1"]').click();await page.getByLabel('Отображение фото',{exact:true}).selectOption(mode);await page.locator('#product-form [type=submit]').click();await page.locator('.modal').waitFor({state:'detached'});assert.equal(db.prepare('SELECT image_fit FROM products WHERE id=1').get().image_fit,mode);await load();}
 await setMode('cover');assert.equal(await fit(1),'cover','manual fill is persisted and applied');
 await setMode('contain');assert.equal(await fit(1),'contain','manual full-product fitting is persisted and applied');
 await page.reload();await page.locator('.products-table').waitFor();await page.locator('.row-edit[data-action=edit-product][data-id="1"]').click();assert.equal(await page.getByLabel('Отображение фото',{exact:true}).inputValue(),'contain');await page.locator('[data-action=close-modal]').last().click();
 await setMode('auto');assert.equal(await fit(1),'contain');assert.equal(await fit(2),'cover');assert.deepEqual(errors,[]);
 console.log('PASS: auto fitting preserves narrow devices, fills posters, and manual modes persist through the admin and storefront');
 await mobile.close();await admin.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true});}
