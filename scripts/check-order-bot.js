import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { managerUsernames } from '../lib/order-bot-managers.js';
import { telegramApiError, telegramFailure } from '../lib/telegram-errors.js';

// Read-only diagnostics: no sendMessage, getUpdates, webhook changes or raw Telegram responses.
export async function checkOrderBot({ environment = process.env, dbPath, fetchImpl = fetch, write = console.log } = {}) {
  const token = environment.ORDER_BOT_TOKEN || '', allowed = managerUsernames(environment.ORDER_MANAGER_USERNAMES);
  const explicit = /^\d+$/.test(environment.ORDER_CHAT_ID || '');
  let healthy = true;
  write('Токен бота заказов: ' + (token ? 'задан (скрыт)' : 'НЕ ЗАДАН'));
  write('Основной BOT_TOKEN: ' + (environment.BOT_TOKEN ? 'задан (скрыт)' : 'НЕ ЗАДАН'));
  write('Режим: ' + (explicit ? 'ручной ORDER_CHAT_ID; белый список отключён' : 'белый список username'));
  write('Белый список: ' + (allowed.map(name => '@' + name).join(', ') || 'ПУСТО'));
  if (!token) return false;
  if (token === environment.BOT_TOKEN) {
    write('ОШИБКА: ORDER_BOT_TOKEN совпадает с BOT_TOKEN. Для уведомлений нужен токен отдельного бота.'); healthy = false;
  }
  if (!explicit && !allowed.length) { write('ОШИБКА: укажите username менеджера в ORDER_MANAGER_USERNAMES.'); healthy = false; }
  async function call(method) {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw telegramApiError(data.error_code || response.status);
    return data.result;
  }
  try {
    const me = await call('getMe');
    write('Бот уведомлений: ' + (/^[a-z0-9_]{1,32}$/i.test(me?.username || '') ? '@' + me.username : 'подключение подтверждено'));
    write('Отправьте /start именно этому боту с аккаунта менеджера из белого списка.');
  } catch (error) { write('ОШИБКА: ' + telegramFailure(error, 'getMe')); return false; }
  try {
    const webhook = await call('getWebhookInfo');
    if (webhook?.url) {
      write('ОШИБКА: у бота включён webhook; приложение не сможет получить /start через getUpdates. Используйте нового отдельного бота без webhook или отключите прежний webhook.'); healthy = false;
    } else write('Webhook: выключен, получение /start разрешено.');
  } catch (error) { write('ОШИБКА: ' + telegramFailure(error, 'getWebhookInfo')); healthy = false; }
  const path = dbPath || environment.DB_PATH || (existsSync('/var/lib/gas-shop/shop.db') ? '/var/lib/gas-shop/shop.db' : resolve('.data/shop.db'));
  if (!existsSync(path)) { write('База не найдена. Укажите путь через --db; новая база не создавалась.'); return false; }
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const botKey = createHash('sha256').update(token.split(':')[0]).digest('hex');
    const registered = db.prepare('SELECT username FROM order_bot_managers WHERE bot_key=?').all(botKey).filter(manager => allowed.includes(manager.username));
    write('Менеджеров из списка подключено: ' + registered.length);
    if (!explicit && !registered.length) { write('ТРЕБУЕТСЯ /start от разрешённого аккаунта. Проверьте, что служба загружает /etc/gas-shop.env.'); healthy = false; }
    write('Заказов в очереди: ' + db.prepare('SELECT COUNT(*) AS n FROM order_notifications WHERE delivered_at IS NULL').get().n);
    // Only known safe diagnostics are printed, never arbitrary database error text.
    const failed = db.prepare('SELECT COUNT(*) AS n FROM order_notifications WHERE delivered_at IS NULL AND attempts>0').get().n;
    write('Заказов с неудачной отправкой: ' + failed);
  } catch { write('Не удалось прочитать очередь. Проверьте путь к базе, права и обновление кода.'); healthy = false; }
  finally { db?.close(); }
  return healthy;
}

function checkServiceEnvironment(environment) {
  try {
    const pid = execFileSync('systemctl', ['show', 'gas-shop', '--property=MainPID', '--value'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!/^\d+$/.test(pid) || pid === '0') { console.log('Служба gas-shop не запущена. Выполните systemctl status gas-shop.'); return; }
    const runtime = Object.fromEntries(readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(value => value.includes('=')).map(value => [value.slice(0,value.indexOf('=')),value.slice(value.indexOf('=')+1)]));
    const keys = ['BOT_TOKEN', 'ORDER_BOT_TOKEN', 'ORDER_MANAGER_USERNAMES', 'ORDER_CHAT_ID'];
    const mismatch = keys.filter(key => (runtime[key] || '') !== (environment[key] || ''));
    console.log(mismatch.length ? 'ОШИБКА: служба работает с другими настройками: ' + mismatch.join(', ') + '. Подключите EnvironmentFile=/etc/gas-shop.env и перезапустите gas-shop.' : 'Настройки запущенной службы совпадают с файлом.');
  } catch { console.log('Окружение службы не прочитано. Запустите проверку на VDS от root.'); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { 'env-file': { type: 'string' }, db: { type: 'string' } } });
    const file = values['env-file'] || (existsSync('/etc/gas-shop.env') ? '/etc/gas-shop.env' : '');
    const environment = { ...process.env, ...(file ? parseEnv(readFileSync(file, 'utf8')) : {}) };
    checkServiceEnvironment(environment);
    if (!await checkOrderBot({ environment, dbPath: values.db })) process.exitCode = 1;
  } catch { console.error('Проверка не выполнена. Проверьте доступ к файлу настроек и параметры --env-file, --db. Значения токенов не выводились.'); process.exitCode = 1; }
}
