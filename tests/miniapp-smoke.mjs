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

  const slideToCategory = async (name, direction, expectedCount) => {
    await settle();
    const state = await page.evaluate(async name => {
      [...document.querySelectorAll('[data-category]')].find(button => button.textContent === name).click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
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
        busy: viewport.getAttribute('aria-busy')
      };
    }, name);
    assert.equal(Math.sign(state.incomingX), direction, 'incoming category slides from the correct side');
    assert.equal(Math.sign(state.outgoingX), -direction, 'previous category slides in the opposite direction');
    assert.ok(Math.abs(state.verticalShift) < 1, 'slide stays horizontal');
    assert.ok(state.clipped);
    assert.equal(state.overflow, false);
    assert.equal(state.count, expectedCount);
    assert.equal(state.busy, 'true');
    await settle();
    assert.equal(await page.locator('.outgoing-catalog-page').count(), 0);
    assert.equal(await page.locator('#catalog-viewport').getAttribute('aria-busy'), null);
    assert.equal(await page.locator('#products .product').count(), expectedCount);
    assert.equal(await page.locator('#catalog-page').evaluate(element => element.inert), false);
  };

  await page.goto(base + '/miniapp');
  await page.getByText('Товары скоро появятся.', { exact: false }).waitFor();
  assert.equal(await page.locator('footer').count(), 0);
  assert.equal(await page.getByText('Магазин в Telegram', { exact: true }).count(), 0);
  assert.equal(await page.locator('#profile-button svg').count(), 1);
  assert.equal(await page.locator('#shop-info').count(), 0);
  await page.waitForFunction(() => [...document.querySelectorAll('.story img')].every(image => image.complete && image.naturalWidth > 0));
  for (const asset of ['important', 'referral', 'reviews']) {
    const response = await fetch(`${base}/miniapp/${asset}.svg`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
  }
  await page.locator('#profile-button').click();
  await page.getByRole('heading', { name: 'Александр Морозов' }).waitFor();
  assert.equal(await page.locator('.profile-stats strong').first().textContent(), '0');
  await page.getByRole('tab', { name: 'Реферальная программа' }).click();
  await page.getByText('Реферальная программа пока не действует.', { exact: true }).waitFor();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.getByRole('tab', { name: 'Обзор' }).getAttribute('aria-selected'), 'true');
  await close();
  await page.locator('#cart-tab').click();
  await page.getByText('Корзина пока пуста', { exact: true }).waitFor();
  await page.locator('[data-continue]').click();
  await page.locator('dialog').waitFor({ state: 'hidden' });

  insertTestFixtures(db);
  db.prepare('UPDATE products SET stock=2 WHERE id=2').run();
  db.prepare("UPDATE settings SET value=? WHERE key='categories'").run(JSON.stringify(['Скоро']));
  await page.locator('#refresh').click();
  await page.locator('.product').first().waitFor();
  assert.equal(await page.locator('.product').count(), 12);
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
  await page.locator('#product-add').click();
  assert.equal(await page.locator('#cart-badge').textContent(), '1');
  await page.locator('#product-add').click();
  assert.equal(await page.locator('#cart-badge').textContent(), '2');
  assert.ok(await page.locator('#product-add').isDisabled());
  assert.equal(db.prepare('SELECT views FROM products WHERE id=2').get().views, before + 1);
  await close();
  await page.locator('#cart-tab').click();
  assert.equal(await page.locator('[data-cart-item]').count(), 1);
  assert.equal(await page.locator('.quantity-control output').textContent(), '2');
  assert.ok(await page.locator('[data-cart-change="1"]').isDisabled());
  await page.locator('[data-cart-change="-1"]').click();
  assert.equal(await page.locator('.quantity-control output').textContent(), '1');
  assert.match(await page.locator('.cart-total strong').textContent(), /4\D?590/);
  await page.locator('[data-cart-change="1"]').click();
  await settle();
  await page.screenshot({ path: '/tmp/gas-cart.png' });
  await close();
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
  await close();

  // The whole catalog card, including its price, opens details. Adding stays in the details sheet.
  assert.equal(await page.locator('#products [data-add]').count(), 0);
  const views = db.prepare('SELECT views FROM products WHERE id=1').get().views;
  const priceView = page.waitForResponse(response => response.url().endsWith('/products/1/view'));
  await page.locator('[data-product="1"] .price').click();
  await priceView;
  await page.locator('#product-add').click();
  assert.equal(db.prepare('SELECT views FROM products WHERE id=1').get().views, views + 1);
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
    assert.ok(layout.cardContentFits, `card contents fit at ${width}px`);
    await page.locator('#profile-button').click();
    await settle();
    assert.ok(await page.locator('#details').evaluate(element => element.scrollWidth <= element.clientWidth));
    await close();
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
  await close();

  // Both explicit motion and the reduced-motion preference are respected.
  assert.ok(await page.evaluate(() => window.motionLog.includes('details')));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motionCount = await page.evaluate(() => window.motionLog.length);
  await page.getByRole('button', { name: 'Для дома', exact: true }).click();
  assert.equal(await page.locator('#products .product').count(), 5);
  assert.equal(await page.locator('.outgoing-catalog-page').count(), 0);
  assert.equal(await page.locator('#catalog-viewport').getAttribute('aria-busy'), null);
  await page.locator('#profile-button').click();
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
  assert.equal(await guest.locator('[data-cart-item]').count(), 1);
  await guest.close();
  console.log('Mini App passed: new icons, profile, local cart, stock limits, refreshed prices, persistence, bidirectional category slides, rapid switching, reduced motion, and layouts at 320/390/480/1280px.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
