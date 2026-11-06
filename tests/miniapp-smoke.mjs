import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { insertTestFixtures } from './fixtures/store.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = mkdtempSync(join(tmpdir(), 'gas-mini-'));
const { server, db } = createApp({ dbPath: join(dir, 'test.db') });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('https://telegram.org/**', route => route.fulfill({
    body: 'window.Telegram={WebApp:{ready(){},expand(){},initDataUnsafe:{user:{id:101,first_name:"Александр",last_name:"Морозов",username:"alex"}}}};',
    contentType: 'text/javascript'
  }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.motionLog = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      window.motionLog.push(this.id || this.className);
      return animate.apply(this, args);
    };
  });
  const close = async () => {
    await page.locator('.close').click();
    await page.locator('dialog').waitFor({ state: 'hidden' });
  };
  const settle = () => page.waitForFunction(() => document.getAnimations().every(animation =>
    animation.effect.getComputedTiming().iterations === Infinity || animation.playState === 'finished'));

  const home = async () => {
    await page.locator('#catalog-tab').click();
    await page.locator('#home-page').waitFor({ state: 'visible' });
    await page.locator('#cart-page').waitFor({ state: 'hidden' });
    await settle();
  };

  const slideToCategory = async (name, direction, expectedCount) => {
    await settle();
    const state = await page.evaluate(async name => {
      const buttons = [...document.querySelectorAll('[data-category]')];
      const marker = document.querySelector('#category-indicator');
      const startMarkerX = new DOMMatrixReadOnly(getComputedStyle(marker).transform).m41;
      buttons.find(button => button.textContent === name).click();
      const animations = document.getAnimations().filter(animation => animation.playState !== 'finished');
      await Promise.all(animations.map(animation => animation.ready));
      animations.forEach(animation => { animation.currentTime = 120; });
      const viewport = document.querySelector('#catalog-viewport');
      const current = document.querySelector('#catalog-page');
      const outgoing = document.querySelector('.outgoing-catalog-page');
      const bounds = viewport.getBoundingClientRect();
      return {
        incomingX: current.getBoundingClientRect().left - bounds.left,
        outgoingX: outgoing?.getBoundingClientRect().left - bounds.left,
        verticalShift: outgoing ? current.getBoundingClientRect().top - outgoing.getBoundingClientRect().top : null,
        clipped: getComputedStyle(viewport).overflowX === 'hidden',
        overflow: document.documentElement.scrollWidth > innerWidth,
        count: document.querySelectorAll('#products .product').length,
        busy: viewport.getAttribute('aria-busy'),
        markerDirection: Math.sign(new DOMMatrixReadOnly(getComputedStyle(marker).transform).m41 - startMarkerX),
        buttonsRetained: buttons.every(button => button.isConnected),
        wind: Boolean(document.querySelector('.category-wind')),
        movingBlur: parseFloat(getComputedStyle(current).filter.replace('blur(', '')) > 0
      };
    }, name);
    assert.equal(Math.sign(state.incomingX), direction, 'incoming category slides from the correct side');
    assert.equal(Math.sign(state.outgoingX), -direction, 'previous category slides in the opposite direction');
    assert.ok(Math.abs(state.verticalShift) < 1, 'slide stays horizontal');
    assert.ok(state.clipped);
    assert.equal(state.overflow, false);
    assert.equal(state.count, expectedCount);
    assert.equal(state.busy, 'true');
    assert.equal(state.markerDirection, direction, 'panel highlight glides towards the selected category');
    assert.ok(state.buttonsRetained);
    assert.ok(state.wind);
    assert.ok(state.movingBlur);
    await settle();
    assert.equal(await page.locator('.outgoing-catalog-page').count(), 0);
    assert.equal(await page.locator('#catalog-viewport').getAttribute('aria-busy'), null);
    assert.equal(await page.locator('#products .product').count(), expectedCount);
    assert.equal(await page.locator('#catalog-page').evaluate(element => element.inert), false);
    assert.equal(await page.locator('.category-wind').count(), 0);
    assert.ok(await page.evaluate(() => {
      const button = document.querySelector('#categories [aria-pressed="true"]').getBoundingClientRect();
      const marker = document.querySelector('#category-indicator').getBoundingClientRect();
      return Math.abs(button.left - marker.left) < 1 && Math.abs(button.width - marker.width) < 1;
    }));
  };

  await page.goto(base + '/miniapp');
  await page.getByText('Товары скоро появятся.', { exact: false }).waitFor();
  assert.equal(await page.locator('footer').count(), 0);
  assert.ok(await page.locator('#banner').isHidden());
  assert.equal(await page.locator('#banner').textContent(), '');
  assert.equal(await page.getByText('Магазин в Telegram', { exact: true }).count(), 0);
  assert.equal(await page.locator('#profile-button svg').count(), 1);
  assert.equal(await page.locator('#shop-info').count(), 0);
  assert.equal(await page.locator('.currency').count(), 0);
  assert.equal(await page.locator('#shop-name').textContent(), 'GAS SHOP');
  assert.equal(await page.locator('.category-bar').evaluate(element => getComputedStyle(element).backdropFilter), 'none');
  await page.waitForFunction(() => [...document.querySelectorAll('.story img')].every(image => image.complete && image.naturalWidth > 0));
  for (const asset of ['important', 'referral', 'reviews', 'background']) {
    const response = await fetch(`${base}/miniapp/${asset}.svg`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
  }
  await page.locator('#profile-button').click();
  await page.getByRole('heading', { name: 'Александр Морозов' }).waitFor();
  assert.equal(await page.locator('.profile-stats strong').first().textContent(), '0');
  await page.locator('[data-toggle-orders]').click();
  await page.getByText('История заказов пока недоступна.', { exact: true }).waitFor();
  await settle();
  const profileMotion = await page.evaluate(async () => {
    const card = document.querySelector('.profile-card');
    const cardTop = card.getBoundingClientRect().top;
    document.querySelector('#profile-referral').click();
    const animations = document.getAnimations().filter(animation => animation.playState !== 'finished');
    await Promise.all(animations.map(animation => animation.ready));
    animations.forEach(animation => { animation.currentTime = 120; });
    const body = document.querySelector('#profile-body');
    return { headerShift: card.getBoundingClientRect().top - cardTop, retained: card === document.querySelector('.profile-card'), outgoing: Boolean(document.querySelector('.outgoing-profile-body')), opacity: Number(getComputedStyle(body).opacity) };
  });
  assert.ok(profileMotion.retained);
  assert.ok(Math.abs(profileMotion.headerShift) < 1, 'profile header stays in place');
  assert.ok(profileMotion.outgoing);
  assert.ok(profileMotion.opacity > 0 && profileMotion.opacity < 1);
  await page.getByText('Реферальная программа пока не действует.', { exact: true }).waitFor();
  await page.keyboard.press('ArrowLeft');
  await settle();
  assert.equal(await page.getByRole('tab', { name: 'Обзор' }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('.outgoing-profile-body').count(), 0);
  assert.equal(await page.locator('#profile-body').evaluate(element => element.inert), false);
  await close();
  await page.locator('#cart-tab').click();
  await page.getByText('Корзина пока пуста', { exact: true }).waitFor();
  assert.ok(await page.locator('#details').isHidden());
  assert.ok(await page.locator('#cart-page').isVisible());
  assert.ok(await page.locator('.bottom-nav').isVisible());
  await page.locator('[data-continue]').click();
  await page.locator('#cart-page').waitFor({ state: 'hidden' });
  await settle();

  insertTestFixtures(db);
  db.prepare('UPDATE products SET stock=2 WHERE id=2').run();
  db.prepare("UPDATE settings SET value=? WHERE key='categories'").run(JSON.stringify(['Скоро']));
  await page.reload();
  await page.locator('.product').first().waitFor();
  assert.equal(await page.locator('.product').count(), 12);
  // Banner visibility and content follow the admin data, including removing the final active banner.
  const banners = db.prepare('SELECT * FROM banners ORDER BY id').all();
  await page.locator('#banner h2').filter({ hasText: banners[0].title }).waitFor();
  db.prepare('UPDATE banners SET active=0 WHERE id=?').run(banners[0].id);
  await page.reload();
  await page.locator('#banner h2').filter({ hasText: banners[1].title }).waitFor();
  db.prepare('UPDATE banners SET active=0').run();
  await page.reload();
  await page.locator('#banner').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#banner').textContent(), '');
  db.prepare('UPDATE banners SET active=1,title=?,subtitle=? WHERE id=?').run('Баннер из админки', 'Условия из редактора магазина', banners[0].id);
  await page.reload();
  await page.getByRole('heading', { name: 'Баннер из админки', exact: true }).waitFor();
  await page.getByText('Условия из редактора магазина', { exact: true }).waitFor();
  const bannerImage='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0a0AAAAASUVORK5CYII=';
  db.prepare('UPDATE banners SET image=? WHERE id=?').run(bannerImage,banners[0].id);
  await page.reload();
  await page.locator('#banner img').waitFor();
  assert.equal(await page.locator('#banner img').getAttribute('alt'),'Баннер из админки');
  assert.equal(await page.locator('#banner a').getAttribute('href'),banners[0].link);
  assert.equal(await page.locator('#banner h2').count(),0);
  db.prepare("UPDATE banners SET image='' WHERE id=?").run(banners[0].id);
  await page.reload();
  await page.getByRole('heading', { name: 'Баннер из админки', exact: true }).waitFor();
  await page.locator('#next-category').click();
  await settle();
  assert.equal(await page.locator('#categories [aria-pressed="true"]').textContent(),'Скоро');
  await page.locator('[data-category=""]').click();
  await settle();
  await slideToCategory('Для дома', 1, 5);
  assert.equal(await page.getByRole('searchbox').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Поиск товаров' }).count(), 0);
  await slideToCategory('Все товары', -1, 12);
  // Rapid selections must cancel old transitions and leave only the latest grid.
  await page.evaluate(() => {
    for (const name of ['Для дома', 'Аксессуары', 'Электроника', 'Для дома']) {
      [...document.querySelectorAll('[data-category]')].find(button => button.textContent === name).click();
    }
  });
  await settle();
  assert.equal(await page.locator('#categories [aria-pressed="true"]').textContent(), 'Для дома');
  assert.equal(await page.locator('#products .product').count(), 5);
  assert.equal(await page.locator('.outgoing-catalog-page').count(), 0);
  assert.equal(await page.locator('#catalog-viewport').evaluate(element => element.style.height), '');
  await slideToCategory('Скоро', -1, 0);
  await page.getByText('В этой категории пока нет товаров.', { exact: true }).waitFor();
  await slideToCategory('Для дома', 1, 5);
  const before = db.prepare('SELECT views FROM products WHERE id=2').get().views;
  const view = page.waitForResponse(response => response.url().endsWith('/products/2/view'));
  await page.locator('[data-product="2"]').click();
  await view;
  assert.equal(await page.locator('#detail-content .price .currency-symbol').evaluate(element => getComputedStyle(element).fontWeight), '400');
  await page.locator('#product-add').click();
  assert.equal(await page.locator('#cart-badge').textContent(), '1');
  await page.locator('#product-add').click();
  assert.equal(await page.locator('#cart-badge').textContent(), '2');
  assert.ok(await page.locator('#product-add').isDisabled());
  assert.equal(db.prepare('SELECT views FROM products WHERE id=2').get().views, before + 1);
  await close();
  await page.evaluate(() => window.scrollTo(0, 200));
  const homeScroll = await page.evaluate(() => window.scrollY);
  await page.locator('#cart-tab').click();
  await page.locator('#cart-page').waitFor({ state: 'visible' });
  assert.ok(await page.locator('#details').isHidden());
  assert.equal(await page.locator('[data-cart-item]').count(), 1);
  assert.equal(await page.locator('.quantity-control output').textContent(), '2');
  assert.ok(await page.locator('[data-cart-change="1"]').isDisabled());
  await page.locator('[data-cart-change="-1"]').click();
  assert.equal(await page.locator('.quantity-control output').textContent(), '1');
  assert.match(await page.locator('.cart-total strong').textContent(), /4\D?590/);
  await page.locator('[data-cart-change="1"]').click();
  await settle();
  await page.screenshot({ path: '/tmp/gas-cart.png' });
  await home();
  assert.equal(await page.locator('#categories [aria-pressed="true"]').textContent(), 'Для дома');
  assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - homeScroll) < 1);
  await page.reload();
  await page.locator('.product').first().waitFor();
  assert.equal(await page.locator('#cart-badge').textContent(), '2');
  await page.locator('#profile-button').click();
  assert.equal(await page.locator('.profile-stats strong').first().textContent(), '2');
  await settle();
  await page.screenshot({ path: '/tmp/gas-profile.png' });
  await page.locator('[data-open-cart]').click();
  await page.locator('[data-remove="2"]').click();
  await page.getByText('Корзина пока пуста', { exact: true }).waitFor();
  assert.ok(await page.locator('#cart-badge').isHidden());
  await home();

  // Clean reference cards open details; adding remains available in the product sheet.
  assert.equal(await page.locator('#products [data-add]').count(), 0);
  assert.equal(await page.locator('#products .product-badge').count(), 0);
  const views = db.prepare('SELECT views FROM products WHERE id=1').get().views;
  const priceView = page.waitForResponse(response => response.url().endsWith('/products/1/view'));
  await page.locator('[data-product="1"] .price').click();
  await priceView;
  await page.locator('#product-add').click();
  assert.equal(await page.locator('#cart-badge').textContent(), '1');
  await page.locator('#product-add').click();
  assert.equal(db.prepare('SELECT views FROM products WHERE id=1').get().views, views + 1);
  assert.equal(await page.locator('#cart-badge').textContent(), '2');
  await close();
  assert.equal(await page.locator('[data-product="6"] .availability-badge').textContent(), 'Нет в наличии');
  await page.locator('[data-product="6"]').click();
  assert.ok(await page.locator('#product-add').isDisabled());
  await close();
  await page.locator('[data-info="reviews"]').click();
  assert.equal(await page.locator('dialog .review').count(), 4);
  await close();
  await page.locator('[data-info="important"]').click();
  await page.getByText('Информация о магазине скоро появится.', { exact: true }).waitFor();
  await close();

  for (const width of [320, 390, 480, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle();
    const layout = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const cards = [...document.querySelectorAll('.product')].map(element => element.getBoundingClientRect());
      const stories = [...document.querySelectorAll('.story')].map(element => element.getBoundingClientRect());
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        shell: rect('.miniapp').width,
        twoColumns: cards[0].top === cards[1].top && cards[2].top > cards[0].top,
        squareStories: stories.every(rect => Math.abs(rect.width - rect.height) < 1),
        order: rect('.stories').bottom < rect('#banner').top && rect('#banner').bottom < rect('.category-bar').top,
        dock: rect('.bottom-nav').bottom <= innerHeight,
        shellColor: getComputedStyle(document.querySelector('.miniapp')).backgroundColor,
        shellImage: getComputedStyle(document.querySelector('.miniapp')).backgroundImage,
        outsideColor: getComputedStyle(document.body).backgroundColor,
        outsideImage: getComputedStyle(document.body).backgroundImage,
        matchingBannerRadius: getComputedStyle(document.querySelector('#banner')).borderRadius === getComputedStyle(document.querySelector('.story')).borderRadius,
        cardContentFits: [...document.querySelectorAll('#products .product')].every(card => {
          const bounds = card.getBoundingClientRect();
          const price = card.querySelector('.product-bottom').getBoundingClientRect();
          return price.bottom <= bounds.bottom && price.left >= bounds.left && price.right <= bounds.right;
        })
      };
    });
    assert.equal(layout.overflow, false, `overflow at ${width}`);
    assert.ok(layout.shell <= 432);
    assert.equal(layout.outsideColor, 'rgb(16, 0, 2)');
    assert.match(layout.outsideImage, /\/miniapp\/background\.svg/);
    assert.equal(layout.shellColor, 'rgba(0, 0, 0, 0)');
    assert.equal(layout.shellImage, 'none');
    assert.ok(layout.twoColumns);
    assert.ok(layout.squareStories);
    assert.ok(layout.order);
    assert.ok(layout.dock);
    assert.ok(layout.matchingBannerRadius, `matching banner and story corners at ${width}px`);
    assert.ok(layout.cardContentFits, `card contents fit at ${width}px`);
    await page.locator('#cart-tab').click();
    await page.locator('#cart-page').waitFor({ state: 'visible' });
    await settle();
    assert.ok(await page.locator('#details').isHidden());
    assert.equal(await page.locator('#cart-tab').getAttribute('aria-current'), 'page');
    assert.ok(await page.evaluate(() => {
      const button = document.querySelector('#catalog-tab'), bounds = button.getBoundingClientRect();
      return document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)?.closest('#catalog-tab') === button
        && document.documentElement.scrollWidth <= innerWidth;
    }), `navigation remains usable on cart at ${width}px`);
    await page.locator('#profile-button').click();
    await settle();
    assert.ok(await page.locator('#details').evaluate(element => element.scrollWidth <= element.clientWidth));
    await close();
    assert.equal(await page.locator('#cart-tab').getAttribute('aria-current'), 'page');
    await home();
    if (width === 390) await page.screenshot({ path: '/tmp/gas-miniapp.png' });
    if (width === 1280) await page.screenshot({ path: '/tmp/gas-miniapp-desktop.png' });
  }

  // Saved quantities, public prices and availability are always reconciled with current admin data.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-product="2"]').click();
  await page.locator('#product-add').click();
  await page.locator('#product-add').click();
  await close();
  assert.ok(await page.evaluate(() => window.motionLog.includes('cart-flight')));
  db.prepare('UPDATE products SET stock=0 WHERE id=1').run();
  db.prepare('UPDATE products SET stock=1,price=5000 WHERE id=2').run();
  await page.reload();
  await page.locator('.product').first().waitFor();
  assert.equal(await page.locator('#cart-badge').textContent(), '1');
  await page.locator('#cart-tab').click();
  assert.equal(await page.locator('[data-cart-item]').count(), 1);
  assert.equal(await page.locator('.quantity-control output').textContent(), '1');
  assert.match(await page.locator('.cart-total strong').textContent(), /5\D?000/);
  await home();

  // Both explicit motion and the reduced-motion preference are respected.
  assert.ok(await page.evaluate(() => window.motionLog.includes('cart-page')));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motionCount = await page.evaluate(() => window.motionLog.length);
  await page.getByRole('button', { name: 'Для дома', exact: true }).click();
  assert.equal(await page.locator('#products .product').count(), 5);
  assert.equal(await page.locator('.outgoing-catalog-page').count(), 0);
  assert.equal(await page.locator('#catalog-viewport').getAttribute('aria-busy'), null);
  await page.locator('#profile-button').click();
  await page.getByRole('tab', { name: 'Реферальная программа' }).click();
  await page.getByRole('tab', { name: 'Обзор' }).click();
  assert.equal(await page.locator('.outgoing-profile-body').count(), 0);
  await close();
  assert.equal(await page.evaluate(() => window.motionLog.length), motionCount);
  await page.evaluate(() => localStorage.setItem('gas-cart:v1:101', '{broken'));
  await page.reload();
  await page.locator('.product').first().waitFor();
  assert.ok(await page.locator('#cart-badge').isHidden());
  const api = await (await fetch(base + '/api/storefront')).json();
  assert.ok(api.reviews.every(review => !('customer_id' in review)));
  assert.ok(api.products.every(product => !('cost' in product)));
  assert.deepEqual(errors, []);

  // Browser fallback without Telegram or usable localStorage still supports a local cart.
  const guest = await browser.newPage({ viewport: { width: 320, height: 700 }, reducedMotion: 'reduce' });
  await guest.route('https://telegram.org/**', route => route.abort());
  await guest.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw Error('Storage unavailable'); } }));
  await guest.goto(base + '/miniapp');
  await guest.locator('.product').first().waitFor();
  await guest.locator('#profile-button').click();
  await guest.getByRole('heading', { name: 'Гость' }).waitFor();
  await guest.locator('.close').click();
  await guest.locator('[data-product="2"]').click();
  await guest.locator('#product-add').click();
  await guest.locator('#product-cart').click();
  await guest.locator('#cart-page').waitFor({ state: 'visible' });
  assert.ok(await guest.locator('#details').isHidden());
  assert.equal(await guest.locator('[data-cart-item]').count(), 1);
  await guest.close();
  // A hanging external SDK must not delay the catalog; late identity restores its own cart.
  const lateContext = await browser.newContext();
  let releaseSdk;
  const sdkGate = new Promise(resolve => { releaseSdk = resolve; });
  await lateContext.route('https://telegram.org/**', async route => {
    await sdkGate;
    await route.fulfill({contentType:'text/javascript',body:'window.Telegram={WebApp:{ready(){},expand(){},initDataUnsafe:{user:{id:909,first_name:"Поздний SDK"}}}};'});
  });
  try {
    await lateContext.addInitScript(() => {
      window.bridgeEvents=[];
      window.TelegramWebviewProxy={postEvent(type,data){window.bridgeEvents.push({type,data});}};
      localStorage.setItem('gas-cart:v1:guest','[]');
      localStorage.setItem('gas-cart:v1:909','[[2,1]]');
    });
    const late = await lateContext.newPage();
    await late.goto(base+'/miniapp',{waitUntil:'domcontentloaded',timeout:5000});
    await late.locator('.product').first().waitFor({timeout:5000});
    assert.equal(await late.evaluate(() => Boolean(window.Telegram)),false);
    assert.deepEqual(await late.evaluate(() => window.bridgeEvents),[{type:'web_app_ready',data:'{}'}]);
    await late.locator('#profile-button').click();
    await late.getByRole('heading',{name:'Гость',exact:true}).waitFor();
    releaseSdk();
    await late.getByRole('heading',{name:'Поздний SDK',exact:true}).waitFor();
    await late.locator('[data-open-cart]').click();
    await late.locator('[data-cart-item="2"]').waitFor();
    assert.equal(await late.locator('#cart-badge').textContent(),'1');
    assert.equal(await late.evaluate(() => localStorage.getItem('gas-cart:v1:guest')),'[]');
  } finally {
    releaseSdk();
    await lateContext.close();
  }
  // Telegram Web receives readiness across origins even when the SDK is unavailable.
  const webContext=await browser.newContext();
  try {
    await webContext.route('https://telegram.org/**',route=>route.abort());
    await webContext.route('https://shop.example/**',async route=>{
      const url=new URL(route.request().url());
      const response=await route.fetch({url:base+url.pathname+url.search});
      await route.fulfill({response});
    });
    await webContext.route('https://web.telegram.org/**',route=>route.fulfill({
      contentType:'text/html',
      body:`<script>window.readyEvents=[];addEventListener('message',e=>{if(e.origin==='https://shop.example'){const data=JSON.parse(e.data);if(data.eventType==='web_app_ready')readyEvents.push(data);}});</script><iframe src="https://shop.example/miniapp"></iframe>`
    }));
    const embedded=await webContext.newPage();
    await embedded.goto('https://web.telegram.org/test-miniapp');
    await embedded.waitForFunction(()=>window.readyEvents.length===1,{},{timeout:5000});
    await embedded.frameLocator('iframe').locator('.product').first().waitFor({timeout:5000});
    assert.deepEqual(await embedded.evaluate(()=>window.readyEvents),[{eventType:'web_app_ready',eventData:{}}]);
  } finally {
    await webContext.close();
  }
  console.log('Mini App passed: new icons, profile, local cart, stock limits, refreshed prices, persistence, bidirectional category slides, rapid switching, reduced motion, and layouts at 320/390/480/1280px.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
