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
const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
const money = value => new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'RUB', maximumFractionDigits: 0
}).format(value);
let data, category = '', loading = false;

const photo = product => /^data:image\/(jpeg|png|webp);base64,/.test(product.image)
  ? `<div class="photo"><img src="${escape(product.image)}" alt="${escape(product.name)}"></div>`
  : '<div class="photo photo-empty"><span class="placeholder-mark" aria-hidden="true">GAS</span><small>Фото скоро появится</small></div>';

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

function show(html) {
  $('#detail-content').innerHTML = html;
  $('#detail-content h2').id = 'detail-title';
  if (!$('#details').open) $('#details').showModal();
  $('#details').scrollTop = 0;
}

function render() {
  const query = $('#search').value.trim().toLocaleLowerCase('ru');
  const items = data.products.filter(product => (!category || product.category === category)
    && (!query || `${product.name} ${product.short_description} ${product.category}`.toLocaleLowerCase('ru').includes(query)));
  $('#count').textContent = `${items.length} товаров`;
  $('#products').innerHTML = items.map(product => `
    <button class="product" data-product="${product.id}">
      ${photo(product)}
      <div class="product-body">
        <small class="product-category">${escape(product.category)}</small>
        <h3>${escape(product.name)}</h3>
        <div class="product-bottom"><span class="price">${money(product.price)}</span><span class="product-arrow" aria-hidden="true">${arrow}</span></div>
        <span class="stock ${product.stock > 0 ? 'in-stock' : ''}">${product.stock > 0 ? 'В наличии' : 'Нет в наличии'}</span>
      </div>
    </button>`).join('');
  $('#status').hidden = Boolean(items.length);
  $('#status').textContent = data.products.length
    ? 'По вашему запросу ничего не найдено.'
    : 'Товары скоро появятся. Загляните чуть позже.';
  const scroll = $('#categories').scrollLeft;
  $('#categories').innerHTML = [['', 'Все товары'], ...data.categories.map(name => [name, name])]
    .map(([value, label]) => `<button data-category="${escape(value)}" aria-pressed="${category === value}">${escape(label)}</button>`).join('');
  $('#categories').scrollLeft = scroll;
}

async function load() {
  if (loading) return;
  loading = true;
  $('#refresh').disabled = true;
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
        ${safe ? `<a class="banner-link" href="${escape(banner.link)}" target="_blank" rel="noopener noreferrer" aria-label="Подробнее: ${escape(banner.title)}">${arrow}</a>` : ''}`;
    }
    render();
  } catch {
    $('#status').hidden = false;
    $('#status').innerHTML = 'Не удалось обновить каталог.<br><button class="retry" id="retry">Повторить</button>';
  } finally {
    loading = false;
    $('#refresh').disabled = false;
  }
}

$('#refresh').onclick = load;
$('#search-toggle').onclick = () => {
  const open = $('#search-panel').hidden;
  $('#search-panel').hidden = !open;
  $('#search-toggle').setAttribute('aria-expanded', String(open));
  if (open) $('#search').focus();
  else {
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
  const button = event.target.closest('[data-product]');
  if (!button) return;
  const product = data.products.find(item => item.id === Number(button.dataset.product));
  show(`${photo(product)}<h2>${escape(product.name)}</h2><strong class="price">${money(product.price)}</strong>
    <p>${product.stock > 0 ? 'В наличии' : 'Нет в наличии'}</p>${formatted(product.short_description)}${formatted(product.description)}`);
  fetch(`/api/storefront/products/${product.id}/view`, { method: 'POST', credentials: 'omit' }).catch(() => {});
};
$('.stories').onclick = event => {
  const button = event.target.closest('[data-info]');
  if (!button) return;
  if (!data) {
    show('<h2>Информация недоступна</h2><p>Сначала загрузите каталог.</p>');
    return;
  }
  if (button.dataset.info === 'important') {
    const shop = data.shop;
    const information = formatted(shop.headline) + formatted(shop.description)
      + [shop.phone, shop.address, shop.hours].filter(Boolean).map(value => `<p>${escape(value)}</p>`).join('');
    show(`<h2>Важно прочитать</h2>${[shop.headline, shop.description, shop.phone, shop.address, shop.hours].some(Boolean)
      ? information : '<p>Информация о магазине скоро появится.</p>'}`);
  } else if (button.dataset.info === 'referral') {
    const referral = data.referral;
    show(`<h2>Реферальная программа</h2>${referral.enabled
      ? `<p>Бонус за приглашение: ${money(referral.bonus)}.</p><p>Минимальная выплата: ${money(referral.minPayout)}.</p><p>Условия участия уточняйте у магазина.</p>`
      : '<p>Реферальная программа пока не действует.</p>'}`);
  } else {
    show(`<h2>Отзывы</h2>${data.reviews.map(review => `<article>
      <strong aria-label="Оценка ${review.rating} из 5">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</strong>
      <p>${escape(review.text)}</p><small>${escape(review.product_name)} · ${new Date(review.created_at).toLocaleDateString('ru-RU')}</small>
      </article>`).join('') || '<p>Опубликованных отзывов пока нет.</p>'}`);
  }
};
$('#shop-info').onclick = () => $('[data-info="important"]').click();
$('.close').onclick = () => $('#details').close();
$('#details').onclick = event => {
  if (event.target !== $('#details')) return;
  const rect = event.target.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
};
document.addEventListener('click', event => { if (event.target.id === 'retry') load(); });
load();
