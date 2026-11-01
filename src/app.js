import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { InputError } from './store.js';
import { equal, digest, randomToken, hashPassword, verifyPassword } from './auth.js';
import { cashSummary, studentDues, jakartaClock, addDays, scheduleMessage, buildReminders } from './domain.js';
import { Scheduler } from './scheduler.js';

export function createApp({ store, bot, setupToken = '', onSetup = () => {}, secureCookie = false, publicUrl = '', trustProxy = false, logError = (...args) => console.error(...args) }) {
  const app = express();
  const db = store.db;
  const worker = new Scheduler(store, bot);
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 'loopback');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': null, 'img-src': ["'self'", 'data:'], 'script-src': ["'self'"], 'style-src': ["'self'"], 'frame-ancestors': ["'none'"] } }, strictTransportSecurity: secureCookie ? undefined : false }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      let matches = false;
      try {
        const origin = new URL(req.get('origin'));
        matches = publicUrl ? origin.origin === new URL(publicUrl).origin : origin.host === req.get('host') && ['http:', 'https:'].includes(origin.protocol);
      } catch { /* Missing or malformed origin is denied. */ }
      if (!matches || req.get('sec-fetch-site') === 'cross-site') return next(new InputError('Permintaan lintas situs ditolak.', 403));
      if (!req.is('application/json')) return next(new InputError('Gunakan JSON.', 415));
    }
    next();
  });
  app.use(express.json({ limit: '32kb', strict: true }));
  const adminRow = () => db.prepare('SELECT * FROM admin WHERE id=1').get();
  app.use('/api', (req, res, next) => {
    const token = req.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('kelas_session='))?.slice(14);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const session = db.prepare('SELECT * FROM sessions WHERE tokenHash=? AND expires>?').get(digest(token), Date.now());
      if (session) req.session = session;
    }
    next();
  });
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: secureCookie, path: '/' };
  function issueSession(res) {
    store.prune();
    const token = randomToken(), csrf = randomToken();
    db.prepare('INSERT INTO sessions (tokenHash,csrf,expires) VALUES (?,?,?)').run(digest(token), csrf, Date.now() + 12 * 3600000);
    res.cookie('kelas_session', token, { ...cookieOptions, maxAge: 12 * 3600000 });
    return { authenticated: true, username: adminRow().username, csrf, setupRequired: false };
  }
  function requireAdmin(req, res, next) {
    if (!req.session) return next(new InputError('Silakan login sebagai admin.', 401));
    if (!['GET', 'HEAD'].includes(req.method) && !equal(req.get('x-csrf-token'), req.session.csrf)) return next(new InputError('Sesi form tidak valid. Muat ulang halaman.', 403));
    next();
  }
  const attempts = new Map();
  const cleanupAttempts = () => { const now = Date.now(); for (const [key, value] of attempts) if (value.until < now) attempts.delete(key); };
  function limitAuth(req, res, next) {
    cleanupAttempts();
    const key = req.ip;
    const bucket = attempts.get(key) || { count: 0, until: Date.now() + 15 * 60000 };
    bucket.count++; attempts.set(key, bucket);
    if (bucket.count > 10) { res.set('Retry-After', String(Math.ceil((bucket.until - Date.now()) / 1000))); return next(new InputError('Terlalu banyak percobaan. Tunggu 15 menit.', 429)); }
    next();
  }
  app.get('/api/session', (req, res) => res.json({ authenticated: !!req.session, setupRequired: !adminRow(), ...(req.session ? { username: adminRow().username, csrf: req.session.csrf } : {}) }));
  app.post('/api/setup', limitAuth, async (req, res) => {
    if (adminRow()) throw new InputError('Admin sudah dibuat. Silakan login.', 409);
    if (!setupToken || !equal(req.body?.token, setupToken)) throw new InputError('Token instalasi tidak cocok. Baca data/setup-token.txt pada server.', 403);
    const { username, password } = req.body;
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) throw new InputError('Username 3–40 karakter, gunakan huruf, angka, titik, garis bawah atau strip.');
    const hash = await hashPassword(password);
    if (adminRow()) throw new InputError('Admin sudah dibuat.', 409);
    db.prepare('INSERT INTO admin (id,username,hash) VALUES (1,?,?)').run(username, hash);
    setupToken = '';
    onSetup();
    res.status(201).json(issueSession(res));
  });
  app.post('/api/login', limitAuth, async (req, res) => {
    const admin = adminRow();
    if (!admin || typeof req.body?.username !== 'string' || !await verifyPassword(req.body?.password, admin.hash) || !equal(req.body.username, admin.username)) throw new InputError('Username atau password salah.', 401);
    attempts.delete(req.ip);
    if (req.session) db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(req.session.tokenHash);
    res.json(issueSession(res));
  });
  app.post('/api/logout', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(req.session.tokenHash);
    res.clearCookie('kelas_session', cookieOptions).json({ ok: true });
  });
  app.post('/api/password', requireAdmin, async (req, res) => {
    if (!await verifyPassword(req.body?.currentPassword, adminRow().hash)) throw new InputError('Password saat ini salah.', 401);
    const hash = await hashPassword(req.body?.password);
    db.prepare('UPDATE admin SET hash=? WHERE id=1').run(hash);
    db.prepare('DELETE FROM sessions').run();
    res.json(issueSession(res));
  });
  app.get('/api/public', (req, res) => {
    const data = store.data();
    res.json({ settings: { className: data.settings.className, semester: data.settings.semester }, courses: data.courses, tasks: data.tasks, transactions: data.transactions.map(t => ({ id: t.id, type: t.type, amount: t.amount, date: t.date, description: t.studentId ? `Iuran kas ${t.period}` : t.description })), totals: cashSummary(data.transactions), clock: jakartaClock() });
  });
  app.get('/api/admin', requireAdmin, (req, res) => {
    const data = store.data();
    res.json({ ...data, dues: studentDues(data.students, data.transactions, jakartaClock().period, data.settings.kasAmount), deliveries: store.deliveries(), bot: bot.snapshot() });
  });
  app.put('/api/settings', requireAdmin, (req, res) => res.json(store.updateSettings(req.body)));
  app.get('/api/bot/status', requireAdmin, (req, res) => res.json(bot.snapshot()));
  app.get('/api/bot/groups', requireAdmin, async (req, res) => res.json(await bot.groups()));
  app.post('/api/bot/connect', requireAdmin, async (req, res) => { await bot.start(); res.status(202).json(bot.snapshot()); });
  app.post('/api/bot/disconnect', requireAdmin, async (req, res) => { store.updateSettings({ botEnabled: false }); await bot.stop(); res.json(bot.snapshot()); });
  app.get('/api/bot/preview', requireAdmin, (req, res) => {
    const data = store.data();
    res.json({ schedule: scheduleMessage(data, addDays(jakartaClock().date, 1)), due: buildReminders(data).map(j => ({ kind: j.kind, message: j.message })) });
  });
  app.post('/api/bot/announce', requireAdmin, async (req, res) => {
    const data = store.data();
    if (!bot.isReady() || !data.settings.groupId) throw new InputError('Hubungkan WhatsApp dan pilih grup dahulu.');
    const key = `manual:${randomUUID()}`;
    const sent = await worker.deliver({ key, kind: 'manual', message: scheduleMessage(data, addDays(jakartaClock().date, 1)) }, data.settings.groupId);
    if (!sent) throw new InputError('Pengiriman gagal atau belum pasti. Periksa riwayat bot.', 502);
    res.json({ ok: true });
  });
  app.get('/api/transactions.csv', requireAdmin, (req, res) => {
    const csvCell = value => { let s = String(value ?? ''); if (typeof value === 'string' && /^[=+@\-\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; };
    const students = store.list('students');
    const rows = [['Tanggal', 'Jenis', 'Keterangan', 'Nominal', 'Mahasiswa', 'Periode'], ...store.list('transactions').map(t => [t.date, t.type === 'income' ? 'Pemasukan' : 'Pengeluaran', t.description, t.amount, students.find(s => s.id === t.studentId)?.name || '', t.period || ''])];
    res.attachment(`buku-kas-${jakartaClock().date}.csv`).type('text/csv; charset=utf-8').send('\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'));
  });
  for (const entity of ['courses', 'tasks', 'students', 'transactions']) {
    app.post(`/api/${entity}`, requireAdmin, (req, res) => res.status(201).json(store.save(entity, req.body)));
    app.put(`/api/${entity}/:id`, requireAdmin, (req, res) => res.json(store.save(entity, req.body, Number(req.params.id))));
    app.delete(`/api/${entity}/:id`, requireAdmin, (req, res) => { store.remove(entity, Number(req.params.id)); res.json({ ok: true }); });
  }
  app.use('/api', (req, res, next) => next(new InputError('Endpoint tidak ditemukan.', 404)));
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url)), { index: 'index.html', maxAge: 0 }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof InputError ? error.status : error.type === 'entity.parse.failed' ? 400 : error.status === 413 ? 413 : 500;
    if (status >= 500) logError(`Kesalahan aplikasi: ${req.method} ${req.path}`, error.stack || String(error), ...(error.cause ? ['Penyebab:', error.cause.stack || String(error.cause)] : []), ...(error.fallbackCause ? ['Jalur cadangan:', error.fallbackCause.stack || String(error.fallbackCause)] : []));
    res.status(status).json({ error: status === 500 ? 'Terjadi kesalahan server. Periksa log di RDP.' : status === 413 ? 'Data terlalu besar.' : status === 400 && error.type === 'entity.parse.failed' ? 'JSON tidak valid.' : error.message });
  });
  return app;
}
