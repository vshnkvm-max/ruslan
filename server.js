import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './lib/database.js';
import { token, digest, verifyPasswordAsync, hashPassword, hashPasswordAsync } from './lib/auth.js';
import { createProductImages, legacyImages } from './lib/product-images.js';
import { createStaticAssets } from './lib/static-assets.js';
import { loadOrderHistory } from './lib/order-history.js';
import { sendJson } from './lib/http-response.js';

const root = dirname(fileURLToPath(import.meta.url));
const sessionDuration = 12 * 60 * 60 * 1000;
const dummyPassword = hashPassword(token());
class HttpError extends Error { constructor(status,message) { super(message); this.status=status; } }
const fail = (status,message) => { throw new HttpError(status,message); };
const str = (v,name,max=200,required=true) => {
  if(typeof v!=='string' || v.length>max || (required&&!v.trim())) fail(400,`Проверьте поле «${name}».`);
  return v.trim();
};
const num = (v,name,max=100000000) => {
  if(!Number.isSafeInteger(v)||v<0||v>max) fail(400,`Проверьте поле «${name}».`);
  return v;
};
const bool = v => { if(typeof v!=='boolean') fail(400,'Ожидается логическое значение.'); return Number(v); };
const passwordValue = v => { if(typeof v!=='string'||!v.length||v.length>1024) fail(400,'Проверьте поле «Пароль».'); return v; };
const choice = (v,options) => { if(!options.includes(v)) fail(400,'Недопустимое значение.'); return v; };
const safeLink = v => {
  v=str(v,'Ссылка',500,false);
  if(v && !(/^\/(?!\/)/.test(v)||/^https:\/\/[^\s]+$/i.test(v))) fail(400,'Укажите относительную ссылку или адрес HTTPS.');
  return v;
};
const imageKeys = legacyImages;

function imageValue(value, allowLegacy=false) {
 if(value===''||(allowLegacy&&imageKeys.includes(value)))return value;
 if(typeof value!=='string'||value.length>700000)fail(400,'Фото слишком большое.');
 const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!match)fail(400,'Используйте фото JPG, PNG или WebP.');
 const bytes=Buffer.from(match[2],'base64');
 const valid=match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!valid||bytes.toString('base64')!==match[2])fail(400,'Некорректный файл изображения.');
 return value;
}

