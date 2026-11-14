import { createHash } from 'node:crypto';

export function managerUsernames(usernames = '') {
  return [...new Set(String(usernames).split(/[,;\s]+/).map(name => name.trim().replace(/^@/, '').toLowerCase()).filter(name => /^[a-z0-9_]{1,32}$/.test(name)))];
}

export function createOrderBotManagers(db, { token, usernames = '', call, isStopped = () => false, onPollError = () => {}, onPollSuccess = () => {}, onRegistrationError = () => {} }) {
  const allowed = new Set(managerUsernames(usernames));
  // A rotated token for the same bot retains its bindings; a different bot requires /start again.
  const botKey = createHash('sha256').update(token.split(':')[0]).digest('hex'), offsetKey = 'order-bot-offset:' + botKey;
  let running, lastPoll = 0;
  const recipients = () => db.prepare('SELECT * FROM order_bot_managers WHERE bot_key=?').all(botKey).filter(manager => allowed.has(manager.username)).map(manager => manager.chat_id);
  async function poll(force = false) {
    if (isStopped() || !token || !allowed.size || running || (!force && Date.now() - lastPoll < 3000)) return running;
    lastPoll = Date.now();
    running = (async () => {
      try {
        const offset = Number(db.prepare('SELECT value FROM settings WHERE key=?').get(offsetKey)?.value || 0);
        const updates = await call('getUpdates', { offset, timeout: 0, limit: 100, allowed_updates: ['message'] });
        if (isStopped() || !Array.isArray(updates)) return;
        onPollSuccess();
        for (const update of updates) {
          if (isStopped()) return;
          if (!Number.isSafeInteger(update.update_id) || update.update_id < offset) continue;
          const message = update.message, from = message?.from, chat = message?.chat;
          const username = typeof from?.username === 'string' ? from.username.toLowerCase() : '';
          let registered = false, rejection = '';
          const start = chat?.type === 'private' && /^\/start(?:@[a-z0-9_]+)?(?:\s.*)?$/i.test(message?.text || '');
          if (start && !allowed.has(username)) rejection = 'Получен /start от аккаунта вне белого списка. Проверьте username менеджера в ORDER_MANAGER_USERNAMES и перезапустите службу.';
          db.exec('BEGIN IMMEDIATE');
          try {
            if (chat?.type === 'private' && Number.isSafeInteger(from?.id) && from.id > 0 && from.id === chat.id && !from.is_bot && allowed.has(username) && /^\/start(?:@[a-z0-9_]+)?(?:\s.*)?$/i.test(message.text || '')) {
              // Pin an approved username to its first Telegram ID, so transfer of that username cannot take over the binding.
              const byName = db.prepare('SELECT telegram_id FROM order_bot_managers WHERE bot_key=? AND username=?').get(botKey, username);
              const byId = db.prepare('SELECT username FROM order_bot_managers WHERE bot_key=? AND telegram_id=?').get(botKey, from.id);
              if ((!byName || byName.telegram_id === from.id) && (!byId || byId.username === username)) {
                db.prepare('INSERT INTO order_bot_managers(bot_key,telegram_id,username,chat_id) VALUES (?,?,?,?) ON CONFLICT(bot_key,telegram_id) DO NOTHING').run(botKey, from.id, username, String(chat.id));
                registered = true;
              } else rejection = 'Этот username уже закреплён за другим Telegram-аккаунтом. Нужен сброс прежней привязки администратором.';
            }
            db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(offsetKey, String(update.update_id + 1));
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
          if (rejection) onRegistrationError(rejection);
          if (registered) {
            try {
              await call('sendMessage', { chat_id: String(chat.id), text: 'Вы подключены к уведомлениям о заказах GAS SHOP. Новые заказы будут приходить в этот чат.' });
              if (!isStopped()) onRegistrationError('');
            } catch (error) { if (!isStopped()) onRegistrationError(error); }
          }
        }
      } catch (error) { if (!isStopped()) onPollError(error); }
    })().finally(() => { running = undefined; });
    return running;
  }
  return { enabled: Boolean(token && allowed.size), recipients, poll };
}
