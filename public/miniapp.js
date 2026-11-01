const telegram = window.Telegram?.WebApp;
if (telegram) {
  telegram.ready();
  telegram.expand();
  telegram.setHeaderColor?.('#f6f3f3');
  telegram.setBackgroundColor?.('#f6f3f3');
}

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
const icons = {
  arrow: icon('<path d="M5 12h14m-6-6 6 6-6 6"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  minus: icon('<path d="M5 12h14"/>'),
  user: icon('<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'),
  bag: icon('<path d="M4 7h16l-1 14H5ZM8 8V6a4 4 0 0 1 8 0v2"/>'),
  trash: icon('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'),
  check: icon('<path d="m5 12 4 4L19 6"/>')
};
const money = value => new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'RUB', maximumFractionDigits: 0
}).format(value);
// Telegram's display data is used only for presentation and local cart separation.
// It never authorizes access to customers, orders or any other private API.
const user = telegram?.initDataUnsafe?.user;
const cartKey = `gas-cart:v1:${Number.isSafeInteger(user?.id) && user.id > 0 ? user.id : 'guest'}`;
const maxQuantity = product => Math.min(product.stock, 999);
let data, category = '', loading = false, modalVersion = 0, toastTimer;
let cart = readCart();

function readCart() {
  try {
    const raw = localStorage.getItem(cartKey);
    if (!raw || raw.length > 20000) return new Map();
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) return new Map();
    return new Map(items.slice(0, 100).filter(item => Array.isArray(item)
      && Number.isSafeInteger(item[0]) && item[0] > 0
      && Number.isSafeInteger(item[1]) && item[1] > 0 && item[1] <= 999));
  } catch { return new Map(); }
}
function saveCart() {
  try { localStorage.setItem(cartKey, JSON.stringify([...cart])); } catch { /* Keep an in-memory cart when storage is unavailable. */ }
}
const cartItems = () => data ? [...cart].map(([id, quantity]) => ({ product: data.products.find(item => item.id === id), quantity }))
  .filter(item => item.product && item.product.stock > 0) : [];
const cartSummary = () => cartItems().reduce((total, { product, quantity }) => ({
  count: total.count + quantity, amount: total.amount + product.price * quantity
}), { count: 0, amount: 0 });

