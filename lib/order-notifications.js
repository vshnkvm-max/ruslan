import { createOrderBotManagers } from './order-bot-managers.js';

// Durable, at-least-once delivery. Each recipient and confirmed message has its own checkpoint.
export function createOrderNotifier(db, { token = '', chatId = '', usernames = '', fetchImpl = fetch } = {}) {
  const explicitChat = /^\d+$/.test(String(chatId)) ? String(chatId) : '';
  let timer, running, stopped = false;
  const controllers = new Set();
  async function call(method, body) {
    const controller = new AbortController(); controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error('delivery');
      return result.result;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  const managers = createOrderBotManagers(db, { token, usernames, call, isStopped: () => stopped });
  const recipients = () => explicitChat ? [explicitChat] : managers.recipients();
  const enabled = Boolean(token && (explicitChat || managers.enabled));
  async function flush() {
    if (stopped || !enabled || running) return running;
    running = (async () => {
      const chats = recipients();
      if (!chats.length) return;
      // Preserve checkpoints of installations previously configured with ORDER_CHAT_ID.
      for (const chat of chats) db.prepare(`INSERT OR IGNORE INTO order_notification_deliveries(order_id,chat_id,sent_count,attempts,next_attempt_at,last_error)
        SELECT order_id,?,${explicitChat ? 'sent_count,attempts,next_attempt_at,last_error' : "0,0,0,''"} FROM order_notifications WHERE delivered_at IS NULL`).run(chat);
      const placeholders = chats.map(() => '?').join(',');
      const entries = db.prepare(`SELECT d.*,n.messages FROM order_notification_deliveries d JOIN order_notifications n ON n.order_id=d.order_id
        WHERE n.delivered_at IS NULL AND d.delivered_at IS NULL AND d.next_attempt_at<=? AND d.chat_id IN (${placeholders}) ORDER BY d.order_id,d.chat_id LIMIT 5`).all(Date.now(), ...chats);
      for (const entry of entries) {
        if (stopped) break;
        try {
          const messages = JSON.parse(entry.messages);
          const order = db.prepare('SELECT status,deleted FROM orders WHERE id=?').get(entry.order_id);
          const state = order?.deleted ? 'Удалён' : ({new:'Новый',accepted:'Принят',completed:'Выполнен',cancelled:'Отменён'}[order?.status] || 'Неизвестен');
          for (let i = entry.sent_count; i < messages.length; i++) {
            await call('sendMessage', { chat_id: entry.chat_id, text: messages[i] + '\n\nСтатус на момент отправки: ' + state, link_preview_options: { is_disabled: true } });
            if (stopped) return;
            db.prepare("UPDATE order_notification_deliveries SET sent_count=?,last_error='' WHERE order_id=? AND chat_id=?").run(i + 1, entry.order_id, entry.chat_id);
          }
          if (!stopped) db.prepare("UPDATE order_notification_deliveries SET delivered_at=?,last_error='' WHERE order_id=? AND chat_id=?").run(new Date().toISOString(), entry.order_id, entry.chat_id);
        } catch {
          if (!stopped) db.prepare("UPDATE order_notification_deliveries SET attempts=attempts+1,next_attempt_at=?,last_error='Не удалось отправить. Повторяем автоматически.' WHERE order_id=? AND chat_id=?").run(Date.now() + Math.min(300000, 5000 * 2 ** Math.min(entry.attempts, 6)), entry.order_id, entry.chat_id);
        }
      }
      if (!stopped) {
        const pending = db.prepare('SELECT order_id FROM order_notifications WHERE delivered_at IS NULL').all();
        for (const {order_id} of pending) {
          const aggregate = db.prepare(`SELECT MIN(sent_count) AS sent_count,MAX(attempts) AS attempts,MIN(next_attempt_at) AS next_attempt_at,COUNT(*) AS total,COUNT(delivered_at) AS delivered FROM order_notification_deliveries WHERE order_id=? AND chat_id IN (${placeholders})`).get(order_id, ...chats);
          if (!aggregate.total) continue;
          const done = aggregate.total === chats.length && aggregate.delivered === aggregate.total;
          db.prepare('UPDATE order_notifications SET sent_count=?,attempts=?,next_attempt_at=?,delivered_at=?,last_error=? WHERE order_id=?').run(aggregate.sent_count,aggregate.attempts,aggregate.next_attempt_at,done?new Date().toISOString():null,done?'':aggregate.attempts?'Не удалось отправить. Повторяем автоматически.':'',order_id);
        }
      }
    })().finally(() => { running = undefined; });
    return running;
  }
  return {
    get configured() { return Boolean(token && recipients().length); },
    get recipientCount() { return recipients().length; },
    registrationEnabled: !explicitChat && managers.enabled,
    flush, pollManagers: () => explicitChat ? Promise.resolve() : managers.poll(true),
    start() {
      if (!enabled || timer || stopped) return;
      const tick = () => { if (!explicitChat) void managers.poll(); void flush(); };
      timer = setInterval(tick, 1000); timer.unref(); tick();
    },
    stop() { stopped = true; clearInterval(timer); for (const controller of controllers) controller.abort(); }
  };
}
