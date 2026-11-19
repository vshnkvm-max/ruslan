import assert from 'node:assert/strict';
import {createApp} from '../server.js';
import {hashPassword} from '../lib/auth.js';
import {profileBotToken,signedProfileUser} from './fixtures/profile.js';
import {reviewBuyer} from './fixtures/reviews.js';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const {server,db}=createApp({dbPath:':memory:',botToken:profileBotToken,orderBotToken:''});
db.prepare('INSERT INTO admins(username,password) VALUES (?,?)').run('admin',hashPassword('referral-test-password'));
const owner=reviewBuyer(db),winner=reviewBuyer(db,102),expired=reviewBuyer(db,103);
db.prepare("UPDATE customers SET name='Анна' WHERE id=?").run(winner);
db.prepare("UPDATE customers SET name='Игорь' WHERE id=?").run(expired);
const insert=db.prepare('INSERT INTO referrals(inviter_id,invitee_id,created_at,rewarded,reward_amount) VALUES (?,?,?,?,?)');
insert.run(owner,winner,new Date().toISOString(),1,160);
insert.run(owner,expired,new Date(Date.now()-8*86400000).toISOString(),0,0);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const admin=await browser.newPage();
 const errors=[];
 admin.on('pageerror',error=>errors.push(error.message));
 await admin.goto(base+'/#referrals');
 await admin.getByLabel('Логин',{exact:true}).fill('admin');
 await admin.getByLabel('Пароль',{exact:true}).fill('referral-test-password');
 await admin.locator('#login-form [type=submit]').click();
 await admin.locator('#referral-form [name=enabled]').check();
 await admin.locator('#referral-form [type=submit]').click();
 await admin.getByText('Включена',{exact:true}).waitFor();
 assert.equal(JSON.parse(db.prepare("SELECT value FROM settings WHERE key='referral'").get().value).enabled,true);
 const mobile=await browser.newContext({viewport:{width:320,height:780},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 await mobile.route('https://telegram.org/**',route=>route.fulfill({contentType:'text/javascript',body:''}));
 async function openMini(initData){
  const page=await mobile.newPage();
  await page.addInitScript(initData=>{
   window.Telegram={WebApp:{initData,ready(){},expand(){}}};
   Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedReferral=text;}}});
  },initData);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/miniapp');
  return page;
 }
 const mini=await openMini(signedProfileUser());
 await mini.locator('[data-info=referral]').click();
 const link=await mini.locator('#referral-link').inputValue();
 assert.match(link,/^https:\/\/t\.me\/gas_shop_vape_bot\?startapp=ref_/);
 const friend=await openMini(signedProfileUser(104,new URL(link).searchParams.get('startapp')));
 await friend.waitForLoadState('load');
 await mini.getByRole('button',{name:'Копировать',exact:true}).click();
 assert.equal(await mini.evaluate(()=>window.copiedReferral),link);
 assert.match(await mini.locator('.referral-rates').innerText(),/3%[\s\S]*5%[\s\S]*7%/);
 await mini.screenshot({path:'/tmp/gas-referral-information.png'});
 await mini.getByRole('button',{name:'Рекомендации',exact:true}).click();
 await mini.getByRole('button',{name:'Успешные',exact:true}).click();
 await mini.getByText('Анна',{exact:true}).waitFor();
 assert.match(await mini.locator('.referral-earned').innerText(),/\+160\s*₽/);
 await mini.screenshot({path:'/tmp/gas-referral-recommendations.png'});
 await mini.getByRole('button',{name:'Отклонённые',exact:true}).click();
 await mini.getByText('Игорь',{exact:true}).waitFor();
 await mini.getByRole('button',{name:'В ожидании',exact:true}).click();
 await mini.locator('.referral-person').getByText('Покупатель',{exact:true}).waitFor();
 assert.ok(await mini.locator('#details').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 const sheet=mini.locator('#details');
 assert.ok(await sheet.evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-innerHeight)<1));
 const handle=await sheet.locator('.sheet-handle').boundingBox();
 const cdp=await mobile.newCDPSession(mini);
 const x=Math.round(handle.x+handle.width/2),y=Math.round(handle.y+handle.height/2);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let offset=20;offset<=220;offset+=20){
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+offset}]});
 }
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await sheet.waitFor({state:'hidden'});
 await mini.locator('[data-info=referral]').click();
 await sheet.locator('.close').click();
 await sheet.waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);
 console.log('PASS: referral activation, signed visit on startup, copy link, rate table, recommendation summaries and all status tabs and bottom sheet dismissal at 320 px');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