function animate(element, frames, options = {}) {
  if (!element?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  return element.animate(frames, { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)', ...options }).finished.catch(() => {});
}
function notify(message) {
  clearTimeout(toastTimer);
  ($('#details').open ? $('#details') : document.body).append($('#toast'));
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2300);
}
function updateBadge() {
  const { count } = cartSummary();
  const badge = $('#cart-badge');
  const previous = Number(badge.textContent);
  badge.textContent = count;
  badge.hidden = count === 0;
  if (count !== previous) void animate(badge, [{ transform: 'scale(.65)' }, { transform: 'scale(1.2)', offset: .6 }, { transform: 'scale(1)' }]);
}
function flyToCart(source) {
  if (!source || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const start = source.getBoundingClientRect(), end = $('#cart-tab').getBoundingClientRect();
  const flying = document.createElement('span');
  flying.className = 'cart-flight';
  flying.setAttribute('aria-hidden', 'true');
  flying.innerHTML = icons.bag;
  flying.style.left = `${start.left + start.width / 2 - 16}px`;
  flying.style.top = `${start.top + start.height / 2 - 16}px`;
  // Use the modal's top layer when adding from a product sheet.
  ($('#details').open ? $('#details') : document.body).append(flying);
  const dx = end.left + end.width / 2 - start.left - start.width / 2;
  const dy = end.top + end.height / 2 - start.top - start.height / 2;
  void animate(flying, [
    { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * .35}px, ${dy * .35 - 40}px) scale(.9)`, opacity: .9, offset: .45 },
    { transform: `translate(${dx}px, ${dy}px) scale(.25)`, opacity: 0 }
  ], { duration: 550 }).then(() => flying.remove());
}
function reconcileCart() {
  let changed = false;
  for (const [id, quantity] of cart) {
    const product = data.products.find(item => item.id === id);
    if (!product || product.stock <= 0) { cart.delete(id); changed = true; }
    else if (quantity > maxQuantity(product)) { cart.set(id, maxQuantity(product)); changed = true; }
  }
  saveCart();
  updateBadge();
  if (changed) notify('Корзина обновлена с учётом наличия товаров');
}
function changeCart(id, delta, source) {
  const product = data?.products.find(item => item.id === id);
  if (!product || product.stock <= 0) return;
  const previous = cart.get(id) || 0;
  if (delta > 0 && previous >= maxQuantity(product)) { notify('Достигнуто доступное количество'); return; }
  if (!previous && cart.size >= 100) { notify('В корзине может быть до 100 разных товаров'); return; }
  const quantity = Math.max(0, Math.min(maxQuantity(product), previous + delta));
  if (quantity) cart.set(id, quantity);
  else cart.delete(id);
  saveCart();
  updateBadge();
  if (delta > 0) {
    flyToCart(source);
    void animate(source, [{ transform: 'scale(.8)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }]);
    if ($('#details').dataset.view !== 'cart') notify('Товар добавлен в корзину');
  }
  if ($('#details').open && $('#details').dataset.view === 'cart') {
    renderCart(false);
    const next = $(`[data-cart-id="${id}"][data-cart-change="${delta}"]:not(:disabled)`)
      || $(`[data-cart-id="${id}"][data-cart-change="-1"]`) || $('[data-continue]');
    next?.focus({ preventScroll: true });
  }
  void animate($(`[data-cart-item="${id}"] .quantity-control output`), [{ opacity: .3, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 160 });
  updateProductAddButton();
}

const photo = product => /^data:image\/(jpeg|png|webp);base64,/.test(product.image)
  ? `<div class="photo"><img src="${escape(product.image)}" alt="${escape(product.name)}"></div>`
  : `<div class="photo photo-empty">${icons.bag}<small>Фото скоро появится</small></div>`;
function formatted(value) {
  return escape(value).split('\n').map(line => {
    const text = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      .replace(/\[color=(#[0-9a-f]{6})\](.*?)\[\/color\]/gi, '<span style="color:$1">$2</span>');
    if (text.startsWith('### ')) return `<h3>${text.slice(4)}</h3>`;
    if (text.startsWith('## ')) return `<h2>${text.slice(3)}</h2>`;
    return `<p>${text}</p>`;
  }).join('');
}
function setNav(view) {
  const inCart = view === 'cart';
  $('.bottom-nav').dataset.active = inCart ? 'cart' : 'catalog';
  $('#cart-tab').toggleAttribute('aria-current', inCart);
  $('#catalog-tab').toggleAttribute('aria-current', !inCart);
  (inCart ? $('#cart-tab') : $('#catalog-tab')).setAttribute('aria-current', 'page');
}
function show(html, view = 'info', shouldAnimate = true) {
  modalVersion++;
  const dialog = $('#details'), content = $('#detail-content');
  const wasOpen = dialog.open;
  const scroll = dialog.scrollTop;
  dialog.getAnimations().forEach(animation => animation.cancel());
  delete dialog.dataset.closing;
  dialog.dataset.view = view;
  content.innerHTML = html;
  content.querySelector('h2').id = 'detail-title';
  setNav(view);
  if (!wasOpen) {
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    void animate(dialog, [{ opacity: 0, transform: 'translateY(32px) scale(.97)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 320 });
  } else if (shouldAnimate) {
    void animate(content, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180 });
  }
  dialog.scrollTop = shouldAnimate ? 0 : scroll;
}
async function closeDetails() {
  const dialog = $('#details');
  if (!dialog.open) return;
  const version = ++modalVersion;
  dialog.dataset.closing = 'true';
  await animate(dialog, [{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(22px) scale(.98)' }], { duration: 170 });
  if (version !== modalVersion) return;
  dialog.close();
}
$('#details').addEventListener('close', () => { document.body.style.overflow = ''; delete $('#details').dataset.closing; setNav('catalog'); });
$('#details').addEventListener('cancel', event => { event.preventDefault(); void closeDetails(); });

function render() {
  const query = $('#search').value.trim().toLocaleLowerCase('ru');
  const items = data.products.filter(product => (!category || product.category === category)
    && (!query || `${product.name} ${product.short_description} ${product.category}`.toLocaleLowerCase('ru').includes(query)));
  $('#count').textContent = `${items.length} товаров`;
  $('#products').innerHTML = items.map((product, index) => `
    <article class="product" style="--item-index:${Math.min(index, 7)}">
      <button class="product-open" data-product="${product.id}">
        ${photo(product)}
        <div class="product-body"><small class="product-category">${escape(product.category)}</small><h3>${escape(product.name)}</h3></div>
      </button>
      <div class="product-purchase">
        <div class="product-bottom"><span class="price">${money(product.price)}</span><button class="quick-add" data-add="${product.id}" aria-label="Добавить в корзину: ${escape(product.name)}" ${product.stock <= 0 ? 'disabled' : ''}>${icons.plus}</button></div>
        <span class="stock ${product.stock > 0 ? 'in-stock' : ''}">${product.stock > 0 ? 'В наличии' : 'Нет в наличии'}</span>
      </div>
    </article>`).join('');
  $('#status').hidden = Boolean(items.length);
  $('#status').textContent = data.products.length ? 'По вашему запросу ничего не найдено.' : 'Товары скоро появятся. Загляните чуть позже.';
  const scroll = $('#categories').scrollLeft;
  $('#categories').innerHTML = [['', 'Все товары'], ...data.categories.map(name => [name, name])]
    .map(([value, label]) => `<button data-category="${escape(value)}" aria-pressed="${category === value}">${escape(label)}</button>`).join('');
  $('#categories').scrollLeft = scroll;
}
async function load() {
  if (loading) return;
  loading = true;
  $('#refresh').disabled = true;
  $('#refresh').classList.add('refreshing');
  try {
    const response = await fetch('/api/storefront', { credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw Error();
    data = await response.json();
    $('#shop-name').textContent = data.shop.name || 'GAS STORE';
    document.title = `${data.shop.name || 'GAS'} — магазин`;
    if (!data.categories.includes(category)) category = '';
    const banner = data.banners[0];
    $('#banner').hidden = !banner;
    if (banner) {
      const safe = /^\/(?!\/)|^https:\/\//i.test(banner.link);
      $('#banner').innerHTML = `<div class="banner-copy"><h2>${escape(banner.title)}</h2><p>${escape(banner.subtitle)}</p></div>
        ${safe ? `<a class="banner-link" href="${escape(banner.link)}" target="_blank" rel="noopener noreferrer" aria-label="Подробнее: ${escape(banner.title)}">${icons.arrow}</a>` : ''}`;
    }
    reconcileCart();
    render();
  } catch {
    $('#status').hidden = false;
    $('#status').innerHTML = 'Не удалось обновить каталог.<br><button class="retry" id="retry">Повторить</button>';
  } finally {
    loading = false;
    $('#refresh').disabled = false;
    $('#refresh').classList.remove('refreshing');
  }
}
function openProduct(id) {
  const product = data?.products.find(item => item.id === id);
  if (!product) return;
  $('#details').dataset.productId = id;
  show(`${photo(product)}<h2>${escape(product.name)}</h2><strong class="price">${money(product.price)}</strong>
    <p class="detail-stock">${product.stock > 0 ? 'В наличии' : 'Нет в наличии'}</p>
    ${formatted(product.short_description)}${formatted(product.description)}
    <button class="primary-button" id="product-add" data-add="${product.id}"></button><button class="secondary-button" id="product-cart" data-open-cart hidden>Открыть корзину ${icons.arrow}</button>`, 'product');
  updateProductAddButton();
  fetch(`/api/storefront/products/${product.id}/view`, { method: 'POST', credentials: 'omit' }).catch(() => {});
}
function updateProductAddButton() {
  const button = $('#product-add');
  if (!button) return;
  $('#product-cart').hidden = cartSummary().count === 0;
  const product = data.products.find(item => item.id === Number(button.dataset.add));
  const quantity = cart.get(product.id) || 0;
  button.disabled = product.stock <= 0 || quantity >= maxQuantity(product);
  button.innerHTML = product.stock <= 0 ? 'Нет в наличии'
    : quantity ? `${icons.check}<span>В корзине: ${quantity}${button.disabled ? '' : ' · Добавить ещё'}</span>`
    : `${icons.bag}<span>Добавить в корзину</span>`;
}
function referralContent() {
  const referral = data?.referral;
  if (!referral) return '<p>Информация пока недоступна. Обновите каталог.</p>';
  return referral.enabled
    ? `<div class="referral-summary"><span>Бонус за приглашение</span><strong>${money(referral.bonus)}</strong></div><p>Минимальная выплата: ${money(referral.minPayout)}.</p><p>Условия участия уточняйте у магазина.</p>`
    : '<div class="empty-inline">Реферальная программа пока не действует.</div>';
}
function openInfo(type) {
  if (!data) { show('<h2>Информация недоступна</h2><p>Сначала загрузите каталог.</p>'); return; }
  if (type === 'important') {
    const shop = data.shop;
    const information = formatted(shop.headline) + formatted(shop.description)
      + [shop.phone, shop.address, shop.hours].filter(Boolean).map(value => `<p>${escape(value)}</p>`).join('');
    show(`<h2>Важно прочитать</h2>${[shop.headline, shop.description, shop.phone, shop.address, shop.hours].some(Boolean)
      ? information : '<p>Информация о магазине скоро появится.</p>'}`);
  } else if (type === 'referral') {
    show(`<h2>Реферальная программа</h2>${referralContent()}`);
  } else {
    show(`<h2>Отзывы</h2>${data.reviews.map(review => `<article class="review">
      <strong aria-label="Оценка ${review.rating} из 5">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</strong>
      <p>${escape(review.text)}</p><small>${escape(review.product_name)} · ${new Date(review.created_at).toLocaleDateString('ru-RU')}</small>
      </article>`).join('') || '<p>Опубликованных отзывов пока нет.</p>'}`);
  }
}
function renderProfile(tab = 'overview') {
  const text = key => typeof user?.[key] === 'string' ? user[key].slice(0, 80) : '';
  const name = [text('first_name'), text('last_name')].filter(Boolean).join(' ') || text('username') || 'Гость';
  const initials = [text('first_name'), text('last_name')].filter(Boolean).map(value => [...value][0]).join('').toUpperCase();
  const { count, amount } = cartSummary();
  show(`<div class="profile-card">
      <div class="profile-identity"><span class="profile-avatar">${initials ? escape(initials) : icons.user}</span><div><h2>${escape(name)}</h2>${text('username') ? `<span class="profile-username">@${escape(text('username'))}</span>` : ''}</div></div>
      <div class="profile-stats"><div><span>В КОРЗИНЕ</span><strong>${count}</strong></div><div><span>СУММА</span><strong>${money(amount)}</strong></div></div>
    </div>
    <div class="profile-tabs" role="tablist" aria-label="Разделы профиля">
      <button role="tab" id="profile-overview" aria-controls="profile-panel" aria-selected="${tab === 'overview'}" tabindex="${tab === 'overview' ? 0 : -1}" data-profile-tab="overview">Обзор</button>
      <button role="tab" id="profile-referral" aria-controls="profile-panel" aria-selected="${tab === 'referral'}" tabindex="${tab === 'referral' ? 0 : -1}" data-profile-tab="referral">Реферальная программа</button>
    </div>
    <div class="profile-panel" id="profile-panel" role="tabpanel" aria-labelledby="profile-${tab}">
      ${tab === 'overview' ? `<button class="profile-link" data-open-cart>${icons.bag}<span>Моя корзина</span>${icons.arrow}</button><p class="profile-hint">Выбранные товары сохраняются на этом устройстве.</p>` : referralContent()}
    </div>`, 'profile', false);
  void animate($('.profile-panel'), [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 200 });
}
function renderCart(shouldAnimate = true) {
  const items = cartItems(), { count, amount } = cartSummary();
  show(`<div class="cart-heading"><span class="sheet-kicker">ВАШ ВЫБОР</span><h2>Корзина <span>${count}</span></h2></div>
    ${!data ? '<p>Сначала загрузите каталог, чтобы проверить наличие и цены.</p>' : items.length ? `
      <div class="cart-items">${items.map(({ product, quantity }) => `<div class="cart-item" data-cart-item="${product.id}">
        <button class="cart-item-photo" data-open-product="${product.id}" aria-label="Открыть: ${escape(product.name)}">${photo(product)}</button>
        <div class="cart-item-body"><button class="cart-item-name" data-open-product="${product.id}">${escape(product.name)}</button><span class="cart-unit-price">${money(product.price)} / шт.</span>
          <div class="cart-item-controls"><div class="quantity-control">
            <button data-cart-id="${product.id}" data-cart-change="-1" aria-label="Уменьшить количество: ${escape(product.name)}">${icons.minus}</button>
            <output aria-label="Количество: ${escape(product.name)}">${quantity}</output>
            <button data-cart-id="${product.id}" data-cart-change="1" aria-label="Увеличить количество: ${escape(product.name)}" ${quantity >= maxQuantity(product) ? 'disabled' : ''}>${icons.plus}</button>
          </div><strong>${money(product.price * quantity)}</strong></div>
        </div>
        <button class="remove-item" data-remove="${product.id}" aria-label="Удалить: ${escape(product.name)}">${icons.trash}</button>
      </div>`).join('')}</div>
      <div class="cart-total"><span>Итого</span><strong>${money(amount)}</strong></div>
      <p class="cart-note">Товары в корзине не резервируются.</p>` : `<div class="cart-empty">${icons.bag}<h3>Корзина пока пуста</h3><p>Добавьте то, что вам понравилось.</p></div>`}
    <button class="primary-button" data-continue>${items.length ? 'Продолжить покупки' : 'Перейти в каталог'}${icons.arrow}</button>`, 'cart', shouldAnimate);
}
async function continueShopping() {
  await closeDetails();
  $('#catalog').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

$('#refresh').onclick = load;
$('#profile-button').onclick = () => renderProfile();
$('#cart-tab').onclick = () => renderCart();
$('#catalog-tab').onclick = continueShopping;
$('#search-toggle').onclick = async () => {
  const open = $('#search-panel').hidden;
  $('#search-toggle').setAttribute('aria-expanded', String(open));
  if (open) {
    $('#search-panel').hidden = false;
    void animate($('#search-panel'), [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'translateY(0)' }]);
    $('#search').focus();
  } else {
    await animate($('#search-panel'), [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 140 });
    $('#search-panel').hidden = true;
    $('#search').value = '';
    if (data) render();
  }
};
$('#search').oninput = () => { if (data) render(); };
$('#categories').onclick = event => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  category = button.dataset.category;
  render();
  $('#categories [aria-pressed="true"]').scrollIntoView({ block: 'nearest', inline: 'nearest' });
};
$('#products').onclick = event => {
  const add = event.target.closest('[data-add]');
  if (add) { changeCart(Number(add.dataset.add), 1, add); return; }
  const button = event.target.closest('[data-product]');
  if (button) openProduct(Number(button.dataset.product));
};
$('.stories').onclick = event => {
  const button = event.target.closest('[data-info]');
  if (button) openInfo(button.dataset.info);
};
$('.close').onclick = closeDetails;
$('#details').onclick = event => {
  if (event.target === $('#details')) {
    const rect = event.target.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) void closeDetails();
  }
};
$('#detail-content').onclick = event => {
  const add = event.target.closest('[data-add]');
  const quantity = event.target.closest('[data-cart-change]');
  const remove = event.target.closest('[data-remove]');
  const product = event.target.closest('[data-open-product]');
  const tab = event.target.closest('[data-profile-tab]');
  if (add) changeCart(Number(add.dataset.add), 1, add);
  else if (quantity) changeCart(Number(quantity.dataset.cartId), Number(quantity.dataset.cartChange), quantity);
  else if (remove) {
    const id = Number(remove.dataset.remove);
    changeCart(id, -(cart.get(id) || 0));
  } else if (product) openProduct(Number(product.dataset.openProduct));
  else if (tab) { renderProfile(tab.dataset.profileTab); $(`#profile-${tab.dataset.profileTab}`).focus({ preventScroll: true }); }
  else if (event.target.closest('[data-open-cart]')) renderCart();
  else if (event.target.closest('[data-continue]')) void continueShopping();
};
$('#detail-content').addEventListener('keydown', event => {
  if (!event.target.closest('[role="tablist"]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const current = $('[role="tab"][aria-selected="true"]').dataset.profileTab;
  const tab = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'referral' : current === 'overview' ? 'referral' : 'overview';
  renderProfile(tab);
  $(`#profile-${tab}`).focus();
});
document.addEventListener('click', event => { if (event.target.id === 'retry') load(); });
load();
