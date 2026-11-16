import {verifiedTelegramUser} from './telegram-auth.js';

export function createCustomerHistory(db,{botToken,fail,orders}) {
  function customer(initData){
    if(!botToken)fail(503,'История временно недоступна.');
    const user=verifiedTelegramUser(initData,botToken);
    if(!user)fail(401,'Откройте магазин заново через Telegram.');
    return db.prepare('SELECT id,balance,banned FROM customers WHERE telegram_id=? AND deleted=0').get(user.id);
  }
  function order(id,initData){
    const c=customer(initData);
    const row=c&&db.prepare('SELECT id,status,created_at,balance_spent,delivery,address FROM orders WHERE id=? AND customer_id=? AND deleted=0').get(id,c.id);
    if(!row)fail(404,'Заказ не найден.');
    const items=db.prepare('SELECT product_id,name,quantity,price FROM order_items WHERE order_id=? ORDER BY id').all(id);
    const total=items.reduce((sum,item)=>sum+item.quantity*item.price,0);
    return {...row,items,total,payable:row.status==='cancelled'?0:total-row.balance_spent,can_cancel:!c.banned&&['new','accepted'].includes(row.status),balance_after:c.balance};
  }
  function list(initData,before=null){
    const c=customer(initData);if(!c)return {items:[],next:null};
    const items=db.prepare(`SELECT o.id,o.status,o.created_at,o.balance_spent,COALESCE(SUM(i.quantity*i.price),0) AS total
      FROM orders o LEFT JOIN order_items i ON i.order_id=o.id WHERE o.customer_id=? AND o.deleted=0 AND (? IS NULL OR o.id<?)
      GROUP BY o.id ORDER BY o.id DESC LIMIT 21`).all(c.id,before,before);
    const more=items.length>20;if(more)items.pop();
    return {items,next:more?items.at(-1).id:null};
  }
  function cancel(id,initData){
    const current=order(id,initData);
    if(current.status==='cancelled')return current;
    if(!current.can_cancel)fail(409,'Этот заказ уже нельзя отменить. Обновите его статус.');
    // No awaits between ownership/status validation and the existing atomic stock/wallet transaction.
    orders.update(id,'cancelled');
    return order(id,initData);
  }
  function balanceHistory(initData,before=null){
    const c=customer(initData);if(!c)return {balance:0,items:[],next:null};
    let cursor=null;
    if(before!==null){
      try{cursor=JSON.parse(Buffer.from(before,'base64url').toString());}catch{fail(400,'Неверная страница начислений.');}
      if(!Array.isArray(cursor)||cursor.length!==3||typeof cursor[0]!=='string'||cursor[0].length>40||!Number.isFinite(Date.parse(cursor[0]))||!['order','adjustment'].includes(cursor[1])||!Number.isSafeInteger(cursor[2])||cursor[2]<=0)fail(400,'Неверная страница начислений.');
    }
    const items=db.prepare(`WITH history AS (
      SELECT id,'order' AS source,kind,order_id,amount,created_at FROM balance_operations WHERE customer_id=?
      UNION ALL SELECT id,'adjustment' AS source,'adjustment' AS kind,NULL AS order_id,amount,created_at FROM customer_balance_adjustments WHERE customer_id=? AND amount!=0
    ) SELECT h.*,o.id AS accessible_order_id FROM history h LEFT JOIN orders o ON o.id=h.order_id AND o.customer_id=? AND o.deleted=0 WHERE (? IS NULL OR (h.created_at,h.source,h.id)<(?,?,?)) ORDER BY h.created_at DESC,h.source DESC,h.id DESC LIMIT 21`).all(c.id,c.id,c.id,cursor?.[0]??null,cursor?.[0]??null,cursor?.[1]??null,cursor?.[2]??null);
    const more=items.length>20;if(more)items.pop();const last=items.at(-1);
    const labels={order_payment:'Списание за заказ',order_refund:'Возврат за заказ',referral_reward:'Реф. программа',cashback:'Кэшбек за заказ'};
    return {balance:c.balance,items:items.map(row=>({id:row.source+':'+row.id,kind:row.kind,order_id:row.accessible_order_id,amount:row.amount,created_at:row.created_at,title:row.kind==='adjustment'?(row.amount>0?'Начисление баланса':'Списание баланса'):(labels[row.kind]||'Изменение баланса')+(row.order_id&&row.kind!=='referral_reward'?' #'+row.order_id:'')})),next:more?Buffer.from(JSON.stringify([last.created_at,last.source,last.id])).toString('base64url'):null};
  }
  return {list,order,cancel,balanceHistory};
}
