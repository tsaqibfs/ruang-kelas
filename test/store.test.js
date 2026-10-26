import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';

test('CRUD SQLite memvalidasi tanggal, nominal dan relasi tanpa menyimpan input buruk', () => {
  const store = new Store(':memory:');
  try {
    const course = store.save('courses', { name: 'Algoritma', day: 1, startTime: '08:00', endTime: '10:00', pj: 'Rani' });
    assert.equal(course.name, 'Algoritma');
    assert.throws(() => store.save('courses', { name: 'Salah', day: 9, startTime: '08:00', endTime: '07:00' }));
    assert.throws(() => store.save('tasks', { title: 'Salah', dueAt: '2026-02-30T10:00' }));
    assert.throws(() => store.save('tasks', { title: 'Salah', dueAt: '2026-10-29T10:00', courseId: 999 }));
    const task = store.save('tasks', { title: 'Laporan', dueAt: '2026-10-29T10:00', courseId: course.id });
    store.remove('courses', course.id);
    assert.equal(store.list('tasks')[0].courseId, null);
    assert.equal(store.save('tasks', { ...task, courseId: null, done: true }, task.id).done, 1);
    const student = store.save('students', { name: 'Rani', nim: '2026001', active: true });
    store.save('transactions', { type: 'income', amount: 5000, date: '2026-10-26', description: 'Iuran', studentId: student.id, period: '2026-10' });
    assert.throws(() => store.save('transactions', { type: 'expense', amount: -1, date: '2026-10-26', description: 'Buruk' }));
    assert.throws(() => store.save('transactions', { type: 'income', amount: 1.5, date: '2026-10-26', description: 'Buruk' }));
    assert.throws(() => store.save('transactions', { type: 'expense', amount: 5000, date: '2026-10-26', description: 'Buruk', studentId: student.id }));
    assert.equal(store.list('transactions').length, 1);
    assert.throws(() => store.remove('students', student.id), /nonaktifkan/i);
  } finally { store.close(); }
});
test('settings menolak jam invalid dan membatasi grup WhatsApp', () => {
  const store = new Store(':memory:');
  try {
    assert.equal(store.settings().scheduleTime, '21:00');
    assert.throws(() => store.updateSettings({ taskTime: '25:00' }));
    assert.throws(() => store.updateSettings({ groupId: '123@c.us' }));
    assert.equal(store.updateSettings({ className: 'TI A', kasAmount: 15000 }).className, 'TI A');
  } finally { store.close(); }
});
