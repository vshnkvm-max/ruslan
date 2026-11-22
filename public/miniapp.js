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
function isMobileClient(){
 const platform=telegram?.platform;
 if(['ios','android','android_x'].includes(platform))return true;
 if(['tdesktop','macos','unigram'].includes(platform))return false;
 return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)||matchMedia('(pointer: coarse)').matches;
}
function canFullscreen(){return isMobileClient()&&typeof telegram?.requestFullscreen==='function'&&telegram.isVersionAtLeast?.('8.0');}
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
 document.documentElement.dataset.device=isMobileClient()?'mobile':'desktop';
 for(const [method,event] of [['setHeaderColor','web_app_set_header_color'],['setBackgroundColor','web_app_set_background_color'],['setBottomBarColor','web_app_set_bottom_bar_color']]){
  try{if(typeof telegram?.[method]==='function')telegram[method](chromeColor);else postTelegramEvent(event,{color:chromeColor});}
  catch{postTelegramEvent(event,{color:chromeColor});}
 }
 if(!telegram)return;
 for(const method of ['ready','expand']){try{if(typeof telegram[method]==='function'){telegram[method]();if(method==='ready')telegramReady=true;}}catch{console.warn(`Telegram WebApp: ${method} недоступен.`);}}
 updateTelegramInsets();
 if(configuredTelegram!==telegram){
  configuredTelegram=telegram;
  if(!isMobileClient()&&telegram.isFullscreen){try{telegram.exitFullscreen?.();}catch{/* Keep the desktop window usable on older clients. */}}
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
  wallet: icon('<path d="M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7m18 5h-5v5h5M17 14.5h.01"/>'),
  reviews: icon('<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5ZM8 11h8M8 15h5"/>'),
  bag: icon('<path d="M4 7h16l-1 14H5ZM8 8V6a4 4 0 0 1 8 0v2"/>'),
  package: icon('<path d="m12 3 9 5v9l-9 5-9-5V8ZM3 8l9 5 9-5M12 13v9M8 5l9 5"/>'),
  trash: icon('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'),
  telegram: icon('<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>'),
  previousPhoto: icon('<path d="m14 6-6 6 6 6"/>'),
  nextPhoto: icon('<path d="m10 6 6 6-6 6"/>'),
  chevron: icon('<path d="m9 5 7 7-7 7"/>'),
  check: icon('<path d="m5 12 4 4L19 6"/>')
};
const money = value => new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'RUB', maximumFractionDigits: 0
}).format(value);
const moneyMarkup = value => money(value).replace('₽', '<span class="currency-symbol">₽</span>');
const metroDeliveryFee = () => data?.metro_delivery_fee ?? 0;
const pickupAddress = 'Новосибирск, метро «Площадь Маркса», выход № 4, ТЦ «Грани».';
// Telegram's display data is used only for presentation and local cart separation.
// It never authorizes access to customers, orders or any other private API.
let user = telegram?.initDataUnsafe?.user;
const cartKeyFor = user => `gas-cart:v1:${Number.isSafeInteger(user?.id) && user.id > 0 ? user.id : 'guest'}`;
let cartKey = cartKeyFor(user);
const maxQuantity = product => Math.min(product.stock, 999);
const cartLineKey = (id, flavor) => flavor ? `${id}:${encodeURIComponent(flavor)}` : id;
const productLineName = (product, flavor) => flavor ? `${product.name} — ${flavor}` : product.name;
function cartSelection(key) {
  if (Number.isSafeInteger(key) && key > 0) return { id: key };
  const match = typeof key === 'string' && /^([1-9]\d*):(.{1,720})$/.exec(key);
  if (!match || !Number.isSafeInteger(Number(match[1]))) return null;
  try {
    const id = Number(match[1]), flavor = decodeURIComponent(match[2]);
    if (!flavor || flavor.length > 80 || key !== cartLineKey(id, flavor)) return null;
    return { id, flavor };
  } catch { return null; }
}
const flavorOption = (product, flavor) => product.flavor_options?.find(option => option.name === flavor);
function lineStock(product, flavor) {
  if (flavor === undefined) return product.flavors?.length ? product.unassigned_stock ?? 0 : product.stock;
  const option = flavorOption(product, flavor);
  return option ? option.stock ?? product.stock : product.flavors?.includes(flavor) ? product.stock : 0;
}
const linePrice = (product, flavor) => product.price + (flavorOption(product, flavor)?.markup ?? 0);
function productPriceMarkup(product) {
  const selections = [...(product.flavors ?? []), undefined];
  const prices = selections.filter(flavor => lineStock(product, flavor) > 0).map(flavor => linePrice(product, flavor));
  if (!prices.length) return moneyMarkup(product.price);
  const lowest = Math.min(...prices);
  return (lowest < Math.max(...prices) ? 'от ' : '') + moneyMarkup(lowest);
}
function cartProductQuantity(id) {
  let total = 0;
  for (const [key, quantity] of cart) {
    if (key === id || typeof key === 'string' && key.startsWith(id + ':')) total += quantity;
  }
  return total;
}
const cartLineLimit = (product, flavor, quantity) =>
  Math.min(lineStock(product, flavor), maxQuantity(product) - cartProductQuantity(product.id) + quantity);
let data, category = '', loading = false, modalVersion = 0, toastTimer;
let cart = readCart();
let categorySlide;
let categoryMenuKey;
let profileTab = 'overview', profileTransition;
let activePage = 'home', pageSwitchVersion = 0, pageTransition;
const pageScroll = { home: 0, cart: 0, profile: 0 };

