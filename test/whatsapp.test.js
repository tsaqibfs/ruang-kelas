import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WhatsApp } from '../src/whatsapp.js';
class Client extends EventEmitter {
  async initialize() {}
  async destroy() { this.emit('auth_failure'); this.emit('disconnected'); }
  async getChats() { return [{ id: { _serialized: '123@g.us' }, name: 'Kelas A' }]; }
}
test('grup dikenali melalui ID grup walau isGroup belum tersedia', async () => {
  const client = new Client();
  const bot = new WhatsApp('.', { createClient: () => client });
  await bot.start(); client.emit('ready');
  assert.deepEqual(await bot.groups(), [{ id: '123@g.us', name: 'Kelas A' }]);
  await bot.stop();
});
test('event client lama tidak merusak koneksi baru setelah putus dan sambung', async () => {
  const clients = [];
  const bot = new WhatsApp('.', { createClient: () => { const c = new Client(); clients.push(c); return c; } });
  await bot.start(); clients[0].emit('ready');
  clients[0].emit('disconnected');
  await Promise.all([bot.start(), bot.start()]);
  assert.equal(clients.length, 2);
  clients[1].emit('ready'); clients[0].emit('auth_failure');
  assert.equal(bot.snapshot().status, 'ready');
  await bot.stop();
});
test('permintaan sambung menunggu penghentian browser lama selesai', async () => {
  let release;
  const clients = [];
  const bot = new WhatsApp('.', { createClient: () => { const c = new Client(); clients.push(c); return c; } });
  await bot.start(); clients[0].emit('ready');
  clients[0].destroy = () => new Promise(resolve => { release = resolve; });
  const stopping = bot.stop();
  await new Promise(resolve => setImmediate(resolve));
  const starting = bot.start();
  release(); await Promise.all([stopping, starting]);
  assert.equal(clients.length, 2);
  clients[1].emit('ready'); assert.equal(bot.isReady(), true);
  await bot.stop();
});
test('kegagalan menutup browser tidak membuka client kedua memakai profil sama', async () => {
  const clients = [];
  const bot = new WhatsApp('.', { createClient: () => { const c = new Client(); clients.push(c); return c; } });
  await bot.start(); clients[0].emit('ready');
  clients[0].destroy = async () => { throw new Error('profile masih terkunci'); };
  await assert.rejects(bot.stop(), /profile masih terkunci/);
  await assert.rejects(bot.start(), /profile masih terkunci/);
  assert.equal(clients.length, 1);
  clients[0].destroy = async () => {};
  await bot.stop(); await bot.start();
  assert.equal(clients.length, 2);
  await bot.stop();
});
test('hasil daftar grup dari koneksi yang sudah terputus ditolak', async () => {
  const client = new Client();
  const bot = new WhatsApp('.', { createClient: () => client });
  await bot.start(); client.emit('ready');
  let finish;
  client.getChats = () => new Promise(resolve => { finish = resolve; });
  const groups = bot.groups();
  await bot.stop();
  finish([{ id: { _serialized: '123@g.us' }, name: 'Grup lama' }]);
  await assert.rejects(groups, /Koneksi berubah/);
});