export function createApp({dbPath=process.env.DB_PATH || resolve(root,'.data/shop.db'), secureCookie=process.env.COOKIE_SECURE==='true'}={}) {
  const db=openDatabase(dbPath);
  const productImages=createProductImages(db,imageValue,fail);
  const serveStatic=createStaticAssets(root);
  const attempts=new Map();
  let activePasswordWork=0;
  async function passwordWork(work) {
    if(activePasswordWork>=2)fail(429,'Сервер обрабатывает вход. Повторите через несколько секунд.');
    activePasswordWork++;
    try {return await work();}finally {activePasswordWork--;}
  }
  const getSession=req=>{
    const cookie=req.headers.cookie?.match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/)?.[1];
    return cookie?db.prepare('SELECT s.*,a.username FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token=? AND s.expires>?').get(digest(cookie),Date.now()):null;
  };
  const getSettings=key => JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(key).value);
  const saveSettings=(key,value)=> db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(value),key);
  const products=()=>productImages.serializeAll(db.prepare(`SELECT p.*, (SELECT AVG(rating) FROM reviews WHERE product_id=p.id AND status='published') AS rating, (SELECT COUNT(*) FROM reviews WHERE product_id=p.id AND status='published') AS review_count FROM products p WHERE p.deleted=0 ORDER BY p.sort_order,p.id DESC`).all());
  const bannerPath=row=>row.image?`/api/banner-images/${row.id}?v=${digest(row.image)}`:'';
  const serializeBanner=row=>({...row,image:bannerPath(row)});
  const categories=()=>[...new Set([...getSettings('categories'),...db.prepare("SELECT DISTINCT category FROM products WHERE deleted=0 AND category!=''").all().map(p=>p.category)])].filter(Boolean);
  const bootstrap=()=>({
    products:products(),...loadOrderHistory(db),categories:categories(),
    reviews:db.prepare('SELECT r.*,c.name AS customer_name,p.name AS product_name FROM reviews r JOIN customers c ON c.id=r.customer_id JOIN products p ON p.id=r.product_id ORDER BY r.created_at DESC').all(),
    purchases:db.prepare('SELECT * FROM purchases ORDER BY id DESC').all().map(p=>({...p,items:JSON.parse(p.items)})),
    referrals:db.prepare('SELECT r.*,c.name AS inviter_name,c.referral_code,i.name AS invitee_name FROM referrals r JOIN customers c ON c.id=r.inviter_id JOIN customers i ON i.id=r.invitee_id ORDER BY r.created_at DESC').all(),
    banners:db.prepare('SELECT * FROM banners ORDER BY id').all().map(serializeBanner),shop:getSettings('shop'),referral:getSettings('referral')
  });
  async function body(req) {
    if(!req.headers['content-type']?.startsWith('application/json')) fail(415,'Ожидается JSON.');
    let size=0; const chunks=[];
    for await(const chunk of req) { size+=chunk.length; if(size>(/^\/api\/(?:products|banners|images)(?:\/\d+)?$/.test(req.url?.split('?')[0])?750000:65536)) fail(413,'Слишком большой запрос.');chunks.push(chunk); }
    try { const value=JSON.parse(Buffer.concat(chunks).toString()); if(!value||typeof value!=='object'||Array.isArray(value)) fail(400,'Неверный JSON.'); return value; }
    catch { fail(400,'Неверный JSON.'); }
  }
  const server=createServer(async(req,res)=>{
    const json=(response,status,data,headers)=>sendJson(req,response,status,data,headers);
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    try {
      let url;try {url=new URL(req.url,'http://localhost');}catch {fail(400,'Некорректный адрес запроса.');}
      const path=url.pathname,method=req.method;
      const miniPage=['/miniapp','/miniapp/'].includes(path);
      if(!miniPage)res.setHeader('X-Frame-Options','DENY');
      res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' ${miniPage ? 'https://telegram.org' : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: ${miniPage?'https:':''}; connect-src 'self'; frame-ancestors ${miniPage ? 'https://web.telegram.org https://*.telegram.org' : "'none'"}; base-uri 'self'; form-action 'self'`);
      const bannerMatch=path.match(/^\/api\/banner-images\/(\d+)$/);
      if(bannerMatch) {
        if(!['GET','HEAD'].includes(method))fail(405,'Метод не поддерживается.');
        const banner=db.prepare('SELECT id,image,active FROM banners WHERE id=?').get(Number(bannerMatch[1]));
        if(!banner?.image||(!banner.active&&!getSession(req)))fail(404,'Баннер не найден.');
        const hash=digest(banner.image);
        if(url.searchParams.get('v')!==hash)fail(404,'Изображение баннера изменилось.');
        const match=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(banner.image);
        if(!match)fail(404,'Изображение не найдено.');
        const etag=`"${hash}"`;
        res.setHeader('Cache-Control',banner.active?'public, max-age=86400, immutable':'private, no-store');
        res.setHeader('ETag',etag);
        if(req.headers['if-none-match']===etag){res.writeHead(304);res.end();return;}
        const content=Buffer.from(match[2],'base64');
        res.writeHead(200,{'Content-Type':match[1],'Content-Length':content.length});res.end(method==='HEAD'?undefined:content);return;
      }
      const imageMatch=path.match(/^\/api\/images\/([a-f0-9-]{36})$/);
      if(imageMatch) {
        if(!['GET','HEAD'].includes(method))fail(405,'Метод не поддерживается.');
        const image=db.prepare('SELECT i.data,p.active,p.deleted FROM product_images i LEFT JOIN products p ON p.id=i.product_id WHERE i.id=?').get(imageMatch[1]);
        if(!image)fail(404,'Фотография не найдена.');
        const published=image.active===1&&image.deleted===0;
        if(!published&&!getSession(req))fail(404,'Фотография не найдена.');
        const [,type,encoded]=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image.data);
        const etag=`"${imageMatch[1]}"`;
        res.setHeader('Cache-Control',published?'public, max-age=86400, immutable':'private, no-store');
        res.setHeader('ETag',etag);
        if(req.headers['if-none-match']===etag){res.writeHead(304);res.end();return;}
        const content=Buffer.from(encoded,'base64');
        res.writeHead(200,{'Content-Type':type,'Content-Length':content.length});
        res.end(method==='HEAD'?undefined:content);return;
      }
      if(path.startsWith('/api/')) {
        if(!['GET','POST','PATCH','DELETE'].includes(method)) fail(405,'Метод не поддерживается.');
        if(method!=='GET' && req.headers.origin) {
          let origin; try {origin=new URL(req.headers.origin);}catch {fail(403,'Недопустимый источник запроса.');}
          if(origin.host!==req.headers.host) fail(403,'Недопустимый источник запроса.');
        }
        if(path==='/api/health'&&method==='GET') return json(res,200,{ok:true});
        if(path==='/api/storefront'&&method==='GET') {
          const shop=getSettings('shop');
          const catalog=productImages.serializeAll(db.prepare('SELECT id,name,sku,category,price,stock,image,description,short_description FROM products WHERE active=1 AND deleted=0 ORDER BY sort_order,id DESC').all(),true);
          return json(res,200,{shop,categories:[...new Set([...getSettings('categories'),...catalog.map(p=>p.category)])].filter(Boolean),referral:getSettings('referral'),reviews:db.prepare("SELECT r.id,r.product_id,r.rating,r.text,r.created_at,p.name AS product_name FROM reviews r JOIN products p ON p.id=r.product_id WHERE r.status='published' AND p.active=1 AND p.deleted=0 ORDER BY r.created_at DESC").all(),products:catalog.map(({id,name,sku,category,price,stock,image,images,description,short_description})=>({id,name,sku,category,price,stock,image,images,description,short_description})),banners:db.prepare('SELECT * FROM banners WHERE active=1 ORDER BY id').all().map(serializeBanner)});
        }
        const productView=path.match(/^\/api\/storefront\/products\/(\d+)\/view$/);
        if(productView&&method==='POST') {
          const result=db.prepare('UPDATE products SET views=views+1 WHERE id=? AND active=1 AND deleted=0').run(Number(productView[1]));
          if(!result.changes) fail(404,'Товар не найден.');
          return json(res,200,{ok:true});
        }
        if(path==='/api/auth/login'&&method==='POST') {
          const key=req.socket.remoteAddress; const now=Date.now();
          for(const [ip,entry] of attempts) if(now-entry.started>900000) attempts.delete(ip);
          if((attempts.get(key)?.count||0)>=10)fail(429,'Слишком много попыток. Повторите через 15 минут.');
          const b=await body(req); const username=str(b.username,'Логин',80); const password=passwordValue(b.password);
          const attempt=attempts.get(key)||{count:0,started:Date.now()};
          if(attempt.count>=10)fail(429,'Слишком много попыток. Повторите через 15 минут.');
          const admin=db.prepare('SELECT * FROM admins WHERE username=?').get(username);
          const valid=await passwordWork(async()=>{
            // Reserve this attempt before yielding so concurrent requests share the limit.
            attempt.count++;attempts.set(key,attempt);
            return verifyPasswordAsync(password,admin?.password||dummyPassword);
          });
          if(!admin||!valid)fail(401,'Неверный логин или пароль.');
          if(db.prepare('SELECT password FROM admins WHERE id=?').get(admin.id)?.password!==admin.password)fail(401,'Пароль изменён. Войдите заново.');
          attempts.delete(key);
          db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
          const sessionToken=token(),csrf=token();
          db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(sessionToken),admin.id,csrf,now+sessionDuration);
          return json(res,200,{username:admin.username,csrf},{'Set-Cookie':`session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secureCookie?'; Secure':''}`});
        }
        const session=getSession(req);
        if(!session) fail(401,'Войдите в аккаунт администратора.');
        if(method!=='GET'&&req.headers['x-csrf-token']!==session.csrf) fail(403,'Сессия запроса недействительна. Обновите страницу.');
        if(path==='/api/auth/me'&&method==='GET') return json(res,200,{username:session.username,csrf:session.csrf});
        if(path==='/api/auth/logout'&&method==='POST') {db.prepare('DELETE FROM sessions WHERE token=?').run(session.token);return json(res,200,{ok:true},{'Set-Cookie':`session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie?'; Secure':''}`});}
        if(path==='/api/bootstrap'&&method==='GET') return json(res,200,{...bootstrap(),user:{username:session.username,csrf:session.csrf}});
        if(path==='/api/images'&&method==='POST') return json(res,201,{image:productImages.upload((await body(req)).image)});
        const match=path.match(/^\/api\/(products|customers|orders|reviews|banners)\/(\d+)$/);
        if(match) {
          const [,table,idText]=match; const id=Number(idText);
          if(!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id)) fail(404,'Запись не найдена.');
          if(method==='DELETE'&&['products','customers'].includes(table)) {db.prepare(`UPDATE ${table} SET deleted=1 WHERE id=?`).run(id);return json(res,200,{ok:true});}
          if(method==='DELETE'&&table==='banners') {db.prepare('DELETE FROM banners WHERE id=?').run(id);return json(res,200,{ok:true});}
          if(method!=='PATCH') fail(405,'Метод не поддерживается.');
          const b=await body(req);
          if(table==='products') {
            if(Object.keys(b).length===1&&'sort_order' in b){db.prepare('UPDATE products SET sort_order=? WHERE id=?').run(num(b.sort_order,'Сортировка',1000000),id);return json(res,200,{ok:true});}
            if(Object.keys(b).length===1&&'active' in b){db.prepare('UPDATE products SET active=? WHERE id=?').run(bool(b.active),id);return json(res,200,{ok:true});}
            const saved=db.prepare('SELECT * FROM products WHERE id=?').get(id);
            if(b.stock!==undefined&&b.stock!==saved.stock)fail(400,'Остатки изменяются через документы закупки.');
            b.sku??=saved.sku;b.short_description??=saved.short_description;b.stock??=saved.stock;
            const p=validateProduct(b),sort=num(b.sort_order??saved.sort_order,'Сортировка',1000000);
            db.exec('BEGIN IMMEDIATE');
            try {
              db.prepare('UPDATE products SET name=?,sku=?,category=?,price=?,cost=?,stock=?,active=?,image=?,description=?,short_description=?,sort_order=? WHERE id=?').run(...p,sort,id);
              productImages.replace(id,b,saved);
              db.exec('COMMIT');
            } catch(error){db.exec('ROLLBACK');throw error;}
          } else if(table==='customers') {
            if(Object.keys(b).length===1&&'banned' in b){const banned=bool(b.banned);db.prepare("UPDATE customers SET banned=?,status=? WHERE id=?").run(banned,banned?'banned':'active',id);}
            else {const saved=db.prepare('SELECT email,city FROM customers WHERE id=?').get(id);const c=validateCustomer({...b,email:b.email??saved.email,city:b.city??saved.city});db.prepare('UPDATE customers SET name=?,username=?,phone=?,email=?,city=?,status=?,banned=? WHERE id=?').run(...c,id);}
          }
          else if(table==='orders') db.prepare('UPDATE orders SET status=? WHERE id=?').run(choice(b.status,['new','accepted','completed','cancelled']),id);
          else if(table==='reviews') db.prepare('UPDATE reviews SET status=? WHERE id=?').run(choice(b.status,['pending','published','hidden']),id);
          else if(table==='banners') {
            const saved=db.prepare('SELECT id,image,description,link FROM banners WHERE id=?').get(id);
            if(b.image===undefined||b.image===bannerPath(saved))b.image=saved.image;
            b.description??=saved.description;b.link??=saved.link;
            db.prepare('UPDATE banners SET title=?,subtitle=?,color=?,link=?,active=?,image=?,description=? WHERE id=?').run(...validateBanner(b),id);
          }
          return json(res,200,{ok:true});
        }
        if(path==='/api/categories'&&method==='POST') {const b=await body(req);const name=str(b.name,'Категория',80);saveSettings('categories',[...new Set([...getSettings('categories'),name])]);return json(res,201,{name});}
        if(path==='/api/categories/order'&&method==='PATCH') {
          const names=(await body(req)).names,current=categories();
          if(!Array.isArray(names)||names.length!==current.length||new Set(names).size!==names.length||names.some(name=>typeof name!=='string'||!current.includes(name)))fail(409,'Список категорий изменился. Обновите панель и повторите сортировку.');
          saveSettings('categories',names);return json(res,200,{categories:names});
        }
        if(path==='/api/categories'&&method==='DELETE') {
          const name=str((await body(req)).name,'Категория',80);
          if(!categories().includes(name))fail(404,'Категория не найдена.');
          db.exec('BEGIN IMMEDIATE');
          try {
            saveSettings('categories',getSettings('categories').filter(value=>value!==name));
            db.prepare("UPDATE products SET category='' WHERE category=? AND deleted=0").run(name);
            db.exec('COMMIT');
          }catch(error){db.exec('ROLLBACK');throw error;}
          return json(res,200,{ok:true});
        }
        if(path==='/api/customers'&&method==='POST') {const c=validateCustomer(await body(req));const result=db.prepare('INSERT INTO customers (name,username,phone,email,city,status,banned,joined,referral_code) VALUES (?,?,?,?,?,?,?,?,?)').run(...c,new Date().toISOString(),token().slice(0,12));return json(res,201,{id:Number(result.lastInsertRowid)});}
        if(path==='/api/products'&&method==='POST') {
          const b=await body(req),key=b.request_key===undefined?null:str(b.request_key,'Ключ товара',80);
          const existing=key?db.prepare('SELECT id,deleted FROM products WHERE create_key=?').get(key):null;
          if(existing){if(existing.deleted)fail(409,'Этот товар уже удалён. Откройте новую форму.');return json(res,200,{id:existing.id});}
          b.stock??=0;
          if(num(b.stock,'Остаток',1000000)!==0)fail(400,'Новый товар создаётся без остатков. Добавьте поступление через закупку.');
          b.sku??=token().slice(0,32);
          const p=validateProduct(b),sort=num(b.sort_order??100,'Сортировка',1000000);
          db.exec('BEGIN IMMEDIATE');
          try {
            const r=db.prepare('INSERT INTO products (name,sku,category,price,cost,stock,active,image,description,short_description,sort_order,create_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(...p,sort,key);
            const id=Number(r.lastInsertRowid);
            productImages.replace(id,b);
            db.exec('COMMIT');return json(res,201,{id});
          } catch(error){db.exec('ROLLBACK');throw error;}
        }
        if(path==='/api/banners'&&method==='POST') {const p=validateBanner(await body(req));const r=db.prepare('INSERT INTO banners (title,subtitle,color,link,active,image,description) VALUES (?,?,?,?,?,?,?)').run(...p);return json(res,201,{id:Number(r.lastInsertRowid)});}
        const purchaseMatch=path.match(/^\/api\/purchases(?:\/(\d+))?$/);
        if(purchaseMatch&&['POST','PATCH'].includes(method)) {
          if((method==='POST')===Boolean(purchaseMatch[1])) fail(405,'Метод не поддерживается.');
          const b=await body(req),posted=bool(b.posted),paid=num(b.paid,'Оплачено');
          const supplier=str(b.supplier,'Поставщик'),comment=str(b.comment??'','Комментарий',2000,false);
          const requestKey=str(b.request_key,'Ключ документа',80);
          const previous=purchaseMatch[1]?db.prepare('SELECT * FROM purchases WHERE id=?').get(Number(purchaseMatch[1])):null;
          if(purchaseMatch[1]&&!previous) fail(404,'Закупка не найдена.');
          const store=str(b.store??previous?.store??'','Магазин',200,false);
          if(previous?.posted) fail(409,'Проведённая закупка доступна только для просмотра.');
          if(method==='POST') {const existing=db.prepare('SELECT id FROM purchases WHERE request_key=?').get(requestKey);if(existing)return json(res,200,{id:existing.id});}
          if(!Array.isArray(b.items)||!b.items.length||b.items.length>100) fail(400,'Добавьте от 1 до 100 товаров.');
          const seen=new Set();let total=0;
          const items=b.items.map(item=>{
            const id=num(item.product_id,'Товар'),quantity=num(item.quantity,'Количество',1000000),cost=num(item.cost,'Цена закупки');
            if(!quantity||seen.has(id))fail(400,'Количество должно быть больше нуля; товары не должны повторяться.');seen.add(id);
            const product=db.prepare('SELECT * FROM products WHERE id=? AND deleted=0 AND active=1').get(id);
            if(!product)fail(400,'Один из товаров удалён или находится в архиве.');
            if(posted&&product.stock+quantity>1000000)fail(400,'Остаток товара превысит 1000000.');
            total+=quantity*cost;if(!Number.isSafeInteger(total)||total>100000000)fail(400,'Сумма закупки превышает 100000000 ₽.');
            return {product_id:id,name:product.name,sku:product.sku,quantity,cost};
          });
          if(paid>total)fail(400,'Оплата не может превышать итог закупки.');
          let id;db.exec('BEGIN IMMEDIATE');
          try {
            if(previous){id=previous.id;db.prepare('UPDATE purchases SET supplier=?,store=?,posted=?,paid=?,total=?,comment=?,items=? WHERE id=?').run(supplier,store,posted,paid,total,comment,JSON.stringify(items),id);}
            else {id=Number(db.prepare('INSERT INTO purchases (supplier,store,posted,paid,total,comment,items,created_at,request_key) VALUES (?,?,?,?,?,?,?,?,?)').run(supplier,store,posted,paid,total,comment,JSON.stringify(items),new Date().toISOString(),requestKey).lastInsertRowid);}
            if(posted){for(const item of items)db.prepare('UPDATE products SET stock=stock+?,cost=? WHERE id=?').run(item.quantity,item.cost,item.product_id);
              if(paid){const payment=db.prepare('INSERT INTO transactions (type,category,description,amount,created_at) VALUES (?,?,?,?,?)').run('expense','Закупка',`Закупка #${id} · ${supplier}`,paid,new Date().toISOString());db.prepare('UPDATE purchases SET transaction_id=? WHERE id=?').run(Number(payment.lastInsertRowid),id);}}
            db.exec('COMMIT');
          }catch(error){db.exec('ROLLBACK');throw error;}
          return json(res,previous?200:201,{id});
        }
        if(path==='/api/transactions'&&method==='POST') {
          const b=await body(req);const amount=num(b.amount,'Сумма');if(!amount) fail(400,'Сумма должна быть больше нуля.');
          const r=db.prepare('INSERT INTO transactions (type,category,description,amount,created_at) VALUES (?,?,?,?,?)').run(choice(b.type,['income','expense']),str(b.category,'Категория',80),str(b.description,'Описание'),amount,new Date().toISOString());return json(res,201,{id:Number(r.lastInsertRowid)});
        }
        if(path==='/api/settings/shop'&&method==='PATCH') {const b=await body(req);b.address??=getSettings('shop').address;const shop={};for(const key of ['name','headline','description','phone','address','hours']) shop[key]=str(b[key],key,key==='description'?2000:200,key==='name');saveSettings('shop',shop);return json(res,200,{ok:true});}
        if(path==='/api/settings/referral'&&method==='PATCH') {const b=await body(req);saveSettings('referral',{enabled:Boolean(bool(b.enabled)),bonus:num(b.bonus,'Бонус',100000),minPayout:num(b.minPayout,'Минимальная выплата',1000000)});return json(res,200,{ok:true});}
        if(path==='/api/auth/password'&&method==='POST') {
          const b=await body(req);const current=passwordValue(b.current);const next=passwordValue(b.password);
          if(next.length<12) fail(400,'Новый пароль должен содержать не менее 12 символов.');
          const admin=db.prepare('SELECT * FROM admins WHERE id=?').get(session.admin_id);
          const replacement=await passwordWork(async()=>{
            if(!await verifyPasswordAsync(current,admin.password))fail(400,'Текущий пароль неверен.');
            return hashPasswordAsync(next);
          });
          if(!getSession(req))fail(401,'Войдите в аккаунт администратора.');
          if(!db.prepare('UPDATE admins SET password=? WHERE id=? AND password=?').run(replacement,admin.id,admin.password).changes)fail(409,'Пароль уже изменён. Повторите вход.');
          db.prepare('DELETE FROM sessions WHERE admin_id=? AND token!=?').run(admin.id,session.token);return json(res,200,{ok:true});
        }
        fail(404,'Маршрут не найден.');
      }
      if(method!=='GET'&&method!=='HEAD') fail(405,'Метод не поддерживается.');
      if(!serveStatic(req,res,path))fail(404,'Страница не найдена.');
    }catch(error) {
      if(res.headersSent) {res.end();return;}
      const conflict=error.code?.includes('CONSTRAINT_UNIQUE')||error.message?.includes('UNIQUE constraint');
      const status=error.status||(conflict?409:500);
      if(status===500) console.error(error);
      json(res,status,{error:conflict?'Этот артикул уже используется.':status===500?'Ошибка сервера. Повторите попытку.':error.message});
    }
  });
  server.requestTimeout=20000;
  server.headersTimeout=20000;
  server.on('close',()=>db.close());
  return {server,db};
}

