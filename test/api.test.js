import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { createApp } from '../src/app.js';

test('API melindungi perubahan admin, bootstrap, CSRF dan menyembunyikan data mahasiswa dari publik', async () => {
  const store = new Store(':memory:');
  const bot = { snapshot: () => ({ status: 'disconnected', qr: 'rahasia' }), groups: async () => [], isReady: () => false };
  const app = createApp({ store, bot, setupToken: 'token-lokal-panjang' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (path, method = 'GET', data, headers = {}) => fetch(`${origin}${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
  try {
    assert.equal((await call('/api/session')).status, 200);
    assert.equal((await call('/api/tasks', 'POST', {})).status, 401);
    assert.equal((await call('/api/setup', 'POST', { token: 'salah', username: 'admin', password: 'password-sangat-kuat' })).status, 403);
    const response = await call('/api/setup', 'POST', { token: 'token-lokal-panjang', username: 'admin', password: 'password-sangat-kuat' });
    assert.equal(response.status, 201);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const session = await response.json();
    const headers = { Cookie: cookie, 'X-CSRF-Token': session.csrf };
    assert.equal((await call('/api/setup', 'POST', { token: 'token-lokal-panjang', username: 'other', password: 'password-sangat-kuat' })).status, 409);
    assert.equal((await call('/api/students', 'POST', { name: 'Nama pribadi', nim: 'Rahasia2026' }, { Cookie: cookie })).status, 403);
    assert.equal((await call('/api/students', 'POST', { name: 'Nama pribadi', nim: 'Rahasia2026' }, headers)).status, 201);
    assert.equal((await call('/api/tasks', 'POST', { title: 'Tugas', dueAt: '2026-10-29T23:59' }, headers)).status, 201);
    assert.equal((await call('/api/transactions', 'POST', { type: 'income', amount: -1 }, headers)).status, 400);
    const publicData = await (await call('/api/public')).json();
    assert.equal(publicData.tasks.length, 1);
    assert.equal(publicData.students, undefined);
    assert.equal(publicData.settings.groupId, undefined);
    assert.doesNotMatch(JSON.stringify(publicData), /Rahasia2026|rahasia/);
    assert.equal((await call('/api/admin')).status, 401);
    assert.equal((await call('/api/settings', 'PUT', { className: 'Bajak' }, { ...headers, Origin: 'https://jahat.example' })).status, 403);
    assert.equal((await call('/api/logout', 'POST', {}, headers)).status, 200);
    assert.equal((await call('/api/admin', 'GET', undefined, headers)).status, 401);
    assert.equal((await call('/api/login', 'POST', { username: 'admin', password: 'salah' })).status, 401);
    assert.equal((await call('/api/login', 'POST', { username: 'admin', password: 'password-sangat-kuat' })).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }
});
