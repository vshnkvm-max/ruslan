import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../lib/database.js';
import { loadOrderHistory } from '../lib/order-history.js';
import { insertTestFixtures } from './fixtures/store.js';

test('batched history preserves totals, customer metrics and ledger with deleted customers and empty orders',()=>{
 const directory=mkdtempSync(join(tmpdir(),'shop-history-')),db=openDatabase(join(directory,'shop.db'));
 try {
  insertTestFixtures(db);
  db.prepare('UPDATE customers SET deleted=1 WHERE id=1').run();
  db.prepare("INSERT INTO orders (customer_id,status,delivery,address,created_at) VALUES (2,'completed','Pickup','','2026-11-01T12:00:00Z')").run();
  // Include equal timestamps to preserve the previous ledger's ordering of ties.
  db.prepare("UPDATE orders SET created_at='2026-11-01T12:00:00Z' WHERE status='completed'").run();
  const expectedOrders=db.prepare(`SELECT o.*,c.name AS customer_name,c.username,COALESCE(SUM(i.price*i.quantity),0) AS total,COALESCE(SUM(i.quantity),0) AS quantity FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN order_items i ON i.order_id=o.id GROUP BY o.id ORDER BY o.created_at DESC`).all().map(order=>({...order,items:db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id)}));
  const expectedCustomers=db.prepare(`SELECT c.*,COUNT(o.id) AS orders_count,COALESCE(SUM(CASE WHEN o.status='completed' THEN (SELECT SUM(price*quantity) FROM order_items WHERE order_id=o.id) ELSE 0 END),0) AS spent,COALESCE(SUM(CASE WHEN o.status!='cancelled' THEN (SELECT SUM(price*quantity) FROM order_items WHERE order_id=o.id) ELSE 0 END),0) AS order_total,MAX(o.created_at) AS last_order FROM customers c LEFT JOIN orders o ON o.customer_id=c.id WHERE c.deleted=0 GROUP BY c.id ORDER BY c.id`).all();
  const expectedTransactions=[
   ...db.prepare('SELECT * FROM transactions').all().map(row=>({...row,id:`t${row.id}`})),
   ...db.prepare("SELECT o.id,o.created_at,SUM(i.price*i.quantity) AS amount FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.status='completed' GROUP BY o.id").all().map(row=>({...row,id:`o${row.id}`,type:'income',category:'Продажи',description:`Заказ #${String(row.id).padStart(4,'0')}`}))
  ].sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const actual=loadOrderHistory(db);
  // SQLite rows have a null prototype; compare their serialized public values.
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify({orders:expectedOrders,customers:expectedCustomers,transactions:expectedTransactions})));
  db.prepare("UPDATE orders SET status='cancelled' WHERE id=4").run();
  assert.ok(!loadOrderHistory(db).transactions.some(row=>row.id==='o4'),'mutations are reflected immediately');
 }finally {db.close();rmSync(directory,{recursive:true,force:true});}
});
