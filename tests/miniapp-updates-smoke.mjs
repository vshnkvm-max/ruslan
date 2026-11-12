import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server.js';
import { hashPassword } from '../lib/auth.js';
import { insertTestFixtures } from './fixtures/store.js';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const directory=mkdtempSync(join(tmpdir(),'shop-updates-'));
const {server,db}=createApp({dbPath:join(directory,'test.db')});
insertTestFixtures(db);db.prepare('INSERT INTO admins(username,password) VALUES (?,?)').run('admin',hashPassword('updates-test-password'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try {
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base);await page.getByLabel('Логин',{exact:true}).fill('admin');await page.getByLabel('Пароль',{exact:true}).fill('updates-test-password');
 await page.locator('#login-form [type=submit]').click();await page.locator('.products-table').waitFor();
 await page.locator('[data-action=edit-product]').first().click();assert.equal(await page.locator('#product-form [name=stock]').count(),0);
 await page.locator('[data-action=close-modal]').last().click();
 const original=await page.evaluate(async()=> (await (await fetch('/api/bootstrap')).json()).categories);
 await page.getByRole('button',{name:'Управление категориями',exact:true}).click();
 await page.getByRole('button',{name:'Опустить '+original[0],exact:true}).click();
 const afterMove=[original[1],original[0],...original.slice(2)];
 assert.deepEqual(await page.locator('#category-order-list strong').allTextContents(),afterMove);
 await page.locator('#category-order-list [draggable]').last().dragTo(page.locator('#category-order-list [draggable]').first());
 const expected=[afterMove.at(-1),...afterMove.slice(0,-1)];
 assert.deepEqual(await page.locator('#category-order-list strong').allTextContents(),expected);
 await page.locator('#category-order-form [type=submit]').click();await page.locator('.modal').waitFor({state:'detached'});
 await page.reload();await page.locator('.products-table').waitFor();
 assert.deepEqual(await page.evaluate(async()=> (await (await fetch('/api/storefront')).json()).categories),expected);
 const purchase=await page.evaluate(async()=>{
  const data=await (await fetch('/api/bootstrap')).json();
  const response=await fetch('/api/purchases',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':data.user.csrf},body:JSON.stringify({supplier:'Unique supplier for operations',posted:true,paid:100,request_key:'updates-purchase',items:[{product_id:data.products[0].id,quantity:2,cost:100}]})});
  return response.json();
 });
 assert.ok(purchase.id,JSON.stringify(purchase));
 await page.goto(base+'/#finance');await page.reload();await page.locator('.operations-table').waitFor();
 await page.getByRole('searchbox').fill('Unique supplier for operations');
 await page.locator(`[data-operation="p${purchase.id}"]`).waitFor();
 assert.equal(await page.locator('.operations-table tbody tr').count(),1,'purchase payment is not duplicated as a second operation');
 assert.match(await page.locator('.operations-table').innerText(),/Закупка/);assert.equal(await page.locator('.metrics-grid').count(),0);
 await page.locator(`[data-operation="p${purchase.id}"] [data-action=purchase-open]`).click();await page.locator('#purchase-form').waitFor();
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('searchbox').fill('');await page.locator('[data-action=filter][data-value=sale]').click();
 assert.ok(await page.locator('[data-operation^="o"]').count()>0);
 await page.locator('[data-operation^="o"] button').first().click();await page.locator('#order-form').waitFor();await page.locator('[data-action=close-modal]').last().click();
 await page.locator('nav a[href="#content"]').click();await page.getByRole('button',{name:/Баннеры/}).click();
 await page.getByRole('button',{name:'Редактировать баннер',exact:true}).first().click();
 assert.equal(await page.locator('#banner-form [name=link]').count(),0);
 await page.getByLabel('Подробное описание акции',{exact:true}).fill('Подробные условия акции\nТолько до конца недели.');
 await page.locator('#banner-form [type=submit]').click();await page.locator('.modal').waitFor({state:'detached'});
 // Generate portrait/landscape photos to exercise image sizing independently of source proportions.
 for(const [id,width,height,color] of [[1,90,240,'#ff0033'],[2,240,90,'#00aa66']]){
  const data=await page.evaluate(({width,height,color})=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,width,height);return canvas.toDataURL('image/png');},{width,height,color});
  const imageId=randomUUID();db.prepare('INSERT INTO product_images(id,product_id,position,data) VALUES (?,?,0,?)').run(imageId,id,data);
  db.prepare('UPDATE products SET image=? WHERE id=?').run('/api/images/'+imageId,id);
 }
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const avatar='https://t.me/i/userpic/test-avatar.png';
 await mobile.route(avatar,route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0a0AAAAASUVORK5CYII=','base64')}));
 await mobile.route('https://telegram.org/**',route=>route.fulfill({contentType:'text/javascript',body:`
 window.tgEvents={};window.tgColors={};window.fullscreenCalls=0;
 window.Telegram={WebApp:{initDataUnsafe:{user:{id:123,first_name:'Тест',photo_url:${JSON.stringify(avatar)}}},ready(){},expand(){},isVersionAtLeast(){return true},isFullscreen:false,
 setHeaderColor(c){tgColors.header=c},setBackgroundColor(c){tgColors.background=c},setBottomBarColor(c){tgColors.bottom=c},
 safeAreaInset:{top:24,bottom:12},contentSafeAreaInset:{top:30,bottom:10},onEvent(e,fn){tgEvents[e]=fn},requestFullscreen(){fullscreenCalls++;this.isFullscreen=true;tgEvents.fullscreenChanged?.()}}};`}));
 const mini=await mobile.newPage();mini.on('pageerror',error=>errors.push(error.message));await mini.goto(base+'/miniapp');
 await mini.locator('.product').first().waitFor();
 await mini.waitForFunction(()=>window.fullscreenCalls===1);
 assert.equal(await mini.evaluate(()=>fullscreenCalls),1);assert.deepEqual(await mini.evaluate(()=>tgColors),{header:'#100002',background:'#100002',bottom:'#100002'});
 await mini.waitForFunction(()=>{const image=document.querySelector('#profile-button img');return image?.complete&&image.naturalWidth>0;});
 assert.deepEqual(await mini.locator('#categories [data-category]').evaluateAll(elements=>elements.map(e=>e.dataset.category)),['',...expected]);
 await mini.locator('#profile-button').tap();await mini.waitForFunction(()=>{const image=document.querySelector('.profile-avatar img');return image?.complete&&image.naturalWidth>0;});
 await mini.locator('dialog[data-view=product] .product-close, dialog:not([data-view=product]) > .close').tap();await mini.locator('dialog').waitFor({state:'hidden'});
 await mini.locator('#banner .banner-open').first().tap();await mini.getByText('Только до конца недели.',{exact:true}).waitFor();
 assert.equal(await mini.locator('#banner a').count(),0);assert.equal(mobile.pages().length,1);
 await mini.locator('dialog[data-view=product] .product-close, dialog:not([data-view=product]) > .close').tap();await mini.locator('dialog').waitFor({state:'hidden'});
 await mini.evaluate(()=>scrollTo(0,650));
 const sticky=await mini.locator('.category-bar').evaluate(element=>({top:element.getBoundingClientRect().top,position:getComputedStyle(element).position,scroll:scrollY}));
 assert.equal(sticky.position,'sticky');assert.ok(sticky.scroll>300);assert.ok(Math.abs(sticky.top-54)<2,JSON.stringify(sticky));
 await mini.evaluate(()=>scrollTo(0,0));
 for(const id of [1,2]){
  const image=mini.locator(`[data-product="${id}"] img`);await image.waitFor();
  const geometry=await image.evaluate(image=>{const canvas=image.parentElement.getBoundingClientRect(),rect=image.getBoundingClientRect();return {square:Math.abs(canvas.width-canvas.height),offset:Math.abs((rect.left+rect.right)-(canvas.left+canvas.right))+Math.abs((rect.top+rect.bottom)-(canvas.top+canvas.bottom)),fit:getComputedStyle(image).objectFit};});
  assert.ok(geometry.square<1);assert.ok(geometry.offset<1);assert.equal(geometry.fit,'contain');
 }
 await mini.locator('[data-product="1"]').tap();
 await mini.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState==='finished'));
 const sheet=await mini.locator('dialog').evaluate(element=>{const rect=element.getBoundingClientRect();return {bottom:rect.bottom,width:rect.width,height:rect.height,viewport:innerHeight};});
 assert.ok(Math.abs(sheet.bottom-sheet.viewport)<1);assert.equal(sheet.width,390);assert.ok(sheet.height>sheet.viewport*0.9);
 assert.equal(await mini.locator('dialog').evaluate(element=>getComputedStyle(element).outlineStyle),'none');
 await mini.waitForFunction(()=>{const image=document.querySelector('dialog .photo img');return image?.complete&&image.naturalWidth>0;});
 const openedPhoto=await mini.locator('dialog .photo img').first().evaluate(image=>{const rect=image.getBoundingClientRect(),frame=image.parentElement.getBoundingClientRect();return {ratio:rect.width/rect.height,natural:image.naturalWidth/image.naturalHeight,gap:Math.abs(frame.width-rect.width)+Math.abs(frame.height-rect.height)};});
 assert.ok(Math.abs(openedPhoto.ratio-openedPhoto.natural)<0.01,'opened portrait photo keeps its aspect ratio');
 assert.ok(openedPhoto.gap<1,'opened photo does not sit inside a square with side gaps');
 await mini.screenshot({path:'/tmp/shop-product-sheet.png'});
 await mini.keyboard.press('Escape');await mini.locator('dialog').waitFor({state:'hidden'});
 await mini.screenshot({path:'/tmp/shop-updated-catalog.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS: category drag/order persistence, stock field removed, unified purchase/sale history, promotion descriptions, Telegram colors/fullscreen/avatar, centered photos, bottom product page and sticky categories');
 await mobile.close();await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true});}
