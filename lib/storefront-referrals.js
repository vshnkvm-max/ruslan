import { randomBytes } from 'node:crypto';
import { verifiedTelegramUser } from './telegram-auth.js';

const week = 7 * 86400000;
const monthFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Moscow',year:'numeric',month:'2-digit'});
const cutoff = now => new Date(now - week).toISOString();
const statusSql = "CASE WHEN r.rewarded=1 THEN 'successful' WHEN r.created_at<=? THEN 'rejected' ELSE 'pending' END";

export function telegramCustomerName(user) {
  return [user.first_name,user.last_name].filter(Boolean).join(' ') || user.username || `Telegram ${user.id}`;
}
export function createTelegramCustomer(db,user) {
  const referralCode=randomBytes(8).toString('hex').toUpperCase();
  const result=db.prepare("INSERT INTO customers(name,username,email,city,joined,referral_code,telegram_id) VALUES (?,?,'','',?,?,?)")
    .run(telegramCustomerName(user),user.username,new Date().toISOString(),referralCode,user.id);
  return {id:Number(result.lastInsertRowid),referral_code:referralCode};
}

export function createStorefrontReferrals(db,{botToken,fail,settings,botUsername}) {
  const enabled=()=>Boolean(settings().enabled);
  const customerByTelegram=db.prepare('SELECT id,referral_code,banned,deleted FROM customers WHERE telegram_id=?');
  function track(user) {
    const code=/^ref_([a-zA-Z0-9_-]{1,64})$/.exec(user.start_param||'')?.[1];
    if(!code||!enabled())return;
    const inviter=db.prepare('SELECT id,telegram_id FROM customers WHERE referral_code=? AND deleted=0 AND banned=0 AND telegram_id IS NOT NULL').get(code);
    if(!inviter||inviter.telegram_id===user.id)return;
    const customer=customerByTelegram.get(user.id)||createTelegramCustomer(db,user);
    if(customer.banned||customer.deleted)return;
    if(db.prepare('SELECT 1 FROM referrals WHERE invitee_id=?').get(customer.id)||
       db.prepare('SELECT 1 FROM orders WHERE customer_id=?').get(customer.id))return;
    const now=new Date().toISOString();
    db.prepare('INSERT INTO referrals(inviter_id,invitee_id,created_at,reward_percent) VALUES (?,?,?,?)').run(inviter.id,customer.id,now,invitationRate(inviter.id,now));
  }
  function invitationRate(inviterId,createdAt,id=null) {
    const [year,month]=monthFormat.format(new Date(createdAt)).split('-').map(Number);
    const from=new Date(Date.UTC(year,month-1,1,-3)).toISOString();
    const until=new Date(Date.UTC(year,month,1,-3)).toISOString();
    const {count}=db.prepare(`SELECT COUNT(*) AS count FROM referrals
      WHERE inviter_id=? AND created_at>=? AND created_at<? AND (? IS NULL OR (created_at,id)<(?,?))`)
      .get(inviterId,from,until,id,createdAt,id);
    return count<2?3:count<5?5:7;
  }
  function reward(order,now) {
    const row=db.prepare(`SELECT r.id,r.inviter_id,r.created_at,r.reward_percent
      FROM referrals r JOIN customers c ON c.id=r.inviter_id
      JOIN customers i ON i.id=r.invitee_id
      WHERE r.invitee_id=? AND r.rewarded=0
      AND c.deleted=0 AND c.banned=0 AND i.deleted=0 AND i.banned=0`).get(order.customer_id);
    if(!row||row.created_at<=cutoff(Date.parse(now))||order.created_at<row.created_at)return;
    if(db.prepare('SELECT 1 FROM orders WHERE customer_id=? AND id<>? AND completed_at IS NOT NULL').get(order.customer_id,order.id))return;
    const {total}=db.prepare('SELECT COALESCE(SUM(price*quantity),0) AS total FROM order_items WHERE order_id=?').get(order.id);
    const rate=row.reward_percent??invitationRate(row.inviter_id,row.created_at,row.id);
    const amount=Math.floor(total*rate/100);
    db.prepare('UPDATE referrals SET rewarded=1,reward_amount=?,reward_percent=? WHERE id=?').run(amount,rate,row.id);
    if(amount>0){
      db.prepare('UPDATE customers SET balance=balance+? WHERE id=?').run(amount,row.inviter_id);
      db.prepare("INSERT INTO balance_operations(customer_id,order_id,kind,amount,created_at) VALUES (?,?,'referral_reward',?,?)").run(row.inviter_id,order.id,amount,now);
    }
  }
  function view(body) {
    if(!botToken)fail(503,'Реферальная программа временно недоступна.');
    const user=verifiedTelegramUser(body.init_data,botToken);
    if(!user)fail(401,'Откройте магазин через Telegram, чтобы увидеть рекомендации.');
    const status=body.status??'pending',before=body.before??null;
    if(!['pending','successful','rejected'].includes(status)||
       (before!==null&&(!Number.isSafeInteger(before)||before<=0)))fail(400,'Неверная страница рекомендаций.');
    db.exec('BEGIN IMMEDIATE');
    try {
      track(user);
      const active=enabled();
      const customer=customerByTelegram.get(user.id)||(active?createTelegramCustomer(db,user):null);
      if(customer?.banned||customer?.deleted)fail(403,'Реферальная программа недоступна.');
      const id=customer?.id??null;
      const code=customer?.referral_code;
      const {count,earned}=db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(reward_amount),0) AS earned FROM referrals WHERE inviter_id=? AND rewarded=1').get(id);
      const items=db.prepare(`SELECT r.id,r.created_at,r.reward_amount AS amount,CASE WHEN c.name='Telegram '||c.telegram_id THEN 'Покупатель' ELSE c.name END AS name
        FROM referrals r JOIN customers c ON c.id=r.invitee_id
        WHERE r.inviter_id=? AND (${statusSql})=? AND (? IS NULL OR r.id<?)
        ORDER BY r.id DESC LIMIT 21`).all(id,cutoff(Date.now()),status,before,before);
      const more=items.length>20;
      if(more)items.pop();
      const link=active&&code?`https://t.me/${botUsername()}?startapp=${encodeURIComponent('ref_'+code)}`:'';
      db.exec('COMMIT');
      return {enabled:active,link,count,earned,items,next:more?items.at(-1).id:null};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function adminList() {
    return db.prepare(`SELECT r.*,(${statusSql}) AS status,c.name AS inviter_name,c.referral_code,i.name AS invitee_name
      FROM referrals r JOIN customers c ON c.id=r.inviter_id JOIN customers i ON i.id=r.invitee_id ORDER BY r.created_at DESC`).all(cutoff(Date.now()));
  }
  return {track,reward,view,adminList};
}
