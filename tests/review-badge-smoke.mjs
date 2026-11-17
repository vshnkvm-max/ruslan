import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.js';
import {profileBotToken,signedProfileUser} from './fixtures/profile.js';
import {reviewBuyer,reviewProduct,reviewOrder} from './fixtures/reviews.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const directory=mkdtempSync(join(tmpdir(),'shop-review-badge-')),{server,db}=createApp({dbPath:join(directory,'shop.db'),botToken:profileBotToken,orderBotToken:''});
const buyer=reviewBuyer(db),other=reviewBuyer(db,202),product=reviewProduct(db);
const orders=[reviewOrder(db,buyer,product),reviewOrder(db,buyer,product)];reviewOrder(db,buyer,product,{age:8*86400000});reviewOrder(db,buyer,product,{status:'new'});
db.prepare("INSERT INTO reviews(customer_id,product_id,rating,text,status,created_at) VALUES (?,?,5,'Чужой отзыв','published','2026-11-01')").run(other,product);
const second=reviewProduct(db,'Другой товар');
db.prepare("INSERT INTO reviews(customer_id,product_id,rating,text,status,created_at) VALUES (?,?,1,'Другой товар отзыв','published','2026-10-01')").run(other,second);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 await context.addInitScript(initData=>{window.Telegram={WebApp:{initData,initDataUnsafe:{user:{id:101,first_name:'Покупатель'}},ready(){},expand(){}}};},signedProfileUser());
 await context.route('https://telegram.org/**',route=>route.fulfill({contentType:'text/javascript',body:''}));const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/miniapp');await page.locator('[data-info="reviews"]').waitFor();
 await page.locator('[data-info="reviews"]').click();await page.getByRole('heading',{name:'Отзывы',exact:true}).waitFor();await page.getByText('Чужой отзыв',{exact:true}).waitFor();
 assert.equal(await page.locator('.review-opportunity').count(),0);
 await page.getByText('Другой товар отзыв',{exact:true}).waitFor();
 for(const [sort,text] of [['rating_asc','Другой товар отзыв'],['rating_desc','Чужой отзыв'],['oldest','Другой товар отзыв'],['newest','Чужой отзыв']]){
  await page.locator('#review-sort').selectOption(sort);
  await page.waitForFunction(text=>document.querySelector('.reviews-feed .review-card p')?.textContent===text,text);
 }

 assert.equal(await page.locator('[data-info="reviews"]').getAttribute('aria-label'),'Отзывы о всех товарах');
 assert.equal(await page.locator('[data-write-review]').count(),0);
 await page.locator('dialog > .close').click();await page.locator('#profile-button').click();await page.locator('[data-my-reviews]').click();await page.locator('[data-write-review]').click();await page.locator('#review-purchase').waitFor();
 await page.locator('#review-purchase').selectOption(`${orders[0]}:${product}`);await page.locator('[data-review-rating="5"]').click();await page.locator('[data-review-submit]').click();await page.getByText('Отзыв отправлен',{exact:true}).waitFor();assert.equal(await page.locator('#review-count-badge').count(),0);
 assert.equal(db.prepare('SELECT order_id FROM reviews WHERE customer_id=?').get(buyer).order_id,orders[0]);
 await page.locator('dialog > .close').click();await page.locator('#profile-button').click();await page.locator('[data-my-reviews]').click();await page.getByText('На модерации',{exact:true}).waitFor();assert.equal(await page.locator('.my-review').count(),1);
 await page.locator('dialog > .close').click();
 await page.evaluate(initData=>{window.Telegram.WebApp.initData=initData;window.Telegram.WebApp.initDataUnsafe.user={id:202,first_name:'Другой'};document.querySelector('#telegram-sdk').dispatchEvent(new Event('load'));},signedProfileUser(202));
 assert.equal(await page.locator('#review-count-badge').count(),0);
 await page.locator('[data-info="reviews"]').click();await page.getByText('Чужой отзыв',{exact:true}).waitFor();assert.equal(await page.locator('[data-write-review]').count(),0);
 // A guest can use the same home shortcut without Telegram authentication.
 const guest=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await guest.route('https://telegram.org/**',route=>route.fulfill({contentType:'text/javascript',body:''}));
 const guestPage=await guest.newPage();guestPage.on('pageerror',error=>errors.push(error.message));
 await guestPage.goto(base+'/miniapp');await guestPage.getByRole('button',{name:'Отзывы о всех товарах',exact:true}).click();
 await guestPage.getByText('Чужой отзыв',{exact:true}).waitFor();await guestPage.getByText('Другой товар отзыв',{exact:true}).waitFor();
 assert.equal(await guestPage.locator('[data-write-review],.review-opportunity').count(),0);
 await guestPage.locator('#review-sort').selectOption('oldest');
 await guestPage.waitForFunction(()=>document.querySelector('.reviews-feed .review-card p')?.textContent==='Другой товар отзыв');
 await guestPage.screenshot({path:'/tmp/shop-home-reviews.png'});
 await guest.close();
 assert.deepEqual(errors,[]);await context.close();console.log('PASS: home reviews opens public feed, separate purchase review form, no writing controls in public feed, own reviews and account isolation');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true});}
