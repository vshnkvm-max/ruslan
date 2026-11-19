import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.js';
import {profileBotToken,signedProfileUser,insertProfileFixtures} from './fixtures/profile.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const directory=mkdtempSync(join(tmpdir(),'shop-profile-browser-')),{server,db}=createApp({dbPath:join(directory,'shop.db'),botToken:profileBotToken});
insertProfileFixtures(db);db.prepare('UPDATE customers SET balance=1540 WHERE telegram_id=101').run();db.prepare('UPDATE customers SET balance=99 WHERE telegram_id=202').run();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await context.addInitScript(initData=>{window.Telegram={WebApp:{platform:'ios',initData,initDataUnsafe:{user:{id:101,first_name:'Покупатель',username:'same_username',photo_url:'https://example.test/avatar.png'}},ready(){},expand(){}}};},signedProfileUser());
  await context.route('https://telegram.org/**',route=>route.fulfill({contentType:'text/javascript',body:''}));
  await context.route('https://example.test/avatar.png',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0a0AAAAASUVORK5CYII=','base64')}));
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/miniapp');await page.waitForFunction(()=>document.querySelector('#header-balance-value')?.textContent==='1 540');await page.waitForFunction(()=>{const image=document.querySelector('.header-profile-avatar img');return image?.complete&&image.naturalWidth>0;});await page.screenshot({path:'/tmp/shop-header-balance.png'});await page.locator('[data-product="1"]').click();await page.locator('[data-add="1"]').click();await page.locator('.product-close').click();
  await page.locator('#profile-button').click();
  await page.waitForFunction(()=>document.querySelector('[data-profile-order-count]')?.textContent==='2');
  assert.equal(await page.locator('#profile-page').isVisible(),true);
  assert.equal(await page.locator('#details').isHidden(),true);
  assert.match(await page.locator('[data-profile-order-total]').innerText(),/6\s*800/);
  assert.equal(await page.locator('#header-balance-value').innerText(),'1 540');
  assert.equal(await page.locator('#profile-page [data-open-cart]').count(),0);assert.equal(await page.getByText('Моя корзина',{exact:true}).count(),0);
  await page.getByText('Кол-во заказов',{exact:true}).waitFor();await page.getByText('Общая сумма',{exact:true}).waitFor();
  await page.screenshot({path:'/tmp/shop-profile-orders.png'});
  await page.locator('[data-customer-orders]').click();await page.getByText('Заказ #3',{exact:true}).waitFor();assert.equal(await page.getByText('Заказ #5',{exact:true}).count(),0);
  await page.locator('[data-back-profile]').click();await page.locator('#profile-page [data-my-reviews]').click();assert.equal(await page.getByRole('button',{name:'Все отзывы',exact:true}).count(),0);assert.equal(await page.locator('.my-review').count(),20);assert.equal(await page.getByText('Чужой отзыв',{exact:true}).count(),0);
  await page.locator('[data-more-reviews]').click();await page.waitForFunction(()=>document.querySelectorAll('.my-review').length===23);
  assert.equal(await page.locator('.my-review img').count(),0);assert.equal(await page.locator('[data-more-reviews]').count(),0);
  await page.locator('dialog').evaluate(element=>element.scrollTop=0);await page.screenshot({path:'/tmp/shop-profile-reviews.png'});
  await page.locator('[data-back-profile]').click();assert.equal(await page.locator('[data-profile-order-count]').innerText(),'2');
  await page.locator('#profile-accruals').click();await page.getByText('Начислений и списаний пока нет.',{exact:true}).waitFor();await page.locator('#profile-overview').click();
  for(const width of [320,1280]){
    await page.setViewportSize({width,height:844});
    assert.ok(await page.locator('.profile-stats').evaluate(element=>element.scrollWidth<=element.clientWidth+1));
    assert.ok(await page.locator('.topbar').evaluate(element=>element.scrollWidth<=element.clientWidth+1));
    await page.screenshot({path:`/tmp/shop-profile-${width}.png`});
  }
  // A different signed account must not inherit the first buyer's cached profile.
  await page.route('**/api/storefront/profile',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Временная ошибка профиля'})}));
  await page.evaluate(initData=>{window.Telegram.WebApp.initData=initData;window.Telegram.WebApp.initDataUnsafe.user={id:202,first_name:'Другой покупатель',username:'same_username'};document.querySelector('#telegram-sdk').dispatchEvent(new Event('load'));},signedProfileUser(202));
  await page.getByText('Временная ошибка профиля',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('#header-balance-value')?.textContent==='99');assert.equal(await page.locator('[data-profile-order-count]').innerText(),'—');
  await page.unroute('**/api/storefront/profile');await page.locator('[data-retry-profile]').click();
  await page.waitForFunction(()=>document.querySelector('[data-profile-order-count]')?.textContent==='1');assert.match(await page.locator('[data-profile-order-total]').innerText(),/50\s*000/);
  await page.locator('#profile-page [data-my-reviews]').click();assert.equal(await page.locator('.my-review').count(),1);await page.getByText('Чужой отзыв',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);await context.close();
  console.log('PASS: real order count and total independent of cart, own reviews and pagination, HTML escaping, recent orders, profile tabs, mobile/desktop layout, network retry and account cache isolation');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true});}
