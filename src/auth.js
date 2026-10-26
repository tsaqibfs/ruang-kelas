import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { InputError } from './store.js';
const derive = promisify(scrypt);
export const digest = token => createHash('sha256').update(token).digest('hex');
export const randomToken = () => randomBytes(32).toString('hex');
export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new InputError('Password harus 12–128 karakter.');
}
export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128 || !stored) return false;
  const [salt, expected] = stored.split(':');
  const result = await derive(password, salt, 64);
  return equal(result.toString('hex'), expected);
}
