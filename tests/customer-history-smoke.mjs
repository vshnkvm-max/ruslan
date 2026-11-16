import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.js';
import {profileBotToken,signedProfileUser} from './fixtures/profile.js';
import {reviewBuyer,reviewProduct,reviewOrder} from './fixtures/reviews.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const directory=mkdtempSync(join(tmpdir(),'shop-history-browser-')),{server,db}=createApp({dbPath:join(directory,'shop.db'),botToken:profileBotToken,orderBotToken:''});
const buyer=reviewBuyer(db),other=reviewBuyer(db,202),product=reviewProduct(db,'Товар <без HTML>');
db.prepare("INSERT INTO admins VALUES (1,'test','unused')").run();db.prepare('UPDATE customers SET balance=1000 WHERE id=?').run(buyer);
db.prepare("INSERT INTO customer_balance_adjustments(customer_id,admin_id,old_balance,new_balance,amount,request_key,created_at) VALUES (?,1,0,1000,1000,?,'2026-11-01T00:00:00.000Z')").run(buyer,randomUUID());
for(let i=0;i<23;i++)reviewOrder(db,buyer,product,{status:'new'});reviewOrder(db,other,product);
const completed=reviewOrder(db,buyer,product);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const result=await fetch(base+'/api/storefront/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({init_data:signedProfileUser(),request_key:randomUUID(),balance_spend:200,items:[{product_id:product,quantity:1,price:1000}]})});assert.equal(result.status,201);const order=(await result.json()).order;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 await context.addInitScript(initData=>{window.Telegram={WebApp:{platform:'ios',initData,initDataUnsafe:{user:{id:101,first_name:'Покупатель'}},ready(){},expand(){}}};},signedProfileUser());
 await context.route('https://telegram.org/**',route=>route.fulfill({contentType:'text/javascript',body:''}));
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/miniapp');await page.locator('#profile-button').click();await page.waitForFunction(()=>document.querySelector('[data-profile-order-count]')?.textContent==='25');
 assert.equal(await page.locator('[data-toggle-orders]').count(),0);await page.getByRole('tab',{name:'Начисления',exact:true}).waitFor();
 await page.locator('[data-customer-orders]').click();await page.waitForFunction(()=>document.querySelectorAll('.customer-order-button').length===20);await page.locator('[data-more-orders]').click();await page.waitForFunction(()=>document.querySelectorAll('.customer-order-button').length===25);assert.equal(await page.locator('[data-more-orders]').count(),0);
 await page.locator(`[data-customer-order="${completed}"]`).click();await page.getByText('Товар <без HTML>',{exact:true}).waitFor();assert.equal(await page.locator('[data-cancel-customer-order]').count(),0);
 await page.locator('[data-back-customer-orders]').click();await page.locator(`[data-customer-order="${order.id}"]`).click();await page.locator('[data-cancel-customer-order]').waitFor();await page.getByText('Списано рублей',{exact:true}).waitFor();
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('#details').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:`/tmp/shop-customer-order-${width}.png`});}
 await page.setViewportSize({width:390,height:844});await page.locator('[data-cancel-customer-order]').click();await page.locator('[data-keep-order]').click();assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'new');
 await page.locator('[data-cancel-customer-order]').click();await page.locator('[data-confirm-order-cancel]').click();await page.getByText('Рубли возвращены',{exact:true}).waitFor();assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'cancelled');assert.equal(db.prepare('SELECT balance FROM customers WHERE id=?').get(buyer).balance,1000);assert.equal(await page.locator('[data-cancel-customer-order]').count(),0);
 await page.waitForFunction(()=>document.querySelector('#header-balance-value')?.textContent==='1 000');await page.locator('[data-back-customer-orders]').click();await page.locator('[data-back-profile]').click();await page.waitForFunction(()=>document.querySelector('[data-profile-order-count]')?.textContent==='24');
 await page.locator('#profile-accruals').click();await page.getByText(`Возврат за заказ #${order.id}`,{exact:true}).waitFor();await page.getByText(`Списание за заказ #${order.id}`,{exact:true}).waitFor();await page.getByText('Начисление баланса',{exact:true}).waitFor();assert.equal(await page.locator('.balance-history-row').count(),3);
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('#details').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:`/tmp/shop-accruals-${width}.png`});}
 await page.locator(`[data-customer-order="${order.id}"]`).first().click();await page.getByText('Рубли возвращены',{exact:true}).waitFor();await page.locator('[data-back-customer-orders]').click();await page.getByRole('heading',{name:'Начисления и списания',exact:true}).waitFor();
 // Recover a cancellation whose server response was lost after the refund committed.
 const created=await fetch(base+'/api/storefront/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({init_data:signedProfileUser(),request_key:randomUUID(),balance_spend:100,items:[{product_id:product,quantity:1,price:1000}]})});const uncertain=(await created.json()).order;
 await page.locator('#profile-overview').click();await page.locator('[data-customer-orders]').click();await page.locator(`[data-customer-order="${uncertain.id}"]`).click();await page.locator('[data-cancel-customer-order]').waitFor();await page.waitForFunction(()=>document.querySelector('#header-balance-value')?.textContent==='900');
 await page.route(`**/api/storefront/orders/${uncertain.id}/cancel`,async route=>{await route.fetch();await route.abort('failed');});
 await page.locator('[data-cancel-customer-order]').click();await page.locator('[data-confirm-order-cancel]').click();await page.locator('[data-retry-order]').waitFor();await page.locator('[data-retry-order]').click();await page.getByText('Рубли возвращены',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('#header-balance-value')?.textContent==='1 000');assert.equal(db.prepare("SELECT COUNT(*) AS n FROM balance_operations WHERE order_id=? AND kind='order_refund'").get(uncertain.id).n,1);
 await page.locator('[data-back-customer-orders]').click();await page.locator('[data-back-profile]').click();await page.locator('#profile-accruals').click();await page.getByText(`Возврат за заказ #${uncertain.id}`,{exact:true}).waitFor();
 // Switching identities must immediately remove private history and order details.
 await page.evaluate(initData=>{window.Telegram.WebApp.initData=initData;window.Telegram.WebApp.initDataUnsafe.user={id:202,first_name:'Другой'};document.querySelector('#telegram-sdk').dispatchEvent(new Event('load'));},signedProfileUser(202));
 await page.getByText('Начислений и списаний пока нет.',{exact:true}).waitFor();assert.equal(await page.locator('.balance-history-row').count(),0);await page.locator('#profile-overview').click();await page.locator('[data-customer-orders]').click();await page.waitForFunction(()=>document.querySelectorAll('.customer-order-button').length===1);assert.equal(await page.locator(`[data-customer-order="${order.id}"]`).count(),0);
 assert.deepEqual(errors,[]);await context.close();console.log('PASS: order button, complete list and pagination, contents, cancellation confirmation and refund, balance history, order links, profile totals, account isolation, mobile/desktop layouts');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true});}
