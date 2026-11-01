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
 await page.locator('#search-toggle').click();assert.equal(await page.locator('#search-toggle').getAttribute('aria-expanded'),'true');
 await page.locator('#search').fill('Лампа');assert.equal(await page.locator('.product').count(),2);
 const before=db.prepare('SELECT views FROM products WHERE id=2').get().views;
 const viewResponse=page.waitForResponse(r=>r.url().endsWith('/products/2/view'));
 await page.locator('[data-product="2"]').click();await page.locator('dialog[open]').waitFor();
 await viewResponse;assert.equal(db.prepare('SELECT views FROM products WHERE id=2').get().views,before+1);
 await page.locator('.close').click();await page.getByRole('button',{name:'Отзывы',exact:false}).click();await page.locator('dialog article').first().waitFor();assert.equal(await page.locator('dialog article').count(),4);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 const api=await (await fetch(base+'/api/storefront')).json();assert.ok(api.reviews.every(r=>!('customer_id' in r)));assert.ok(api.products.every(p=>!('cost' in p)));
 await page.locator('.close').click();
 await page.locator('#search-toggle').click();assert.equal(await page.locator('.product').count(),5);
 await page.getByRole('button',{name:'Все товары',exact:true}).click();
 await page.getByRole('button',{name:'Реферальная программа',exact:false}).click();
 await page.getByText('Реферальная программа пока не действует.',{exact:true}).waitFor();await page.locator('.close').click();
 await page.locator('#shop-info').click();await page.getByText('Информация о магазине скоро появится.',{exact:true}).waitFor();await page.locator('.close').click();
 assert.equal(await page.locator('.intro').count(),0);
 for(const width of [320,390,480,1280]) {
  await page.setViewportSize({width,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  const layout=await page.evaluate(()=>{
   const rect=selector=>document.querySelector(selector).getBoundingClientRect();
   const cards=[...document.querySelectorAll('.product')].map(el=>el.getBoundingClientRect());
   const stories=[...document.querySelectorAll('.story')].map(el=>el.getBoundingClientRect());
   return {overflow:document.documentElement.scrollWidth>innerWidth,shell:rect('.miniapp').width,
    twoColumns:cards[0].top===cards[1].top&&cards[2].top>cards[0].top,
    squareStories:stories.every(r=>Math.abs(r.width-r.height)<1),
    order:rect('.stories').bottom<rect('#banner').top&&rect('#banner').bottom<rect('.category-bar').top,
    dock:rect('.bottom-nav').bottom<=innerHeight};
  });
  assert.equal(layout.overflow,false,`overflow at ${width}`);assert.ok(layout.shell<=480);
  assert.ok(layout.twoColumns);assert.ok(layout.squareStories);assert.ok(layout.order);assert.ok(layout.dock);
  if(width<=480)await page.screenshot({path:`/tmp/gas-miniapp-${width}.png`,fullPage:true});
 }
 // Refresh must use current admin data and handle long content safely.
 db.prepare("UPDATE settings SET value=? WHERE key='shop'").run(JSON.stringify({name:'GAS — магазин с очень длинным названием',headline:'',description:'Условия магазина',phone:'',address:'',hours:''}));
 db.prepare('UPDATE banners SET title=?,subtitle=? WHERE id=1').run('Большой выбор каждый день','Новые поступления в каталоге');
 await page.setViewportSize({width:390,height:844});await page.locator('#refresh').click();await page.getByText('Большой выбор каждый день',{exact:true}).waitFor();
 await page.screenshot({path:'/tmp/gas-miniapp.png',fullPage:true});
 await page.locator('#shop-info').click();await page.getByText('Условия магазина',{exact:true}).waitFor();await page.locator('.close').click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);
 console.log('Mini App passed: admin data, search, categories, product views, reviews, information, compact layout at 320/390/480/1280px, and refresh.');
}finally{await browser.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
