import { randomBytes, scryptSync, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey=promisify(scrypt);

export const token = () => randomBytes(32).toString('hex');
export const digest = value => createHash('sha256').update(value).digest('hex');
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, saved) {
  const [salt, hash] = saved.split(':');
  const candidate = scryptSync(password, salt, 64);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}
export async function hashPasswordAsync(password) {
  const salt=randomBytes(16).toString('hex');
  return `${salt}:${(await deriveKey(password,salt,64)).toString('hex')}`;
}
export async function verifyPasswordAsync(password,saved) {
  const [salt,hash]=saved.split(':');
  const candidate=await deriveKey(password,salt,64),expected=Buffer.from(hash,'hex');
  return candidate.length===expected.length&&timingSafeEqual(candidate,expected);
}
