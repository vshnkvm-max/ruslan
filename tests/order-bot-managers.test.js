import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../lib/database.js';
import { createOrderNotifier } from '../lib/order-notifications.js';

function update(update_id, id, username, extra = {}) {
  return { update_id, message: { text: '/start', from: { id, username }, chat: { id, type: 'private' }, ...extra } };
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'shop-managers-')), path = join(directory, 'shop.db');
  let db = openDatabase(path);
  db.prepare("INSERT INTO customers(id,name,username,email,city,joined,referral_code) VALUES (1,'Buyer','','','','now','CODE')").run();
  db.prepare("INSERT INTO orders(id,customer_id,status,delivery,address,created_at) VALUES (1,1,'new','','','now')").run();
  db.prepare("INSERT INTO order_notifications(order_id,messages) VALUES (1,?)").run(JSON.stringify(['Order one']));
  let updates = [], failChat = '', failPoll = false;
  const sent = [], offsets = [];
  const options = { token: '123456:test-token', usernames: ' @ManagerOne, MANAGERTWO ', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/getUpdates')) {
      offsets.push(body.offset);
      if (failPoll) throw new Error('poll failure');
      const result = updates.filter(update => update.update_id >= body.offset);
      return { ok: true, json: async () => ({ ok: true, result }) };
    }
    if (String(body.chat_id) === failChat && body.text.startsWith('Order')) throw new Error('delivery failure');
    sent.push(body);
    return { ok: true, json: async () => ({ ok: true, result: { message_id: sent.length } }) };
  } };
  return { get db() { return db; }, options, sent, offsets, setUpdates(value) { updates = value; }, failFor(chat) { failChat = chat; }, failPolling() { failPoll = true; }, reopen() { db.close(); db = openDatabase(path); }, close() { db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('only private /start from an allowlisted username can register; username case and @ normalize', async () => {
  const f = fixture(), notifier = createOrderNotifier(f.db, f.options);
  try {
    assert.equal(notifier.configured, false); assert.equal(notifier.registrationEnabled, true);
    await notifier.flush(); assert.equal(f.sent.length, 0);
    f.setUpdates([
      update(1, 10, 'outsider'), update(2, 11, 'managerone', { chat: { id: -50, type: 'group' } }),
      update(3, 12, 'managerone', { text: 'hello' }), update(4, 13, 'managerone', { chat: { id: 99, type: 'private' } }),
      update(5, 14, 'managerone', { from: { id: 14, username: 'managerone', is_bot: true } }),
      update(6, 101, 'ManagerOne'), update(7, 202, 'MANAGERTWO')
    ]);
    await notifier.pollManagers(); assert.equal(notifier.configured, true); assert.equal(notifier.recipientCount, 2);
    assert.deepEqual(f.sent.map(body => body.chat_id), ['101', '202']);
    await notifier.flush();
    assert.deepEqual(f.sent.filter(body => body.text.startsWith('Order')).map(body => body.chat_id).sort(), ['101', '202']);
    assert.ok(f.db.prepare('SELECT delivered_at FROM order_notifications WHERE order_id=1').get().delivered_at);
    const count = f.sent.length; await notifier.pollManagers(); await notifier.flush(); assert.equal(f.sent.length, count); assert.equal(f.offsets.at(-1), 8);
  } finally { notifier.stop(); f.close(); }
});

test('binding and offset survive restart; transferred usernames cannot overwrite identity; removing allowlist revokes delivery', async () => {
  const f = fixture(); let notifier = createOrderNotifier(f.db, f.options);
  try {
    f.setUpdates([update(1, 101, 'managerone')]); await notifier.pollManagers(); notifier.stop(); f.reopen();
    notifier = createOrderNotifier(f.db, f.options); assert.equal(notifier.recipientCount, 1);
    f.setUpdates([update(2, 999, 'managerone')]); await notifier.pollManagers(); assert.equal(f.offsets.at(-1), 2);
    assert.equal(notifier.recipientCount, 1); await notifier.flush();
    assert.equal(f.sent.filter(body => body.chat_id === '999').length, 0); assert.equal(f.sent.filter(body => body.text.startsWith('Order'))[0].chat_id, '101');
    notifier.stop(); notifier = createOrderNotifier(f.db, { ...f.options, usernames: 'managertwo' });
    assert.equal(notifier.configured, false); assert.equal(notifier.recipientCount, 0);
    notifier.stop(); notifier = createOrderNotifier(f.db, { ...f.options, token: '777777:another-bot' }); assert.equal(notifier.recipientCount, 0);
    notifier.stop(); notifier = createOrderNotifier(f.db, { ...f.options, token: '123456:rotated-token' }); assert.equal(notifier.recipientCount, 1);
  } finally { notifier.stop(); f.close(); }
});

test('delivery failures are retried for the failed recipient only, polling failure preserves existing recipients', async () => {
  const f = fixture(), notifier = createOrderNotifier(f.db, f.options);
  try {
    f.setUpdates([update(1, 101, 'managerone'), update(2, 202, 'managertwo')]); await notifier.pollManagers();
    f.failFor('202'); await notifier.flush();
    assert.equal(f.sent.filter(body => body.text.startsWith('Order') && body.chat_id === '101').length, 1);
    assert.equal(f.db.prepare('SELECT delivered_at FROM order_notifications WHERE order_id=1').get().delivered_at, null);
    f.failFor(''); f.failPolling(); await notifier.pollManagers(); assert.equal(notifier.recipientCount, 2);
    f.db.prepare('UPDATE order_notification_deliveries SET next_attempt_at=0').run(); await notifier.flush();
    assert.equal(f.sent.filter(body => body.text.startsWith('Order') && body.chat_id === '101').length, 1);
    assert.equal(f.sent.filter(body => body.text.startsWith('Order') && body.chat_id === '202').length, 1);
    assert.ok(f.db.prepare('SELECT delivered_at FROM order_notifications WHERE order_id=1').get().delivered_at);
  } finally { notifier.stop(); f.close(); }
});

test('manual ORDER_CHAT_ID stays compatible and does not poll the bot', async () => {
  const f = fixture(), notifier = createOrderNotifier(f.db, { ...f.options, chatId: '303' });
  try {
    assert.equal(notifier.configured, true); assert.equal(notifier.registrationEnabled, false);
    await notifier.pollManagers(); await notifier.flush(); assert.deepEqual(f.offsets, []);
    assert.equal(f.sent[0].chat_id, '303');
  } finally { notifier.stop(); f.close(); }
});
