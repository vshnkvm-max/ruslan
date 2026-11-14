// Read secrets from the environment; never print the bot token or raw Telegram responses.
const token = process.env.ORDER_BOT_TOKEN;
if (!token) { console.error('Задайте ORDER_BOT_TOKEN в окружении.'); process.exit(1); }
try {
  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error('api');
  const chats = new Map();
  for (const update of data.result || []) {
    const chat = update.message?.chat;
    if (chat?.type === 'private') chats.set(chat.id, chat);
  }
  if (!chats.size) console.log('Личные чаты не найдены. Менеджер должен открыть отдельного бота и отправить /start, затем повторите команду. Если у бота установлен webhook, getUpdates недоступен: используйте новый отдельный бот без webhook.');
  for (const chat of chats.values()) console.log(`ORDER_CHAT_ID=${chat.id} · ${[chat.first_name, chat.last_name].filter(Boolean).join(' ')}${chat.username ? ' (@' + chat.username + ')' : ''}`);
} catch { console.error('Не удалось получить чаты. Проверьте токен, доступ к api.telegram.org:443 и отсутствие webhook у отдельного бота.'); process.exitCode = 1; }
