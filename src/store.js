import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const defaults = { className: 'Kelas kita', semester: 'Semester aktif', scheduleTime: '21:00', taskTime: '08:00', kasTime: '19:00', kasWeekday: 5, kasAmount: 10000, scheduleEnabled: true, taskEnabled: true, kasEnabled: true, botEnabled: false, groupId: '' };
const tables = new Set(['courses', 'tasks', 'students', 'transactions']);
function text(value, label, required = false, max = 200) {
  if (value == null) value = '';
  if (typeof value !== 'string') throw new InputError(`${label} harus berupa teks.`);
  value = value.trim();
  if ((required && !value) || value.length > max) throw new InputError(`${label} wajib diisi, maksimal ${max} karakter.`);
  return value;
}
function integer(value, label, min, max) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new InputError(`${label} harus bilangan bulat ${min}–${max}.`);
  return value;
}
function boolean(value, label) {
  if (![true, false, 0, 1].includes(value)) throw new InputError(`${label} tidak valid.`);
  return Boolean(value);
}
function time(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new InputError('Jam harus HH:mm yang valid.');
  return value;
}
function date(value) {
  if (typeof value !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new InputError('Tanggal tidak valid (tahun 2000–2099).');
  return value;
}
function period(value) {
  if (typeof value !== 'string' || !/^20\d\d-(0[1-9]|1[0-2])$/.test(value)) throw new InputError('Periode harus YYYY-MM.');
  return value;
}
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Data tidak valid.');
}
export class Store {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY, name TEXT NOT NULL, lecturer TEXT NOT NULL, pj TEXT NOT NULL, day INTEGER NOT NULL, startTime TEXT NOT NULL, endTime TEXT NOT NULL, room TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, courseId INTEGER REFERENCES courses(id) ON DELETE SET NULL, dueAt TEXT NOT NULL, description TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY, name TEXT NOT NULL, nim TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('income','expense')), amount INTEGER NOT NULL CHECK(amount>0), date TEXT NOT NULL, description TEXT NOT NULL, studentId INTEGER REFERENCES students(id) ON DELETE RESTRICT, period TEXT);
      CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (tokenHash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY, jobKey TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, message TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, nextAttempt INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
    `);
    this.db.prepare('INSERT OR IGNORE INTO settings (id,value) VALUES (1,?)').run(JSON.stringify(defaults));
  }
  close() { this.db.close(); }
  settings() { return { ...defaults, ...JSON.parse(this.db.prepare('SELECT value FROM settings WHERE id=1').get().value) }; }
  updateSettings(input) {
    object(input);
    const next = this.settings();
    for (const [key, value] of Object.entries(input)) {
      if (['className', 'semester'].includes(key)) next[key] = text(value, key === 'className' ? 'Nama kelas' : 'Semester', true, 100);
      else if (['scheduleTime', 'taskTime', 'kasTime'].includes(key)) next[key] = time(value);
      else if (key === 'kasWeekday') next[key] = integer(value, 'Hari kas', 1, 7);
      else if (key === 'kasAmount') next[key] = integer(value, 'Nominal kas', 1, 1000000000);
      else if (['scheduleEnabled', 'taskEnabled', 'kasEnabled', 'botEnabled'].includes(key)) next[key] = boolean(value, key);
      else if (key === 'groupId') {
        if (typeof value !== 'string' || (value !== '' && !/^\d+(?:-\d+)?@g\.us$/.test(value))) throw new InputError('ID grup WhatsApp tidak valid.');
        next[key] = value;
      } else throw new InputError(`Pengaturan ${key} tidak dikenal.`);
    }
    this.db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(next));
    return next;
  }
  list(table) {
    if (!tables.has(table)) throw new InputError('Jenis data tidak dikenal.');
    const order = { courses: 'day, startTime', tasks: 'dueAt', students: 'name COLLATE NOCASE', transactions: 'date DESC, id DESC' }[table];
    return this.db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all().map(row => ({ ...row }));
  }
  data() { return { settings: this.settings(), ...Object.fromEntries([...tables].map(t => [t, this.list(t)])) }; }
  save(table, input, id = null) {
    if (!tables.has(table)) throw new InputError('Jenis data tidak dikenal.');
    object(input);
    if (id != null) {
      integer(id, 'ID', 1, Number.MAX_SAFE_INTEGER);
      if (!this.db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id)) throw new InputError('Data tidak ditemukan.', 404);
    }
    const relation = (value, target) => {
      if (value == null || value === '') return null;
      integer(value, 'Referensi', 1, Number.MAX_SAFE_INTEGER);
      if (!this.db.prepare(`SELECT id FROM ${target} WHERE id=?`).get(value)) throw new InputError('Data referensi tidak ditemukan.');
      return value;
    };
    let record;
    if (table === 'courses') {
      record = { name: text(input.name, 'Matkul', true), lecturer: text(input.lecturer, 'Dosen'), pj: text(input.pj, 'PJ'), day: integer(input.day, 'Hari', 1, 7), startTime: time(input.startTime), endTime: time(input.endTime), room: text(input.room, 'Ruang') };
      if (record.endTime <= record.startTime) throw new InputError('Jam selesai harus setelah jam mulai.');
    } else if (table === 'tasks') {
      if (typeof input.dueAt !== 'string' || input.dueAt.length !== 16 || input.dueAt[10] !== 'T') throw new InputError('Tenggat tugas tidak valid.');
      date(input.dueAt.slice(0, 10)); time(input.dueAt.slice(11));
      record = { title: text(input.title, 'Judul', true), courseId: relation(input.courseId, 'courses'), dueAt: input.dueAt, description: text(input.description, 'Deskripsi', false, 2000), done: Number(boolean(input.done ?? false, 'Status')) };
    } else if (table === 'students') {
      record = { name: text(input.name, 'Nama', true), nim: text(input.nim, 'NIM', true, 50), active: Number(boolean(input.active ?? true, 'Status aktif')) };
    } else {
      if (!['income', 'expense'].includes(input.type)) throw new InputError('Jenis transaksi tidak valid.');
      const studentId = relation(input.studentId, 'students');
      if (studentId && input.type !== 'income') throw new InputError('Pembayaran mahasiswa harus berupa pemasukan.');
      record = { type: input.type, amount: integer(input.amount, 'Nominal', 1, 1000000000), date: date(input.date), description: text(input.description, 'Keterangan', true, 500), studentId, period: studentId ? period(input.period) : null };
    }
    const keys = Object.keys(record);
    try {
      if (id == null) {
        const result = this.db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(record));
        id = Number(result.lastInsertRowid);
      } else this.db.prepare(`UPDATE ${table} SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`).run(...Object.values(record), id);
    } catch (error) {
      if (error.message.includes('UNIQUE')) throw new InputError('NIM tersebut sudah terdaftar.');
      throw error;
    }
    return { ...this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) };
  }
  remove(table, id) {
    if (!tables.has(table)) throw new InputError('Jenis data tidak dikenal.');
    integer(id, 'ID', 1, Number.MAX_SAFE_INTEGER);
    try {
      if (!this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id).changes) throw new InputError('Data tidak ditemukan.', 404);
    } catch (error) {
      if (error.message.includes('FOREIGN KEY')) throw new InputError('Mahasiswa memiliki transaksi. Nonaktifkan mahasiswa untuk menjaga buku kas.');
      throw error;
    }
  }
  deliveries() { return this.db.prepare('SELECT * FROM deliveries ORDER BY id DESC LIMIT 100').all().map(r => ({ ...r })); }
  claim(job, target, now) {
    const stamp = now.toISOString();
    this.db.prepare("INSERT OR IGNORE INTO deliveries (jobKey,kind,message,target,status,createdAt,updatedAt) VALUES (?,?,?,?,'queued',?,?)").run(job.key, job.kind, job.message, target, stamp, stamp);
    const result = this.db.prepare("UPDATE deliveries SET status='sending', attempts=attempts+1, message=?, target=?, updatedAt=? WHERE jobKey=? AND (status='queued' OR (status='failed' AND attempts<3 AND nextAttempt<=?))").run(job.message, target, stamp, job.key, now.getTime());
    return result.changes > 0;
  }
  sent(key, now) { this.db.prepare("UPDATE deliveries SET status='sent', error='', updatedAt=? WHERE jobKey=?").run(now.toISOString(), key); }
  failed(key, error, now) { this.db.prepare("UPDATE deliveries SET status='failed', error=?, nextAttempt=?, updatedAt=? WHERE jobKey=?").run(String(error).slice(0, 500), now.getTime() + 60000, now.toISOString(), key); }
  uncertain(key, error, now) { this.db.prepare("UPDATE deliveries SET status='uncertain', error=?, updatedAt=? WHERE jobKey=?").run(String(error).slice(0, 500), now.toISOString(), key); }
  recover() { this.db.prepare("UPDATE deliveries SET status='uncertain', error='Proses terhenti saat mengirim. Periksa WhatsApp sebelum mengirim ulang.' WHERE status='sending'").run(); }
  prune() { this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()); }
}
