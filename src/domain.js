const clockFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const rupiah = amount => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
export function jakartaClock(now = new Date()) {
  const p = Object.fromEntries(clockFormat.formatToParts(now).map(p => [p.type, p.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, time: `${p.hour}:${p.minute}`, weekday: new Date(`${date}T00:00:00Z`).getUTCDay() || 7, period: date.slice(0, 7) };
}
export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function cashSummary(transactions) {
  const income = transactions.filter(t => t.type === 'income').reduce((a, t) => a + t.amount, 0);
  const expense = transactions.filter(t => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
  return { income, expense, balance: income - expense };
}
export function studentDues(students, transactions, period, amount) {
  return students.filter(s => s.active).map(s => {
    const paid = transactions.filter(t => t.type === 'income' && t.studentId === s.id && t.period === period).reduce((a, t) => a + t.amount, 0);
    return { ...s, paid, remaining: Math.max(0, amount - paid) };
  });
}
export function scheduleMessage(data, date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  const courses = data.courses.filter(c => c.day === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const label = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' }).format(new Date(`${date}T12:00:00+07:00`));
  return `*Jadwal kuliah ${data.settings.className}*\n${label}\n\n` + (courses.length ? courses.map(c => `*${c.startTime}–${c.endTime} WIB · ${c.name}*\nRuang: ${c.room || 'Belum ditentukan'}\nPJ: ${c.pj || 'Belum ditentukan'}${c.lecturer ? `\nDosen: ${c.lecturer}` : ''}`).join('\n\n') : 'Tidak ada jadwal kuliah. Selamat beristirahat!');
}
export function buildReminders(data, now = new Date()) {
  const clock = jakartaClock(now);
  const { settings: s } = data;
  const jobs = [];
  if (s.scheduleEnabled && clock.time >= s.scheduleTime) {
    const date = addDays(clock.date, 1);
    jobs.push({ key: `schedule:${date}`, kind: 'schedule', message: scheduleMessage(data, date) });
  }
  if (s.taskEnabled && clock.time >= s.taskTime) {
    for (const task of data.tasks) {
      if (task.done || new Date(`${task.dueAt}:00+07:00`) < now) continue;
      const day = task.dueAt.slice(0, 10);
      const stage = day === clock.date ? 'H' : day === addDays(clock.date, 3) ? 'H-3' : null;
      if (!stage) continue;
      const course = data.courses.find(c => c.id === task.courseId);
      jobs.push({ key: `task:${task.id}:${stage}:${clock.date}`, kind: 'task', message: `*Pengingat tugas ${stage === 'H' ? 'hari ini' : 'H-3'}*\n${task.title}${course ? `\nMatkul: ${course.name}` : ''}\nTenggat: ${day} pukul ${task.dueAt.slice(11)} WIB${task.description ? `\n\n${task.description}` : ''}` });
    }
  }
  if (s.kasEnabled && clock.weekday === s.kasWeekday && clock.time >= s.kasTime) {
    const dues = studentDues(data.students, data.transactions, clock.period, s.kasAmount);
    const unpaid = dues.filter(d => d.remaining > 0);
    if (unpaid.length) jobs.push({ key: `kas:${clock.date}`, kind: 'kas', message: `*Pengingat kas ${s.className}*\nPeriode: ${clock.period}\nIuran: ${rupiah(s.kasAmount)} / mahasiswa\n\nMasih ada ${unpaid.length} mahasiswa yang belum lunas. Bagi yang belum, silakan bayar ke bendahara. Terima kasih!` });
  }
  return jobs;
}
