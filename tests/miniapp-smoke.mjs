import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.js';
import {insertTestFixtures} from './fixtures/store.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=mkdtempSync(join(tmpdir(),'gas-mini-'));
const {server,db}=createApp({dbPath:join(dir,'test.db')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://telegram.org/**',r=>r.fulfill({body:'window.Telegram={WebApp:{ready(){},expand(){}}};',contentType:'text/javascript'}));
 await page.goto(base+'/miniapp');await page.getByText('Товары скоро появятся.',{exact:false}).waitFor();
 insertTestFixtures(db);await page.locator('#refresh').click();await page.locator('.product').first().waitFor();
 assert.equal(await page.locator('.product').count(),12);assert.equal(await page.locator('#banner').count(),1);
 await page.getByRole('button',{name:'Для дома',exact:true}).click();assert.equal(await page.locator('.product').count(),5);
 await page.locator('#search').fill('Лампа');assert.equal(await page.locator('.product').count(),2);
 const before=db.prepare('SELECT views FROM products WHERE id=2').get().views;
 await page.locator('[data-product="2"]').click();await page.locator('dialog[open]').waitFor();
 await page.waitForResponse(r=>r.url().endsWith('/products/2/view'));assert.equal(db.prepare('SELECT views FROM products WHERE id=2').get().views,before+1);
 await page.locator('.close').click();await page.getByRole('button',{name:'Отзывы',exact:false}).click();await page.locator('dialog article').first().waitFor();assert.equal(await page.locator('dialog article').count(),4);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 const api=await (await fetch(base+'/api/storefront')).json();assert.ok(api.reviews.every(r=>!('customer_id' in r)));assert.ok(api.products.every(p=>!('cost' in p)));
 await page.screenshot({path:'/tmp/gas-miniapp.png',fullPage:true});console.log('Mini App: empty state, admin data, category, search, details, views, reviews, privacy and mobile layout passed.');
}finally{await browser.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
