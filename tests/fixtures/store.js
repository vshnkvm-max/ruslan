// Explicit test fixtures. Never imported by the application or admin creation CLI.
export function insertTestFixtures(db) {
  db.exec('BEGIN');
  try {
    const products = [
      ['Наушники Nothing Headphone', 'SKU-001', 'Электроника', 12990, 8100, 24, 'headphones', 'Беспроводные наушники с активным шумоподавлением.'],
      ['Лампа настольная Form', 'SKU-002', 'Для дома', 4590, 2300, 18, 'lamp', 'Мягкий свет и лаконичная форма для рабочего стола.'],
      ['Рюкзак Everyday', 'SKU-003', 'Аксессуары', 6900, 3500, 7, 'bag', 'Городской рюкзак с отделением для ноутбука.'],
      ['Колонка Sound Mini', 'SKU-004', 'Электроника', 3490, 1900, 32, 'speaker', 'Компактная беспроводная колонка.'],
      ['Термокружка Daily', 'SKU-005', 'Для дома', 1890, 800, 4, 'cup', 'Сохраняет тепло напитка до 6 часов.'],
      ['Часы Analog', 'SKU-006', 'Аксессуары', 8900, 4700, 0, 'watch', 'Классические часы с текстильным ремешком.'],
      ['Органайзер Desk', 'SKU-007', 'Для дома', 2490, 1200, 15, 'organizer', 'Порядок на столе, место для важных мелочей.'],
      ['Шоппер Cotton', 'SKU-008', 'Аксессуары', 990, 350, 48, 'tote', 'Плотный хлопок и удобные широкие ручки.'],
      ['Наушники Air Buds', 'SKU-009', 'Электроника', 5990, 2900, 11, 'headphones', 'Компактные наушники для каждого дня.'],
      ['Лампа Arc', 'SKU-010', 'Для дома', 7490, 4100, 6, 'lamp', 'Регулируемый свет для уютного вечера.'],
      ['Рюкзак Weekend', 'SKU-011', 'Аксессуары', 8490, 4400, 12, 'bag', 'Всё для небольшой поездки.'],
      ['Кружка Studio', 'SKU-012', 'Для дома', 1290, 500, 23, 'cup', 'Керамическая кружка с матовым покрытием.']
    ];
    const insert = db.prepare('INSERT INTO products (name,sku,category,price,cost,stock,image,description) VALUES (?,?,?,?,?,?,?,?)');
    for (const row of products) insert.run(...row);
    const people = [
      ['Александра Морозова','alex.morozova','alex@example.com','Москва'], ['Михаил Соколов','m_sokolov','mikhail@example.com','Новосибирск'],
      ['Анна Волкова','annav','anna@example.com','Санкт-Петербург'], ['Дмитрий Ким','dmitry.k','dmitry@example.com','Омск'],
      ['Мария Иванова','mari.ivanova','maria@example.com','Казань'], ['Артём Лебедев','art.lebedev','artem@example.com','Москва'],
      ['Екатерина Белова','kate.belova','kate@example.com','Омск'], ['Никита Смирнов','nik.smirnov','nikita@example.com','Томск']
    ];
    const date = days => new Date(Date.now() - days * 86400000).toISOString();
    const customer = db.prepare('INSERT INTO customers (name,username,email,city,joined,referral_code) VALUES (?,?,?,?,?,?)');
    people.forEach((p,i) => customer.run(...p, date(30+i*4), `REF${String(i+1).padStart(3,'0')}`));
    const order = db.prepare('INSERT INTO orders (customer_id,status,delivery,address,created_at) VALUES (?,?,?,?,?)');
    const item = db.prepare('INSERT INTO order_items (order_id,product_id,name,quantity,price,cost) VALUES (?,?,?,?,?,?)');
    const statuses = ['new','new','accepted','completed','completed','cancelled','completed','accepted','completed','completed','completed','completed'];
    statuses.forEach((status,i) => {
      const id = Number(order.run(i%8+1,status,i%2 ? 'Курьер' : 'Самовывоз',i%2 ? 'Адрес указан при оформлении' : 'Основной магазин',date(i*2)).lastInsertRowid);
      const p = products[i%products.length];
      item.run(id,i%products.length+1,p[0],1,p[3],p[4]);
      if (i%3===0) item.run(id,5,products[4][0],2,products[4][3],products[4][4]);
    });
    const review = db.prepare('INSERT INTO reviews (customer_id,product_id,rating,text,status,created_at) VALUES (?,?,?,?,?,?)');
    ['Очень приятные материалы и аккуратная упаковка. Спасибо!','Всё пришло вовремя. Качество отличное, покупкой доволен.','Хорошая вещь на каждый день. Цвет немного отличается от фото.','Понравился дизайн, вживую выглядит ещё лучше.','Быстро ответили на вопросы и помогли с выбором.','Заказываю второй раз, всё супер!'].forEach((s,i)=> review.run(i+1,i+1,i===2?4:5,s,i<2?'pending':'published',date(i+1)));
    db.prepare('INSERT INTO transactions (type,category,description,amount,created_at) VALUES (?,?,?,?,?)').run('expense','Аренда','Аренда магазина',18000,date(4));
    db.prepare('INSERT INTO transactions (type,category,description,amount,created_at) VALUES (?,?,?,?,?)').run('expense','Доставка','Услуги курьерской службы',2400,date(2));
    for (let i=0;i<5;i++) db.prepare('INSERT INTO referrals (inviter_id,invitee_id,rewarded,created_at) VALUES (?,?,?,?)').run(i%2+1,i+3,i<3?1:0,date(i+3));
    db.prepare('INSERT INTO banners (title,subtitle,color,link) VALUES (?,?,?,?)').run('Вещи, которые вдохновляют','Новая коллекция для вашего дня','#d9edca','/catalog');
    db.prepare('INSERT INTO banners (title,subtitle,color,link) VALUES (?,?,?,?)').run('Маленькие детали. Большой уют.','Всё для дома в одном месте','#e5dff3','/catalog?category=home');
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}
