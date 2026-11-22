import { ECDH } from 'node:crypto';
import webPush from 'web-push';
import { digest } from './auth.js';

const deliveryLifetime = 60 * 60 * 1000;
const pushHosts = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);

function browserPushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048 || /\s/.test(value)) return null;
  const url = URL.parse(value);
  if (!url || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) return null;
  if (!pushHosts.has(url.hostname) && !url.hostname.endsWith('.push.apple.com') &&
      !url.hostname.endsWith('.notify.windows.com')) return null;
  return url.href;
}

export function createOrderPush(db, {
  fail,
  send = webPush.sendNotification,
  log = process.env.NODE_ENV === 'production' ? console.warn : () => {}
}) {
  let timer, running, stopped = false;
  function keys() {
    let saved = db.prepare("SELECT value FROM settings WHERE key='order_push_vapid'").get();
    if (!saved) {
      db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES ('order_push_vapid',?)")
        .run(JSON.stringify(webPush.generateVAPIDKeys()));
      saved = db.prepare("SELECT value FROM settings WHERE key='order_push_vapid'").get();
    }
    return JSON.parse(saved.value);
  }

  function subscribe(adminId, subscription) {
    const endpoint = browserPushEndpoint(subscription.endpoint);
    const { p256dh, auth } = subscription.keys ?? {};
    if (!endpoint || typeof p256dh !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(p256dh) ||
        typeof auth !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(auth)) {
      fail(400, 'Некорректная подписка на уведомления.');
    }
    try { ECDH.convertKey(Buffer.from(p256dh, 'base64url'), 'prime256v1'); }
    catch { fail(400, 'Некорректный ключ подписки на уведомления.'); }
    const id = digest(endpoint);
    db.prepare(`INSERT INTO order_push_devices(id,admin_id,endpoint,public_key,auth_secret) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET admin_id=excluded.admin_id, public_key=excluded.public_key, auth_secret=excluded.auth_secret`)
      .run(id, adminId, endpoint, p256dh, auth);
    return id;
  }

  function enqueue(orderId) {
    db.prepare('INSERT INTO order_push_deliveries(order_id,device_id,expires_at) SELECT ?,id,? FROM order_push_devices')
      .run(orderId, Date.now() + deliveryLifetime);
  }

  async function deliver(job, vapidDetails) {
    const { order_id: orderId, device_id: deviceId } = job;
    const subscription = { endpoint: job.endpoint, keys: { p256dh: job.public_key, auth: job.auth_secret } };
    try {
      await send(subscription, JSON.stringify({ orderId }), {
        vapidDetails, TTL: Math.max(0, Math.ceil((job.expires_at - Date.now()) / 1000)),
        topic: 'order-' + orderId, timeout: 8000
      });
    } catch (error) {
      if (stopped) return;
      if ([404, 410].includes(error.statusCode)) {
        db.prepare('DELETE FROM order_push_devices WHERE id=? AND public_key=? AND auth_secret=?')
          .run(deviceId, job.public_key, job.auth_secret);
        return;
      }
      const seconds = Number(error.headers?.['retry-after']);
      const delay = Math.max(Number.isFinite(seconds) ? seconds * 1000 : 0, Math.min(300000, 5000 * 2 ** Math.min(job.attempts, 6)));
      db.prepare('UPDATE order_push_deliveries SET attempts=attempts+1,next_attempt_at=? WHERE order_id=? AND device_id=?')
        .run(Date.now() + delay, orderId, deviceId);
      if (job.attempts === 0) {
        const status = Number.isInteger(error.statusCode) ? 'HTTP ' + error.statusCode : 'ошибка соединения';
        log('[Уведомления о заказах] ' + status);
      }
      return;
    }
    if (!stopped) db.prepare('DELETE FROM order_push_deliveries WHERE order_id=? AND device_id=?').run(orderId, deviceId);
  }

  async function flush() {
    if (stopped || running) return running;
    const now = Date.now();
    db.prepare('DELETE FROM order_push_deliveries WHERE expires_at<=?').run(now);
    const jobs = db.prepare(`SELECT jobs.*, devices.endpoint, devices.public_key, devices.auth_secret
      FROM order_push_deliveries jobs JOIN order_push_devices devices ON devices.id=jobs.device_id
      WHERE jobs.next_attempt_at<=? ORDER BY jobs.order_id LIMIT 10`).all(now);
    if (!jobs.length) return;
    const vapidDetails = { subject: 'https://github.com/vshnkvm-max/ruslan', ...keys() };
    running = Promise.all(jobs.map(job => deliver(job, vapidDetails))).finally(() => { running = undefined; });
    return running;
  }

  return {
    publicKey: () => keys().publicKey,
    subscribe, enqueue, flush,
    unsubscribe(adminId, id) {
      db.prepare('DELETE FROM order_push_devices WHERE admin_id=? AND id=?').run(adminId, id);
    },
    start() {
      if (timer || stopped) return;
      timer = setInterval(() => void flush().catch(() => log('[Уведомления о заказах] Ошибка очереди.')), 1000);
      timer.unref();
    },
    stop() { stopped = true; clearInterval(timer); }
  };
}
