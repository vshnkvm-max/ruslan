let telegram = window.Telegram?.WebApp;
let telegramReady=false,fullscreenRequested=false,configuredTelegram=null;
const chromeColor='#100002';
function postTelegramEvent(eventType,eventData={}){
 try {
  if(typeof window.TelegramWebviewProxy?.postEvent==='function')window.TelegramWebviewProxy.postEvent(eventType,JSON.stringify(eventData));
  else if(typeof window.external?.notify==='function')window.external.notify(JSON.stringify({eventType,eventData}));
  else if(window.parent!==window)window.parent.postMessage(JSON.stringify({eventType,eventData}),'https://web.telegram.org');
 }catch { /* The browser may not expose a native Telegram bridge. */ }
}
function canFullscreen(){return typeof telegram?.requestFullscreen==='function'&&telegram.isVersionAtLeast?.('8.0');}
function updateTelegramInsets(){
 const safe=telegram?.safeAreaInset||{},content=telegram?.contentSafeAreaInset||{};
 document.documentElement.style.setProperty('--telegram-safe-top',`${Math.max(0,Number(safe.top)||0)+Math.max(0,Number(content.top)||0)}px`);
 document.documentElement.style.setProperty('--telegram-safe-bottom',`${Math.max(0,Number(safe.bottom)||0)+Math.max(0,Number(content.bottom)||0)}px`);
 const button=document.getElementById('fullscreen-button');if(button)button.hidden=!canFullscreen()||Boolean(telegram.isFullscreen);
}
function requestTelegramFullscreen(automatic=false){
 if(!canFullscreen()||telegram.isFullscreen||(automatic&&fullscreenRequested))return;
 fullscreenRequested=true;try{telegram.requestFullscreen();}catch{updateTelegramInsets();}
}
function configureTelegram(){
 for(const [method,event] of [['setHeaderColor','web_app_set_header_color'],['setBackgroundColor','web_app_set_background_color'],['setBottomBarColor','web_app_set_bottom_bar_color']]){
  try{if(typeof telegram?.[method]==='function')telegram[method](chromeColor);else postTelegramEvent(event,{color:chromeColor});}
  catch{postTelegramEvent(event,{color:chromeColor});}
 }
 if(!telegram)return;
 for(const method of ['ready','expand']){try{if(typeof telegram[method]==='function'){telegram[method]();if(method==='ready')telegramReady=true;}}catch{console.warn(`Telegram WebApp: ${method} недоступен.`);}}
 updateTelegramInsets();
 if(configuredTelegram!==telegram){
  configuredTelegram=telegram;
  for(const event of ['safeAreaChanged','contentSafeAreaChanged','fullscreenChanged'])telegram.onEvent?.(event,updateTelegramInsets);
  telegram.onEvent?.('fullscreenFailed',()=>{updateTelegramInsets();notify('Этот клиент Telegram не поддерживает полный экран.');});
 }
 requestTelegramFullscreen(true);
}
function signalReadyWithoutSdk(){if(!telegramReady)postTelegramEvent('web_app_ready');}

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
  package: icon('<path d="m12 3 9 5v9l-9 5-9-5V8ZM3 8l9 5 9-5M12 13v9M8 5l9 5"/>'),
  trash: icon('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'),
  chevron: icon('<path d="m9 5 7 7-7 7"/>'),
  check: icon('<path d="m5 12 4 4L19 6"/>')
};
const money = value => new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'RUB', maximumFractionDigits: 0
}).format(value);
const moneyMarkup = value => money(value).replace('₽', '<span class="currency-symbol">₽</span>');
// Telegram's display data is used only for presentation and local cart separation.
// It never authorizes access to customers, orders or any other private API.
let user = telegram?.initDataUnsafe?.user;
const cartKeyFor = user => `gas-cart:v1:${Number.isSafeInteger(user?.id) && user.id > 0 ? user.id : 'guest'}`;
let cartKey = cartKeyFor(user);
const maxQuantity = product => Math.min(product.stock, 999);
let data, category = '', loading = false, modalVersion = 0, toastTimer;
let cart = readCart();
let categorySlide;
let categoryMenuKey;
let profileTab = 'overview', profileTransition, ordersTransition;
let activePage = 'home', pageSwitchVersion = 0, pageTransition;
const pageScroll = { home: 0, cart: 0 };

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
    if (activePage !== 'cart' || $('#details').open) notify('Товар добавлен в корзину');
  }
  if (activePage === 'cart') {
    renderCart();
    const next = $(`[data-cart-id="${id}"][data-cart-change="${delta}"]:not(:disabled)`)
      || $(`[data-cart-id="${id}"][data-cart-change="-1"]`) || $('[data-continue]');
    if (!$('#details').open) next?.focus({ preventScroll: true });
  }
  void animate($(`[data-cart-item="${id}"] .quantity-control output`), [{ opacity: .3, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 160 });
  updateProductAddButton();
}

