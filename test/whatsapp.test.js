import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WhatsApp } from '../src/whatsapp.js';
import vm from 'node:vm';
class Client extends EventEmitter {
  async initialize() {}
  async destroy() { this.emit('auth_failure'); this.emit('disconnected'); }
  async getChats() { return [{ id: { _serialized: '123@g.us' }, name: 'Kelas A' }]; }
}
test('grup tetap dimuat saat serializer getChats gagal pada chat lain', async () => {
  const client = new Client();
  client.getChats = async () => { throw new Error('r'); };
  client.pupPage = { evaluate: async fn => vm.runInNewContext(`(${fn.toString()})()`, {
    window: { require: name => {
      assert.equal(name, 'WAWebCollections');
      return { Chat: { getModelsArray: () => [
        { id: { _serialized: '123@g.us' }, name: 'Kelas A' },
        { id: { _serialized: '123@c.us' }, name: 'Pribadi' }
      ] } };
    } }
  }) };
  const bot = new WhatsApp('.', { createClient: () => client });
  await bot.start(); client.emit('ready');
  assert.deepEqual(await bot.groups(), [{ id: '123@g.us', name: 'Kelas A' }]);
  await bot.stop();
});
test('kegagalan memuat grup menjelaskan operasi dan menyimpan penyebab asli', async () => {
  const client = new Client();
  const original = new Error('r');
  client.getChats = async () => { throw original; };
  const bot = new WhatsApp('.', { createClient: () => client });
  await bot.start(); client.emit('ready');
  await assert.rejects(bot.groups(), error => error.status === 503 && /grup/i.test(error.message) && error.cause === original);
  await bot.stop();
});
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
test('cleanup logout berjalan setelah browser tutup dan EBUSY bisa dicoba kembali', async () => {
  const order = [], clients = [];
  let strategy, locked = true;
  const bot = new WhatsApp('.', { createClient: options => {
    strategy = options.authStrategy;
    strategy.cleanupAfterClose = async () => {
      order.push('cleanup');
      if (locked) { const error = new Error('EBUSY lockfile'); error.code = 'EBUSY'; throw error; }
    };
    const client = new Client();
    client.destroy = async () => { order.push('close'); };
    clients.push(client); return client;
  } });
  await bot.start(); clients[0].emit('ready');
  await strategy.logout();
  await assert.rejects(bot.stop(), /EBUSY/);
  assert.deepEqual(order, ['close', 'cleanup']);
  assert.equal(bot.snapshot().status, 'error');
  locked = false;
  await bot.start();
  assert.equal(clients.length, 2);
  await bot.stop();
});
