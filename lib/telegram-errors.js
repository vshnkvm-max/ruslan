// Never return upstream descriptions, fetch URLs or exception messages: they may contain bot tokens.
export function telegramFailure(error, method = '') {
  const status = error?.telegramStatus;
  if (status === 401 || status === 404) return 'Telegram не принял токен ORDER_BOT_TOKEN. Проверьте токен отдельного бота заказов.';
  if (status === 409 && method === 'getUpdates') return 'Не удаётся получать /start: у бота включён webhook или этот же бот запущен в другой программе. Используйте отдельного бота без webhook.';
  if (status === 403) return 'Бот не может написать менеджеру. Разблокируйте бота и отправьте ему /start в личном чате.';
  if (status === 429) return 'Telegram ограничил частоту запросов. Отправка повторится после паузы.';
  if (status === 400 && method === 'sendMessage') return 'Telegram отклонил сообщение. Проверьте ORDER_CHAT_ID и отправьте /start именно боту заказов.';
  if (status) return `Telegram вернул ошибку ${status}. Запрос будет повторён.`;
  return 'Нет ответа от Telegram. Проверьте доступ сервера к api.telegram.org:443 и DNS.';
}

export function telegramApiError(status, retryAfter) {
  const error = new Error('Telegram request failed');
  error.telegramStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 502;
  error.retryAfter = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 86400) : 0;
  return error;
}
