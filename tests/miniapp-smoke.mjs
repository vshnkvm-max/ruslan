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
  assert.match(await page.locator('.category-bar').evaluate(element => getComputedStyle(element).backdropFilter), /blur/);
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

  // Quick add works independently; opening by price still counts one view and allows adding again.
  assert.equal(await page.locator('#products [data-add]').count(), 12);
  assert.equal(await page.locator('#products .product-badge').count(), 0);
  const views = db.prepare('SELECT views FROM products WHERE id=1').get().views;
  await page.locator('#products [data-add="1"]').click();
  assert.ok(await page.locator('#details').isHidden());
  assert.equal(await page.locator('#cart-badge').textContent(), '1');
  assert.equal(db.prepare('SELECT views FROM products WHERE id=1').get().views, views);
  assert.ok(await page.locator('#products [data-add="6"]').isDisabled());
  const priceView = page.waitForResponse(response => response.url().endsWith('/products/1/view'));
  await page.locator('[data-product="1"] .price').click();
  await priceView;
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
        matchingBannerRadius: getComputedStyle(document.querySelector('#banner')).borderRadius === getComputedStyle(document.querySelector('.story')).borderRadius,
        cardContentFits: [...document.querySelectorAll('#products .product')].every(card => {
          const bounds = card.getBoundingClientRect();
          const price = card.querySelector('.product-bottom').getBoundingClientRect();
          return price.bottom <= bounds.bottom && price.left >= bounds.left && price.right <= bounds.right;
        })
      };
    });
    assert.equal(layout.overflow, false, `overflow at ${width}`);
    assert.ok(layout.shell <= 480);
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
  console.log('Mini App passed: new icons, profile, local cart, stock limits, refreshed prices, persistence, bidirectional category slides, rapid switching, reduced motion, and layouts at 320/390/480/1280px.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
