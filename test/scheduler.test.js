import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Scheduler } from '../src/scheduler.js';

test('riwayat pengiriman mencegah duplikat termasuk setelah worker dibuat ulang', async () => {
  const store = new Store(':memory:');
  store.updateSettings({ botEnabled: true, groupId: '123456@g.us' });
  let sent = 0;
  const transport = { isReady: () => true, send: async (target, message) => { assert.equal(target, '123456@g.us'); assert.match(message, /Jadwal/); sent++; } };
  try {
    const worker = new Scheduler(store, transport);
    await worker.tick(new Date('2026-10-26T14:00:00Z'));
    await worker.tick(new Date('2026-10-26T14:01:00Z'));
    await new Scheduler(store, transport).tick(new Date('2026-10-26T14:02:00Z'));
    assert.equal(sent, 1);
    assert.equal(store.deliveries()[0].status, 'sent');
  } finally { store.close(); }
});
test('bot offline tidak menghabiskan pengingat dan kegagalan dicoba lagi setelah satu menit', async () => {
  const store = new Store(':memory:');
  store.updateSettings({ botEnabled: true, groupId: '123456@g.us' });
  let ready = false, failures = true;
  const transport = { isReady: () => ready, send: async () => { if (failures) throw new Error('Koneksi gagal'); } };
  try {
    const worker = new Scheduler(store, transport);
    await worker.tick(new Date('2026-10-26T14:00:00Z'));
    assert.equal(store.deliveries().length, 0);
    ready = true;
    await worker.tick(new Date('2026-10-26T14:00:00Z'));
    assert.equal(store.deliveries()[0].status, 'failed');
    await worker.tick(new Date('2026-10-26T14:00:30Z'));
    assert.equal(store.deliveries()[0].attempts, 1);
    failures = false;
    await worker.tick(new Date('2026-10-26T14:01:00Z'));
    assert.equal(store.deliveries()[0].status, 'sent');
    assert.equal(store.deliveries()[0].attempts, 2);
  } finally { store.close(); }
});
test('pengiriman dengan hasil tidak pasti tidak dikirim ulang otomatis', async () => {
  const store = new Store(':memory:');
  store.updateSettings({ botEnabled: true, groupId: '123456@g.us' });
  try {
    const transport = { isReady: () => true, send: async () => { const e = new Error('Timeout'); e.uncertain = true; throw e; } };
    const worker = new Scheduler(store, transport);
    await worker.tick(new Date('2026-10-26T14:00:00Z'));
    await worker.tick(new Date('2026-10-26T14:02:00Z'));
    assert.equal(store.deliveries()[0].status, 'uncertain');
    assert.equal(store.deliveries()[0].attempts, 1);
  } finally { store.close(); }
});
