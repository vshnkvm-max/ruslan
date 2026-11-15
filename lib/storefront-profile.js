export function loadStorefrontBalance(db, telegramId) {
  return db.prepare('SELECT balance FROM customers WHERE telegram_id=? AND deleted=0').get(telegramId)?.balance ?? 0;
}
export function loadStorefrontProfile(db, telegramId, before) {
  const customer = db.prepare('SELECT id,balance FROM customers WHERE telegram_id=? AND deleted=0').get(telegramId);
  if (!customer) return { balance: 0, stats: { orders_count: 0, total: 0 }, orders: [], reviews: [], reviews_count: 0, reviews_next: null };
  const stats = db.prepare(`SELECT COUNT(DISTINCT o.id) AS orders_count,COALESCE(SUM(i.price*i.quantity),0) AS total
    FROM orders o LEFT JOIN order_items i ON i.order_id=o.id WHERE o.customer_id=? AND o.deleted=0 AND o.status!='cancelled'`).get(customer.id);
  const orders = db.prepare(`SELECT o.id,o.status,o.created_at,COALESCE(SUM(i.price*i.quantity),0) AS total
    FROM orders o LEFT JOIN order_items i ON i.order_id=o.id WHERE o.customer_id=? AND o.deleted=0
    GROUP BY o.id ORDER BY o.created_at DESC,o.id DESC LIMIT 10`).all(customer.id);
  const reviews = db.prepare(`SELECT r.id,r.product_id,r.rating,r.text,r.status,r.created_at,p.name AS product_name
    FROM reviews r JOIN products p ON p.id=r.product_id WHERE r.customer_id=? AND (? IS NULL OR r.id<?) ORDER BY r.id DESC LIMIT 21`).all(customer.id,before,before);
  const more = reviews.length > 20;
  if (more) reviews.pop();
  return { balance: customer.balance, stats, orders, reviews, reviews_count: db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE customer_id=?').get(customer.id).n, reviews_next: more ? reviews.at(-1).id : null };
}
