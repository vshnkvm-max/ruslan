import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../lib/database.js';
import { createOrderNotifier } from '../lib/order-notifications.js';
import { managerUsernames } from '../lib/order-bot-managers.js';
import { checkOrderBot } from '../scripts/check-order-bot.js';

const token = '123456:SECRET_NOT_FOR_OUTPUT';
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'shop-bot-diagnostics-')), path = join(directory, 'shop.db'), db = openDatabase(path);
  return { db, path, close() { db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('manager usernames support collectible short names and common separators', () => {
  assert.deepEqual(managerUsernames('@John; ManagerOne @managerone,second_manager'), ['john', 'managerone', 'second_manager']);
  assert.deepEqual(managerUsernames('https://t.me/manager_one,display-name,123:secret'), []);
});

test('polling errors become safe actionable diagnostics and clear after recovery', async () => {
  const f = fixture(), logs = []; let fail = true;
  const notifier = createOrderNotifier(f.db, { token, usernames: 'managerone', log: message => logs.push(message), fetchImpl: async () => fail ? { ok: false, status: 409, json: async () => ({ ok: false, error_code: 409, description: 'SECRET_NOT_FOR_OUTPUT ' + token }) } : { ok: true, json: async () => ({ ok: true, result: [] }) } });
  try {
    await notifier.pollManagers(); await notifier.pollManagers();
    assert.match(notifier.error, /webhook/); assert.equal(logs.length, 1); assert.doesNotMatch(JSON.stringify(logs), /SECRET_NOT_FOR_OUTPUT/);
    fail = false; await notifier.pollManagers(); assert.equal(notifier.error, '');
  } finally { notifier.stop(); f.close(); }
});

test('rejected registration and failed acknowledgement are visible without admitting an outsider', async () => {
  const f = fixture(); let updates = [{ update_id: 1, message: { text: '/start', chat: { id: 101, type: 'private' }, from: { id: 101, username: 'outsider' } } }];
  const notifier = createOrderNotifier(f.db, { token, usernames: 'managerone', fetchImpl: async url => url.endsWith('/getUpdates') ? { ok: true, json: async () => ({ ok: true, result: updates }) } : { ok: false, status: 403, json: async () => ({ ok: false, error_code: 403 }) } });
  try {
    await notifier.pollManagers(); assert.equal(notifier.recipientCount, 0); assert.match(notifier.error, /вне белого списка/);
    updates = [{ update_id: 2, message: { text: '/start', chat: { id: 101, type: 'private' }, from: { id: 101, username: 'managerone' } } }];
    await notifier.pollManagers(); assert.equal(notifier.recipientCount, 1); assert.match(notifier.error, /Разблокируйте/);
  } finally { notifier.stop(); f.close(); }
});

test('doctor identifies bot and webhook without polling, sending messages, printing secrets or changing the database', async () => {
  const f = fixture(), output = [], methods = [];
  try {
    const before = f.db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
    const healthy = await checkOrderBot({ environment: { ORDER_BOT_TOKEN: token, BOT_TOKEN: 'other:main', ORDER_MANAGER_USERNAMES: '@managerone' }, dbPath: f.path, write: line => output.push(line), fetchImpl: async url => {
      const method = url.split('/').at(-1); methods.push(method);
      return { ok: true, json: async () => ({ ok: true, result: method === 'getMe' ? { username: 'orders_test_bot' } : { url: 'https://example.test/SECRET_WEBHOOK_PATH' } }) };
    } });
    assert.equal(healthy, false); assert.deepEqual(methods, ['getMe', 'getWebhookInfo']);
    assert.match(output.join('\n'), /@orders_test_bot/); assert.match(output.join('\n'), /включён webhook/); assert.match(output.join('\n'), /подключено: 0/);
    assert.doesNotMatch(output.join('\n'), /SECRET|other:main|example\.test/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM settings').get().n, before);
  } finally { f.close(); }
});

test('doctor classifies an invalid token without logging upstream errors', async () => {
  const output = [];
  const healthy = await checkOrderBot({ environment: { ORDER_BOT_TOKEN: token }, write: line => output.push(line), fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error_code: 401, description: token }) }) });
  assert.equal(healthy, false); assert.match(output.join('\n'), /не принял токен/); assert.doesNotMatch(output.join('\n'), /SECRET_NOT_FOR_OUTPUT/);
});

test('Telegram retry_after is respected and send failures persist a specific safe reason', async () => {
  const f = fixture();
  f.db.prepare("INSERT INTO customers(id,name,username,email,city,joined,referral_code) VALUES (1,'Buyer','','','','now','CODE')").run();
  f.db.prepare("INSERT INTO orders(id,customer_id,status,delivery,address,created_at) VALUES (1,1,'new','','','now')").run();
  f.db.prepare('INSERT INTO order_notifications(order_id,messages) VALUES (1,?)').run(JSON.stringify(['Order']));
  const notifier = createOrderNotifier(f.db, { token, chatId: '101', fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ ok: false, error_code: 429, description: token, parameters: { retry_after: 120 } }) }) });
  try {
    const before = Date.now(); await notifier.flush();
    const notification = f.db.prepare('SELECT * FROM order_notification_deliveries WHERE order_id=1').get();
    assert.ok(notification.next_attempt_at >= before + 120000); assert.match(notification.last_error, /частоту запросов/); assert.doesNotMatch(notification.last_error, /SECRET/);
  } finally { notifier.stop(); f.close(); }
});
