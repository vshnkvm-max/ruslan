import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './lib/database.js';
import { token, digest, verifyPassword, hashPassword } from './lib/auth.js';

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
const imageKeys = ['headphones','lamp','bag','speaker','cup','watch','organizer','tote'];

function productImage(value) {
 if(value===''||imageKeys.includes(value))return value;
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
  const attempts=new Map();
  const getSettings=key => JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(key).value);
  const saveSettings=(key,value)=> db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(value),key);
  const products=()=>db.prepare(`SELECT p.*, (SELECT AVG(rating) FROM reviews WHERE product_id=p.id AND status='published') AS rating, (SELECT COUNT(*) FROM reviews WHERE product_id=p.id AND status='published') AS review_count FROM products p WHERE p.deleted=0 ORDER BY p.sort_order,p.id DESC`).all();
  const customers=()=>db.prepare(`SELECT c.*, COUNT(o.id) AS orders_count, COALESCE(SUM(CASE WHEN o.status='completed' THEN (SELECT SUM(price*quantity) FROM order_items WHERE order_id=o.id) ELSE 0 END),0) AS spent, COALESCE(SUM(CASE WHEN o.status!='cancelled' THEN (SELECT SUM(price*quantity) FROM order_items WHERE order_id=o.id) ELSE 0 END),0) AS order_total, MAX(o.created_at) AS last_order FROM customers c LEFT JOIN orders o ON o.customer_id=c.id WHERE c.deleted=0 GROUP BY c.id ORDER BY c.id`).all();
  const orders=()=>db.prepare(`SELECT o.*,c.name AS customer_name,c.username,COALESCE(SUM(i.price*i.quantity),0) AS total,COALESCE(SUM(i.quantity),0) AS quantity FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN order_items i ON i.order_id=o.id GROUP BY o.id ORDER BY o.created_at DESC`).all().map(o=>({...o,items:db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id)}));
  const ledger=()=>[
    ...db.prepare('SELECT * FROM transactions').all().map(t=>({...t,id:`t${t.id}`})),
    ...db.prepare(`SELECT o.id,o.created_at,SUM(i.price*i.quantity) AS amount FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.status='completed' GROUP BY o.id`).all().map(o=>({...o,id:`o${o.id}`,type:'income',category:'Продажи',description:`Заказ #${String(o.id).padStart(4,'0')}`}))
  ].sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const bootstrap=()=>({
    products:products(),customers:customers(),orders:orders(),categories:[...new Set([...getSettings('categories'),...products().map(p=>p.category)])],
    reviews:db.prepare('SELECT r.*,c.name AS customer_name,p.name AS product_name FROM reviews r JOIN customers c ON c.id=r.customer_id JOIN products p ON p.id=r.product_id ORDER BY r.created_at DESC').all(),
    transactions:ledger(),referrals:db.prepare('SELECT r.*,c.name AS inviter_name,c.referral_code,i.name AS invitee_name FROM referrals r JOIN customers c ON c.id=r.inviter_id JOIN customers i ON i.id=r.invitee_id ORDER BY r.created_at DESC').all(),
    banners:db.prepare('SELECT * FROM banners ORDER BY id').all(),shop:getSettings('shop'),referral:getSettings('referral')
  });
  function json(res,status,data,headers={}) {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));
  }
  async function body(req) {
    if(!req.headers['content-type']?.startsWith('application/json')) fail(415,'Ожидается JSON.');
    let size=0; const chunks=[];
    for await(const chunk of req) { size+=chunk.length; if(size>(/^\/api\/products(?:\/\d+)?$/.test(req.url?.split('?')[0])?750000:65536)) fail(413,'Слишком большой запрос.');chunks.push(chunk); }
    try { const value=JSON.parse(Buffer.concat(chunks).toString()); if(!value||typeof value!=='object'||Array.isArray(value)) fail(400,'Неверный JSON.'); return value; }
    catch { fail(400,'Неверный JSON.'); }
  }
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const url=new URL(req.url,'http://localhost'); const path=url.pathname; const method=req.method;
      if(path.startsWith('/api/')) {
        if(!['GET','POST','PATCH','DELETE'].includes(method)) fail(405,'Метод не поддерживается.');
        if(method!=='GET' && req.headers.origin) {
          let origin; try {origin=new URL(req.headers.origin);}catch {fail(403,'Недопустимый источник запроса.');}
          if(origin.host!==req.headers.host) fail(403,'Недопустимый источник запроса.');
        }
        if(path==='/api/health'&&method==='GET') return json(res,200,{ok:true});
        if(path==='/api/storefront'&&method==='GET') {
          const shop=getSettings('shop');
          return json(res,200,{shop,products:products().filter(p=>p.active).map(({id,name,sku,category,price,stock,image,description})=>({id,name,sku,category,price,stock,image,description})),banners:db.prepare('SELECT * FROM banners WHERE active=1').all()});
        }
        if(path==='/api/auth/login'&&method==='POST') {
          const key=req.socket.remoteAddress; const now=Date.now();
          for(const [ip,entry] of attempts) if(now-entry.started>900000) attempts.delete(ip);
          const attempt=attempts.get(key)||{count:0,started:now};
          if(attempt.count>=10) fail(429,'Слишком много попыток. Повторите через 15 минут.');
          const b=await body(req); const username=str(b.username,'Логин',80); const password=passwordValue(b.password);
          const admin=db.prepare('SELECT * FROM admins WHERE username=?').get(username);
          const valid=verifyPassword(password,admin?.password||dummyPassword);
          if(!admin||!valid) {attempt.count++;attempts.set(key,attempt);fail(401,'Неверный логин или пароль.');}
          attempts.delete(key);
          db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
          const sessionToken=token(),csrf=token();
          db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(sessionToken),admin.id,csrf,now+sessionDuration);
          return json(res,200,{username:admin.username,csrf},{'Set-Cookie':`session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secureCookie?'; Secure':''}`});
        }
        const cookie=req.headers.cookie?.match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/)?.[1];
        const session=cookie ? db.prepare('SELECT s.*,a.username FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token=? AND s.expires>?').get(digest(cookie),Date.now()):null;
        if(!session) fail(401,'Войдите в аккаунт администратора.');
        if(method!=='GET'&&req.headers['x-csrf-token']!==session.csrf) fail(403,'Сессия запроса недействительна. Обновите страницу.');
        if(path==='/api/auth/me'&&method==='GET') return json(res,200,{username:session.username,csrf:session.csrf});
        if(path==='/api/auth/logout'&&method==='POST') {db.prepare('DELETE FROM sessions WHERE token=?').run(session.token);return json(res,200,{ok:true},{'Set-Cookie':`session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie?'; Secure':''}`});}
        if(path==='/api/bootstrap'&&method==='GET') return json(res,200,bootstrap());
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
            const p=validateProduct(b);db.prepare('UPDATE products SET name=?,sku=?,category=?,price=?,cost=?,stock=?,active=?,image=?,description=? WHERE id=?').run(...p,id);
          } else if(table==='customers') {
            if(Object.keys(b).length===1&&'banned' in b){const banned=bool(b.banned);db.prepare("UPDATE customers SET banned=?,status=? WHERE id=?").run(banned,banned?'banned':'active',id);}
            else {const c=validateCustomer(b);db.prepare('UPDATE customers SET name=?,username=?,phone=?,email=?,city=?,status=?,banned=? WHERE id=?').run(...c,id);}
          }
          else if(table==='orders') db.prepare('UPDATE orders SET status=? WHERE id=?').run(choice(b.status,['new','accepted','completed','cancelled']),id);
          else if(table==='reviews') db.prepare('UPDATE reviews SET status=? WHERE id=?').run(choice(b.status,['pending','published','hidden']),id);
          else if(table==='banners') db.prepare('UPDATE banners SET title=?,subtitle=?,color=?,link=?,active=? WHERE id=?').run(...validateBanner(b),id);
          return json(res,200,{ok:true});
        }
        if(path==='/api/categories'&&method==='POST') {const b=await body(req);const name=str(b.name,'Категория',80);saveSettings('categories',[...new Set([...getSettings('categories'),name])]);return json(res,201,{name});}
        if(path==='/api/customers'&&method==='POST') {const c=validateCustomer(await body(req));const result=db.prepare('INSERT INTO customers (name,username,phone,email,city,status,banned,joined,referral_code) VALUES (?,?,?,?,?,?,?,?,?)').run(...c,new Date().toISOString(),token().slice(0,12));return json(res,201,{id:Number(result.lastInsertRowid)});}
        if(path==='/api/products'&&method==='POST') {const p=validateProduct(await body(req));const r=db.prepare('INSERT INTO products (name,sku,category,price,cost,stock,active,image,description) VALUES (?,?,?,?,?,?,?,?,?)').run(...p);return json(res,201,{id:Number(r.lastInsertRowid)});}
        if(path==='/api/banners'&&method==='POST') {const p=validateBanner(await body(req));const r=db.prepare('INSERT INTO banners (title,subtitle,color,link,active) VALUES (?,?,?,?,?)').run(...p);return json(res,201,{id:Number(r.lastInsertRowid)});}
        if(path==='/api/transactions'&&method==='POST') {
          const b=await body(req);const amount=num(b.amount,'Сумма');if(!amount) fail(400,'Сумма должна быть больше нуля.');
          const r=db.prepare('INSERT INTO transactions (type,category,description,amount,created_at) VALUES (?,?,?,?,?)').run(choice(b.type,['income','expense']),str(b.category,'Категория',80),str(b.description,'Описание'),amount,new Date().toISOString());return json(res,201,{id:Number(r.lastInsertRowid)});
        }
        if(path==='/api/settings/shop'&&method==='PATCH') {const b=await body(req);const shop={};for(const key of ['name','headline','description','phone','address','hours']) shop[key]=str(b[key],key,key==='description'?2000:200,key==='name');saveSettings('shop',shop);return json(res,200,{ok:true});}
        if(path==='/api/settings/referral'&&method==='PATCH') {const b=await body(req);saveSettings('referral',{enabled:Boolean(bool(b.enabled)),bonus:num(b.bonus,'Бонус',100000),minPayout:num(b.minPayout,'Минимальная выплата',1000000)});return json(res,200,{ok:true});}
        if(path==='/api/auth/password'&&method==='POST') {
          const b=await body(req);const current=passwordValue(b.current);const next=passwordValue(b.password);
          if(next.length<12) fail(400,'Новый пароль должен содержать не менее 12 символов.');
          const admin=db.prepare('SELECT * FROM admins WHERE id=?').get(session.admin_id);
          if(!verifyPassword(current,admin.password)) fail(400,'Текущий пароль неверен.');
          db.prepare('UPDATE admins SET password=? WHERE id=?').run(hashPassword(next),admin.id);
          db.prepare('DELETE FROM sessions WHERE admin_id=? AND token!=?').run(admin.id,session.token);return json(res,200,{ok:true});
        }
        fail(404,'Маршрут не найден.');
      }
      if(method!=='GET'&&method!=='HEAD') fail(405,'Метод не поддерживается.');
      const files={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};
      const file=files[path];if(!file) fail(404,'Страница не найдена.');
      const content=await readFile(resolve(root,'public',file));
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
      res.writeHead(200,{'Content-Type':types[extname(file)],'Cache-Control':'no-cache'});res.end(method==='HEAD'?undefined:content);
    }catch(error) {
      if(res.headersSent) {res.end();return;}
      const conflict=error.code?.includes('CONSTRAINT_UNIQUE')||error.message?.includes('UNIQUE constraint');
      const status=error.status||(conflict?409:500);
      if(status===500) console.error(error);
      json(res,status,{error:conflict?'Этот артикул уже используется.':status===500?'Ошибка сервера. Повторите попытку.':error.message});
    }
  });
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
  return [str(b.name,'Название'),str(b.sku,'Артикул',40),str(b.category,'Категория',80),num(b.price,'Цена'),num(b.cost,'Закупочная цена'),num(b.stock,'Остаток',1000000),bool(b.active),productImage(b.image),str(b.description,'Описание',2000,false)];
}
function validateBanner(b) {
  if(!/^#[0-9a-f]{6}$/i.test(b.color)) fail(400,'Некорректный цвет.');
  return [str(b.title,'Заголовок',120),str(b.subtitle,'Подзаголовок',240,false),b.color,safeLink(b.link),bool(b.active)];
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const host=process.env.HOST||'127.0.0.1'; const port=Number(process.env.PORT||3000);
  const {server}=createApp();server.listen(port,host,()=>console.log(`Сервер панели управления запущен на ${host}:${port}`));
}
