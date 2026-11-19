import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.js';
import {hashPassword} from '../lib/auth.js';
import {profileBotToken,signedProfileUser} from './fixtures/profile.js';
import {reviewBuyer,reviewProduct,reviewOrder,reviewPng} from './fixtures/reviews.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const directory=mkdtempSync(join(tmpdir(),'shop-review-browser-')),{server,db}=createApp({dbPath:join(directory,'shop.db'),botToken:profileBotToken,orderBotToken:''});
db.prepare('INSERT INTO admins(username,password) VALUES (?,?)').run('reviews-admin',hashPassword('test-review-password'));
const buyer=reviewBuyer(db),other=reviewBuyer(db,202),product=reviewProduct(db,'Купленный товар'),expired=reviewProduct(db,'Просроченный товар');
reviewOrder(db,buyer,product);reviewOrder(db,buyer,expired,{age:8*86400000});reviewOrder(db,buyer,expired,{status:'new'});
for(const [rating,text,date] of [[1,'Первый отзыв','2026-01-01'],[5,'Второй отзыв','2026-01-02'],[3,'Третий отзыв','2026-01-03']])db.prepare("INSERT INTO reviews(customer_id,product_id,rating,text,status,created_at,author_name) VALUES (?,?,?,?,'published',?,'Анна')").run(other,product,rating,text,date);
for(let i=0;i<18;i++)db.prepare("INSERT INTO reviews(customer_id,product_id,rating,text,status,created_at,author_name) VALUES (?,?,3,?,'published','2026-01-04','Анна')").run(other,product,`Дополнительный отзыв ${i+1}`);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 await context.addInitScript(initData=>{window.Telegram={WebApp:{platform:'ios',initData,initDataUnsafe:{user:{id:101,first_name:'Покупатель',username:'buyer'}},ready(){},expand(){},disableVerticalSwipes(){},enableVerticalSwipes(){}}};},signedProfileUser());
 await context.route('https://telegram.org/**',route=>route.fulfill({contentType:'text/javascript',body:''}));
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 let productAttempts=0,feedPageFailures=0;
 await page.route('**/api/storefront/reviews?*',route=>{
  const query=new URL(route.request().url()).searchParams;
  if(query.get('product_id')===String(product)&&query.get('offset')==='0'&&++productAttempts===1){
   return route.fulfill({status:502,contentType:'text/html',body:'<h1>Bad Gateway</h1>'});
  }
  if(!query.has('product_id')&&query.get('offset')==='20'&&feedPageFailures++<2){
   return route.abort('failed');
  }
  return route.continue();
 });
 await page.goto(base+'/miniapp');await page.locator(`[data-product="${product}"]`).click();
 const productReviews=page.locator('#product-reviews');
 await productReviews.locator('.review-card').nth(19).waitFor();
 assert.equal(productAttempts,2,'the first product page retries a proxy error');
 assert.equal(await productReviews.locator('.review-product-name').count(),0);
 assert.equal(await productReviews.getByRole('button',{name:'Все отзывы о товаре'}).count(),0);
 await productReviews.getByRole('button',{name:'Показать ещё отзывы'}).click();
 await productReviews.locator('.review-card').nth(20).waitFor();
 await page.locator('.product-close').click();
 await page.locator('[data-info="reviews"]').click();
 await page.locator('.reviews-feed .review-product-name').first().waitFor();
 assert.equal(await page.locator('.reviews-feed .review-card').count(),20);
 assert.equal(await page.evaluate(initData=>{
  const before=document.querySelector('.reviews-feed .review-card');
  const saved=window.Telegram.WebApp.initData;
  window.Telegram.WebApp.initData=initData;
  document.querySelector('#telegram-sdk').dispatchEvent(new Event('load'));
  window.Telegram.WebApp.initData=saved;
  document.querySelector('#telegram-sdk').dispatchEvent(new Event('load'));
  return before===document.querySelector('.reviews-feed .review-card');
 },signedProfileUser(202)),true,'late Telegram data does not clear public reviews');
 await page.locator('[data-review-more]').click();
 await page.locator('[data-review-retry]').waitFor();
 assert.equal(feedPageFailures,2);
 assert.equal(await page.locator('.reviews-feed .review-card').count(),20);
 await page.locator('[data-review-retry]').click();
 await page.locator('.reviews-feed .review-card').nth(20).waitFor();
 assert.equal(feedPageFailures,3,'retry resumes at the failed page');

 await page.selectOption('#review-sort','oldest');await page.waitForFunction(()=>document.querySelector('.reviews-feed .review-card p')?.textContent==='Первый отзыв');
 await page.selectOption('#review-sort','rating_desc');await page.waitForFunction(()=>document.querySelector('.reviews-feed .review-card p')?.textContent==='Второй отзыв');
 await page.selectOption('#review-sort','rating_asc');await page.waitForFunction(()=>document.querySelector('.reviews-feed .review-card p')?.textContent==='Первый отзыв');
 await page.locator('#review-media-only').check();await page.getByText('Отзывов пока нет.',{exact:true}).waitFor();
 await page.locator('dialog > .close').click();await page.locator(`[data-product="${product}"]`).click();
 await productReviews.locator('[data-write-review]').click();await page.locator('#review-purchase').waitFor();
 await page.locator('[data-review-back]').click();await productReviews.locator('[data-write-review]').click();
 await page.locator('#review-purchase').waitFor();assert.equal(await page.locator('#review-purchase option:not([value=""])').count(),1);assert.match(await page.locator('#review-purchase').innerText(),/Купленный товар/);assert.doesNotMatch(await page.locator('#review-purchase').innerText(),/Просроченный/);
 await page.locator('[data-review-submit]').click();await page.getByText('Выберите оценку от 1 до 5 звёзд.',{exact:true}).waitFor();
 await page.locator('[data-review-rating="4"]').click();await page.locator('#review-text').fill('Мой отзыв с фото и видео <b>без HTML</b>');
 await page.locator('#review-files').setInputFiles({name:'review.png',mimeType:'image/png',buffer:reviewPng});
 await page.locator('.review-draft-media img').waitFor();await page.locator('[data-review-submit]:not([disabled])').waitFor();
 await page.locator('#review-files').setInputFiles(new URL('./fixtures/review-video.mp4',import.meta.url).pathname);
 await page.locator('.review-draft-media video').waitFor();await page.locator('[data-review-submit]:not([disabled])').waitFor();
 assert.equal(await page.locator('.review-draft-media > div').count(),2);
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('#details').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:`/tmp/shop-review-form-${width}.png`});}
 await page.setViewportSize({width:390,height:844});await page.locator('[data-review-submit]').click();await page.getByText('Отзыв отправлен',{exact:true}).waitFor();await page.locator('#details [data-my-reviews]').click();
 await page.getByText('На модерации',{exact:true}).waitFor();assert.equal(await page.locator('.my-review').count(),1);assert.equal(await page.locator('.my-review img').count(),1);assert.equal(await page.locator('.my-review video').count(),1);assert.equal(await page.locator('.my-review b').count(),0);await page.locator('.my-review time').waitFor();assert.equal(await page.getByRole('button',{name:'Все отзывы',exact:true}).count(),0);
 const sent=db.prepare('SELECT id FROM reviews WHERE customer_id=?').get(buyer);assert.ok(sent);assert.equal(db.prepare('SELECT rating FROM reviews WHERE id=?').get(sent.id).rating,4);
 const admin=await browser.newContext({viewport:{width:1280,height:900}}),adminPage=await admin.newPage();await adminPage.goto(base);await adminPage.getByLabel('Логин',{exact:true}).fill('reviews-admin');await adminPage.getByLabel('Пароль',{exact:true}).fill('test-review-password');await adminPage.locator('#login-form button[type=submit]').click();await adminPage.locator('.products-table').waitFor();await adminPage.locator('nav a[href="#reviews"]').click();
 const adminCard=adminPage.locator('.reviews-list .review').filter({hasText:'Мой отзыв с фото и видео'});await adminCard.waitFor();assert.equal(await adminCard.locator('.admin-review-media img').count(),1);assert.equal(await adminCard.locator('.admin-review-media video').count(),1);
 await adminCard.locator('[data-action="review-publish"]').click();await adminPage.waitForFunction(id=>!document.querySelector(`[data-action="review-publish"][data-id="${id}"]`),sent.id);
 await page.locator('dialog > .close').click();await page.locator('#catalog-tab').click();await page.locator('[data-info="reviews"]').click();await page.locator('#review-media-only').check();await page.waitForFunction(()=>document.querySelectorAll('.reviews-feed .review-card').length===1);
 await page.locator('.reviews-feed video').evaluate(video=>{video.load();});await page.waitForFunction(()=>document.querySelector('.reviews-feed video')?.readyState>=1);
 await page.locator('.reviews-feed video').evaluate(async video=>{await video.play();});
 const mediaLayout=await page.locator('.reviews-feed .review-media-list').evaluate(list=>{const image=list.querySelector('img'),card=list.closest('.review-card'),box=image.getBoundingClientRect(),media=list.getBoundingClientRect(),frame=card.getBoundingClientRect();return {width:box.width,height:box.height,centered:Math.abs((media.left+media.right)-(frame.left+frame.right))<2,border:getComputedStyle(card).borderTopStyle};});
 assert.deepEqual(mediaLayout,{width:96,height:96,centered:true,border:'solid'});
 const singlePhoto=await page.locator('.reviews-feed .review-media-list').evaluate(list=>{
  list.querySelector('video').remove();
  const card=list.closest('.review-card');
  const leftEdge=card.getBoundingClientRect().left+card.clientLeft+parseFloat(getComputedStyle(card).paddingLeft);
  return Math.abs(list.getBoundingClientRect().left-leftEdge)<1;
 });
 assert.equal(singlePhoto,true);
 await page.screenshot({path:'/tmp/shop-review-feed.png'});
 // A committed response lost in transit must be recovered without creating a duplicate.
 const secondOrder=reviewOrder(db,buyer,product);
 await page.locator('dialog > .close').click();await page.locator('#profile-button').click();await page.locator('#profile-page [data-my-reviews]').click();await page.locator('[data-write-review]').click();await page.locator('#review-purchase').waitFor();await page.locator('[data-review-rating="5"]').click();await page.locator('#review-text').fill('Повтор после потери ответа');
 let drop=true;await page.route('**/api/storefront/reviews',async route=>{if(route.request().method()==='POST'&&drop){drop=false;await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.locator('[data-review-submit]').click();await page.getByText('Проверим отправленный отзыв. Повторная отправка не создаст второй отзыв.',{exact:true}).waitFor();
 await page.locator('[data-review-submit]').click();await page.getByText('Отзыв отправлен',{exact:true}).waitFor();assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE customer_id=? AND order_id=?').get(buyer,secondOrder).n,1);
 await page.locator('dialog > .close').click();await page.locator('#catalog-tab').click();await page.locator('[data-info="reviews"]').click();await page.locator('.reviews-feed .review-card').first().waitFor();await page.waitForTimeout(150);assert.equal(await page.locator('[data-write-review]').count(),0);
 // Pending drafts are scoped to the account even when the Telegram SDK replaces its identity.
 await page.evaluate(({order,product})=>localStorage.setItem('gas-review-pending:gas-cart:v1:101',JSON.stringify({request_key:crypto.randomUUID(),order_id:order,product_id:product,rating:5,text:'Личный черновик',media_ids:[]})),{order:secondOrder,product});
 await page.locator('dialog > .close').click();await page.locator('#profile-button').click();await page.locator('#profile-page [data-my-reviews]').click();await page.locator('[data-write-review]').click();await page.getByText('Проверим отправленный отзыв. Повторная отправка не создаст второй отзыв.',{exact:true}).waitFor();
 await page.evaluate(initData=>{window.Telegram.WebApp.initData=initData;window.Telegram.WebApp.initDataUnsafe.user={id:202,first_name:'Другой'};document.querySelector('#telegram-sdk').dispatchEvent(new Event('load'));},signedProfileUser(202));
 await page.getByText('Сейчас нет товаров, доступных для отзыва. Отзыв можно оставить в течение 7 дней после выполнения заказа.',{exact:true}).waitFor();assert.equal(await page.locator('[data-review-submit]').count(),0);
 // A guest can read public reviews, but gets no submission form.
 const guest=await browser.newContext({viewport:{width:390,height:844}});await guest.route('https://telegram.org/**',route=>route.fulfill({contentType:'text/javascript',body:''}));const guestPage=await guest.newPage();await guestPage.goto(base+'/miniapp');await guestPage.locator('[data-info="reviews"]').click();await guestPage.locator('.reviews-feed .review-card').first().waitFor();assert.equal(await guestPage.locator('[data-write-review]').count(),0);await guest.close();
 const mediaIds=db.prepare('SELECT id FROM review_media WHERE review_id=?').all(sent.id);
 await adminCard.locator('[data-action="review-delete"]').click();
 await adminPage.locator('[data-action="confirm-delete-review"]').click();
 await adminCard.waitFor({state:'detached'});
 for(const {id} of mediaIds)assert.equal((await fetch(base+'/api/review-media/'+id)).status,404);
 await admin.close();
 assert.deepEqual(errors,[]);await context.close();console.log('PASS: product reviews, all filters, 7-day purchase selection, photo and video upload, playback, moderation status, own reviews, lost-response recovery, guest access and 320/390/1280 layouts');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true});}
