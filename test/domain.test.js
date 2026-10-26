import test from 'node:test';
import assert from 'node:assert/strict';
import { jakartaClock, addDays, buildReminders, cashSummary, studentDues } from '../src/domain.js';

const settings = { className: 'TI 2A', scheduleTime: '21:00', taskTime: '08:00', kasTime: '19:00', kasWeekday: 5, kasAmount: 10000, scheduleEnabled: true, taskEnabled: true, kasEnabled: true };
const base = { settings, courses: [], tasks: [], students: [], transactions: [] };

test('tanggal WIB melewati tengah malam meski UTC masih hari sebelumnya', () => {
  assert.deepEqual(jakartaClock(new Date('2026-12-31T17:05:00Z')), { date: '2027-01-01', time: '00:05', weekday: 5, period: '2027-01' });
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
test('pengumuman pukul 21 WIB mengambil jadwal besok dan PJ', () => {
  const data = { ...base, courses: [{ id: 1, name: 'Basis data', day: 2, startTime: '08:00', endTime: '09:40', pj: 'Rani', room: 'B201' }] };
  assert.equal(buildReminders(data, new Date('2026-10-26T13:59:00Z')).length, 0);
  const jobs = buildReminders(data, new Date('2026-10-26T14:00:00Z'));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].key, 'schedule:2026-10-27');
  assert.match(jobs[0].message, /Basis data/);
  assert.match(jobs[0].message, /Rani/);
});
test('tugas H-3 dan hari-H memakai tanggal lokal, mengecualikan selesai dan lewat tenggat', () => {
  const tasks = [
    { id: 1, title: 'Laporan', dueAt: '2026-10-29T23:59', done: 0 },
    { id: 2, title: 'Kuis', dueAt: '2026-10-26T09:00', done: 0 },
    { id: 3, title: 'Sudah ditutup', dueAt: '2026-10-26T09:00', done: 1 },
    { id: 4, title: 'Terlambat', dueAt: '2026-10-26T07:00', done: 0 }
  ];
  const jobs = buildReminders({ ...base, tasks }, new Date('2026-10-26T01:00:00Z'));
  assert.deepEqual(jobs.map(j => j.key).sort(), ['task:1:H-3:2026-10-26', 'task:2:H:2026-10-26']);
  assert.equal(buildReminders({ ...base, tasks }, new Date('2026-10-26T00:59:00Z')).length, 0);
});
test('saldo memakai rupiah bulat dan jumlah belum lunas memperhitungkan pembayaran parsial per bulan', () => {
  const students = [{ id: 1, name: 'Rani', active: 1 }, { id: 2, name: 'Dimas', active: 1 }, { id: 3, name: 'Alumni', active: 0 }];
  const transactions = [
    { type: 'income', amount: 5000, studentId: 1, period: '2026-10' },
    { type: 'income', amount: 10000, studentId: 2, period: '2026-09' },
    { type: 'expense', amount: 2000 }
  ];
  assert.deepEqual(cashSummary(transactions), { income: 15000, expense: 2000, balance: 13000 });
  assert.deepEqual(studentDues(students, transactions, '2026-10', 10000).map(s => [s.id, s.paid, s.remaining]), [[1, 5000, 5000], [2, 0, 10000]]);
});
test('pengingat kas hanya pada hari terpilih, tanpa membocorkan nama penunggak', () => {
  const data = { ...base, students: [{ id: 1, name: 'Nama rahasia', active: 1 }] };
  const jobs = buildReminders(data, new Date('2026-10-30T12:00:00Z'));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].key, 'kas:2026-10-30');
  assert.doesNotMatch(jobs[0].message, /Nama rahasia/);
  assert.equal(buildReminders(data, new Date('2026-10-29T12:00:00Z')).length, 0);
});
