import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.js';
import {hashPassword} from '../lib/auth.js';
import {profileBotToken,signedProfileUser,insertProfileFixtures} from './fixtures/profile.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const directory=mkdtempSync(join(tmpdir(),'shop-manual-balance-')),{server,db}=createApp({dbPath:join(directory,'shop.db'),botToken:profileBotToken,orderBotToken:''});
insertProfileFixtures(db);db.prepare("INSERT INTO admins(username,password) VALUES ('admin',?)").run(hashPassword('manual-balance-test-password'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),admin=await context.newPage(),errors=[];
 admin.on('pageerror',error=>errors.push(error.message));
 await admin.goto(base+'/#customers');await admin.getByLabel('Логин',{exact:true}).fill('admin');await admin.getByLabel('Пароль',{exact:true}).fill('manual-balance-test-password');await admin.locator('#login-form [type=submit]').click();await admin.locator('.customers-table').waitFor();
 await admin.locator('.person-cell[data-action=customer-detail][data-id="1"]').click();await admin.getByRole('button',{name:'Установить баланс',exact:true}).click();
 await admin.getByLabel('Баланс, ₽',{exact:true}).fill('1500');await admin.locator('#customer-balance-form [type=submit]').click();await admin.locator('.modal').waitFor({state:'detached'});
 assert.equal(db.prepare('SELECT balance FROM customers WHERE id=1').get().balance,1500);
 await admin.locator('[data-action=customer-balance][data-id="1"]').click();
 await admin.getByLabel('Баланс, ₽',{exact:true}).fill('2000');
 await admin.screenshot({path:'/tmp/shop-admin-customer-balance.png'});
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 await mobile.addInitScript(initData=>{window.Telegram={WebApp:{platform:'ios',initData,initDataUnsafe:{user:{id:101,first_name:'Покупатель'}},ready(){},expand(){}}};},signedProfileUser());
 await mobile.route('https://telegram.org/**',route=>route.fulfill({contentType:'text/javascript',body:''}));
 const mini=await mobile.newPage();mini.on('pageerror',error=>errors.push(error.message));await mini.goto(base+'/miniapp');
 await mini.waitForFunction(()=>document.querySelector('#header-balance-value')?.textContent==='1 500');
 await mini.locator('[data-product="1"]').click();await mini.locator('[data-add="1"]').click();await mini.locator('[data-open-cart]').click();await mini.locator('[data-checkout]').click();await mini.locator('[data-toggle-rubles]').click();
 assert.equal(await mini.locator('#checkout-rubles').inputValue(),'1000');await mini.locator('[data-confirm-checkout]').click();await mini.getByRole('heading',{name:'Заказ #6 принят',exact:true}).waitFor();assert.equal(db.prepare('SELECT balance FROM customers WHERE id=1').get().balance,500);
 // A stale admin form must not silently overwrite the buyer's payment.
 await admin.locator('#customer-balance-form [type=submit]').click();await admin.locator('#customer-balance-form .form-error').filter({hasText:'Баланс клиента изменился'}).waitFor();
 assert.equal(db.prepare('SELECT balance FROM customers WHERE id=1').get().balance,500);assert.match(await admin.locator('#customer-balance-current').innerText(),/500/);
 await admin.getByLabel('Баланс, ₽',{exact:true}).fill('1800');await admin.locator('#customer-balance-form [type=submit]').click();await admin.locator('.modal').waitFor({state:'detached'});assert.equal(db.prepare('SELECT balance FROM customers WHERE id=1').get().balance,1800);
 // Commit the next adjustment but lose its response; a later debit must survive the retry.
 await admin.locator('[data-action=customer-balance][data-id="1"]').click();await admin.getByLabel('Баланс, ₽',{exact:true}).fill('2500');
 await admin.route('**/api/customers/1/balance',async route=>{if(route.request().method()==='PATCH'){await route.fetch();await route.abort('failed');}else await route.continue();});
 await admin.locator('#customer-balance-form [type=submit]').click();await admin.locator('#customer-balance-form .form-error').filter({hasText:'Нет соединения'}).waitFor();assert.equal(await admin.getByLabel('Баланс, ₽',{exact:true}).isEditable(),false);
 const paid=await mini.evaluate(async initData=>{const response=await fetch('/api/storefront/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({init_data:initData,request_key:crypto.randomUUID(),balance_spend:300,items:[{product_id:1,quantity:1,price:2000}]})});return response.status;},signedProfileUser());assert.equal(paid,201);assert.equal(db.prepare('SELECT balance FROM customers WHERE id=1').get().balance,2200);
 await admin.unroute('**/api/customers/1/balance');await admin.locator('#customer-balance-form [type=submit]').click();await admin.locator('.modal').waitFor({state:'detached'});
 assert.equal(db.prepare('SELECT balance FROM customers WHERE id=1').get().balance,2200);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM customer_balance_adjustments WHERE customer_id=1').get().n,3);
 await admin.locator('[data-action=customer-balance][data-id="1"]').click();await admin.getByLabel('Баланс, ₽',{exact:true}).fill('0');await admin.locator('#customer-balance-form [type=submit]').click();await admin.locator('.modal').waitFor({state:'detached'});assert.equal(db.prepare('SELECT balance FROM customers WHERE id=1').get().balance,0);
 await mini.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await mini.waitForFunction(()=>document.querySelector('#header-balance-value')?.textContent==='0');
 assert.deepEqual(errors,[]);await mobile.close();await context.close();
 console.log('PASS: admin absolute balance setting, customer-card/table access, Mini App wallet payment, stale edit rejection, lost-response retry preserving a later debit, zero balance and header refresh');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true});}
