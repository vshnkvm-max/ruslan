import { createHmac,timingSafeEqual,randomBytes,createHash } from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
function telegramUser(initData,botToken){
 if(!botToken||typeof initData!=='string'||initData.length>20000)return null;
 try{
  const fields=new URLSearchParams(initData),signature=fields.get('hash');if(!/^[a-f0-9]{64}$/.test(signature||''))return null;
  const authDate=Number(fields.get('auth_date'));if(!Number.isFinite(authDate)||Math.abs(Date.now()/1000-authDate)>86400)return null;
  fields.delete('hash');
  const text=[...fields].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('\n');
  const secret=createHmac('sha256','WebAppData').update(botToken).digest(),expected=createHmac('sha256',secret).update(text).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))return null;
  const user=JSON.parse(fields.get('user'));return Number.isSafeInteger(user?.id)&&user.id>0?user.id:null;
 }catch{return null;}
}
export function recordProductView(db,req,{productId,body={},secureCookie=false,botToken=''}){
 const cookie=req.headers.cookie?.match(/(?:^|;\s*)shop_visitor=([a-f0-9]{64})(?:;|$)/)?.[1];
 const supplied=typeof body.visitor_id==='string'&&/^[a-f0-9]{64}$/.test(body.visitor_id)?body.visitor_id:null;
 const visitor=cookie||supplied||randomBytes(32).toString('hex'),user=telegramUser(body.init_data,botToken);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 db.exec('BEGIN IMMEDIATE');
 try{
  const product=db.prepare('SELECT id FROM products WHERE id=? AND active=1 AND visible=1 AND stock>0 AND deleted=0').get(productId);
  if(!product){db.exec('ROLLBACK');return null;}
  const result=db.prepare('INSERT OR IGNORE INTO product_views(product_id,visitor_hash,view_day) VALUES (?,?,?)').run(productId,hash(user?'telegram:'+user:'browser:'+visitor),day);
  if(result.changes)db.prepare('UPDATE products SET views=views+1 WHERE id=?').run(productId);
  db.exec('COMMIT');
  return {counted:Boolean(result.changes),headers:cookie?{}:{'Set-Cookie':`shop_visitor=${visitor}; HttpOnly; Path=/; Max-Age=31536000; ${secureCookie?'SameSite=None; Secure; Partitioned':'SameSite=Lax'}`}};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
