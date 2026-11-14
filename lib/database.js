import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, admin_id INTEGER REFERENCES admins(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sku TEXT UNIQUE NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL, cost INTEGER NOT NULL, stock INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, image TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL, email TEXT NOT NULL, city TEXT NOT NULL, banned INTEGER NOT NULL DEFAULT 0, joined TEXT NOT NULL, referral_code TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), status TEXT NOT NULL, delivery TEXT NOT NULL, address TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL, quantity INTEGER NOT NULL, price INTEGER NOT NULL, cost INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), product_id INTEGER NOT NULL REFERENCES products(id), rating INTEGER NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY, type TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, amount INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS referrals (id INTEGER PRIMARY KEY, inviter_id INTEGER REFERENCES customers(id), invitee_id INTEGER UNIQUE REFERENCES customers(id), rewarded INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS banners (id INTEGER PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT NOT NULL, color TEXT NOT NULL, link TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY, supplier TEXT NOT NULL, store TEXT NOT NULL, posted INTEGER NOT NULL, paid INTEGER NOT NULL, total INTEGER NOT NULL, comment TEXT NOT NULL, items TEXT NOT NULL, created_at TEXT NOT NULL, request_key TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
  `);
  // Additive migrations preserve existing data and linked order history.
  const addColumn=(table,name,definition)=>{const added=!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===name);if(added)db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);return added;};
  addColumn('products','sort_order','INTEGER NOT NULL DEFAULT 100');
  addColumn('products','image_fit',"TEXT NOT NULL DEFAULT 'auto'");
  addColumn('products','short_description',"TEXT NOT NULL DEFAULT ''");
  addColumn('products','views','INTEGER NOT NULL DEFAULT 0');
  addColumn('products','deleted','INTEGER NOT NULL DEFAULT 0');
  addColumn('customers','phone',"TEXT NOT NULL DEFAULT ''");
  addColumn('customers','status',"TEXT NOT NULL DEFAULT 'active'");
  addColumn('customers','deleted','INTEGER NOT NULL DEFAULT 0');
  addColumn('banners','image',"TEXT NOT NULL DEFAULT ''");
  addColumn('banners','description',"TEXT NOT NULL DEFAULT ''");
  addColumn('purchases','transaction_id','INTEGER REFERENCES transactions(id)');
  addColumn('products','create_key','TEXT');
  if(addColumn('products','visible','INTEGER NOT NULL DEFAULT 1'))db.exec('UPDATE products SET visible=CASE WHEN stock>0 THEN 1 ELSE 0 END');
  addColumn('purchases','deleted','INTEGER NOT NULL DEFAULT 0');
  addColumn('purchases','posted_at','TEXT');
  addColumn('transactions','deleted','INTEGER NOT NULL DEFAULT 0');
  addColumn('orders','deleted','INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales(id INTEGER PRIMARY KEY,customer TEXT NOT NULL,posted INTEGER NOT NULL,paid INTEGER NOT NULL,total INTEGER NOT NULL,comment TEXT NOT NULL,items TEXT NOT NULL,created_at TEXT NOT NULL,posted_at TEXT,request_key TEXT UNIQUE NOT NULL,transaction_id INTEGER REFERENCES transactions(id),deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS product_views(product_id INTEGER NOT NULL REFERENCES products(id),visitor_hash TEXT NOT NULL,view_day TEXT NOT NULL,PRIMARY KEY(product_id,visitor_hash,view_day));
    CREATE TRIGGER IF NOT EXISTS products_visibility_insert AFTER INSERT ON products BEGIN UPDATE products SET visible=CASE WHEN NEW.stock>0 THEN 1 ELSE 0 END WHERE id=NEW.id; END;
    CREATE TRIGGER IF NOT EXISTS products_visibility_stock AFTER UPDATE OF stock ON products WHEN NEW.stock!=OLD.stock BEGIN UPDATE products SET visible=CASE WHEN NEW.stock>0 THEN 1 ELSE 0 END WHERE id=NEW.id; END;
    UPDATE purchases SET posted_at=created_at WHERE posted=1 AND posted_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_create_key ON products(create_key) WHERE create_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS product_images (
      id TEXT PRIMARY KEY,
      product_id INTEGER REFERENCES products(id),
      position INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id,position);
    CREATE INDEX IF NOT EXISTS idx_product_images_listing ON product_images(product_id,position,id);
    CREATE INDEX IF NOT EXISTS idx_reviews_product_status ON reviews(product_id,status);
    CREATE INDEX IF NOT EXISTS idx_products_catalog ON products(deleted,active,sort_order,id);
    CREATE INDEX IF NOT EXISTS idx_transactions_purchase_match ON transactions(type,category,description,amount);
  `);
  const insertSetting = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING');
  insertSetting.run('shop', JSON.stringify({name:'',headline:'',description:'',phone:'',address:'',hours:''}));
  insertSetting.run('referral', JSON.stringify({enabled:false,bonus:100,percent:5,minPayout:0}));
  const referral=JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get('referral').value);
  if(!Object.hasOwn(referral,'percent')){
    if(referral.bonus===0&&referral.minPayout===0)referral.bonus=100;
    referral.bonus??=100;referral.percent=5;
    db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(referral),'referral');
  }
  insertSetting.run('categories',JSON.stringify([]));
  // Link historical purchase payments only when the existing record is unambiguous.
  db.exec(`UPDATE purchases SET transaction_id=(
    SELECT MIN(t.id) FROM transactions t WHERE t.type='expense' AND t.category='Закупка'
      AND t.description='Закупка #'||purchases.id||' · '||purchases.supplier AND t.amount=purchases.paid
  ) WHERE posted=1 AND paid>0 AND transaction_id IS NULL AND (
    SELECT COUNT(*) FROM transactions t WHERE t.type='expense' AND t.category='Закупка'
      AND t.description='Закупка #'||purchases.id||' · '||purchases.supplier AND t.amount=purchases.paid
  )=1`);
  return db;
}
