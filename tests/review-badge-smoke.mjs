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
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 await context.addInitScript(initData=>{window.Telegram={WebApp:{initData,initDataUnsafe:{user:{id:101,first_name:'Покупатель'}},ready(){},expand(){}}};},signedProfileUser());
 await context.route('https://telegram.org/**',route=>route.fulfill({contentType:'text/javascript',body:''}));const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/miniapp');await page.waitForFunction(()=>document.querySelector('#review-count-badge')?.textContent==='2');
 await page.locator('[data-info="reviews"]').click();await page.getByRole('heading',{name:'Оставить отзыв',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.review-opportunity').length===2);assert.equal(await page.locator('[data-all-reviews]').count(),1);assert.equal(await page.locator('[data-my-reviews]').count(),0);assert.equal(await page.getByText('Чужой отзыв',{exact:true}).count(),0);
 await page.screenshot({path:'/tmp/shop-review-opportunities.png'});
 // Repeated purchases of the same product must select the exact order clicked.
 await page.locator(`[data-review-purchase="${orders[0]}:${product}"]`).click();await page.locator('#review-purchase').waitFor();assert.equal(await page.locator('#review-purchase').inputValue(),`${orders[0]}:${product}`);await page.locator('[data-review-rating="5"]').click();await page.locator('[data-review-submit]').click();await page.getByText('Отзыв отправлен',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('#review-count-badge')?.textContent==='1');assert.equal(db.prepare('SELECT order_id FROM reviews WHERE customer_id=?').get(buyer).order_id,orders[0]);
 await page.locator('[data-review-opportunities]').click();await page.waitForFunction(()=>document.querySelectorAll('.review-opportunity').length===1);assert.equal(await page.locator(`[data-review-purchase="${orders[0]}:${product}"]`).count(),0);
 await page.locator('dialog > .close').click();await page.locator('#profile-button').click();await page.locator('[data-my-reviews]').click();await page.getByText('На модерации',{exact:true}).waitFor();assert.equal(await page.locator('.my-review').count(),1);
 db.prepare('UPDATE orders SET completed_at=? WHERE id=?').run(new Date(Date.now()-7*86400000+2500).toISOString(),orders[1]);
 await page.locator('#catalog-tab').click();await page.locator('[data-info="reviews"]').click();await page.getByText('Сейчас нет товаров, на которые можно оставить отзыв.',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('#review-count-badge')?.hidden===true);assert.equal(await page.locator('[data-review-purchase]').count(),0);
 // Switching accounts must never keep the old buyer's opportunities visible.
 await page.evaluate(initData=>{window.Telegram.WebApp.initData=initData;window.Telegram.WebApp.initDataUnsafe.user={id:202,first_name:'Другой'};document.querySelector('#telegram-sdk').dispatchEvent(new Event('load'));},signedProfileUser(202));await page.getByText('Сейчас нет товаров, на которые можно оставить отзыв.',{exact:true}).waitFor();assert.equal(await page.locator('#review-count-badge').isVisible(),false);
 assert.deepEqual(errors,[]);await context.close();console.log('PASS: home reviews lists eligible purchases and links to the public feed, exact repeated purchase selection, count 2 → 1 → hidden, expiry, own reviews remain in profile and account isolation');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true});}
