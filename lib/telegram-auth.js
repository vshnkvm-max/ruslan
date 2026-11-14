import { createHmac, timingSafeEqual } from 'node:crypto';

// initDataUnsafe is presentation data; orders require the signed initData string.
export function verifiedTelegramUser(initData, botToken) {
  if (!botToken || typeof initData !== 'string' || initData.length > 20000) return null;
  try {
    const fields = new URLSearchParams(initData), signature = fields.get('hash');
    if (new Set([...fields.keys()]).size !== [...fields.keys()].length || !/^[a-f0-9]{64}$/.test(signature || '')) return null;
    const authDate = Number(fields.get('auth_date')), age = Date.now() / 1000 - authDate;
    if (!Number.isSafeInteger(authDate) || age < -60 || age > 86400) return null;
    fields.delete('hash');
    const text = [...fields].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
    if (!timingSafeEqual(createHmac('sha256', secret).update(text).digest(), Buffer.from(signature, 'hex'))) return null;
    const user = JSON.parse(fields.get('user'));
    if (!Number.isSafeInteger(user?.id) || user.id <= 0) return null;
    return { id: user.id, first_name: String(user.first_name || '').slice(0, 100), last_name: String(user.last_name || '').slice(0, 100), username: String(user.username || '').slice(0, 80) };
  } catch { return null; }
}
