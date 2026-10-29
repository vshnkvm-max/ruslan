import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { openDatabase } from '../lib/database.js';
import { hashPassword } from '../lib/auth.js';

const path = resolve(process.env.DB_PATH || '.data/shop.db');
const db = openDatabase(path);
const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD || randomBytes(18).toString('base64url');
if (username!==username.trim() || username.length>80 || !username.trim()) throw new Error('Логин должен содержать от 1 до 80 символов без пробелов по краям.');
if (password.length < 12) throw new Error('Пароль должен содержать не менее 12 символов.');
if (db.prepare('SELECT id FROM admins WHERE username=?').get(username)) {
  console.log('Администратор уже существует. Учётная запись не изменена.');
} else {
  const credentials = join(dirname(path),'initial-admin.txt');
  if (existsSync(credentials) && !process.env.ADMIN_PASSWORD) throw new Error('Файл initial-admin.txt уже существует. Сохраните его и задайте ADMIN_PASSWORD для новой учётной записи.');
  db.prepare('INSERT INTO admins (username,password) VALUES (?,?)').run(username,hashPassword(password));
  if (!process.env.ADMIN_PASSWORD) {
    writeFileSync(credentials,`Логин: ${username}\nПароль: ${password}\n\nХраните эти данные в менеджере паролей. Этот файл можно удалить после сохранения.\n`,{mode:0o600,flag:'wx'});
    console.log(`Администратор создан. Данные для входа: ${credentials}`);
  } else console.log('Администратор создан с паролем из ADMIN_PASSWORD.');
}
db.close();
