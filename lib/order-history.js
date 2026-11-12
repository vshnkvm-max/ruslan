// Read order lines in one batch and reuse the same totals for customer metrics
// and the ledger, instead of querying every order repeatedly during bootstrap.
export function loadOrderHistory(db) {
  const itemsByOrder=new Map();
  for(const item of db.prepare('SELECT * FROM order_items ORDER BY order_id,id').all()) {
    if(!itemsByOrder.has(item.order_id))itemsByOrder.set(item.order_id,[]);
    itemsByOrder.get(item.order_id).push(item);
  }
  const orders=db.prepare(`
    WITH totals AS (
      SELECT order_id,SUM(price*quantity) AS total,SUM(quantity) AS quantity
      FROM order_items GROUP BY order_id
    )
    SELECT o.*,c.name AS customer_name,c.username,
      COALESCE(t.total,0) AS total,COALESCE(t.quantity,0) AS quantity
    FROM orders o JOIN customers c ON c.id=o.customer_id
    LEFT JOIN totals t ON t.order_id=o.id WHERE o.deleted=0 ORDER BY o.created_at DESC,o.id
  `).all().map(order=>({...order,items:itemsByOrder.get(order.id)||[]}));
  const metrics=new Map();
  for(const order of orders) {
    if(!metrics.has(order.customer_id))metrics.set(order.customer_id,{orders_count:0,spent:0,order_total:0,last_order:null});
    const customer=metrics.get(order.customer_id);
    customer.orders_count++;
    if(order.status==='completed')customer.spent+=order.total;
    if(order.status!=='cancelled')customer.order_total+=order.total;
    if(customer.last_order===null||order.created_at>customer.last_order)customer.last_order=order.created_at;
  }
  const customers=db.prepare('SELECT * FROM customers WHERE deleted=0 ORDER BY id').all().map(customer=>({
    ...customer,...(metrics.get(customer.id)||{orders_count:0,spent:0,order_total:0,last_order:null})
  }));
  const transactions=[
    ...db.prepare('SELECT * FROM transactions WHERE deleted=0').all().map(transaction=>({...transaction,id:`t${transaction.id}`})),
    ...orders.filter(order=>order.status==='completed'&&order.items.length).sort((a,b)=>a.id-b.id).map(order=>({
      id:`o${order.id}`,created_at:order.created_at,amount:order.total,type:'income',category:'Продажи',description:`Заказ #${String(order.id).padStart(4,'0')}`
    }))
  ].sort((a,b)=>b.created_at.localeCompare(a.created_at));
  return {orders,customers,transactions};
}