function readCart() {
  try {
    const raw = localStorage.getItem(cartKey);
    if (!raw || raw.length > 80000) return new Map();
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) return new Map();
    return new Map(items.slice(0, 100).filter(item => Array.isArray(item)
      && cartSelection(item[0])
      && Number.isSafeInteger(item[1]) && item[1] > 0 && item[1] <= 999));
  } catch { return new Map(); }
}
function saveCart() {
  try { localStorage.setItem(cartKey, JSON.stringify([...cart])); } catch { /* Keep an in-memory cart when storage is unavailable. */ }
}
const cartItems = () => data ? [...cart].flatMap(([key, quantity]) => {
  const { id, flavor } = cartSelection(key);
  const product = data.products.find(item => item.id === id);
  return product && lineStock(product, flavor) > 0 ? [{ key, product, flavor, quantity, price:linePrice(product, flavor) }] : [];
}) : [];
const cartSummary = () => cartItems().reduce((total, { price, quantity }) => ({
  count: total.count + quantity, amount: total.amount + price * quantity
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
  const quantities = new Map();
  for (const [key, quantity] of cart) {
    const { id, flavor } = cartSelection(key);
    const product = data.products.find(item => item.id === id);
    const used = quantities.get(id) || 0;
    const remaining = product ? Math.min(lineStock(product, flavor),maxQuantity(product) - used) : 0;
    if (remaining <= 0) { cart.delete(key); changed = true; continue; }
    const validQuantity = Math.min(quantity, remaining);
    if (validQuantity !== quantity) { cart.set(key, validQuantity); changed = true; }
    quantities.set(id, used + validQuantity);
  }
  saveCart();
  updateBadge();
  if (changed) notify('Корзина обновлена с учётом наличия товаров');
}
function changeCart(key, delta, source) {
  const selection = cartSelection(key);
  if (!selection) return;
  const { id, flavor } = selection;
  const product = data?.products.find(item => item.id === id);
  if (!product || lineStock(product, flavor) <= 0) return;
  const previous = cart.get(key) || 0;
  const limit = cartLineLimit(product, flavor, previous);
  if (delta > 0 && previous >= limit) { notify('Достигнуто доступное количество'); return; }
  if (!previous && cart.size >= 100) { notify('В корзине может быть до 100 позиций'); return; }
  const quantity = Math.max(0, Math.min(limit, previous + delta));
  if (quantity) cart.set(key, quantity);
  else cart.delete(key);
  saveCart();
  updateBadge();
  if (delta > 0) {
    flyToCart(source);
    void animate(source, [{ transform: 'scale(.8)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }]);
    if (activePage !== 'cart' || $('#details').open) notify('Товар добавлен в корзину');
  }
  if (activePage === 'cart') {
    renderCart();
    const next = $(`[data-cart-id="${key}"][data-cart-change="${delta}"]:not(:disabled)`)
      || $(`[data-cart-id="${key}"][data-cart-change="-1"]`) || $('[data-continue]');
    if (!$('#details').open) next?.focus({ preventScroll: true });
  }
  void animate($(`[data-cart-item="${key}"] .quantity-control output`), [{ opacity: .3, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 160 });
  updateProductAddButton();
}

const isPhoto=value=>/^data:image\/(jpeg|png|webp);base64,/.test(value)||/^\/api\/images\/[a-f0-9-]{36}$/.test(value);
const photo = product => isPhoto(product.image)
  ? `<div class="photo" data-photo-fit="${['auto','contain','cover'].includes(product.image_fit)?product.image_fit:'auto'}"><img src="${escape(product.image)}" alt="${escape(product.name)}" loading="lazy" decoding="async"></div>`
  : `<div class="photo photo-empty">${icons.bag}<small>Фото скоро появится</small></div>`;
function productGallery(product){
 const images=product.images?.length?product.images:(isPhoto(product.image)?[product.image]:[]);
 if(images.length<2)return photo(product);
 return `<div class="product-gallery"><div class="gallery-stage"><div class="gallery-track" id="gallery-track" aria-label="Фотографии товара">${images.map((image,index)=>`<div class="gallery-slide">${photo({...product,image,name:`${product.name} — фото ${index+1}`})}</div>`).join('')}</div><button type="button" class="gallery-arrow gallery-prev" data-gallery-step="-1" aria-label="Предыдущее фото" disabled>${icons.previousPhoto}</button><button type="button" class="gallery-arrow gallery-next" data-gallery-step="1" aria-label="Следующее фото">${icons.nextPhoto}</button></div><div class="gallery-controls"><div class="gallery-dots">${images.map((_,index)=>`<button type="button" data-gallery-dot="${index}" aria-label="Фото ${index+1}" aria-pressed="${index===0}"></button>`).join('')}</div></div></div>`;
}
function updateGallery(){
 const track=$('#gallery-track');if(!track)return;
 const index=Math.round(track.scrollLeft/Math.max(1,track.clientWidth)),count=track.children.length;
 $('[data-gallery-step="-1"]').disabled=index===0;$('[data-gallery-step="1"]').disabled=index>=count-1;
 document.querySelectorAll('[data-gallery-dot]').forEach((dot,i)=>dot.setAttribute('aria-pressed',String(i===index)));
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
function setNav() {
  $('.bottom-nav').dataset.active = activePage === 'home' ? 'catalog' : activePage;
  for (const [id, page] of [['catalog-tab', 'home'], ['cart-tab', 'cart'], ['profile-button', 'profile']]) {
    const button = $('#' + id);
    if (activePage === page) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}
const bottomSheetViews = new Set(['product','checkout','important','reviews','review-form','reviews-sent','review-opportunities','referral','my-orders','order-detail','my-reviews']);
function show(html, view = 'info', shouldAnimate = true) {
  stopBannerAuto();
  if(view==='checkout'){clearTimeout(toastTimer);$('#toast').classList.remove('visible');}
  resetSheetGesture();
  resetCatalogPull();
  stopProfileTransition();
  modalVersion++;
  const dialog = $('#details'), content = $('#detail-content');
  const wasOpen = dialog.open;
  const scroll = dialog.scrollTop;
  dialog.getAnimations().forEach(animation => animation.cancel());
  delete dialog.dataset.closing;
  dialog.dataset.view = view;
  content.innerHTML = html;
  content.querySelector('h2').id = 'detail-title';
  setNav();
  if (!wasOpen) {
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    void animate(dialog, bottomSheetViews.has(view)?[{transform:'translateY(100%)'},{transform:'translateY(0)'}]:[{opacity:0,transform:'translateY(32px) scale(.97)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:320});
  } else if (shouldAnimate) {
    void animate(content, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180 });
  }
  dialog.scrollTop = shouldAnimate ? 0 : scroll;
  syncTelegramSwipes();
}
async function closeDetails() {
  const dialog = $('#details');
  if (!dialog.open) return;
  const from=getComputedStyle(dialog).transform;
  dialog.getAnimations().forEach(animation=>animation.cancel());
  resetSheetGesture();
  const version = ++modalVersion;
  dialog.dataset.closing = 'true';
  if(dialog.dataset.view==='promotion'){dialog.close();return;}
  await animate(dialog,bottomSheetViews.has(dialog.dataset.view)?[{transform:from==='none'?'translateY(0)':from},{transform:'translateY(100%)'}]:[{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(22px) scale(.98)'}],{duration:220});
  if (version !== modalVersion) return;
  dialog.close();
}
$('#details').addEventListener('close', () => { resetSheetGesture();scheduleBannerAuto();document.body.style.overflow = ''; delete $('#details').dataset.closing; setNav(); syncTelegramSwipes(); });
$('#details').addEventListener('cancel', event => {
  event.preventDefault();
  if ($('#checkout-metro')?.getAttribute('aria-expanded') === 'true') {
    setCheckoutMetroOpen(false);
    $('#checkout-metro').focus();
    return;
  }
  void closeDetails();
});

let sheetGesture=null,swipeOwner=null;
function holdTelegramSwipes(){
 if(swipeOwner||!telegram?.disableVerticalSwipes||telegram.isVerticalSwipesEnabled===false)return;
 try{telegram.disableVerticalSwipes();swipeOwner=telegram;}catch{/* Older Telegram clients may not support this API. */}
}
function releaseTelegramSwipes(){const owner=swipeOwner;swipeOwner=null;try{owner?.enableVerticalSwipes?.();}catch{/* Keep closing available without the SDK. */}}
function catalogAtTop(){
 return activePage==='home'&&!$('#details').open&&window.scrollY<=1;
}
function syncTelegramSwipes(){
 const dialog=$('#details');
 if(swipeOwner&&swipeOwner!==telegram)releaseTelegramSwipes();
 if(dialog.open?bottomSheetViews.has(dialog.dataset.view):catalogAtTop()&&navigator.maxTouchPoints>0)holdTelegramSwipes();
 else releaseTelegramSwipes();
}
window.addEventListener('pagehide',()=>{resetCatalogPull();releaseTelegramSwipes();});
window.addEventListener('pageshow',syncTelegramSwipes);
window.addEventListener('scroll',syncTelegramSwipes,{passive:true});
function resetSheetGesture(){sheetGesture=null;const dialog=$('#details');dialog.style.removeProperty('transform');delete dialog.dataset.dragging;}
function startSheetGesture(x,y,target,pointerId=null){
 const dialog=$('#details');
 if(!dialog.open||!bottomSheetViews.has(dialog.dataset.view)||dialog.dataset.closing||target.closest('button,a,input,textarea,select'))return;
 if(dialog.scrollTop>1&&!target.closest('.sheet-handle'))return;
 sheetGesture={x,y,dy:0,axis:null,dragging:false,time:performance.now(),samples:[],version:modalVersion,pointerId};
}
function moveSheetGesture(x,y,event){
 const gesture=sheetGesture,dialog=$('#details');if(!gesture)return;
 if(gesture.version!==modalVersion||!dialog.open||dialog.dataset.closing){resetSheetGesture();return;}
 const dx=x-gesture.x,dy=y-gesture.y;
 if(!gesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>8)gesture.axis=Math.abs(dx)>Math.abs(dy)?'horizontal':dy>0?'down':'scroll';
 if(gesture.axis!=='down'||!event.cancelable)return;
 event.preventDefault();
 if(!gesture.dragging){dialog.getAnimations().forEach(animation=>animation.cancel());gesture.dragging=true;dialog.dataset.dragging='true';}
 gesture.dy=Math.max(0,dy);const now=performance.now();gesture.samples.push({y:dy,time:now});gesture.samples=gesture.samples.filter(sample=>now-sample.time<=120);
 dialog.style.transform=`translateY(${gesture.dy}px)`;
}
function endSheetGesture(cancelled=false){
 const gesture=sheetGesture,dialog=$('#details');if(!gesture)return;
 sheetGesture=null;delete dialog.dataset.dragging;
 if(!gesture.dragging)return;
 const last=gesture.samples.at(-1),first=gesture.samples[0];
 const speed=!last||performance.now()-last.time>100?0:last.time>first.time?(last.y-first.y)/(last.time-first.time):gesture.dy/Math.max(1,performance.now()-gesture.time);
 const threshold=Math.min(140,dialog.clientHeight*0.18);
 if(!cancelled&&(gesture.dy>=threshold||(gesture.dy>45&&speed>0.65))){void closeDetails();return;}
 const from=dialog.style.transform;dialog.style.removeProperty('transform');
 void animate(dialog,[{transform:from},{transform:'translateY(0)'}],{duration:180});
}
const sheet=$('#details');
sheet.addEventListener('touchstart',event=>{if(event.touches.length!==1){endSheetGesture(true);return;}const touch=event.touches[0];startSheetGesture(touch.clientX,touch.clientY,event.target);},{passive:true});
sheet.addEventListener('touchmove',event=>{if(event.touches.length!==1){endSheetGesture(true);return;}const touch=event.touches[0];moveSheetGesture(touch.clientX,touch.clientY,event);},{passive:false});
sheet.addEventListener('touchend',()=>endSheetGesture(),{passive:true});
sheet.addEventListener('touchcancel',()=>endSheetGesture(true),{passive:true});
sheet.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse'||event.button!==0||!event.target.closest('.sheet-handle'))return;startSheetGesture(event.clientX,event.clientY,event.target,event.pointerId);if(sheetGesture)sheet.setPointerCapture(event.pointerId);});
sheet.addEventListener('pointermove',event=>{if(sheetGesture?.pointerId===event.pointerId)moveSheetGesture(event.clientX,event.clientY,event);});
sheet.addEventListener('pointerup',event=>{if(sheetGesture?.pointerId===event.pointerId)endSheetGesture();});
sheet.addEventListener('pointercancel',event=>{if(sheetGesture?.pointerId===event.pointerId)endSheetGesture(true);});
sheet.addEventListener('lostpointercapture',event=>{if(sheetGesture?.pointerId===event.pointerId)endSheetGesture(true);});

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
          <div class="product-bottom"><span class="price">${productPriceMarkup(product)}</span><span class="product-chevron" aria-hidden="true">${icons.chevron}</span></div>
        </div>
      </button>
    </article>`).join('');
  $('#status').hidden = Boolean(items.length);
  $('#status').textContent = data.products.length ? 'В этой категории пока нет товаров.' : 'Товары скоро появятся. Загляните чуть позже.';
  renderCategories(!animateProducts);
}
async function load({animateProducts=true} = {}) {
  if (loading) return false;
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
    renderBanners();
    reconcileCart();
    render(animateProducts);
    if (activePage === 'cart') renderCart();
    refreshCheckoutPayment();
    openStartProduct();
    return true;
  } catch(error) {
    const reason=error.name==='AbortError'?'Сервер не ответил за 15 секунд.':error.httpStatus?`Сервер вернул HTTP ${error.httpStatus}.`:stage==='network'?'Нет соединения с сервером.':stage==='data'?'Сервер вернул некорректные данные каталога.':'Ошибка отображения каталога.';
    console.error(`Каталог: ${reason}`,error);
    $('#status').hidden = false;
    $('#status').innerHTML = `Не удалось обновить каталог.<br>${escape(reason)}<br><button class="retry" id="retry">Повторить</button>`;
    return false;
  } finally {
    clearTimeout(timer);
    loading = false;
  }
}
const catalogPullThreshold=72;
let catalogPull=null,catalogRefreshing=false;
function resetCatalogPull(){
 catalogPull=null;
 if(!catalogRefreshing)$('#catalog-refresh').hidden=true;
}
async function refreshCatalog(){
 if(loading||!catalogAtTop())return;
 const indicator=$('#catalog-refresh');
 catalogRefreshing=true;
 indicator.hidden=false;
 indicator.dataset.refreshing='';
 indicator.style.setProperty('--catalog-pull-offset','14px');
 $('#catalog-refresh-label').textContent='Обновляем каталог…';
 try{
  const updated=await load({animateProducts:false});
  if(activePage==='home'&&!$('#details').open)notify(updated?'Каталог обновлён':'Не удалось обновить каталог');
 }finally{
  catalogRefreshing=false;
  delete indicator.dataset.refreshing;
  resetCatalogPull();
 }
}
const catalogSurface=$('.miniapp');
catalogSurface.addEventListener('touchstart',event=>{
 resetCatalogPull();
 if(loading||!catalogAtTop()||event.touches.length!==1||
    event.target.closest('.bottom-nav,input,textarea,select,[contenteditable]'))return;
 const touch=event.touches[0];
 catalogPull={x:touch.clientX,y:touch.clientY,distance:0,active:false};
},{passive:true});
catalogSurface.addEventListener('touchmove',event=>{
 const pull=catalogPull;
 if(!pull)return;
 if(event.touches.length!==1||!catalogAtTop()||!event.cancelable){resetCatalogPull();return;}
 const touch=event.touches[0],dx=Math.abs(touch.clientX-pull.x),dy=touch.clientY-pull.y;
 if(!pull.active){
  if(Math.max(dx,Math.abs(dy))<8)return;
  if(dy<=dx){resetCatalogPull();return;}
  pull.active=true;
 }
 event.preventDefault();
 pull.distance=Math.max(0,dy);
 const indicator=$('#catalog-refresh');
 indicator.hidden=false;
 indicator.style.setProperty('--catalog-pull-offset',`${Math.min(48,pull.distance*.40+4)}px`);
 indicator.style.setProperty('--catalog-pull-angle',`${Math.min(360,pull.distance*5)}deg`);
 const label=$('#catalog-refresh-label');
 const text=pull.distance>=catalogPullThreshold?'Отпустите для обновления':'Потяните для обновления';
 if(label.textContent!==text)label.textContent=text;
},{passive:false});
catalogSurface.addEventListener('touchend',()=>{
 const refresh=catalogPull?.distance>=catalogPullThreshold;
 resetCatalogPull();
 if(refresh)void refreshCatalog();
},{passive:true});
catalogSurface.addEventListener('touchcancel',resetCatalogPull,{passive:true});
let bannerIndex=0,bannerObserver,bannerWidth=0,bannerFrame=0,bannerSettleTimer,bannerAutoTimer,bannerTouching=false;
const bannerLoop=()=>data?.banners.length>1;
const bannerOffset=()=>bannerLoop()?1:0;
function stopBannerAuto(){clearTimeout(bannerAutoTimer);}
function scheduleBannerAuto(){
 stopBannerAuto();
 if(!bannerLoop()||document.hidden)return;
 bannerAutoTimer=setTimeout(()=>{
  if(!bannerTouching&&!$('#details').open&&activePage==='home')goToBanner(bannerIndex+1);
  else scheduleBannerAuto();
 },7000);
}
function updateBannerPosition(force=false){
 const track=$('#banner-track');if(!track||!data?.banners.length)return;
 const physical=Math.max(0,Math.min(track.children.length-1,Math.round(track.scrollLeft/Math.max(1,bannerWidth))));
 const index=(physical-bannerOffset()+data.banners.length)%data.banners.length;
 if(force||index!==bannerIndex||track.dataset.physical!==String(physical)){
  bannerIndex=index;track.dataset.physical=physical;
  [...track.children].forEach((slide,i)=>{
   slide.setAttribute('aria-hidden',String(i!==physical));slide.querySelector('button').tabIndex=i===physical?0:-1;
   if(Math.abs(i-physical)<=1){const image=slide.querySelector('img');if(image)image.loading='eager';}
  });
  document.querySelectorAll('[data-banner-dot]').forEach((dot,i)=>dot.setAttribute('aria-pressed',String(i===index)));
 }
}
function finishBannerScroll(){
 clearTimeout(bannerSettleTimer);
 const track=$('#banner-track');if(!track||bannerTouching)return;
 updateBannerPosition();
 if(bannerLoop()){
  const physical=Math.round(track.scrollLeft/Math.max(1,bannerWidth));
  if(physical===0||physical===track.children.length-1){track.scrollLeft=(bannerIndex+1)*bannerWidth;updateBannerPosition(true);}
 }
 scheduleBannerAuto();
}
function scrollBanner(){
 stopBannerAuto();clearTimeout(bannerSettleTimer);
 if(!bannerFrame)bannerFrame=requestAnimationFrame(()=>{bannerFrame=0;updateBannerPosition();});
 bannerSettleTimer=setTimeout(finishBannerScroll,160);
}
function resizeBanners(){
 const track=$('#banner-track');if(!track)return;
 const width=track.clientWidth;
 if(!width||width===bannerWidth)return;
 bannerWidth=width;
 track.scrollLeft=(bannerIndex+bannerOffset())*width;updateBannerPosition(true);
}
function goToBanner(index){
 const track=$('#banner-track');if(!track||!data.banners.length)return;
 stopBannerAuto();
 const count=data.banners.length,target=(index%count+count)%count;
 let physical=target+bannerOffset();
 if(bannerLoop()&&bannerIndex===0&&index===-1)physical=0;
 else if(bannerLoop()&&bannerIndex===count-1&&index===count)physical=count+1;
 track.scrollTo({left:physical*track.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 scheduleBannerAuto();
}
function renderBanners(){
 bannerObserver?.disconnect();stopBannerAuto();clearTimeout(bannerSettleTimer);cancelAnimationFrame(bannerFrame);bannerFrame=0;bannerIndex=0;bannerWidth=0;bannerTouching=false;
 const banners=data.banners,root=$('#banner');root.hidden=!banners.length;root.classList.remove('has-image');root.replaceChildren();
 if(!banners.length)return;
 const slides=bannerLoop()?[banners.at(-1),...banners,banners[0]]:banners;
 root.innerHTML=`<div class="banner-track" id="banner-track" role="group" aria-roledescription="карусель" aria-label="Акции магазина">${slides.map((banner,physical)=>{
  const index=banners.indexOf(banner),image=/^data:image\/(jpeg|png|webp);base64,|^\/api\/banner-images\//.test(banner.image);
  return `<div class="banner-slide ${image?'has-image':''}" role="group" aria-label="Акция ${index+1} из ${banners.length}"><button type="button" class="banner-open ${image?'':'banner-text'}" data-banner="${banner.id}" aria-label="Подробнее об акции: ${escape(banner.title)}">${image?`<img class="banner-image" draggable="false" src="${escape(banner.image)}" alt="${escape(banner.title)}" decoding="async" loading="${physical<=2?'eager':'lazy'}">`:`<span class="banner-copy"><h2>${escape(banner.title)}</h2><p>${escape(banner.subtitle)}</p></span><span class="banner-link" aria-hidden="true">${icons.arrow}</span>`}</button></div>`;
 }).join('')}</div>${banners.length>1?`<div class="banner-navigation" aria-label="Листание акций"><button type="button" data-banner-step="-1" aria-label="Предыдущий баннер">${icons.previousPhoto}</button><div class="banner-dots">${banners.map((_,index)=>`<button type="button" data-banner-dot="${index}" aria-label="Показать баннер ${index+1}" aria-pressed="${index===0}"></button>`).join('')}</div><button type="button" data-banner-step="1" aria-label="Следующий баннер">${icons.nextPhoto}</button></div>`:''}`;
 const track=$('#banner-track');track.addEventListener('scroll',scrollBanner,{passive:true});track.addEventListener('scrollend',finishBannerScroll,{passive:true});
 track.addEventListener('touchstart',()=>{bannerTouching=true;stopBannerAuto();},{passive:true});
 for(const event of ['touchend','touchcancel'])track.addEventListener(event,e=>{bannerTouching=e.touches.length>0;if(!bannerTouching){clearTimeout(bannerSettleTimer);bannerSettleTimer=setTimeout(finishBannerScroll,160);}},{passive:true});
 if(window.ResizeObserver){bannerObserver=new ResizeObserver(resizeBanners);bannerObserver.observe(track);}
 resizeBanners();scheduleBannerAuto();
}
window.addEventListener('resize',resizeBanners);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopBannerAuto();else scheduleBannerAuto();});
window.addEventListener('pagehide',stopBannerAuto);
window.addEventListener('pageshow',scheduleBannerAuto);
function openBanner(id){
 const banner=data?.banners.find(banner=>banner.id===id);if(!banner)return;
 const image=/^data:image\/(jpeg|png|webp);base64,|^\/api\/banner-images\//.test(banner.image)?`<img class="promotion-image" src="${escape(banner.image)}" alt="${escape(banner.title)}">`:'';
 show(`${image}<div class="promotion-copy ${image&&!banner.subtitle&&!banner.description?'promotion-copy-empty':''}"><h2>${escape(banner.title)}</h2>${banner.subtitle?`<p>${escape(banner.subtitle)}</p>`:''}${formatted(banner.description)}</div>`,'promotion');
}
let browserVisitor;
function visitorId(){if(browserVisitor)return browserVisitor;try{browserVisitor=localStorage.getItem('gas-visitor:v1');}catch{}if(!/^[a-f0-9]{64}$/.test(browserVisitor||'')){browserVisitor=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');try{localStorage.setItem('gas-visitor:v1',browserVisitor);}catch{}}return browserVisitor;}
async function shareProduct(id){
 const product=data?.products.find(item=>item.id===id);if(!product)return;
 const bot=data.shop?.botUsername||'gas_shop_vape_bot',url=`https://t.me/${bot}?startapp=product_${id}`;
 const path=`/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(product.name)}`;
 try{
  if(typeof telegram?.openTelegramLink==='function')telegram.openTelegramLink('https://t.me'+path);
  else if(window.TelegramWebviewProxy?.postEvent||window.external?.notify||window.parent!==window)postTelegramEvent('web_app_open_tg_link',{path_full:path});
  else window.open('https://t.me'+path,'_blank','noopener,noreferrer');
 }catch{notify('Не удалось открыть чаты Telegram.');}
}
let startProductHandled=false;
function openStartProduct(){if(startProductHandled)return;const start=telegram?.initDataUnsafe?.start_param||new URLSearchParams(location.hash.slice(1)).get('tgWebAppStartParam')||new URL(location.href).searchParams.get('product');const match=/^(?:product_)?(\d+)$/.exec(start||'');if(match){startProductHandled=true;openProduct(Number(match[1]));}}
function quantityControls(key, name, quantity, canAdd) {
  return `<div class="quantity-control">
    <button data-cart-id="${escape(key)}" data-cart-change="-1" aria-label="Уменьшить количество: ${escape(name)}" ${quantity?'':'disabled'}>${icons.minus}</button>
    <output aria-label="Количество: ${escape(name)}">${quantity}</output>
    <button data-cart-id="${escape(key)}" data-cart-change="1" aria-label="Увеличить количество: ${escape(name)}" ${canAdd?'':'disabled'}>${icons.plus}</button>
  </div>`;
}
function productFlavorRows(product) {
  const selections = product.unassigned_stock > 0 ? [...product.flavors, undefined] : product.flavors;
  return `<section class="product-flavors" id="product-flavors">
    <h3>Вкусы</h3>
    ${selections.map(flavor=>{
      const key=cartLineKey(product.id,flavor);
      const name=flavor??'Без выбора вкуса';
      const quantity=cart.get(key)||0;
      const stock=lineStock(product,flavor);
      const price=linePrice(product,flavor);
      const info=[...(product.flavor_stock_tracked || price!==product.price ? [moneyMarkup(price)] : []),
        ...(product.flavor_stock_tracked ? [stock ? `В наличии ${stock} шт.` : 'Нет в наличии'] : [])].join(' · ');
      return `<div class="product-flavor-row" data-flavor-key="${escape(key)}">
        <div><strong>${escape(name)}</strong>${info?`<small>${info}</small>`:''}</div>${quantityControls(key,name,quantity,quantity<cartLineLimit(product,flavor,quantity))}
      </div>`;
    }).join('')}
  </section>`;
}
function openProduct(id, { toReviews = false } = {}) {
  const product = data?.products.find(item => item.id === id);
  if (!product) return;
  $('#details').dataset.productId = id;
  const description = formatted(product.short_description) + formatted(product.description);
  show(`${productGallery(product)}<div class="product-title-row"><h2>${escape(product.name)}</h2><div class="product-title-actions"><button type="button" class="product-share" data-share-product="${product.id}" aria-label="Поделиться товаром">${icons.telegram}<span>Поделиться</span></button><button type="button" class="product-close" data-product-close aria-label="Закрыть товар">${icon('<path d="m6 6 12 12M18 6 6 18"/>')}</button></div></div><strong class="price">${productPriceMarkup(product)}</strong>
    <p class="detail-stock">${product.stock > 0 ? 'В наличии' : 'Нет в наличии'}</p>
    ${product.flavors?.length?productFlavorRows(product):`${description}<button class="primary-button" id="product-add" data-add="${product.id}">${icons.bag}<span>Добавить в корзину</span></button>
      <div id="product-quantity" hidden>${quantityControls(product.id,product.name,0,true)}</div>`}<button class="secondary-button" id="product-cart" data-open-cart hidden>Открыть корзину ${icons.arrow}</button>${product.flavors?.length?description:''}<section class="product-review-section" id="product-reviews"><h3>Отзывы</h3><p>Загружаем отзывы…</p></section>`, 'product');
  $('#gallery-track')?.addEventListener('scroll',updateGallery,{passive:true});
  updateProductAddButton();
  void loadProductReviews(id);
  if(toReviews){$('#product-reviews').scrollIntoView({block:'start'});return;}
  fetch(`/api/storefront/products/${product.id}/view`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({visitor_id:visitorId(),init_data:telegram?.initData||''})}).catch(()=>{});
}
function updateProductAddButton() {
  const dialog = $('#details');
  if (!dialog.open || dialog.dataset.view !== 'product') return;
  $('#product-cart').hidden = cartSummary().count === 0;
  const product = data.products.find(item => item.id === Number(dialog.dataset.productId));
  if (!product) return;
  const updateControls = (root, key, flavor) => {
    const quantity = cart.get(key) || 0;
    root.querySelector('output').value = quantity;
    root.querySelector('[data-cart-change="-1"]').disabled = quantity === 0;
    root.querySelector('[data-cart-change="1"]').disabled = quantity >= cartLineLimit(product,flavor,quantity);
  };
  const button = $('#product-add');
  if (!button) {
    dialog.querySelectorAll('[data-flavor-key]').forEach(row=>{
      const key = row.dataset.flavorKey.includes(':') ? row.dataset.flavorKey : Number(row.dataset.flavorKey);
      updateControls(row,key,cartSelection(key).flavor);
    });
    return;
  }
  const quantity = cart.get(product.id) || 0;
  const controls = $('#product-quantity');
  const focused = document.activeElement;
  updateControls(controls,product.id,undefined);
  button.hidden = quantity > 0;
  controls.hidden = quantity === 0;
  if (button.hidden && focused === button) {
    (controls.querySelector('[data-cart-change="1"]:not(:disabled)') || controls.querySelector('button')).focus({preventScroll:true});
  } else if (controls.hidden && controls.contains(focused)) button.focus({preventScroll:true});
}
async function reviewRequest(url,options={},timeout=15000){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try {
  const response=await fetch(url,{...options,signal:controller.signal});
  let result;
  try{result=await response.json();}
  catch(error){
   if(error.name!=='SyntaxError')throw error;
   const invalid=new Error(response.ok?'Сервер вернул неожиданный ответ.':'Сервер не смог выполнить запрос.');
   if(!response.ok)invalid.status=response.status;
   throw invalid;
  }
  if(!response.ok){
   const error=new Error(result?.error||'Не удалось выполнить запрос.');
   error.status=response.status;
   throw error;
  }
  return result;
 }catch(error){
  if(error.name==='AbortError')throw new Error('Сервер не ответил. Проверьте соединение и повторите.');
  if(error instanceof TypeError)throw new Error('Нет соединения с сервером. Повторите запрос.');
  throw error;
 }finally{clearTimeout(timer);}
}
async function requestPublicReviews(url,isCurrent){
 try{return await reviewRequest(url,{},8000);}
 catch(error){
  if(!isCurrent()||(error.status&&![408,500,502,503,504].includes(error.status)))throw error;
  await new Promise(resolve=>setTimeout(resolve,350));
  if(!isCurrent())throw error;
  return reviewRequest(url,{},8000);
 }
}
function dialogViewOpen(view){
 const dialog=$('#details');
 return dialog.open&&dialog.dataset.view===view&&!dialog.dataset.closing;
}
let reviewIdentity=telegram?.initData||'';
let reviewFeed={sort:'newest',media:false,items:[],total:0,average:0,next:null,loading:false,error:'',version:0};
let reviewDraft=null,reviewEligibility={key:null,items:[],next:null,loaded:false},reviewExpiryTimer;
let reviewEligibilityVersion=0;
const reviewDate=value=>new Date(value).toLocaleDateString('ru-RU');
const reviewCountLabel=value=>`${value} ${{one:'отзыв',few:'отзыва',many:'отзывов',other:'отзывов'}[new Intl.PluralRules('ru').select(value)]}`;
function reviewMediaMarkup(review){return review.media?.length?`<div class="review-media-list">${review.media.map(file=>file.type==='video'?`<video src="${escape(file.url)}" controls playsinline preload="none" aria-label="Видео к отзыву"></video>`:`<img src="${escape(file.url)}" alt="Фото к отзыву о товаре ${escape(review.product_name)}" loading="lazy" decoding="async">`).join('')}</div>`:'';}
function reviewCard(review,{own=false,showProduct=true}={}){
 const rating=Math.max(0,Math.min(5,Math.trunc(Number(review.rating)||0))),statuses={pending:'На модерации',published:'Опубликован',hidden:'Скрыт'};
 return `<article class="review review-card${own?' my-review':''}"><div class="review-author-row"><strong>${escape(review.author_name||'Покупатель')}</strong><time datetime="${escape(review.created_at)}">${reviewDate(review.created_at)}</time></div><div class="review-stars" aria-label="Оценка ${rating} из 5">${'★'.repeat(rating)}${'☆'.repeat(5-rating)}</div>${showProduct?`<div class="review-product-name">${escape(review.product_name)}</div>`:''}${own?`<span class="my-review-status">${escape(statuses[review.status]||review.status)}</span>`:''}${reviewMediaMarkup(review)}${review.text?`<p>${escape(review.text)}</p>`:''}</article>`;
}
function pendingReview(owner=cartKey){try{const item=JSON.parse(localStorage.getItem('gas-review-pending:'+owner));return item&&typeof item.request_key==='string'&&Number.isSafeInteger(item.order_id)&&Number.isSafeInteger(item.product_id)?item:null;}catch{return null;}}
function validReviewChoices(){return reviewEligibility.key===(telegram?.initData||'')?reviewEligibility.items.filter(item=>Date.parse(item.expires_at)>Date.now()):[];}
function reviewWriteButton(){
 const pending=pendingReview(),choices=validReviewChoices();
 if(pending)return `<button class="primary-button" data-write-review="">Проверить отправку отзыва</button>`;
 if(!choices.length)return '';
 const expires=new Date(Math.max(...choices.map(item=>Date.parse(item.expires_at)))).toISOString();
 return `<button class="primary-button" data-write-review="" data-review-expires="${expires}">Оставить отзыв</button>`;
}
function scheduleReviewExpiry(){
 clearTimeout(reviewExpiryTimer);
 const dates=[...document.querySelectorAll('[data-review-expires]')].map(node=>Date.parse(node.dataset.reviewExpires)).filter(Number.isFinite);
 if(!dates.length)return;
 reviewExpiryTimer=setTimeout(()=>{
  document.querySelectorAll('[data-review-expires]').forEach(node=>{if(Date.parse(node.dataset.reviewExpires)<=Date.now())node.remove();});
  if(reviewDraft&&$('#details').open&&$('#details').dataset.view==='review-form'&&!reviewDraft.locked&&!reviewDraft.busy)renderReviewForm();
  if($('#details').open&&$('#details').dataset.view==='review-opportunities')renderReviewOpportunities();
  scheduleReviewExpiry();
 },Math.max(20,Math.min(...dates)-Date.now()+20));
}
async function refreshReviewEligibility(){
 const key=telegram?.initData||'',version=reviewEligibilityVersion+1;
 if(!key)return;
 try{await loadReviewEligibility();}catch{if(key===(telegram?.initData||'')&&version===reviewEligibilityVersion)reviewEligibility={key:null,items:[],next:null,loaded:false};}
}
async function loadReviewEligibility(productId=null,append=false){
 const key=telegram?.initData||'';if(!key)return {items:[],next_offset:null,total:0,next_expiry:null};
 const version=productId?null:++reviewEligibilityVersion;
 const result=await reviewRequest('/api/storefront/reviews/eligible',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({init_data:key,...(productId?{product_id:productId}:{}),...(append?{offset:typeof append==='number'?append:reviewEligibility.next}: {})})});
 if(key!==(telegram?.initData||''))return {items:[],next_offset:null,total:0,next_expiry:null};
 if(!productId&&version===reviewEligibilityVersion){reviewEligibility={key,items:append?[...reviewEligibility.items,...result.items]:result.items,next:result.next_offset,loaded:true,total:result.total,next_expiry:result.next_expiry};const slot=$('#my-review-write-slot');if(slot){slot.innerHTML=reviewWriteButton();scheduleReviewExpiry();}}
 return result;
}
function renderReviewFeed(){
 const state=reviewFeed;
 show(`<h2>Отзывы</h2>
 <div class="review-filters"><label for="review-sort">Сортировка<select id="review-sort"><option value="newest" ${state.sort==='newest'?'selected':''}>Сначала новые</option><option value="oldest" ${state.sort==='oldest'?'selected':''}>Сначала старые</option><option value="rating_asc" ${state.sort==='rating_asc'?'selected':''}>Сначала с низкой оценкой</option><option value="rating_desc" ${state.sort==='rating_desc'?'selected':''}>Сначала с высокой оценкой</option></select></label><label class="review-media-filter"><input id="review-media-only" type="checkbox" ${state.media?'checked':''}>С медиа</label></div>
 ${state.total?`<p class="review-summary">${reviewCountLabel(state.total)} · ${Number(state.average).toLocaleString('ru-RU',{maximumFractionDigits:1})} ★</p>`:''}
 <div class="reviews-feed">${state.items.map(review=>reviewCard(review)).join('')||(!state.loading&&!state.error?'<p>Отзывов пока нет.</p>':'')}</div>
 ${state.error?`<div class="profile-error" role="alert"><p>${escape(state.error)}</p><button class="secondary-button" data-review-retry>Повторить</button></div>`:''}
 ${state.loading?'<p role="status">Загружаем отзывы…</p>':''}${state.next!==null&&!state.error?`<button class="secondary-button" data-review-more ${state.loading?'disabled':''}>Показать ещё</button>`:''}`, 'reviews',false);
 scheduleReviewExpiry();
}
async function loadReviewFeed(more=false){
 const state=reviewFeed,version=++state.version;
 state.loading=true;
 state.error='';
 if(!more){state.items=[];state.total=0;state.next=null;}
 renderReviewFeed();
 const isCurrent=()=>reviewFeed===state&&state.version===version&&dialogViewOpen('reviews');
 try{
  const query=new URLSearchParams({sort:state.sort,media:state.media?'1':'0',offset:String(more?state.next:0)});
  const result=await requestPublicReviews('/api/storefront/reviews?'+query,isCurrent);
  if(!isCurrent())return;
  state.items=more?[...state.items,...result.items]:result.items;
  state.total=result.total;state.average=result.average;state.next=result.next_offset;
 }catch(error){if(isCurrent())state.error=error.message;}
 finally{if(isCurrent()){state.loading=false;renderReviewFeed();}}
}
let reviewOpportunities=null;
function renderReviewOpportunities(){
 const state=reviewOpportunities;if(!state||state.key!==(telegram?.initData||''))return;
 state.items=state.items.filter(item=>Date.parse(item.expires_at)>Date.now());
 show(`<h2>Оставить отзыв</h2><p class="review-rule">Выберите купленный товар. Отзыв можно оставить в течение 7 дней после выполнения заказа.</p>
 ${!state.key?'<p>Откройте магазин через Telegram, чтобы увидеть товары, на которые можно оставить отзыв.</p>':''}
 ${pendingReview()?'<button class="primary-button" data-write-review="">Проверить отправку отзыва</button>':''}
 ${state.error?`<div class="profile-error" role="alert"><p>${escape(state.error)}</p><button class="secondary-button" data-review-opportunities>Повторить</button></div>`:''}
 <div class="review-opportunities">${state.items.map(item=>`<article class="review-opportunity" data-review-expires="${item.expires_at}"><strong>${escape(item.product_name)}</strong><p>Заказ #${item.order_id} · выполнен ${reviewDate(item.completed_at)}</p><p>Можно оставить до ${new Date(item.expires_at).toLocaleString('ru-RU')}</p><button class="primary-button" data-review-purchase="${item.order_id}:${item.product_id}">Написать отзыв</button></article>`).join('')}</div>
 ${state.loading?'<p role="status">Проверяем выполненные заказы…</p>':state.key&&!state.error&&!state.items.length?'<p>Сейчас нет товаров, на которые можно оставить отзыв.</p>':''}
 ${state.next!==null?`<button class="secondary-button" data-more-review-opportunities ${state.loading?'disabled':''}>Показать ещё</button>`:''}`, 'review-opportunities',false);
 scheduleReviewExpiry();
}
async function openReviewOpportunities(more=false){
 if(more&&reviewOpportunities?.loading)return;
 const state=more?reviewOpportunities:{key:telegram?.initData||'',items:[],next:null,loading:false,error:''};reviewOpportunities=state;
 state.loading=Boolean(state.key);state.error='';renderReviewOpportunities();if(!state.key)return;
 try{const result=await loadReviewEligibility(null,more?state.next:false);if(reviewOpportunities!==state||state.key!==(telegram?.initData||''))return;state.items=more?[...state.items,...result.items]:result.items;state.next=result.next_offset;}
 catch(error){if(reviewOpportunities===state)state.error=error.message;}
 finally{state.loading=false;if(reviewOpportunities===state&&$('#details').open&&$('#details').dataset.view==='review-opportunities')renderReviewOpportunities();}
}

function openReviewFeed(){
 reviewFeed={sort:'newest',media:false,items:[],total:0,average:0,next:null,loading:false,error:'',version:0};
 void loadReviewFeed();
}
function loadProductReviews(id){
 const container=$('#product-reviews');
 if(!container)return;
 container.innerHTML='<h3>Отзывы</h3><div class="product-review-list"></div><div class="product-review-pagination"></div><div class="product-write-review"></div>';
 const list=container.querySelector('.product-review-list');
 const pagination=container.querySelector('.product-review-pagination');
 const isCurrent=()=>list.isConnected&&dialogViewOpen('product');
 async function loadPage(offset){
  pagination.innerHTML='<p role="status">Загружаем отзывы…</p>';
  try {
   const result=await requestPublicReviews(`/api/storefront/reviews?product_id=${id}&offset=${offset}`,isCurrent);
   if(!isCurrent())return;
   if(offset===0 && result.total){
    const average=Number(result.average).toLocaleString('ru-RU',{maximumFractionDigits:1});
    container.querySelector('h3').innerHTML=`Отзывы <span>${result.total} · ${average} ★</span>`;
   }
   const cards=result.items.map(review=>reviewCard(review,{showProduct:false})).join('');
   list.insertAdjacentHTML('beforeend',cards||(!offset?'<p>Об этом товаре пока нет отзывов.</p>':''));
   pagination.replaceChildren();
   if(result.next_offset!==null){
    pagination.innerHTML='<button class="secondary-button">Показать ещё отзывы</button>';
    pagination.firstElementChild.onclick=()=>void loadPage(result.next_offset);
   }
  } catch {
   if(!isCurrent())return;
   pagination.innerHTML='<p role="alert">Не удалось загрузить отзывы.</p><button class="secondary-button">Повторить</button>';
   pagination.querySelector('button').onclick=()=>void loadPage(offset);
  }
 }
 void loadPage(0);
 void updateProductReviewButton(id);
}
async function updateProductReviewButton(id){
 const slot=$('#product-reviews .product-write-review');
 if(!slot)return;
 slot.replaceChildren();
 try {
  const eligible=await loadReviewEligibility(id);
  if(!slot.isConnected||!dialogViewOpen('product')||!eligible.items.length)return;
  const expires=eligible.items.reduce((last,item)=>item.expires_at>last?item.expires_at:last,'');
  slot.innerHTML=`<button class="primary-button" data-write-review="${id}" data-review-expires="${expires}">Оставить отзыв</button>`;
  scheduleReviewExpiry();
 }catch{}
}
async function openReviewForm(productId=null,orderId=null,origin=$('#details').dataset.view){
 const pending=pendingReview();
 reviewFeed.version++;
 reviewDraft=pending?{...pending,files:[],choices:[],next:null,locked:true,busy:false,productId,error:''}:{request_key:crypto.randomUUID(),rating:0,text:'',files:[],choices:[],next:null,locked:false,busy:false,productId,error:'',loading:true};
 const draft=reviewDraft;draft.origin=origin;renderReviewForm();
 if(pending)return;
 try{let result=await loadReviewEligibility(productId);while(orderId&&!result.items.some(item=>item.order_id===orderId)&&result.next_offset!==null){const page=await loadReviewEligibility(productId,result.next_offset);if(reviewDraft!==draft)return;result={...page,items:[...result.items,...page.items]};}if(reviewDraft!==draft)return;draft.choices=result.items;draft.next=result.next_offset;draft.loading=false;const selected=orderId?draft.choices.find(item=>item.order_id===orderId&&item.product_id===productId):draft.choices[0];draft.selected=selected?`${selected.order_id}:${selected.product_id}`:'';if(orderId&&!selected)draft.error='Этот товар больше недоступен для отзыва.';}
 catch(error){if(reviewDraft===draft){draft.loading=false;draft.error=error.message;}}
 if(reviewDraft===draft&&$('#details').open&&$('#details').dataset.view==='review-form')renderReviewForm();
}
function renderReviewForm(){
 const draft=reviewDraft;if(!draft)return;
 draft.choices=draft.choices.filter(choice=>Date.parse(choice.expires_at)>Date.now());
 if(!draft.choices.some(choice=>`${choice.order_id}:${choice.product_id}`===draft.selected)&&!draft.locked){if(draft.selected){draft.error='Срок для выбранного товара истёк. Выберите другой купленный товар.';draft.files=[];}draft.selected='';}
 show(`<h2>Оставить отзыв</h2><button class="profile-back" data-review-back>${icons.previousPhoto}К отзывам</button>
 ${draft.error?`<div class="profile-error" role="alert">${escape(draft.error)}</div>`:''}
 ${draft.locked?'<p>Проверим отправленный отзыв. Повторная отправка не создаст второй отзыв.</p>':draft.loading?'<p role="status">Проверяем выполненные заказы…</p>':!draft.choices.length?'<p>Сейчас нет товаров, доступных для отзыва. Отзыв можно оставить в течение 7 дней после выполнения заказа.</p>':''}
 ${!draft.locked&&draft.choices.length?`<label class="review-field" for="review-purchase">Купленный товар<select id="review-purchase" ${draft.busy?'disabled':''}><option value="" ${!draft.selected?'selected':''}>Выберите купленный товар</option>${draft.choices.map(choice=>`<option value="${choice.order_id}:${choice.product_id}" data-review-expires="${choice.expires_at}" ${draft.selected===`${choice.order_id}:${choice.product_id}`?'selected':''}>${escape(choice.product_name)} · заказ #${choice.order_id}</option>`).join('')}</select></label>${draft.selected?`<p class="review-rule">Доступно до ${new Date(draft.choices.find(choice=>`${choice.order_id}:${choice.product_id}`===draft.selected).expires_at).toLocaleString('ru-RU')}</p>`:''}
 <div class="review-rating" role="group" aria-label="Оценка товара">${[1,2,3,4,5].map(value=>`<button type="button" data-review-rating="${value}" aria-label="Оценка ${value} из 5" aria-pressed="${draft.rating===value}" ${draft.busy?'disabled':''} class="${value<=draft.rating?'selected':''}">★</button>`).join('')}</div>
 <label class="review-field" for="review-text">Ваш отзыв<textarea id="review-text" maxlength="2000" rows="4" placeholder="Поделитесь впечатлениями (необязательно)" ${draft.busy?'disabled':''}>${escape(draft.text)}</textarea></label>
 <label class="review-file-label">Добавить фото или видео<input id="review-files" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple ${draft.busy?'disabled':''}></label><p class="review-rule">До 5 файлов. Видео — до 20 МБ, все файлы вместе — до 40 МБ.</p>
 <div class="review-draft-media">${draft.files.map((file,index)=>`<div>${file.type==='video'?`<video src="${escape(file.url)}" controls playsinline preload="none"></video>`:`<img src="${escape(file.url)}" alt="Приложенное фото">`}<button type="button" class="secondary-button" data-remove-review-file="${index}" ${draft.busy?'disabled':''}>Убрать</button></div>`).join('')}</div>`:''}
 ${draft.next!==null&&!draft.locked?`<button class="secondary-button" data-review-more-choices ${draft.busy?'disabled':''}>Показать ещё купленные товары</button>`:''}
 ${draft.choices.length||draft.locked?`<button class="primary-button" data-review-submit ${draft.busy||(!draft.locked&&!draft.selected)?'disabled':''}>${draft.busy?escape(draft.progress||'Отправляем…'):draft.locked?'Проверить отправку':'Отправить отзыв'}</button>`:''}`, 'review-form',false);
 scheduleReviewExpiry();
}
async function prepareReviewFile(file){
 if(file.type.startsWith('image/')){
  const bitmap=await createImageBitmap(file);
  try{const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось подготовить фото.')),'image/jpeg',.82));}finally{bitmap.close();}
 }
 if(!['video/mp4','video/webm','video/quicktime'].includes(file.type))throw new Error('Выберите фото JPG, PNG, WebP или видео MP4, WebM, MOV.');
 if(file.size>20*1024*1024)throw new Error('Видео должно быть не больше 20 МБ.');return file;
}
async function uploadReviewFiles(files){
 const draft=reviewDraft;if(!draft||draft.busy||draft.locked)return;
 if(draft.files.length+files.length>5){draft.error='Можно добавить до 5 фото или видео.';renderReviewForm();return;}
 const choice=draft.choices.find(item=>`${item.order_id}:${item.product_id}`===draft.selected);if(!choice)return;
 draft.busy=true;draft.error='';
 try{for(let index=0;index<files.length;index++){
   draft.progress=`Загружаем файл ${index+1} из ${files.length}…`;if($('#details').dataset.view==='review-form')renderReviewForm();
   const blob=await prepareReviewFile(files[index]);if(reviewDraft!==draft)return;if(draft.files.reduce((sum,file)=>sum+file.size,0)+blob.size>40*1024*1024)throw new Error('Общий размер медиа — не более 40 МБ.');
   const result=await reviewRequest(`/api/storefront/reviews/${choice.order_id}/${choice.product_id}/media`,{method:'POST',headers:{'Content-Type':blob.type,'X-Telegram-Init-Data':telegram?.initData||''},body:blob},75000);
   if(reviewDraft!==draft)return;draft.files.push(result.media);
  }}catch(error){draft.error=error.message;}
 finally{draft.busy=false;if(reviewDraft===draft&&$('#details').open&&$('#details').dataset.view==='review-form')renderReviewForm();}
}
async function submitReview(){
 const draft=reviewDraft;if(!draft||draft.busy)return;
 if(!draft.locked&&!draft.rating){draft.error='Выберите оценку от 1 до 5 звёзд.';renderReviewForm();return;}
 const selected=draft.choices.find(choice=>`${choice.order_id}:${choice.product_id}`===draft.selected);
 if(!draft.locked&&!selected)return;
 const body=draft.locked?{request_key:draft.request_key,order_id:draft.order_id,product_id:draft.product_id,rating:draft.rating,text:draft.text,media_ids:draft.media_ids}:{request_key:draft.request_key,order_id:selected.order_id,product_id:selected.product_id,rating:draft.rating,text:draft.text,media_ids:draft.files.map(file=>file.id)};
 const owner=cartKey;draft.busy=true;draft.error='';draft.progress='Отправляем отзыв…';renderReviewForm();
 try{localStorage.setItem('gas-review-pending:'+owner,JSON.stringify(body));}catch{}
 try{
  const result=await reviewRequest('/api/storefront/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,init_data:telegram?.initData||''})},20000);
  try{localStorage.removeItem('gas-review-pending:'+owner);}catch{}
  if(owner!==cartKey||reviewDraft!==draft)return;
  profileState={key:'',status:'idle'};reviewEligibilityVersion++;reviewEligibility={key:null,items:[],next:null,loaded:false};void refreshReviewEligibility();reviewDraft=null;
  if($('#details').open&&$('#details').dataset.view==='review-form')show(`<h2>Отзыв отправлен</h2><p>${result.review.status==='published'?'Отзыв опубликован.':'Отзыв появится после модерации.'}</p>${draft.origin==='review-opportunities'?'<button class="primary-button" data-review-opportunities>К доступным отзывам</button>':'<button class="primary-button" data-my-reviews>Мои отзывы</button>'}`,'reviews-sent');
 }catch(error){draft.error=error.message;if(error.status>=400&&error.status<500&&error.status!==401){try{localStorage.removeItem('gas-review-pending:'+owner);}catch{}}if(pendingReview(owner)){Object.assign(draft,body,{locked:true});}}
 finally{draft.busy=false;if(reviewDraft===draft&&$('#details').open&&$('#details').dataset.view==='review-form')renderReviewForm();}
}

const referralStatuses={pending:'В ожидании',successful:'Успешные',rejected:'Отклонённые'};
let referralView;
function renderReferrals(){
 const view=referralView;
 const active=document.activeElement;
 const focused=$('#details').dataset.view==='referral'&&active?.matches('[data-referral-tab],[data-referral-status]');
 const result=view.result;
 const info=`
  <section class="referral-card">
   <label for="referral-link">Твоя реферальная ссылка</label>
   ${result?.link?`<div class="referral-link-row"><textarea id="referral-link" rows="3" readonly>${escape(result.link)}</textarea><button class="primary-button" data-copy-referral>Копировать</button></div>`:
   `<p>${!view.key?'Открой магазин через Telegram, чтобы получить ссылку.':result?.enabled===false?'Новые приглашения пока недоступны.':view.loading?'Загружаем ссылку…':'Ссылка пока недоступна.'}</p>`}
  </section>
  <section class="referral-card referral-rules">
   <h3>Как это работает</h3>
   <p>Зарабатывай бонусные рубли за каждого приглашенного друга.</p>
   <p>Оплачивай бонусными рублями до 50% стоимости заказа.</p>
   <p>Твоя награда зависит от суммы первого выполненного заказа друга и количества приглашенных в месяц.</p>
   <dl class="referral-rates"><div><dt>1–2 приглашенных</dt><dd>3%</dd></div><div><dt>3–5 приглашенных</dt><dd>5%</dd></div><div><dt>Более 5 приглашенных</dt><dd>7%</dd></div></dl>
   <p>Ставка закрепляется при переходе. У друга есть 7 дней, чтобы выполнить первый заказ.</p>
   <p class="referral-warning"><strong>Предупреждение</strong><br>Боты, фейки, способы обхода системы = блокировка и списание <strong>всего</strong> баланса!</p>
   <p class="referral-tip"><strong>Совет</strong><br>Советуйте наш магазин тем, кто реально заинтересован в покупке — друзьям, в вейп-барахолках, личные каналы.</p>
  </section>`;
 const recommendations=`
  ${result?`<div class="referral-stats"><div class="referral-card"><span>Успешные</span><strong>${result.count}</strong></div><div class="referral-card"><span>Заработано</span><strong>${moneyMarkup(result.earned)}</strong></div></div>`:''}
  <section class="referral-card">
   <h3>История рекомендаций</h3>
   <div class="referral-filters" role="group" aria-label="Статус рекомендаций">${Object.entries(referralStatuses).map(([id,label])=>`<button data-referral-status="${id}" aria-pressed="${view.status===id}">${label}</button>`).join('')}</div>
   ${view.items.map(item=>`<article class="referral-person"><span class="referral-avatar">${escape([...item.name][0]?.toUpperCase()||'')}</span><div><strong>${escape(item.name)}</strong><time datetime="${escape(item.created_at)}">${new Date(item.created_at).toLocaleDateString('ru-RU')}</time></div>${view.status==='successful'?`<strong class="referral-earned">+${moneyMarkup(item.amount)}</strong>`:''}</article>`).join('')}
   ${!view.key?'<p>Открой магазин через Telegram, чтобы увидеть рекомендации.</p>':view.loading?'<p role="status">Загружаем рекомендации…</p>':!view.items.length&&!view.error?'<p>В этом разделе пока нет рекомендаций.</p>':''}
   ${view.next!==null?`<button class="secondary-button" data-referral-more ${view.loading?'disabled':''}>Показать ещё</button>`:''}
  </section>`;
 show(`<h2>Реферальная программа</h2><div class="referral-tabs" role="group" aria-label="Раздел реферальной программы">
  <button data-referral-tab="information" aria-pressed="${view.tab==='information'}">Информация</button>
  <button data-referral-tab="recommendations" aria-pressed="${view.tab==='recommendations'}">Рекомендации</button>
 </div><div class="referral-content">${view.error?historyError(view.error,'data-referral-retry'):''}${view.tab==='information'?info:recommendations}</div>`,'referral',false);
 if(focused){
  const selector=active.dataset.referralTab?`[data-referral-tab="${active.dataset.referralTab}"]`:`[data-referral-status="${active.dataset.referralStatus}"]`;
  $(selector)?.focus({preventScroll:true});
 }
}
async function loadReferrals(more=false){
 const view=referralView,version=++view.version;
 view.loading=Boolean(view.key);
 view.error='';
 if(!more){view.items=[];view.next=null;}
 renderReferrals();
 if(!view.key)return;
 const current=()=>referralView===view&&version===view.version&&view.key===(telegram?.initData||'');
 try{
  const result=await historyRequest('referrals',{status:view.status,...(more?{before:view.next}:{})});
  if(!current())return;
  view.result=result;
  view.items=more?[...view.items,...result.items]:result.items;
  view.next=result.next;
 }catch(error){if(current())view.error=error.message;}
 finally{if(current()){view.loading=false;if($('#details').open&&$('#details').dataset.view==='referral'&&!$('#details').dataset.closing)renderReferrals();}}
}
function openReferrals(){
 referralView={key:telegram?.initData||'',tab:'information',status:'pending',result:null,items:[],next:null,error:'',loading:false,version:0};
 void loadReferrals();
}
let trackedReferralSession;
function trackReferralVisit(){
 const key=telegram?.initData||'';
 if(!key||trackedReferralSession===key||!new URLSearchParams(key).get('start_param')?.startsWith('ref_'))return;
 trackedReferralSession=key;
 void historyRequest('referrals').catch(()=>{if(trackedReferralSession===key)trackedReferralSession=null;});
}
async function copyReferralLink(){
 const input=$('#referral-link');
 try{await navigator.clipboard.writeText(input.value);}
 catch{input.focus();input.select();if(!document.execCommand?.('copy')){notify('Выделили ссылку. Скопируй её вручную.');return;}}
 notify('Ссылка скопирована');
}
function openInfo(type) {
  if(type==='reviews'){openReviewFeed();return;}
  if (type === 'important') {
    show(`<div class="important-info">
      <span class="important-eyebrow">GAS SHOP · ПЕРЕД ПЕРВЫМ ЗАКАЗОМ</span>
      <h2>Важная информация</h2>
      <p class="important-welcome">👋 Приветствую!</p>
      <p>Здесь собрана основная информация для удобного сотрудничества и ответы на большинство вопросов при первом обращении.</p>
      <blockquote class="important-reminder">Ознакомление с этим разделом <strong>обязательно перед обращением</strong>.</blockquote>

      <section class="important-card important-payment" aria-labelledby="important-payment-title">
        <h3 id="important-payment-title"><span aria-hidden="true">01</span> Оплата</h3>
        <p><strong>Исключительно наличные!</strong></p>
        <p>Переводы, крипта, NFT и б/у устройства не принимаются.</p>
        <div class="important-inset"><strong>Когда возможен перевод</strong><p>Для предзаказа, долгосрочной брони товара и перед отправкой доставки сторонними службами.</p></div>
      </section>

      <section class="important-card important-delivery" aria-labelledby="important-delivery-title">
        <h3 id="important-delivery-title"><span aria-hidden="true">02</span> Получение заказов</h3>
        <p>Заказ можно получить при личной встрече в месте самовывоза или оформить доставку.</p>
        <div class="important-inset"><strong>Самовывоз · бесплатно</strong><p>${pickupAddress}</p></div>
        <ul><li><strong>По линии метро</strong> — ${metroDeliveryFee() ? moneyMarkup(metroDeliveryFee()) : 'стоимость указана при оформлении'}.</li><li><strong>Вне линии метро</strong> — стоимость рассчитывается отдельно.</li></ul>
      </section>

      <section class="important-card important-returns" aria-labelledby="important-returns-title">
        <h3 id="important-returns-title"><span aria-hidden="true">03</span> Возврат и брак</h3>
        <p>Бракованное устройство, которое не работает после вскрытия покупателем, можно заменить на <strong>новое</strong>.</p>
        <div class="important-inset"><strong>Обязательно сохраните упаковку и товарный вид.</strong><p>Для замены обратитесь в течение <strong>24 часов с момента покупки</strong>. После истечения этого срока тоже идём навстречу.</p></div>
        <p>Замена товаров из категорий «Расходники», «Снюс» и «Жидкости», как правило, не производится в связи с отсутствием брака.</p>
        <p><strong>Будьте внимательны!</strong></p>
      </section>

      <section class="important-card important-balance" aria-labelledby="important-balance-title">
        <h3 id="important-balance-title"><span aria-hidden="true">04</span> Баланс бота</h3>
        <div class="important-inset"><strong>Баланс не обналичивается.</strong><p>Виртуальные средства в кошельке используются исключительно для оплаты товаров внутри бота.</p></div>
        <p>Баланс пополняется за счёт:</p>
        <ul><li>Кэшбека.</li><li>Вознаграждений за выполнение заданий и розыгрыши.</li><li>Внесения денежных средств на баланс.</li></ul>
        <p>При серьёзном нарушении правил возможны <strong>обнуление баланса и блокировка</strong>.</p>
      </section>

      <footer class="important-footer"><p>❤️ Спасибо, что нашли время ознакомиться с этой информацией. Это первый и самый важный шаг к комфортному и долгосрочному взаимодействию.</p><p><strong>С уважением, GAS 😁</strong></p></footer>
    </div>`, 'important');
    return;
  }
  if (!data) { show('<h2>Информация недоступна</h2><p>Сначала загрузите каталог.</p>'); return; }
  if (type === 'referral') {
    openReferrals();
  } else {
    openReviewFeed();
  }
}
let profileState = { key: '', status: 'idle' }, profileRequestVersion = 0;
let headerBalanceState = { key:null, value:null, loading:false }, balanceRequestVersion = 0;
function renderHeaderBalance() {
  const value = headerBalanceState.value, known = Number.isFinite(value);
  $('#header-balance-value').textContent = known ? new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(value) : '—';
  $('#header-balance').setAttribute('aria-label', known ? `Баланс: ${money(value)}` : headerBalanceState.loading ? 'Баланс загружается' : 'Баланс недоступен');
}
function applyHeaderBalance(key, value) {
  if (key !== (telegram?.initData || '') || !Number.isFinite(value)) return;
  balanceRequestVersion++;
  headerBalanceState = { key, value, loading:false };
  renderHeaderBalance();
  refreshCheckoutPayment();
}
async function loadHeaderBalance(force = false) {
  const key = telegram?.initData || '';
  if (headerBalanceState.key !== key) { headerBalanceState = { key, value:null, loading:false }; renderHeaderBalance(); }
  if (!key || headerBalanceState.loading || (!force && headerBalanceState.value !== null)) return;
  headerBalanceState.loading = true; renderHeaderBalance();
  const version = ++balanceRequestVersion, controller = new AbortController(), timeout = setTimeout(() => controller.abort(),15000);
  try {
    const response = await fetch('/api/storefront/balance',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({init_data:key})});
    if (!response.ok) throw new Error('balance');
    const result = await response.json();
    if (version !== balanceRequestVersion || key !== (telegram?.initData || '')) return;
    applyHeaderBalance(key,result.balance);
  } catch {
    if (version === balanceRequestVersion && key === (telegram?.initData || '')) headerBalanceState.value = null;
  } finally {
    clearTimeout(timeout);
    if (version === balanceRequestVersion) { headerBalanceState.loading = false; renderHeaderBalance(); }
  }
}
let customerHistoryState={key:null};
const orderStatus=status=>({new:'Новый',accepted:'В работе',completed:'Выполнен',cancelled:'Отменён'}[status]||status);
function currentCustomerHistory(){
 const key=telegram?.initData||'';
 if(customerHistoryState.key!==key)customerHistoryState={key,orders:[],ordersNext:null,ordersLoading:false,ordersError:'',order:null,orderError:'',orderLoading:false,orderVersion:0,cancelling:false,cancelConfirm:false,transactions:[],transactionsNext:null,transactionsLoading:false,transactionsVersion:0,transactionsLoaded:false,transactionsError:''};
 return customerHistoryState;
}
function historyRequest(path,body={}){return reviewRequest('/api/storefront/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,init_data:telegram?.initData||''})});}
function historyError(message,action){return `<div class="profile-error" role="alert"><p>${escape(message)}</p><button class="secondary-button" ${action}>Повторить</button></div>`;}
const balanceHistoryDate = new Intl.DateTimeFormat('ru-RU', {dateStyle:'medium',timeStyle:'short'});
function accrualsContent(){
 const state=currentCustomerHistory();
 const heading='<h3 id="balance-history-title">Начисления и списания</h3>';
 if(!state.key)return `<section class="balance-history-panel" aria-labelledby="balance-history-title">${heading}<p class="balance-history-status">Откройте магазин через Telegram, чтобы увидеть начисления и списания.</p></section>`;
 const rows=state.transactions.map(item=>{
  const credit=item.amount>0;
  return `<article class="balance-history-row ${credit?'balance-credit':'balance-debit'}" data-balance-event="${escape(item.id)}">
   <span class="balance-history-icon" aria-hidden="true">${credit?icons.plus:icons.minus}</span>
   <div class="balance-history-details">
    <strong>${escape(item.title)}</strong>
    <time datetime="${escape(item.created_at)}">${balanceHistoryDate.format(new Date(item.created_at))}</time>
    ${item.order_id?`<button class="balance-history-order" data-customer-order="${item.order_id}" data-order-origin="accruals">Открыть заказ ${icons.chevron}</button>`:''}
   </div>
   <strong class="balance-history-amount">${credit?'+':'−'}${moneyMarkup(Math.abs(item.amount))}</strong>
  </article>`;
 }).join('');
 return `<section class="balance-history-panel" aria-labelledby="balance-history-title">
  ${heading}
  ${state.transactionsError?historyError(state.transactionsError,'data-retry-accruals'):''}
  ${rows?`<div class="balance-history">${rows}</div>`:''}
  ${state.transactionsLoading?'<p class="balance-history-status" role="status">Загружаем операции…</p>':state.transactionsLoaded&&!rows&&!state.transactionsError?'<p class="balance-history-status">Начислений и списаний пока нет.</p>':''}
  ${state.transactionsNext?`<button class="secondary-button" data-more-accruals ${state.transactionsLoading?'disabled':''}>Показать ещё</button>`:''}
 </section>`;
}
function refreshAccrualsView(){
 if(activePage==='profile'&&profileTab==='accruals'){stopProfileTransition();$('#profile-body').innerHTML=accrualsContent();}
}
async function loadAccruals(more=false,refresh=true){
 const state=currentCustomerHistory();if(!state.key||state.transactionsLoading)return;
 const version=++state.transactionsVersion;state.transactionsLoading=true;state.transactionsError='';if(refresh)refreshAccrualsView();else if($('#profile-body')&&profileTab==='accruals')$('#profile-body').innerHTML=accrualsContent();
 try{
  const result=await historyRequest('transactions',more?{before:state.transactionsNext}:{});
  if(currentCustomerHistory()!==state||state.transactionsVersion!==version)return;
  state.transactions=more?[...state.transactions,...result.items]:result.items;state.transactionsNext=result.next;state.transactionsLoaded=true;state.transactionsAt=Date.now();applyHeaderBalance(state.key,result.balance);
 }catch(error){if(currentCustomerHistory()===state&&state.transactionsVersion===version)state.transactionsError=error.message;}
 finally{if(state.transactionsVersion===version){state.transactionsLoading=false;if(currentCustomerHistory()===state)refreshAccrualsView();}}
}
function renderCustomerOrders(){
 const state=currentCustomerHistory();
 show(`<h2>Заказы</h2><button class="profile-back" data-back-profile>${icons.previousPhoto}В профиль</button>
 ${!state.key?'<p>Откройте магазин через Telegram, чтобы увидеть свои заказы.</p>':''}
 ${state.ordersError?historyError(state.ordersError,'data-retry-orders'):''}
 <div class="customer-order-list">${state.orders.map(order=>`<button class="profile-order customer-order-button" data-customer-order="${order.id}"><div><strong>Заказ #${order.id}</strong><small>${escape(orderStatus(order.status))} · ${reviewDate(order.created_at)}</small></div><strong>${moneyMarkup(order.total+(order.delivery_fee??0))} ${icons.arrow}</strong></button>`).join('')}</div>
 ${state.ordersLoading?'<p role="status">Загружаем заказы…</p>':state.key&&!state.ordersError&&!state.orders.length?'<p>Заказов пока нет.</p>':''}
 ${state.ordersNext?`<button class="secondary-button" data-more-orders ${state.ordersLoading?'disabled':''}>Показать ещё</button>`:''}`, 'my-orders',false);
}
async function openCustomerOrders(more=false){
 const state=currentCustomerHistory();if(state.ordersLoading){renderCustomerOrders();return;}
 if(!state.key){renderCustomerOrders();return;}
 state.ordersLoading=true;state.ordersError='';if(!more)state.orders=[];renderCustomerOrders();
 try{const result=await historyRequest('orders/list',more?{before:state.ordersNext}:{});if(currentCustomerHistory()!==state)return;state.orders=more?[...state.orders,...result.items]:result.items;state.ordersNext=result.next;}
 catch(error){if(currentCustomerHistory()===state)state.ordersError=error.message;}
 finally{state.ordersLoading=false;if(currentCustomerHistory()===state&&dialogViewOpen('my-orders'))renderCustomerOrders();}
}
function orderMeetingDate(value){
 return value?`<p class="order-meeting-date">Дата встречи <time datetime="${escape(value)}">${escape(value.split('-').reverse().join('.'))}</time></p>`:'';
}
function orderFulfillment(order){
 return order.delivery?`<p class="order-fulfillment"><strong>${escape(order.delivery)}</strong>${order.address?`<span>${escape(order.address)}</span>`:''}</p>`:'';
}
function renderCustomerOrder(id){
 const state=currentCustomerHistory(),order=state.order?.id===id?state.order:null;
 show(`<h2>Заказ #${id}</h2><button class="profile-back" data-back-customer-orders>${icons.previousPhoto}${state.orderOrigin==='accruals'?'К начислениям':'К заказам'}</button>
 ${state.orderError?historyError(state.orderError,`data-retry-order="${id}"`):''}${state.orderLoading?'<p role="status">Загружаем заказ…</p>':''}
 ${order?`<p class="customer-order-status">${escape(orderStatus(order.status))} · ${reviewDate(order.created_at)}</p>
 ${orderMeetingDate(order.meeting_date)}
 ${orderFulfillment(order)}
 <div class="customer-order-items">${order.items.map(item=>`<div><span>${escape(item.name)}<small>${item.quantity} × ${moneyMarkup(item.price)}</small></span><strong>${moneyMarkup(item.quantity*item.price)}</strong></div>`).join('')}</div>
 <div class="customer-order-totals">
  <div><span>Стоимость товаров</span><strong>${moneyMarkup(order.total)}</strong></div>
  ${order.delivery_fee?`<div><span>Доставка по метро</span><strong>${moneyMarkup(order.delivery_fee)}</strong></div>`:''}
  ${order.balance_spent?`<div><span>${order.status==='cancelled'?'Рубли возвращены':'Списано рублей'}</span><strong>${moneyMarkup(order.balance_spent)}</strong></div>`:''}
  <div><span>${order.address&&!order.delivery_fee?'К оплате за товары':'К оплате'}</span><strong>${moneyMarkup(order.payable)}</strong></div>
 </div>
 ${order.can_cancel?state.cancelConfirm?`<div class="profile-error"><p>Отменить заказ? Товары вернутся на склад${order.balance_spent?', списанные рубли — на баланс':''}.</p><button class="primary-button" data-confirm-order-cancel="${id}" ${state.cancelling?'disabled':''}>${state.cancelling?'Отменяем…':'Да, отменить'}</button><button class="secondary-button" data-keep-order="${id}" ${state.cancelling?'disabled':''}>Оставить заказ</button></div>`:`<button class="secondary-button customer-cancel-order" data-cancel-customer-order="${id}">Отменить заказ</button>`:''}`:''}`, 'order-detail',false);
}
async function openCustomerOrder(id,origin){
 const state=currentCustomerHistory(),version=++state.orderVersion;state.order=null;state.orderLoading=true;state.orderError='';state.cancelConfirm=false;state.orderOrigin=origin||state.orderOrigin||'orders';renderCustomerOrder(id);
 try{const result=await historyRequest('orders/'+id);if(currentCustomerHistory()!==state||state.orderVersion!==version)return;state.order=result.order;applyHeaderBalance(state.key,result.order.balance_after);profileState={key:'',status:'idle'};state.transactionsVersion++;state.transactionsLoading=false;state.transactionsLoaded=false;}
 catch(error){if(currentCustomerHistory()===state&&state.orderVersion===version)state.orderError=error.message;}
 finally{if(state.orderVersion===version){state.orderLoading=false;if(currentCustomerHistory()===state&&dialogViewOpen('order-detail'))renderCustomerOrder(id);}}
}
async function cancelCustomerOrder(id){
 const state=currentCustomerHistory();if(state.cancelling||state.order?.id!==id||!state.cancelConfirm)return;
 const version=state.orderVersion;state.cancelling=true;state.orderError='';renderCustomerOrder(id);
 try{
  const result=await historyRequest('orders/'+id+'/cancel');if(currentCustomerHistory()!==state)return;
  if(state.orderVersion===version){state.order=result.order;state.cancelConfirm=false;}
  state.transactionsVersion++;state.transactionsLoading=false;state.transactionsLoaded=false;state.transactions=[];state.transactionsNext=null;
  profileState={key:'',status:'idle'};applyHeaderBalance(state.key,result.order.balance_after);
  if(data)void load();
 }catch(error){if(currentCustomerHistory()===state&&state.orderVersion===version){state.orderError=error.message;if(error.status===409){try{const updated=await historyRequest('orders/'+id);if(currentCustomerHistory()===state&&state.orderVersion===version){state.order=updated.order;state.cancelConfirm=false;}}catch{}}}}
 finally{state.cancelling=false;if(currentCustomerHistory()===state&&state.orderVersion===version&&dialogViewOpen('order-detail'))renderCustomerOrder(id);}
}

function currentProfile() {
  const key = telegram?.initData || '';
  if (profileState.key !== key) profileState = { key, status: 'idle' };
  return profileState;
}
function profileMessage() {
  const state = currentProfile();
  if (!state.key) return '<p class="profile-hint">Откройте магазин через Telegram, чтобы увидеть свои заказы и отзывы.</p>';
  if (state.error) return `<div class="profile-error" role="status"><p>${escape(state.error)}</p><button class="primary-button secondary-button" data-retry-profile>Повторить</button></div>`;
  return state.status === 'loading' ? '<p class="profile-hint" role="status">Загружаем профиль…</p>' : '';
}
function profileContent(tab) {
  if (tab !== 'overview') return accrualsContent();
  return `<button class="profile-link" data-my-reviews>${icons.reviews}<span>Мои отзывы</span>${icons.arrow}</button>
    <button class="profile-link" data-customer-orders>${icons.package}<span>Заказы</span>${icons.arrow}</button>${profileMessage()}`;
}
function refreshProfileView() {
  if (activePage === 'profile') renderProfile(profileTab);
  if (dialogViewOpen('my-reviews')) renderMyReviews();
}
async function loadProfile(more = false) {
  const state = currentProfile();
  if (!state.key || state.status === 'loading' || state.loadingMore) return;
  const version = ++profileRequestVersion, controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
  state.error = ''; if (more) state.loadingMore = true; else state.status = 'loading';
  refreshProfileView();
  try {
    const response = await fetch('/api/storefront/profile', { method:'POST', headers:{'Content-Type':'application/json'}, signal:controller.signal, body:JSON.stringify({init_data:state.key,...(more ? {reviews_before:state.reviews_next} : {})}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось загрузить профиль.');
    if (version !== profileRequestVersion || currentProfile() !== state) return;
    const reviews = more ? [...state.reviews, ...result.reviews] : result.reviews;
    Object.assign(state, result, { reviews, status:'ready', loadedAt:Date.now() });
    applyHeaderBalance(state.key, result.balance);
  } catch (error) {
    if (version !== profileRequestVersion || currentProfile() !== state) return;
    state.status = more ? 'ready' : 'error';
    state.error = ['AbortError','TypeError'].includes(error.name) ? 'Не удалось загрузить профиль. Проверьте соединение и повторите.' : error.message;
  } finally {
    clearTimeout(timeout); state.loadingMore = false;
    if (version === profileRequestVersion && currentProfile() === state) refreshProfileView();
  }
}
function renderMyReviews() {
  const state = currentProfile();
  show(`<h2>Мои отзывы</h2><button class="profile-back" data-back-profile>${icons.previousPhoto}В профиль</button><div id="my-review-write-slot">${reviewWriteButton()}</div>${profileMessage()}
    ${state.status === 'ready' ? state.reviews.length ? `<div class="my-reviews-list">${state.reviews.map(review=>reviewCard(review,{own:true})).join('')}</div>${state.reviews_next ? `<button class="primary-button secondary-button" data-more-reviews ${state.loadingMore?'disabled':''}>${state.loadingMore?'Загружаем…':'Показать ещё'}</button>` : ''}` : '<div class="empty-inline">У вас пока нет отзывов.</div>' : ''}`, 'my-reviews', false);
  if (state.status === 'idle'||(state.status==='ready'&&Date.now()-state.loadedAt>30000)) void loadProfile();
  scheduleReviewExpiry();
  void loadReviewEligibility().then(()=>{const slot=$('#my-review-write-slot');if(slot){slot.innerHTML=reviewWriteButton();scheduleReviewExpiry();}}).catch(()=>{});
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
  if (tab === profileTab || !['overview', 'accruals'].includes(tab)) return;
  stopProfileTransition();
  const panel = $('#profile-panel'), body = $('#profile-body');
  if (!panel || !body) return;
  const direction = tab === 'accruals' ? 1 : -1;
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
  if(tab==='accruals'&&!currentCustomerHistory().transactionsLoading)void loadAccruals(false,false);
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
function userPhotoUrl(){try{const value=typeof user?.photo_url==='string'?user.photo_url:'';const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function avatarPhoto(){const src=userPhotoUrl();return src?`<img class="client-avatar-photo" src="${escape(src)}" alt="Аватар клиента" referrerpolicy="no-referrer" decoding="async">`:'';}
function bindAvatarFallbacks(root=document){root.querySelectorAll('.client-avatar-photo').forEach(image=>image.addEventListener('error',()=>image.remove(),{once:true}));}
function updateClientAvatar(){const avatar=$('#profile-button .header-profile-avatar');avatar.querySelector('.client-avatar-photo')?.remove();avatar.insertAdjacentHTML('beforeend',avatarPhoto());bindAvatarFallbacks(avatar);}
function renderProfile(tab = 'overview') {
  const text = key => typeof user?.[key] === 'string' ? user[key].slice(0, 80) : '';
  const name = [text('first_name'), text('last_name')].filter(Boolean).join(' ') || text('username') || 'Гость';
  const initials = [text('first_name'), text('last_name')].filter(Boolean).map(value => [...value][0]).join('').toUpperCase();
  const state = currentProfile(), ready = state.status === 'ready';
  profileTab = tab;
  stopProfileTransition();
  const page = $('#profile-page');
  page.innerHTML = `<div class="profile-card">
      <div class="profile-identity"><span class="profile-avatar">${initials ? escape(initials) : icons.user}${avatarPhoto()}</span><div><h2>${escape(name)}</h2>${text('username') ? `<span class="profile-username">@${escape(text('username'))}</span>` : ''}</div></div>
      <div class="profile-stats" aria-busy="${state.status==='loading'}"><div>${icons.bag}<strong data-profile-order-count>${ready ? state.stats.orders_count : '—'}</strong><span>Кол-во заказов</span></div><div>${icons.wallet}<strong data-profile-order-total>${ready ? moneyMarkup(state.stats.total) : '—'}</strong><span>Общая сумма</span></div></div>
    </div>
    <div class="profile-tabs" role="tablist" aria-label="Разделы профиля" data-active="${tab}">
      <span class="profile-tab-indicator" aria-hidden="true"></span>
      <button role="tab" id="profile-overview" aria-controls="profile-panel" aria-selected="${tab === 'overview'}" tabindex="${tab === 'overview' ? 0 : -1}" data-profile-tab="overview">Обзор</button>
      <button role="tab" id="profile-accruals" aria-controls="profile-panel" aria-selected="${tab === 'accruals'}" tabindex="${tab === 'accruals' ? 0 : -1}" data-profile-tab="accruals">Начисления</button>
    </div>
    <div class="profile-panel" id="profile-panel" role="tabpanel" aria-labelledby="profile-${tab}"><div class="profile-body" id="profile-body">${profileContent(tab)}</div></div>`;
  bindAvatarFallbacks(page);
  if(tab==='accruals'&&(!currentCustomerHistory().transactionsLoaded||Date.now()-currentCustomerHistory().transactionsAt>30000)&&!currentCustomerHistory().transactionsLoading&&!currentCustomerHistory().transactionsError)void loadAccruals(false,false);
  if (state.status === 'idle' || (ready && Date.now()-state.loadedAt > 30000)) void loadProfile();
}

function renderCart() {
  const items = cartItems(), { count, amount } = cartSummary();
  $('#cart-content').innerHTML = `<div class="cart-heading"><span class="sheet-kicker">ВАШ ВЫБОР</span><h1>Корзина <span>${count}</span></h1></div>
    ${!data ? '<p>Сначала загрузите каталог, чтобы проверить наличие и цены.</p>' : items.length ? `
      <div class="cart-items">${items.map(({ key, product, flavor, quantity, price }) => {
        const name = productLineName(product, flavor);
        return `<div class="cart-item" data-cart-item="${escape(key)}">
          <button class="cart-item-photo" data-open-product="${product.id}" aria-label="Открыть: ${escape(name)}">${photo(product)}</button>
          <div class="cart-item-body"><button class="cart-item-name" data-open-product="${product.id}">${escape(name)}</button><span class="cart-unit-price">${moneyMarkup(price)} / шт.</span>
            <div class="cart-item-controls">${quantityControls(key,name,quantity,quantity<cartLineLimit(product,flavor,quantity))}<strong>${moneyMarkup(price * quantity)}</strong></div>
          </div>
          <button class="remove-item" data-remove="${escape(key)}" aria-label="Удалить: ${escape(name)}">${icons.trash}</button>
        </div>`;
      }).join('')}</div>
      <div class="cart-total"><span>Итого</span><strong>${moneyMarkup(amount)}</strong></div>` : `<div class="cart-empty">${icons.bag}<h3>Корзина пока пуста</h3><p>Добавьте то, что вам понравилось.</p></div>`}
    ${items.length || pendingCheckout() ? '<button class="primary-button" data-checkout>'+ (pendingCheckout() ? 'Проверить заказ' : 'Оформить заказ') + icons.bag + '</button>' : ''}
    <button class="primary-button secondary-button" data-continue>${items.length ? 'Продолжить покупки' : 'Перейти в каталог'}${icons.arrow}</button>`;
}
let checkoutDraft, checkoutSubmitting = false, checkoutLocked = false;
const checkoutPending = new Map();
function pendingCheckout() {
  try {
    const pending = checkoutPending.get(cartKey) || JSON.parse(localStorage.getItem(cartKey + ':checkout'));
    return pending && typeof pending.request_key === 'string' && Array.isArray(pending.items) && pending.items.length ? pending : null;
  } catch { return checkoutPending.get(cartKey) || null; }
}
function checkoutGoodsTotal() { return checkoutDraft?.items.reduce((sum,item)=>sum+item.price*item.quantity,0) || 0; }
const checkoutSpendStep = () => data?.balance_spend_step ?? 50;
function checkoutSpendLimit() {
  const balance = headerBalanceState.key === (telegram?.initData || '') && Number.isFinite(headerBalanceState.value) ? headerBalanceState.value : 0;
  const step = checkoutSpendStep();
  return Math.max(0,Math.floor(Math.min(balance,checkoutGoodsTotal()/2)/step)*step);
}
const moscowDate = () => new Date().toLocaleDateString('sv-SE', {timeZone:'Europe/Moscow'});
function checkoutMetroPicker(station) {
  const stations = (data?.metro_lines ?? [])
    .flatMap(line => line.stations.map(name => ({name, color:line.color})))
    .sort((a,b) => a.name.localeCompare(b.name,'ru'));
  return `<div class="checkout-location" id="checkout-metro-location">
    <span id="checkout-metro-label">Станция метро</span>
    <input type="hidden" id="checkout-metro-value" value="${escape(station)}" hidden>
    <button type="button" id="checkout-metro" class="checkout-metro-toggle" aria-expanded="false"
      aria-controls="checkout-metro-options" aria-labelledby="checkout-metro-label checkout-metro-selected">
      <span class="checkout-metro-mark" id="checkout-metro-selected-mark" aria-hidden="true" hidden></span>
      <span id="checkout-metro-selected">Выберите станцию</span>
      ${icons.chevron}
    </button>
    <ul id="checkout-metro-options" class="checkout-metro-options" aria-labelledby="checkout-metro-label" hidden>
      ${stations.map(({name,color})=>{
        const line = color === 'green' ? 'green' : 'red';
        const lineName = line === 'green' ? 'зелёная ветка' : 'красная ветка';
        return `<li><button type="button" data-metro-station="${escape(name)}" data-metro-color="${line}"
          aria-label="${escape(name)}, ${lineName}" aria-pressed="false">
          <span class="checkout-metro-mark" data-line="${line}" aria-hidden="true"></span>
          <span>${escape(name)}</span>
        </button></li>`;
      }).join('')}
    </ul>
  </div>`;
}
function setCheckoutMetroOpen(open) {
  $('#checkout-metro-options').hidden = !open;
  $('#checkout-metro').setAttribute('aria-expanded',String(open));
}
function refreshCheckoutMetro(enabled) {
  const station = $('#checkout-metro-value');
  const toggle = $('#checkout-metro');
  const options = [...$('#checkout-metro-options').querySelectorAll('[data-metro-station]')];
  const selected = options.find(option=>option.dataset.metroStation===station.value);
  if (!selected && !checkoutLocked) station.value = '';
  for (const option of options) option.setAttribute('aria-pressed',String(option===selected));
  const mark = $('#checkout-metro-selected-mark');
  mark.hidden = !selected;
  mark.dataset.line = selected?.dataset.metroColor ?? '';
  $('#checkout-metro-selected').textContent = station.value || 'Выберите станцию';
  toggle.disabled = !enabled || checkoutLocked;
  if (toggle.disabled) setCheckoutMetroOpen(false);
  return station.value;
}
function checkoutFulfillment(draft) {
  const mode = draft.delivery_method;
  const delivery = mode === 'metro' || mode === 'address';
  const station = mode === 'metro' ? draft.delivery_location : '';
  return `<fieldset id="checkout-fulfillment" class="checkout-fulfillment">
    <legend>Способ получения</legend>
    <div class="checkout-choices">
      <label><input type="radio" name="checkout-receiving" id="checkout-pickup" ${delivery ? '' : 'checked'}>Самовывоз</label>
      <label><input type="radio" name="checkout-receiving" id="checkout-delivery" ${delivery ? 'checked' : ''}>Доставка</label>
    </div>
    <div id="checkout-pickup-info" class="checkout-pickup-info">
      <strong>Место самовывоза</strong>
      <div class="checkout-pickup-address">${pickupAddress}</div>
    </div>
    <fieldset id="checkout-delivery-fields" class="checkout-delivery-fields" hidden>
      <legend>Куда доставить</legend>
      <div class="checkout-choices">
        <label><input type="radio" name="checkout-destination" value="metro" ${mode === 'address' ? '' : 'checked'}>По метро</label>
        <label><input type="radio" name="checkout-destination" value="address" ${mode === 'address' ? 'checked' : ''}>По адресу</label>
      </div>
      ${checkoutMetroPicker(station)}
      <div class="checkout-location" id="checkout-address-location" hidden>
        <label for="checkout-address">Адрес доставки</label>
        <input id="checkout-address" type="text" autocomplete="street-address" maxlength="300" value="${mode === 'address' ? escape(draft.delivery_location) : ''}" aria-describedby="checkout-address-price" required>
        <span class="checkout-note" id="checkout-address-price">Стоимость доставки рассчитывается отдельно.</span>
      </div>
    </fieldset>
  </fieldset>`;
}
function refreshCheckoutFulfillment() {
  const fieldset = $('#checkout-fulfillment');
  if (!fieldset) return 0;
  const delivery = $('#checkout-delivery').checked;
  const metro = $('input[name="checkout-destination"]:checked').value === 'metro';
  fieldset.disabled = checkoutLocked;
  fieldset.hidden = checkoutLocked && !checkoutDraft.delivery_method;
  $('#checkout-pickup-info').hidden = delivery;
  $('#checkout-delivery-fields').hidden = !delivery;
  $('#checkout-metro-location').hidden = !metro;
  const station = refreshCheckoutMetro(delivery && metro);
  $('#checkout-address-location').hidden = metro;
  const address = $('#checkout-address');
  address.disabled = !delivery || metro;
  let receiving = fieldset.hidden ? 'Согласование с менеджером' : 'Самовывоз';
  if (delivery) receiving = metro ? (station ? 'м. ' + station : 'По метро') : (address.value.trim() || 'По адресу');
  $('#checkout-summary-fulfillment').textContent = receiving;
  const deliveryFee = delivery && metro ? (checkoutLocked ? checkoutDraft.delivery_fee ?? metroDeliveryFee() : metroDeliveryFee()) : 0;
  $('#checkout-delivery-fee').textContent = delivery && !metro ? 'Уточняется' : money(deliveryFee);
  $('#checkout-payable-label').textContent = delivery && !deliveryFee ? 'Итого за товары' : 'Итого';
  return deliveryFee;
}
function refreshCheckoutPayment() {
  if (!checkoutDraft || !$('#details').open || $('#details').dataset.view !== 'checkout' || !$('#checkout-summary')) return;
  const max = checkoutSpendLimit();
  const step = checkoutSpendStep();
  if (!checkoutLocked) checkoutDraft.balance_spend = Math.min(max,Math.max(0,Math.floor((checkoutDraft.balance_spend||0)/step)*step));
  const spent = checkoutDraft.balance_spend || 0;
  const date = $('#checkout-meeting-date');
  const disabled = checkoutSubmitting || checkoutLocked;
  date.disabled = checkoutLocked;
  $('#checkout-summary-date').textContent = date.value ? date.value.slice(5).split('-').reverse().join('.') : '—';
  const deliveryFee = refreshCheckoutFulfillment();
  $('[data-adjust-rubles="-1"]').disabled = disabled || spent === 0;
  $('[data-adjust-rubles="1"]').disabled = disabled || spent >= max;
  $('#checkout-rubles-output').textContent = money(spent);
  const spendHint = $('#checkout-rubles-limit');
  spendHint.hidden = checkoutLocked;
  spendHint.textContent = Number.isFinite(headerBalanceState.value)
    ? (max ? `Доступно до ${money(max)} · шаг ${money(step)}` : `Для списания доступно меньше ${money(step)}.`)
    : 'Баланс пока недоступен.';
  $('#checkout-wallet-amount').textContent = (spent ? '−' : '') + money(spent);
  $('#checkout-payable').textContent = money(checkoutGoodsTotal()+deliveryFee-spent);
}
function adjustCheckoutRubles(direction) {
  if (checkoutSubmitting || checkoutLocked || !checkoutDraft) return;
  checkoutDraft.balance_spend += direction * checkoutSpendStep();
  refreshCheckoutPayment();
}
function openCheckout() {
  if (checkoutSubmitting) return;
  const pending = pendingCheckout();
  const items = pending?.items || cartItems().map(({ product, flavor, quantity, price }) => ({ product_id: product.id, flavor, name: productLineName(product, flavor), price, quantity }));
  if (!items.length) return;
  checkoutDraft = pending || { request_key: crypto.randomUUID(), items, balance_spend:0 };
  checkoutLocked = Boolean(pending);
  const total = checkoutGoodsTotal();
  const cashbackPercent = Number(data?.cashback_percent) || 0;
  const cashback = Math.floor(total * cashbackPercent / 100);
  show(`<h2>Подтверждение заказа</h2>
    ${pending ? '<p>Проверим, сохранился ли предыдущий заказ. Повторного списания не будет.</p>' : ''}
    <label class="checkout-meeting-date" for="checkout-meeting-date">Дата встречи
      <input id="checkout-meeting-date" type="date" min="${moscowDate()}" max="9999-12-31" value="${escape(checkoutDraft.meeting_date??'')}" required>
    </label>
    ${checkoutFulfillment(checkoutDraft)}
    <div class="checkout-items">${items.map(item => `<div class="checkout-item"><span>${escape(item.name)}<small>${item.quantity} шт. × ${moneyMarkup(item.price)}</small></span><strong>${moneyMarkup(item.quantity * item.price)}</strong></div>`).join('')}</div>
    <div class="checkout-rubles">
      <div class="checkout-rubles-control">
        <strong>Списать бонусы</strong>
        <div class="quantity-control" role="group" aria-label="Списать бонусы">
          <button type="button" data-adjust-rubles="-1" aria-label="Уменьшить списание на ${checkoutSpendStep()} ₽">${icons.minus}</button>
          <output id="checkout-rubles-output" aria-label="Сумма списания">${moneyMarkup(0)}</output>
          <button type="button" data-adjust-rubles="1" aria-label="Увеличить списание на ${checkoutSpendStep()} ₽">${icons.plus}</button>
        </div>
      </div>
      <p id="checkout-rubles-limit" class="checkout-note"></p>
    </div>
    <section id="checkout-summary" class="checkout-summary" aria-label="Итог заказа">
      <dl>
        <div><dt>Получение</dt><dd id="checkout-summary-fulfillment"></dd></div>
        <div><dt>Дата</dt><dd id="checkout-summary-date"></dd></div>
      </dl>
      <dl class="checkout-summary-prices">
        <div><dt>Сумма</dt><dd>${moneyMarkup(total)}</dd></div>
        <div><dt>Скидка</dt><dd>${moneyMarkup(0)}</dd></div>
        <div><dt>Списано бонусов</dt><dd id="checkout-wallet-amount"></dd></div>
        <div><dt>Доставка</dt><dd id="checkout-delivery-fee"></dd></div>
      </dl>
      <div class="checkout-summary-total"><strong id="checkout-payable-label">Итого</strong><strong id="checkout-payable">${moneyMarkup(total)}</strong></div>
      <div class="checkout-summary-reward"><span>Будет начислено бонусов за заказ</span><strong>${cashback ? '+' : ''}${moneyMarkup(cashback)}</strong></div>
    </section>
    <p class="checkout-cash-note">${icons.wallet}Оплата только наличными</p>
    <p class="checkout-error" role="alert" hidden></p>
    <button class="primary-button" data-confirm-checkout>${pending ? 'Проверить заказ' : 'Подтвердить'}</button>
    <button class="primary-button secondary-button" data-cancel-checkout>Отмена</button>`, 'checkout');
  refreshCheckoutPayment();
  void loadHeaderBalance(true);
}
async function confirmCheckout() {
  if (checkoutSubmitting || !checkoutDraft) return;
  const errorElement = $('.checkout-error');
  if (!telegram?.initData) { errorElement.hidden = false; errorElement.textContent = 'Откройте магазин через Telegram, чтобы оформить заказ.'; return; }
  const draft = checkoutDraft, ownerKey = cartKey, dialogVersion = modalVersion, initData = telegram.initData;
  if (!checkoutLocked) {
    const date = $('#checkout-meeting-date');
    date.min = moscowDate();
    if (!date.validity.valid) {
      errorElement.hidden = false;
      errorElement.textContent = 'Выберите дату встречи, начиная с сегодняшнего дня.';
      date.focus();
      return;
    }
    draft.meeting_date = date.value;
    const method = $('#checkout-delivery').checked ? $('input[name="checkout-destination"]:checked').value : 'pickup';
    const location = method === 'metro' ? $('#checkout-metro-value') : method === 'address' ? $('#checkout-address') : null;
    if (location && (!location.value.trim() || !location.validity.valid)) {
      errorElement.hidden = false;
      errorElement.textContent = method === 'metro' ? 'Выберите станцию метро.' : 'Укажите адрес доставки.';
      if (method === 'metro') {
        setCheckoutMetroOpen(true);
        $('#checkout-metro').focus();
      } else location.focus();
      return;
    }
    draft.delivery_method = method;
    draft.delivery_location = location?.value.trim();
    draft.delivery_fee = method === 'metro' ? metroDeliveryFee() : 0;
  }
  const confirm = $('[data-confirm-checkout]'), cancel = $('[data-cancel-checkout]');
  checkoutSubmitting = true; confirm.disabled = true; cancel.disabled = true; confirm.textContent = 'Подтверждаем…'; errorElement.hidden = true;
  checkoutLocked = true; refreshCheckoutPayment();
  checkoutPending.set(ownerKey, draft);
  try { localStorage.setItem(ownerKey + ':checkout', JSON.stringify(draft)); } catch { /* Retain the in-memory request key on retry. */ }
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/storefront/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ ...draft, init_data: initData }) });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) void load();
      if ([400,409,429].includes(response.status)) {
        checkoutLocked = false;
        void loadHeaderBalance(true);
        checkoutPending.delete(ownerKey);
        try { localStorage.removeItem(ownerKey + ':checkout'); } catch { /* Storage can be unavailable. */ }
      }
      throw new Error(result.error || 'Не удалось подтвердить заказ. Повторите попытку.');
    }
    checkoutPending.delete(ownerKey);
    try { localStorage.removeItem(ownerKey + ':checkout'); } catch { /* Storage can be unavailable. */ }
    if (ownerKey === cartKey) {
      for (const item of draft.items) {
        const key = cartLineKey(item.product_id, item.flavor);
        const remaining = (cart.get(key) || 0) - item.quantity;
        if (remaining > 0) cart.set(key, remaining); else cart.delete(key);
      }
      saveCart(); updateBadge(); renderCart();
    }
    checkoutDraft = undefined;
    profileState = { key:'', status:'idle' };
    const { order } = result;
    const cancelled = order.status === 'cancelled';
    const title = `Заказ #${order.id} ${cancelled ? 'отменён' : 'принят'}`;
    const managerId = !cancelled && /^[1-9][0-9]{0,15}$/.test(order.manager_telegram_id) ? order.manager_telegram_id : '';
    applyHeaderBalance(initData,order.balance_after);
    if ($('#details').open && modalVersion === dialogVersion) {
      show(`<h2>${title}</h2>
        ${orderMeetingDate(order.meeting_date)}
        ${orderFulfillment(order)}
        ${order.delivery_fee ? `<div class="checkout-subtotal"><span>Доставка по метро</span><strong>${moneyMarkup(order.delivery_fee)}</strong></div>` : ''}
        ${order.balance_spent ? `<div class="checkout-subtotal"><span>${cancelled ? 'Возвращено рублей' : 'Оплата рублями'}</span><strong>${moneyMarkup(order.balance_spent)}</strong></div>` : ''}
        <div class="cart-total"><span>${order.address && !order.delivery_fee ? 'К оплате за товары' : 'К оплате'}</span><strong>${moneyMarkup(order.payable??order.total)}</strong></div>
        ${managerId ? `<p class="checkout-manager">Telegram ID менеджера <a href="tg://user?id=${managerId}">${managerId}</a></p>` : ''}
        <button class="primary-button" data-continue>Продолжить покупки${icons.arrow}</button>`, 'checkout');
    } else notify(managerId ? `${title}. Telegram ID менеджера ${managerId}` : title);
    void load();
  } catch (error) {
    if ($('#details').open && modalVersion === dialogVersion) {
      errorElement.hidden = false;
      errorElement.textContent = ['AbortError','TimeoutError','TypeError'].includes(error.name) ? 'Ответ не получен. Нажмите «Подтвердить» ещё раз: проверим сохранённый заказ без дублей.' : error.message;
    } else { if(activePage==='cart')renderCart(); notify('Проверьте заказ в корзине, чтобы узнать результат подтверждения.'); }
  } finally {
    clearTimeout(timeout);
    checkoutSubmitting = false;
    refreshCheckoutPayment();
    if (confirm.isConnected) { confirm.disabled = false; cancel.disabled = false; confirm.textContent = 'Подтвердить'; }
  }
}
async function navigateToPage(next, { toCatalog = false, profileSection = 'overview' } = {}) {
  if (!['home', 'cart', 'profile'].includes(next)) return;
  const version = ++pageSwitchVersion;
  await closeDetails();
  if (version !== pageSwitchVersion || $('#details').open) return;
  resetCatalogPull();
  if (next === activePage) {
    if (next === 'cart') renderCart();
    if (next === 'profile') renderProfile(profileSection);
    setNav();
    if (toCatalog) $('#catalog').scrollIntoView({ behavior: 'instant', block: 'start' });
    syncTelegramSwipes();
    return;
  }
  pageTransition?.cancel();
  pageScroll[activePage] = window.scrollY;
  stopCategorySlide();
  const previous = $(`#${activePage}-page`), target = $(`#${next}-page`);
  const transferFocus = previous.contains(document.activeElement);
  if (next === 'cart') renderCart();
  if (activePage === 'profile') {
    stopProfileTransition();
    previous.replaceChildren();
  }
  previous.hidden = true;
  target.hidden = false;
  activePage = next;
  if (next === 'profile') renderProfile(profileSection);
  setNav();
  window.scrollTo({ top: pageScroll[next], behavior: 'instant' });
  if (toCatalog) $('#catalog').scrollIntoView({ behavior: 'instant', block: 'start' });
  if (next === 'home') positionCategoryIndicator();
  syncTelegramSwipes();
  if (transferFocus || next === 'profile') target.focus({ preventScroll: true });
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

$('#profile-button').onclick = () => { void navigateToPage('profile'); };
$('#fullscreen-button')?.addEventListener('click',()=>requestTelegramFullscreen());
$('#banner').onclick=event=>{
 const step=event.target.closest('[data-banner-step]'),dot=event.target.closest('[data-banner-dot]'),banner=event.target.closest('[data-banner]');
 if(step)goToBanner(bannerIndex+Number(step.dataset.bannerStep));else if(dot)goToBanner(Number(dot.dataset.bannerDot));else if(banner)openBanner(Number(banner.dataset.banner));
};
$('#banner').addEventListener('dragstart',event=>event.preventDefault());
$('#banner').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key)||!event.target.closest('[data-banner-dot],[data-banner-step],.banner-open'))return;event.preventDefault();const next=bannerIndex+(event.key==='ArrowRight'?1:-1),target=(next+data.banners.length)%data.banners.length;goToBanner(next);document.querySelector(`[data-banner-dot="${target}"]`)?.focus({preventScroll:true});});
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
 const referralTab=event.target.closest('[data-referral-tab]');
 if(referralTab){
  referralView.tab=referralTab.dataset.referralTab;
  renderReferrals();
  $('#details').scrollTop=0;
  return;
 }
 const referralStatus=event.target.closest('[data-referral-status]');
 if(referralStatus){
  referralView.status=referralStatus.dataset.referralStatus;
  void loadReferrals();
  return;
 }
 if(event.target.closest('[data-referral-retry]')){void loadReferrals();return;}
 if(event.target.closest('[data-referral-more]')){if(!referralView.loading)void loadReferrals(true);return;}
 if(event.target.closest('[data-copy-referral]')){void copyReferralLink();return;}

 if(event.target.closest('[data-review-opportunities]')){void openReviewOpportunities();return;}
 if(event.target.closest('[data-more-review-opportunities]')){void openReviewOpportunities(true);return;}
 const purchase=event.target.closest('[data-review-purchase]');if(purchase){const [orderId,productId]=purchase.dataset.reviewPurchase.split(':').map(Number);void openReviewForm(productId,orderId);return;}
 const ownOrder=event.target.closest('[data-customer-order]');if(ownOrder){void openCustomerOrder(Number(ownOrder.dataset.customerOrder),ownOrder.dataset.orderOrigin||'orders');return;}
 if(event.target.closest('[data-customer-orders],[data-retry-orders]')){void openCustomerOrders();return;}
 if(event.target.closest('[data-more-orders]')){void openCustomerOrders(true);return;}
 if(event.target.closest('[data-back-customer-orders]')){if(currentCustomerHistory().orderOrigin==='accruals')void navigateToPage('profile',{profileSection:'accruals'});else void openCustomerOrders();return;}
 const retryOrder=event.target.closest('[data-retry-order]');if(retryOrder){void openCustomerOrder(Number(retryOrder.dataset.retryOrder));return;}
 const cancelOrder=event.target.closest('[data-cancel-customer-order]');if(cancelOrder){currentCustomerHistory().cancelConfirm=true;renderCustomerOrder(Number(cancelOrder.dataset.cancelCustomerOrder));return;}
 const keepOrder=event.target.closest('[data-keep-order]');if(keepOrder){currentCustomerHistory().cancelConfirm=false;renderCustomerOrder(Number(keepOrder.dataset.keepOrder));return;}
 const confirmCancel=event.target.closest('[data-confirm-order-cancel]');if(confirmCancel){void cancelCustomerOrder(Number(confirmCancel.dataset.confirmOrderCancel));return;}
 if(event.target.closest('[data-retry-accruals]')){void loadAccruals();return;}
 if(event.target.closest('[data-more-accruals]')){void loadAccruals(true);return;}

 const write=event.target.closest('[data-write-review]');if(write){void openReviewForm(Number(write.dataset.writeReview)||null);return;}
 const rating=event.target.closest('[data-review-rating]');if(rating&&reviewDraft&&!reviewDraft.busy){reviewDraft.rating=Number(rating.dataset.reviewRating);document.querySelectorAll('[data-review-rating]').forEach(button=>{button.classList.toggle('selected',Number(button.dataset.reviewRating)<=reviewDraft.rating);button.setAttribute('aria-pressed',String(Number(button.dataset.reviewRating)===reviewDraft.rating));});return;}
 if(event.target.closest('[data-review-submit]')){void submitReview();return;}
 if(event.target.closest('[data-review-back]')){
  const draft=reviewDraft;reviewDraft=null;
  if(draft?.origin==='review-opportunities')void openReviewOpportunities();
  else if(draft?.origin==='product')openProduct(draft.productId,{toReviews:true});
  else renderMyReviews();
  return;
 }
 if(event.target.closest('[data-review-retry]')){void loadReviewFeed(reviewFeed.next!==null);return;}
 if(event.target.closest('[data-review-more]')){if(!reviewFeed.loading)void loadReviewFeed(true);return;}
 const removeReview=event.target.closest('[data-remove-review-file]');if(removeReview&&reviewDraft&&!reviewDraft.busy){reviewDraft.files.splice(Number(removeReview.dataset.removeReviewFile),1);renderReviewForm();return;}
 if(event.target.closest('[data-review-more-choices]')&&reviewDraft&&!reviewDraft.busy){const draft=reviewDraft;draft.busy=true;void loadReviewEligibility(draft.productId,draft.next).then(result=>{if(reviewDraft===draft){draft.choices.push(...result.items);draft.next=result.next_offset;}}).catch(error=>{draft.error=error.message;}).finally(()=>{draft.busy=false;if(reviewDraft===draft&&$('#details').dataset.view==='review-form')renderReviewForm();});return;}

 const spend=event.target.closest('[data-adjust-rubles]');if(spend){adjustCheckoutRubles(Number(spend.dataset.adjustRubles));return;}
 const metroToggle = event.target.closest('#checkout-metro');
 if (metroToggle) {
  if (!metroToggle.disabled) setCheckoutMetroOpen(metroToggle.getAttribute('aria-expanded') !== 'true');
  return;
 }
 const metroStation = event.target.closest('[data-metro-station]');
 if (metroStation) {
  if (checkoutLocked) return;
  $('#checkout-metro-value').value = metroStation.dataset.metroStation;
  setCheckoutMetroOpen(false);
  if ($('.checkout-error').textContent.startsWith('Выберите станцию метро')) $('.checkout-error').hidden = true;
  refreshCheckoutPayment();
  $('#checkout-metro').focus();
  return;
 }
 if(event.target.closest('[data-my-reviews]')){renderMyReviews();return;}
 if(event.target.closest('[data-back-profile]')){void navigateToPage('profile');return;}
 if(event.target.closest('[data-retry-profile]')){void loadProfile();return;}
 if(event.target.closest('[data-more-reviews]')){void loadProfile(true);return;}
 if(event.target.closest('[data-checkout]')){openCheckout();return;}
 if(event.target.closest('[data-confirm-checkout]')){void confirmCheckout();return;}
 if(event.target.closest('[data-cancel-checkout]')){void closeDetails();return;}
 if(event.target.closest('[data-product-close]')){void closeDetails();return;}
 const share=event.target.closest('[data-share-product]');if(share){void shareProduct(Number(share.dataset.shareProduct));return;}
 const dot=event.target.closest('[data-gallery-dot]');if(dot){const track=$('#gallery-track');track.scrollTo({left:Number(dot.dataset.galleryDot)*track.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});return;}
 const step=event.target.closest('[data-gallery-step]');
 if(step){const track=$('#gallery-track');const index=Math.round(track.scrollLeft/Math.max(1,track.clientWidth));track.scrollTo({left:Math.max(0,Math.min(track.children.length-1,index+Number(step.dataset.galleryStep)))*track.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});return;}
  const add = event.target.closest('[data-add]');
  const quantity = event.target.closest('[data-cart-change]');
  const remove = event.target.closest('[data-remove]');
  const product = event.target.closest('[data-open-product]');
  const tab = event.target.closest('[data-profile-tab]');
  if (add) changeCart(Number(add.dataset.add), 1, add);
  else if (quantity || remove) {
    const rawKey = quantity?.dataset.cartId ?? remove.dataset.remove;
    const key = rawKey.includes(':') ? rawKey : Number(rawKey);
    const delta = quantity ? Number(quantity.dataset.cartChange) : -(cart.get(key) || 0);
    changeCart(key, delta, quantity);
  } else if (product) openProduct(Number(product.dataset.openProduct));
  else if (tab) void switchProfileTab(tab.dataset.profileTab);
  else if (event.target.closest('[data-open-cart]')) void navigateToPage('cart');
  else if (event.target.closest('[data-continue]')) void continueShopping();
}
$('#detail-content').onclick = handleCartAction;
$('#detail-content').addEventListener('keydown',event=>{
 const picker = event.target.closest('#checkout-metro-location');
 if (!picker || !['ArrowUp','ArrowDown','Home','End'].includes(event.key) || $('#checkout-metro').matches(':disabled')) return;
 const stations = [...picker.querySelectorAll('[data-metro-station]')];
 if (!stations.length) return;
 event.preventDefault();
 setCheckoutMetroOpen(true);
 const index = stations.indexOf(event.target);
 const last = stations.length-1;
 const next = event.key==='Home' ? 0 : event.key==='End' ? last
   : event.key==='ArrowDown' ? Math.min(index+1,last) : index<0 ? last : Math.max(index-1,0);
 stations[next].focus();
});
$('#detail-content').addEventListener('change',event=>{
 if(event.target.matches('#checkout-fulfillment input[type="radio"], #checkout-meeting-date'))refreshCheckoutPayment();
 if(event.target.id==='review-sort'){reviewFeed.sort=event.target.value;void loadReviewFeed();}
 if(event.target.id==='review-media-only'){reviewFeed.media=event.target.checked;void loadReviewFeed();}
 if(event.target.id==='review-files')void uploadReviewFiles([...event.target.files]);
 if(event.target.id==='review-purchase'&&reviewDraft&&!reviewDraft.busy){reviewDraft.selected=event.target.value;reviewDraft.files=[];renderReviewForm();}
});
$('#detail-content').addEventListener('input',event=>{if(event.target.id==='review-text'&&reviewDraft)reviewDraft.text=event.target.value;});
$('#detail-content').addEventListener('input',event=>{if(event.target.matches('#checkout-address, #checkout-meeting-date'))refreshCheckoutPayment();});
$('#cart-content').onclick = handleCartAction;
$('#profile-page').onclick = handleCartAction;
$('#profile-page').addEventListener('keydown', event => {
  if (!event.target.closest('[role="tablist"]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const current = $('[role="tab"][aria-selected="true"]').dataset.profileTab;
  const tab = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'accruals' : current === 'overview' ? 'accruals' : 'overview';
  void switchProfileTab(tab);
});
document.addEventListener('click', event => { if (event.target.id === 'retry') load(); });
$('#telegram-sdk')?.addEventListener('load', () => {
  telegram = window.Telegram?.WebApp;
  configureTelegram();
  syncTelegramSwipes();
  user = telegram?.initDataUnsafe?.user;
  updateClientAvatar();
  trackReferralVisit();
  if($('#details').open&&$('#details').dataset.view==='referral'&&referralView?.key!==(telegram?.initData||''))openReferrals();
  void loadHeaderBalance();
  if(data)openStartProduct();
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
  if(reviewIdentity!==(telegram?.initData||'')){reviewIdentity=telegram?.initData||'';reviewEligibilityVersion++;const draft=reviewDraft;reviewDraft=null;reviewEligibility={key:null,items:[],next:null,loaded:false};if($('#details').open&&$('#details').dataset.view==='review-form')void openReviewForm(draft?.productId,null,draft?.origin);else if(dialogViewOpen('product'))void updateProductReviewButton(Number($('#details').dataset.productId));}
  if(dialogViewOpen('my-orders')||dialogViewOpen('order-detail'))void openCustomerOrders();
  if($('#details').open&&$('#details').dataset.view==='review-opportunities')void openReviewOpportunities();
  void refreshReviewEligibility();
  refreshProfileView();
});
updateClientAvatar();
trackReferralVisit();
void loadHeaderBalance();
void refreshReviewEligibility();
load();
configureTelegram();
syncTelegramSwipes();
signalReadyWithoutSdk();
document.addEventListener('visibilitychange',()=>{if(!document.hidden){trackReferralVisit();void loadHeaderBalance(true);void refreshReviewEligibility();}});
setInterval(()=>{if(!document.hidden)void refreshReviewEligibility();},60000);

document.addEventListener('click',event=>{const button=event.target.closest('button');if(!event.isTrusted||!button||button.disabled)return;try{if(telegram?.HapticFeedback?.impactOccurred)telegram.HapticFeedback.impactOccurred('light');else if(telegram||window.TelegramWebviewProxy)postTelegramEvent('web_app_trigger_haptic_feedback',{type:'impact',impact_style:'light'});else navigator.vibrate?.(8);}catch{}});
document.addEventListener('touchmove',event=>{if(event.touches.length>1&&event.cancelable)event.preventDefault();},{passive:false});
for(const type of ['gesturestart','gesturechange'])document.addEventListener(type,event=>event.preventDefault(),{passive:false});
document.addEventListener('dblclick',event=>{if(!event.target.closest('input,textarea'))event.preventDefault();});

// Touch must not leave the keyboard focus ring behind after the native share sheet.
document.documentElement.dataset.input='pointer';
for(const type of ['pointerdown','touchstart'])document.addEventListener(type,()=>{document.documentElement.dataset.input='pointer';},{capture:true,passive:true});
document.addEventListener('keydown',event=>{if(event.key==='Tab'||event.key.startsWith('Arrow'))document.documentElement.dataset.input='keyboard';},true);
