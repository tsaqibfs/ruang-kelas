import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { Store } from './store.js';
import { WhatsApp } from './whatsapp.js';
import { Scheduler } from './scheduler.js';
import { createApp } from './app.js';
import { randomToken } from './auth.js';

const dataDir = resolve(process.env.DATA_DIR || './data');
mkdirSync(dataDir, { recursive: true });
const store = new Store(join(dataDir, 'kelas.sqlite'));
const tokenPath = join(dataDir, 'setup-token.txt');
let setupToken = '';
if (!store.db.prepare('SELECT id FROM admin WHERE id=1').get()) {
  if (!existsSync(tokenPath)) writeFileSync(tokenPath, randomToken(), { mode: 0o600, flag: 'wx' });
  setupToken = readFileSync(tokenPath, 'utf8').trim();
}
const bot = new WhatsApp(dataDir);
store.recover();
const scheduler = new Scheduler(store, bot);
const app = createApp({ store, bot, setupToken, onSetup: () => { if (existsSync(tokenPath)) unlinkSync(tokenPath); }, secureCookie: process.env.COOKIE_SECURE === 'true', publicUrl: process.env.PUBLIC_URL || '', trustProxy: process.env.TRUST_PROXY === 'loopback' });
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, host, error => {
  if (error) { console.error(`Server gagal: ${error.message}`); process.exitCode = 1; return; }
  console.log(`Ruang kelas siap: http://${host}:${port}`);
  if (setupToken) console.log(`Buat akun admin dari web. Token instalasi tersedia di ${tokenPath}`);
  if (store.settings().botEnabled) bot.start().catch(error => console.error('Bot:', error.message));
});
const interval = setInterval(() => scheduler.tick().catch(error => console.error('Pengingat:', error.message)), 30000);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  server.close();
  await bot.stop().catch(() => {});
  // Let an in-flight scheduler save its result before closing the database.
  const timeout = Date.now() + 65000;
  while (scheduler.busy && Date.now() < timeout) await new Promise(resolve => setTimeout(resolve, 250));
  store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