function validateCustomer(b) {
 const email=str(b.email??'','Email',200,false);
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Проверьте Email.');
 const phone=str(b.phone??'','Телефон',40,false);
 if(phone&&!/^[+\d\s()\-]{3,40}$/.test(phone))fail(400,'Проверьте телефон.');
 const status=choice(b.status,['active','pending','banned']);
 return [str(b.name,'Имя'),str(b.username??'','Username',80,false),phone,email,str(b.city??'','Город',100,false),status,Number(status==='banned')];
}

function validateProduct(b) {
  return [str(b.name,'Название'),str(b.sku,'Артикул',40),str(b.category??'','Категория',80,false),num(b.price,'Цена'),num(b.cost,'Закупочная цена'),num(b.stock,'Остаток',1000000),bool(b.active),'',str(b.description,'Описание',2000,false),str(b.short_description??'','Краткое описание',2000,false)];
}
function validateBanner(b) {
  if(!/^#[0-9a-f]{6}$/i.test(b.color)) fail(400,'Некорректный цвет.');
  return [str(b.title,'Заголовок',120),str(b.subtitle,'Подзаголовок',240,false),b.color,safeLink(b.link??''),bool(b.active),imageValue(b.image??''),str(b.description??'','Описание акции',10000,false)];
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const host=process.env.HOST||'127.0.0.1'; const port=Number(process.env.PORT||3000);
  const {server}=createApp();server.listen(port,host,()=>console.log(`Сервер панели управления запущен на ${host}:${port}`));
}