const isPhoto=value=>/^data:image\/(jpeg|png|webp);base64,/.test(value)||/^\/api\/images\/[a-f0-9-]{36}$/.test(value);
const photo = product => isPhoto(product.image)
  ? `<div class="photo"><img src="${escape(product.image)}" alt="${escape(product.name)}" loading="lazy" decoding="async"></div>`
  : `<div class="photo photo-empty">${icons.bag}<small>Фото скоро появится</small></div>`;
function productGallery(product){
 const images=product.images?.length?product.images:(isPhoto(product.image)?[product.image]:[]);
 if(images.length<2)return photo(product);
 return `<div class="product-gallery"><div class="gallery-track" id="gallery-track" aria-label="Фотографии товара">${images.map((image,index)=>`<div class="gallery-slide">${photo({...product,image,name:`${product.name} — фото ${index+1}`})}</div>`).join('')}</div><div class="gallery-controls"><button type="button" data-gallery-step="-1" aria-label="Предыдущее фото" disabled>‹</button><span id="gallery-counter" aria-live="polite">1 / ${images.length}</span><button type="button" data-gallery-step="1" aria-label="Следующее фото">›</button></div></div>`;
}
function updateGallery(){
 const track=$('#gallery-track');if(!track)return;
 const index=Math.round(track.scrollLeft/Math.max(1,track.clientWidth)),count=track.children.length;
 $('#gallery-counter').textContent=`${index+1} / ${count}`;
 $('[data-gallery-step="-1"]').disabled=index===0;
 $('[data-gallery-step="1"]').disabled=index>=count-1;
}
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
  stopProfileTransition();
  ordersTransition?.cancel();
  ordersTransition = undefined;
  modalVersion++;
  const dialog = $('#details'), content = $('#detail-content');
  const wasOpen = dialog.open;
  delete dialog.dataset.profileAnchored;
  dialog.style.removeProperty('--profile-top');
  const scroll = dialog.scrollTop;
  dialog.getAnimations().forEach(animation => animation.cancel());
  delete dialog.dataset.closing;
  dialog.dataset.view = view;
  content.innerHTML = html;
  content.querySelector('h2').id = 'detail-title';
  setNav(activePage === 'cart' ? 'cart' : 'catalog');
  if (!wasOpen) {
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    void animate(dialog, view==='product'?[{transform:'translateY(100%)'},{transform:'translateY(0)'}]:[{opacity:0,transform:'translateY(32px) scale(.97)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:320});
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
  await animate(dialog,dialog.dataset.view==='product'?[{transform:'translateY(0)'},{transform:'translateY(100%)'}]:[{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(22px) scale(.98)'}],{duration:220});
  if (version !== modalVersion) return;
  dialog.close();
}
$('#details').addEventListener('close', () => { document.body.style.overflow = ''; delete $('#details').dataset.closing; setNav(activePage === 'cart' ? 'cart' : 'catalog'); });
$('#details').addEventListener('cancel', event => { event.preventDefault(); void closeDetails(); });

function positionCategoryIndicator(smooth = false) {
  const selected = $('#categories [aria-pressed="true"]');
  const indicator = $('#category-indicator');
  if (!selected || !indicator || !$('#categories').clientWidth) return;
  if (!smooth) indicator.setAttribute('data-instant', '');
  indicator.style.width = `${selected.offsetWidth}px`;
  indicator.style.transform = `translate3d(${selected.offsetLeft}px, 0, 0)`;
  indicator.classList.add('is-positioned');
  if (!smooth) {
    // Commit non-animated placement on first load and after size changes.
    indicator.getBoundingClientRect();
    indicator.removeAttribute('data-instant');
  }
}
function centerActiveCategory(smooth = false) {
  const menu = $('#categories'), selected = $('#categories [aria-pressed="true"]');
  if (!selected || !menu.clientWidth) return;
  const left = selected.offsetLeft - (menu.clientWidth - selected.offsetWidth) / 2;
  menu.scrollTo({
    left: Math.max(0, Math.min(menu.scrollWidth - menu.clientWidth, left)),
    behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant'
  });
}
function renderCategories(smooth = false) {
  const menu = $('#categories');
  const entries = [['', 'Все товары'], ...data.categories.map(name => [name, name])];
  const key = JSON.stringify(entries);
  if (key !== categoryMenuKey) {
    const scroll = menu.scrollLeft;
    menu.innerHTML = '<span class="category-indicator" id="category-indicator" aria-hidden="true"></span>'
      + entries.map(([value, label]) => `<button data-category="${escape(value)}" aria-pressed="false">${escape(label)}</button>`).join('');
    categoryMenuKey = key;
    menu.scrollLeft = scroll;
    smooth = false;
  }
  menu.querySelectorAll('[data-category]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
  positionCategoryIndicator(smooth);
}

function stopCategorySlide() {
  if (!categorySlide) return;
  const slide = categorySlide;
  categorySlide = undefined;
  slide.animations.forEach(animation => animation.cancel());
  slide.outgoing.remove();
  slide.wind.remove();
  $('#catalog-page').inert = false;
  $('#catalog-viewport').classList.remove('is-sliding');
  $('#catalog-viewport').style.height = '';
  $('#catalog-viewport').removeAttribute('aria-busy');
}

async function selectCategory(next) {
  const order = ['', ...data.categories];
  if (next === category || !order.includes(next)) return;
  const direction = order.indexOf(next) > order.indexOf(category) ? 1 : -1;
  stopCategorySlide();
  const viewport = $('#catalog-viewport'), page = $('#catalog-page');
  const shouldSlide = Boolean(page.animate) && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const oldHeight = page.getBoundingClientRect().height;
  const outgoing = shouldSlide ? page.cloneNode(true) : null;
  category = next;
  render(false);
  const selected = $('#categories [aria-pressed="true"]');
  selected.focus({ preventScroll: true });
  centerActiveCategory(true);
  if (!shouldSlide) return;

  // The old page is a visual snapshot; only the new page remains accessible.
  outgoing.removeAttribute('id');
  outgoing.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
  outgoing.classList.add('outgoing-catalog-page');
  outgoing.setAttribute('aria-hidden', 'true');
  outgoing.inert = true;
  viewport.append(outgoing);
  viewport.classList.add('is-sliding');
  viewport.setAttribute('aria-busy', 'true');
  viewport.style.height = `${oldHeight}px`;
  page.inert = true;
  const newHeight = page.getBoundingClientRect().height;
  const wind = document.createElement('div');
  wind.className = 'category-wind';
  wind.setAttribute('aria-hidden', 'true');
  viewport.append(wind);
  const timing = { duration: 380, easing: 'cubic-bezier(.16,.8,.18,1)', fill: 'both' };
  const slide = { outgoing, wind, animations: [
    page.animate([
      { transform: `translate3d(${direction * 105}%, 0, 0) scaleX(1.035)`, filter: 'blur(5px)' },
      { transform: 'translate3d(0, 0, 0) scaleX(1)', filter: 'blur(0)' }
    ], timing),
    outgoing.animate([
      { transform: 'translate3d(0, 0, 0) scaleX(1)', filter: 'blur(0)' },
      { transform: `translate3d(${-direction * 105}%, 0, 0) scaleX(.98)`, filter: 'blur(6px)' }
    ], timing),
    viewport.animate([{ height: `${oldHeight}px` }, { height: `${newHeight}px` }], timing),
    wind.animate([
      { transform: `translateX(${-direction * 100}%)`, opacity: 0 },
      { transform: 'translateX(0)', opacity: .65, offset: .35 },
      { transform: `translateX(${direction * 100}%)`, opacity: 0 }
    ], timing)
  ] };
  categorySlide = slide;
  await Promise.all(slide.animations.map(animation => animation.finished.catch(() => {})));
  // A newer selection or a catalog refresh may already have replaced this slide.
  if (categorySlide === slide) stopCategorySlide();
}

function render(animateProducts = true) {
  stopCategorySlide();
  $('#catalog-page').classList.toggle('no-product-entrance', !animateProducts);
  const items = data.products.filter(product => !category || product.category === category);
  $('#count').textContent = `${items.length} товаров`;
  $('#products').innerHTML = items.map((product, index) => `
    <article class="product" style="--item-index:${Math.min(index, 7)}">
      <button class="product-open" data-product="${product.id}" aria-label="Открыть товар: ${escape(product.name)}">
        <div class="catalog-photo">${photo(product)}
          ${product.stock <= 0 ? '<span class="availability-badge">Нет в наличии</span>' : ''}
        </div>
        <div class="product-body">
          <h3>${escape(product.name)}</h3>
          <div class="product-bottom"><span class="price">${moneyMarkup(product.price)}</span><span class="product-chevron" aria-hidden="true">${icons.chevron}</span></div>
        </div>
      </button>
    </article>`).join('');
  $('#status').hidden = Boolean(items.length);
  $('#status').textContent = data.products.length ? 'В этой категории пока нет товаров.' : 'Товары скоро появятся. Загляните чуть позже.';
  renderCategories(!animateProducts);
}
async function load() {
  if (loading) return;
  loading = true;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  let stage='network';
  try {
    const response = await fetch('/api/storefront', { credentials: 'omit', cache: 'no-store', signal:controller.signal });
    if (!response.ok) {const error=new Error();error.httpStatus=response.status;throw error;}
    stage='data';
    const payload=await response.json();
    if(!payload||!Array.isArray(payload.products))throw new Error('Некорректный каталог.');
    data={...payload,categories:Array.isArray(payload.categories)?payload.categories:[...new Set(payload.products.map(product=>product.category).filter(Boolean))],banners:Array.isArray(payload.banners)?payload.banners:[],reviews:Array.isArray(payload.reviews)?payload.reviews:[]};
    stage='render';
    document.title = 'GAS SHOP — магазин';
    if (!data.categories.includes(category)) category = '';
    const banner = data.banners[0];
    const bannerImage = /^data:image\/(jpeg|png|webp);base64,/.test(banner?.image)||/^\/api\/banner-images\/\d+\?v=[a-f0-9]{64}$/.test(banner?.image);
    $('#banner').hidden = !banner;
    $('#banner').classList.toggle('has-image', bannerImage);
    $('#banner').replaceChildren();
    if (banner) {
      $('#banner').innerHTML=bannerImage?`<button type="button" class="banner-open" aria-label="Подробнее об акции: ${escape(banner.title)}"><img class="banner-image" src="${escape(banner.image)}" alt="${escape(banner.title)}"></button>`:`<button type="button" class="banner-open" aria-label="Подробнее об акции: ${escape(banner.title)}"><span class="banner-copy"><h2>${escape(banner.title)}</h2><p>${escape(banner.subtitle)}</p></span><span class="banner-link" aria-hidden="true">${icons.arrow}</span></button>`;
    }
    reconcileCart();
    render();
    if (activePage === 'cart') renderCart();
  } catch(error) {
    const reason=error.name==='AbortError'?'Сервер не ответил за 15 секунд.':error.httpStatus?`Сервер вернул HTTP ${error.httpStatus}.`:stage==='network'?'Нет соединения с сервером.':stage==='data'?'Сервер вернул некорректные данные каталога.':'Ошибка отображения каталога.';
    console.error(`Каталог: ${reason}`,error);
    $('#status').hidden = false;
    $('#status').innerHTML = `Не удалось обновить каталог.<br>${escape(reason)}<br><button class="retry" id="retry">Повторить</button>`;
  } finally {
    clearTimeout(timer);
    loading = false;
  }
}
function openBanner(){
 const banner=data?.banners[0];if(!banner)return;
 const image=/^data:image\/(jpeg|png|webp);base64,|^\/api\/banner-images\//.test(banner.image)?`<img class="promotion-image" src="${escape(banner.image)}" alt="${escape(banner.title)}">`:'';
 show(`${image}<h2>${escape(banner.title)}</h2>${banner.subtitle?`<p>${escape(banner.subtitle)}</p>`:''}${formatted(banner.description)}${!banner.description&&!banner.subtitle?'<p>Подробности акции скоро появятся.</p>':''}`,'promotion');
}
function openProduct(id) {
  const product = data?.products.find(item => item.id === id);
  if (!product) return;
  $('#details').dataset.productId = id;
  show(`${productGallery(product)}<h2>${escape(product.name)}</h2><strong class="price">${moneyMarkup(product.price)}</strong>
    <p class="detail-stock">${product.stock > 0 ? 'В наличии' : 'Нет в наличии'}</p>
    ${formatted(product.short_description)}${formatted(product.description)}
    <button class="primary-button" id="product-add" data-add="${product.id}"></button><button class="secondary-button" id="product-cart" data-open-cart hidden>Открыть корзину ${icons.arrow}</button>`, 'product');
  $('#gallery-track')?.addEventListener('scroll',updateGallery,{passive:true});
  updateProductAddButton();
  fetch(`/api/storefront/products/${product.id}/view`, { method: 'POST', credentials: 'omit' }).catch(() => {});
}
function updateProductAddButton() {
  const button = $('#product-add');
  if (!button || !$('#details').open) return;
  $('#product-cart').hidden = cartSummary().count === 0;
  const product = data.products.find(item => item.id === Number(button.dataset.add));
  if (!product) return;
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
    ? `<div class="referral-summary"><span>Бонус за приглашение</span><strong>${moneyMarkup(referral.bonus)}</strong></div><p>Минимальная выплата: ${moneyMarkup(referral.minPayout)}.</p><p>Условия участия уточняйте у магазина.</p>`
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
function profileContent(tab) {
  return tab === 'overview' ? `<button class="profile-link" data-open-cart>${icons.bag}<span>Моя корзина</span>${icons.arrow}</button>
    <div class="recent-orders">
      <button class="recent-orders-toggle" data-toggle-orders aria-expanded="false" aria-controls="recent-orders-list">${icons.package}<span>Последние заказы</span>${icons.chevron}</button>
      <div class="recent-orders-list" id="recent-orders-list" hidden><p>История заказов пока недоступна.</p></div>
    </div><p class="profile-hint">Выбранные товары сохраняются на этом устройстве.</p>` : referralContent();
}
function stopProfileTransition() {
  if (!profileTransition) return;
  const transition = profileTransition;
  profileTransition = undefined;
  transition.animations.forEach(animation => animation.cancel());
  transition.outgoing.remove();
  const panel = $('#profile-panel');
  if (panel) {
    panel.style.height = '';
    panel.removeAttribute('aria-busy');
  }
  const body = $('#profile-body');
  if (body) body.inert = false;
}
async function switchProfileTab(tab) {
  if (tab === profileTab || !['overview', 'referral'].includes(tab)) return;
  stopProfileTransition();
  ordersTransition?.cancel();
  ordersTransition = undefined;
  const panel = $('#profile-panel'), body = $('#profile-body');
  if (!panel || !body) return;
  const direction = tab === 'referral' ? 1 : -1;
  const dialog = $('#details');
  if (!dialog.hasAttribute('data-profile-anchored')) {
    dialog.style.setProperty('--profile-top', `${dialog.getBoundingClientRect().top}px`);
    dialog.dataset.profileAnchored = 'true';
  }
  const oldHeight = body.getBoundingClientRect().height;
  const outgoing = body.cloneNode(true);
  profileTab = tab;
  $('.profile-tabs').dataset.active = tab;
  panel.setAttribute('aria-labelledby', `profile-${tab}`);
  document.querySelectorAll('[data-profile-tab]').forEach(button => {
    const active = button.dataset.profileTab === tab;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  body.innerHTML = profileContent(tab);
  $(`#profile-${tab}`).focus({ preventScroll: true });
  if (!body.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  outgoing.removeAttribute('id');
  outgoing.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
  outgoing.classList.add('outgoing-profile-body');
  outgoing.setAttribute('aria-hidden', 'true');
  outgoing.inert = true;
  panel.append(outgoing);
  panel.style.height = `${oldHeight}px`;
  panel.setAttribute('aria-busy', 'true');
  body.inert = true;
  const timing = { duration: 320, easing: 'cubic-bezier(.22,.8,.25,1)', fill: 'both' };
  const transition = { outgoing, animations: [
    body.animate([{ opacity: 0, transform: `translateX(${direction * 22}px)`, filter: 'blur(2px)' }, { opacity: 1, transform: 'translateX(0)', filter: 'blur(0)' }], timing),
    outgoing.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-direction * 22}px)` }], timing),
    panel.animate([{ height: `${oldHeight}px` }, { height: `${body.getBoundingClientRect().height}px` }], timing)
  ] };
  profileTransition = transition;
  await Promise.all(transition.animations.map(animation => animation.finished.catch(() => {})));
  if (profileTransition === transition) stopProfileTransition();
}
async function toggleRecentOrders(button) {
  const list = $('#recent-orders-list');
  if (!list) return;
  const open = button.getAttribute('aria-expanded') !== 'true';
  const from = list.hidden ? 0 : list.getBoundingClientRect().height;
  ordersTransition?.cancel();
  button.setAttribute('aria-expanded', String(open));
  list.hidden = false;
  if (!list.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { list.hidden = !open; return; }
  const animation = list.animate([{ height: `${from}px`, opacity: open ? 0 : 1 }, { height: open ? `${list.scrollHeight}px` : '0px', opacity: open ? 1 : 0 }], { duration: 260, easing: 'ease', fill: 'both' });
  ordersTransition = animation;
  await animation.finished.catch(() => {});
  if (ordersTransition !== animation) return;
  list.hidden = !open;
  animation.cancel();
  ordersTransition = undefined;
}
function userPhotoUrl(){try{const value=typeof user?.photo_url==='string'?user.photo_url:'';const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function avatarPhoto(){const src=userPhotoUrl();return src?`<img class="client-avatar-photo" src="${escape(src)}" alt="Аватар клиента" referrerpolicy="no-referrer" decoding="async">`:'';}
function bindAvatarFallbacks(root=document){root.querySelectorAll('.client-avatar-photo').forEach(image=>image.addEventListener('error',()=>image.remove(),{once:true}));}
function updateClientAvatar(){const button=$('#profile-button');button.querySelector('.client-avatar-photo')?.remove();button.insertAdjacentHTML('beforeend',avatarPhoto());bindAvatarFallbacks(button);}
function renderProfile(tab = 'overview') {
  const text = key => typeof user?.[key] === 'string' ? user[key].slice(0, 80) : '';
  const name = [text('first_name'), text('last_name')].filter(Boolean).join(' ') || text('username') || 'Гость';
  const initials = [text('first_name'), text('last_name')].filter(Boolean).map(value => [...value][0]).join('').toUpperCase();
  const { count, amount } = cartSummary();
  profileTab = tab;
  show(`<div class="profile-card">
      <div class="profile-identity"><span class="profile-avatar">${initials ? escape(initials) : icons.user}${avatarPhoto()}</span><div><h2>${escape(name)}</h2>${text('username') ? `<span class="profile-username">@${escape(text('username'))}</span>` : ''}</div></div>
      <div class="profile-stats"><div><span>В КОРЗИНЕ</span><strong>${count}</strong></div><div><span>СУММА</span><strong>${moneyMarkup(amount)}</strong></div></div>
    </div>
    <div class="profile-tabs" role="tablist" aria-label="Разделы профиля" data-active="${tab}">
      <span class="profile-tab-indicator" aria-hidden="true"></span>
      <button role="tab" id="profile-overview" aria-controls="profile-panel" aria-selected="${tab === 'overview'}" tabindex="${tab === 'overview' ? 0 : -1}" data-profile-tab="overview">Обзор</button>
      <button role="tab" id="profile-referral" aria-controls="profile-panel" aria-selected="${tab === 'referral'}" tabindex="${tab === 'referral' ? 0 : -1}" data-profile-tab="referral">Реферальная программа</button>
    </div>
    <div class="profile-panel" id="profile-panel" role="tabpanel" aria-labelledby="profile-${tab}"><div class="profile-body" id="profile-body">${profileContent(tab)}</div></div>`, 'profile', false);
  bindAvatarFallbacks($('#detail-content'));
}

function renderCart() {
  const items = cartItems(), { count, amount } = cartSummary();
  $('#cart-content').innerHTML = `<div class="cart-heading"><span class="sheet-kicker">ВАШ ВЫБОР</span><h1>Корзина <span>${count}</span></h1></div>
    ${!data ? '<p>Сначала загрузите каталог, чтобы проверить наличие и цены.</p>' : items.length ? `
      <div class="cart-items">${items.map(({ product, quantity }) => `<div class="cart-item" data-cart-item="${product.id}">
        <button class="cart-item-photo" data-open-product="${product.id}" aria-label="Открыть: ${escape(product.name)}">${photo(product)}</button>
        <div class="cart-item-body"><button class="cart-item-name" data-open-product="${product.id}">${escape(product.name)}</button><span class="cart-unit-price">${moneyMarkup(product.price)} / шт.</span>
          <div class="cart-item-controls"><div class="quantity-control">
            <button data-cart-id="${product.id}" data-cart-change="-1" aria-label="Уменьшить количество: ${escape(product.name)}">${icons.minus}</button>
            <output aria-label="Количество: ${escape(product.name)}">${quantity}</output>
            <button data-cart-id="${product.id}" data-cart-change="1" aria-label="Увеличить количество: ${escape(product.name)}" ${quantity >= maxQuantity(product) ? 'disabled' : ''}>${icons.plus}</button>
          </div><strong>${moneyMarkup(product.price * quantity)}</strong></div>
        </div>
        <button class="remove-item" data-remove="${product.id}" aria-label="Удалить: ${escape(product.name)}">${icons.trash}</button>
      </div>`).join('')}</div>
      <div class="cart-total"><span>Итого</span><strong>${moneyMarkup(amount)}</strong></div>` : `<div class="cart-empty">${icons.bag}<h3>Корзина пока пуста</h3><p>Добавьте то, что вам понравилось.</p></div>`}
    <button class="primary-button" data-continue>${items.length ? 'Продолжить покупки' : 'Перейти в каталог'}${icons.arrow}</button>`;
}
async function navigateToPage(next, { toCatalog = false } = {}) {
  if (!['home', 'cart'].includes(next)) return;
  const version = ++pageSwitchVersion;
  await closeDetails();
  if (version !== pageSwitchVersion || $('#details').open) return;
  if (next === activePage) {
    if (next === 'cart') renderCart();
    setNav(next === 'cart' ? 'cart' : 'catalog');
    if (toCatalog) $('#catalog').scrollIntoView({ behavior: 'instant', block: 'start' });
    return;
  }
  pageTransition?.cancel();
  pageScroll[activePage] = window.scrollY;
  stopCategorySlide();
  const previous = $(`#${activePage}-page`), target = $(`#${next}-page`);
  const transferFocus = previous.contains(document.activeElement);
  if (next === 'cart') renderCart();
  previous.hidden = true;
  target.hidden = false;
  activePage = next;
  setNav(next === 'cart' ? 'cart' : 'catalog');
  window.scrollTo({ top: pageScroll[next], behavior: 'instant' });
  if (toCatalog) $('#catalog').scrollIntoView({ behavior: 'instant', block: 'start' });
  if (next === 'home') positionCategoryIndicator();
  if (transferFocus) target.focus({ preventScroll: true });
  if (!target.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const animation = target.animate([
    { opacity: 0, transform: `translateX(${next === 'cart' ? 18 : -18}px)` },
    { opacity: 1, transform: 'translateX(0)' }
  ], { duration: 240, easing: 'cubic-bezier(.22,.8,.25,1)' });
  pageTransition = animation;
  await animation.finished.catch(() => {});
  if (pageTransition === animation) pageTransition = undefined;
}
async function continueShopping() {
  await navigateToPage('home', { toCatalog: true });
}

const resizeCategoryPanel = () => {
  positionCategoryIndicator();
  centerActiveCategory();
};
if (window.ResizeObserver) new ResizeObserver(resizeCategoryPanel).observe($('#categories'));
else window.addEventListener('resize', resizeCategoryPanel);

$('#profile-button').onclick = () => renderProfile();
$('#fullscreen-button')?.addEventListener('click',()=>requestTelegramFullscreen());
$('#banner').onclick=openBanner;
$('#cart-tab').onclick = () => { void navigateToPage('cart'); };
$('#catalog-tab').onclick = () => { void navigateToPage('home'); };
$('#categories').onclick = event => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  void selectCategory(button.dataset.category);
};
$('#products').onclick = event => {
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
function handleCartAction(event) {
 const step=event.target.closest('[data-gallery-step]');
 if(step){const track=$('#gallery-track');const index=Math.round(track.scrollLeft/Math.max(1,track.clientWidth));track.scrollTo({left:Math.max(0,Math.min(track.children.length-1,index+Number(step.dataset.galleryStep)))*track.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});return;}
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
  else if (tab) void switchProfileTab(tab.dataset.profileTab);
  else if (event.target.closest('[data-toggle-orders]')) void toggleRecentOrders(event.target.closest('[data-toggle-orders]'));
  else if (event.target.closest('[data-open-cart]')) void navigateToPage('cart');
  else if (event.target.closest('[data-continue]')) void continueShopping();
}
$('#detail-content').onclick = handleCartAction;
$('#cart-content').onclick = handleCartAction;
$('#detail-content').addEventListener('keydown', event => {
  if (!event.target.closest('[role="tablist"]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const current = $('[role="tab"][aria-selected="true"]').dataset.profileTab;
  const tab = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'referral' : current === 'overview' ? 'referral' : 'overview';
  void switchProfileTab(tab);
});
document.addEventListener('click', event => { if (event.target.id === 'retry') load(); });
$('#telegram-sdk')?.addEventListener('load', () => {
  telegram = window.Telegram?.WebApp;
  configureTelegram();
  user = telegram?.initDataUnsafe?.user;
  updateClientAvatar();
  const nextKey = cartKeyFor(user);
  if (nextKey !== cartKey) {
    // Keep guest and Telegram carts separate even when the SDK arrives late.
    cartKey = nextKey;
    cart = readCart();
    if (data) {
      reconcileCart();
      if (activePage === 'cart') renderCart();
      updateProductAddButton();
    }
  }
  if ($('#details').open && $('#details').dataset.view === 'profile') renderProfile(profileTab);
});
updateClientAvatar();
load();
configureTelegram();
signalReadyWithoutSdk();
