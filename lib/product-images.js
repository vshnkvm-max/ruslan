import { randomUUID } from 'node:crypto';

export const legacyImages = ['headphones','lamp','bag','speaker','cup','watch','organizer','tote'];
const pathFor = id => `/api/images/${id}`;
const reference = /^\/api\/images\/([a-f0-9-]{36})$/;
export const maxProductImages = 10;

export function createProductImages(db, validate, fail) {
  const insert = db.prepare('INSERT INTO product_images (id,data) VALUES (?,?)');
  const list = db.prepare('SELECT id FROM product_images WHERE product_id=? ORDER BY position,id');
  const find = db.prepare('SELECT product_id FROM product_images WHERE id=?');
  function upload(value) {
    const data = validate(value);
    if (!data) fail(400,'Выберите фотографию.');
    const id = randomUUID();
    insert.run(id,data);
    return pathFor(id);
  }
  function urls(id) { return list.all(id).map(row => pathFor(row.id)); }
  function replace(id, body, saved) {
    let values = body.images;
    let legacy = '';
    if (values === undefined) {
      if (body.image === undefined || (saved && body.image === saved.image)) values = urls(id);
      else if (legacyImages.includes(body.image)) { legacy = body.image; values = []; }
      else values = body.image ? [body.image] : [];
    }
    if (!Array.isArray(values) || values.length > maxProductImages) fail(400,`Можно добавить до ${maxProductImages} фотографий.`);
    const ids = values.map(value => {
      if (typeof value !== 'string') fail(400,'Некорректная фотография.');
      const match = reference.exec(value);
      if (match) {
        const row = find.get(match[1]);
        if (!row || (row.product_id !== null && row.product_id !== id)) fail(400,'Фотография недоступна. Загрузите её заново.');
        return match[1];
      }
      return upload(value).slice('/api/images/'.length);
    });
    if (new Set(ids).size !== ids.length) fail(400,'Фотографии не должны повторяться.');
    db.prepare('UPDATE product_images SET product_id=NULL WHERE product_id=?').run(id);
    ids.forEach((imageId,position) => db.prepare('UPDATE product_images SET product_id=?,position=? WHERE id=?').run(id,position,imageId));
    db.prepare('UPDATE products SET image=? WHERE id=?').run(ids.length ? pathFor(ids[0]) : legacy,id);
    return urls(id);
  }
  function serialize(row) {
    const images = urls(row.id);
    return {...row,image:images[0] || (legacyImages.includes(row.image) ? row.image : ''),images};
  }
  function serializeAll(rows,publishedOnly=false) {
    const imagesByProduct=new Map();
    if(!rows.length)return [];
    for(const image of db.prepare('SELECT i.id,i.product_id FROM product_images i JOIN products p ON p.id=i.product_id WHERE p.deleted=0 AND (?=0 OR p.active=1) ORDER BY i.product_id,i.position,i.id').all(Number(publishedOnly))) {
      if(!imagesByProduct.has(image.product_id))imagesByProduct.set(image.product_id,[]);
      imagesByProduct.get(image.product_id).push(pathFor(image.id));
    }
    return rows.map(row=>{const images=imagesByProduct.get(row.id)||[];return {...row,image:images[0]||(legacyImages.includes(row.image)?row.image:''),images};});
  }
  // Move old inline photographs without loading every image into memory at once.
  let lastId = 0;
  const next = db.prepare("SELECT id,image FROM products WHERE id>? AND image LIKE 'data:image/%' ORDER BY id LIMIT 1");
  for (let row; (row = next.get(lastId));) {
    lastId = row.id;
    db.exec('BEGIN IMMEDIATE');
    try {
      replace(row.id,{images:[row.image]});
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      if(error.status===400){console.warn(`Пропущено повреждённое старое фото товара #${row.id}; исходные данные сохранены.`);continue;}
      throw error;
    }
  }
  return {upload,replace,serialize,serializeAll};
}
