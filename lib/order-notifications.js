// Durable, at-least-once delivery. Each confirmed Telegram message is checkpointed separately.
export function createOrderNotifier(db, { token = '', chatId = '', fetchImpl = fetch } = {}) {
  const configured = Boolean(token && /^\d+$/.test(String(chatId)));
  let timer, running, stopped = false, controller;
  async function flush() {
    if (stopped || !configured || running) return running;
    running = (async () => {
      const entries = db.prepare('SELECT * FROM order_notifications WHERE delivered_at IS NULL AND next_attempt_at<=? ORDER BY order_id LIMIT 5').all(Date.now());
      for (const entry of entries) {
        if (stopped) break;
        try {
          const messages = JSON.parse(entry.messages);
          const order = db.prepare('SELECT status,deleted FROM orders WHERE id=?').get(entry.order_id);
          const state = order?.deleted ? 'Удалён' : ({new:'Новый',accepted:'Принят',completed:'Выполнен',cancelled:'Отменён'}[order?.status] || 'Неизвестен');
          for (let i = entry.sent_count; i < messages.length; i++) {
            controller = new AbortController();
            const timeout = setTimeout(() => controller?.abort(), 8000);
            try {
              const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
                body: JSON.stringify({ chat_id: String(chatId), text: messages[i] + '\n\nСтатус на момент отправки: ' + state, link_preview_options: { is_disabled: true } })
              });
              const result = await response.json();
              if (!response.ok || !result.ok) throw new Error('delivery');
              if (stopped) return;
              db.prepare("UPDATE order_notifications SET sent_count=?,last_error='' WHERE order_id=?").run(i + 1, entry.order_id);
            } finally { clearTimeout(timeout); controller = undefined; }
          }
          if (!stopped) db.prepare("UPDATE order_notifications SET delivered_at=?,last_error='' WHERE order_id=?").run(new Date().toISOString(), entry.order_id);
        } catch {
          if (!stopped) db.prepare("UPDATE order_notifications SET attempts=attempts+1,next_attempt_at=?,last_error='Не удалось отправить. Повторяем автоматически.' WHERE order_id=?").run(Date.now() + Math.min(300000, 5000 * 2 ** Math.min(entry.attempts, 6)), entry.order_id);
        }
      }
    })().finally(() => { running = undefined; });
    return running;
  }
  return {
    configured, flush,
    start() { if (!configured || timer || stopped) return; timer = setInterval(() => { void flush(); }, 1000); timer.unref(); void flush(); },
    stop() { stopped = true; clearInterval(timer); controller?.abort(); }
  };
}
