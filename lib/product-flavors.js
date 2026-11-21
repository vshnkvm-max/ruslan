export function flavorName(value, str, fail) {
  const name = str(value, 'Вкус', 80).normalize('NFC');
  if (name.length > 80 || !name.isWellFormed() || /\p{Cc}/u.test(name)) fail(400, 'Проверьте название вкуса.');
  return name;
}

export const flavorKey = name => name.toLocaleLowerCase('ru');

export function readProductFlavors(product) {
  const { tracked = false, options = [] } = JSON.parse(product.flavor_details);
  const stored = new Map(options.map(option => [option.name, option]));
  const flavors = new Map(JSON.parse(product.flavors).map(name => [name, stored.get(name) ?? { name, stock: 0, markup: 0 }]));
  const assigned = [...flavors.values()].reduce((total, option) => total + option.stock, 0);
  return { tracked, flavors, unassigned: product.stock - assigned };
}

export function serializeProductFlavors(product) {
  const { tracked, flavors, unassigned } = readProductFlavors(product);
  const { flavor_details, ...fields } = product;
  return {
    ...fields,
    flavors: [...flavors.keys()],
    flavor_options: [...flavors.values()].map(option => ({ ...option, stock: tracked ? option.stock : null })),
    unassigned_stock: tracked || !flavors.size ? unassigned : 0,
    flavor_stock_tracked: tracked
  };
}

export function writeProductFlavors(db, productId, {tracked, flavors}) {
  db.prepare('UPDATE products SET flavors=?,flavor_details=? WHERE id=?')
    .run(JSON.stringify([...flavors.keys()]), JSON.stringify({tracked,options:[...flavors.values()]}), productId);
}

export function validateFlavorPrice(price, markup, fail) {
  if (!Number.isSafeInteger(markup) || price + markup < 0 || price + markup > 100000000) {
    fail(400, 'Цена товара с наценкой за вкус должна быть целым числом от 0 до 100 000 000 ₽.');
  }
}

export function changeProductStock(db, product, deltas, fail, message, maxStock = Infinity) {
  const state = readProductFlavors(product);
  let total = product.stock;
  for (const [name, delta] of deltas) {
    if (!delta) continue;
    total += delta;
    if (name === null) {
      state.unassigned += delta;
      continue;
    }
    const flavor = state.flavors.get(name);
    if (!flavor || flavor.stock + delta < 0) fail(409, message);
    flavor.stock += delta;
    state.tracked = true;
  }
  if (state.unassigned < 0 || total > maxStock) fail(409, message);
  if (total !== product.stock) db.prepare('UPDATE products SET stock=? WHERE id=?').run(total,product.id);
  if (state.tracked) writeProductFlavors(db,product.id,state);
}
