export const e = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value || 0);
export const number = value => new Intl.NumberFormat('id-ID').format(value || 0);
export const days = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
export function dateLabel(value, long = false) {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: long ? 'long' : 'short', ...(long ? { year: 'numeric' } : {}), timeZone: 'Asia/Jakarta' }).format(new Date(`${value.slice(0, 10)}T12:00:00+07:00`));
}
export function monthLabel(value) { return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(`${value}-01T12:00:00+07:00`)); }
export function taskStatus(task, today) {
  if (task.done) return { label: 'Ditutup', tone: 'muted', key: 'done' };
  if (new Date(`${task.dueAt}:00+07:00`) < new Date()) return { label: 'Lewat tenggat', tone: 'red', key: 'overdue' };
  const n = Math.round((new Date(`${task.dueAt.slice(0, 10)}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
  return { label: n === 0 ? 'Hari ini' : n === 1 ? 'Besok' : `${n} hari lagi`, tone: n <= 3 ? 'amber' : 'green', key: 'active' };
}
export const badge = (label, tone = 'muted') => `<span class="badge ${e(tone)}">${e(label)}</span>`;
export const empty = (title, description, action = '') => `<div class="empty-state"><span class="empty-mark" aria-hidden="true">—</span><h3>${e(title)}</h3><p>${e(description)}</p>${action}</div>`;
export const addButton = (entity, label) => `<button class="button primary" data-action="new" data-entity="${entity}"><span aria-hidden="true">+</span> ${e(label)}</button>`;
export function actions(entity, item, extra = '') { return `<div class="row-actions">${extra}<button class="button tiny ghost" data-action="edit" data-entity="${entity}" data-id="${item.id}" aria-label="Edit ${e(item.name || item.title || item.description)}">Edit</button><button class="button tiny danger-ghost" data-action="delete" data-entity="${entity}" data-id="${item.id}">Hapus</button></div>`; }
export function pageHeader(title, subtitle, action = '') { return `<section class="page-heading"><div><p class="eyebrow">${e(title === 'Ringkasan kelas' ? 'Satu kelas, satu ruang' : 'Ruang kelas')}</p><h1>${e(title)}</h1><p>${e(subtitle)}</p></div>${action}</section>`; }
export function field(label, name, type = 'text', value = '', extra = '') { return `<label class="field"><span>${e(label)}</span><input name="${name}" type="${type}" value="${e(value)}" ${extra}></label>`; }
export function select(label, name, options, value = '', extra = '') { return `<label class="field"><span>${e(label)}</span><select name="${name}" ${extra}>${options.map(([v, l]) => `<option value="${e(v)}" ${String(value) === String(v) ? 'selected' : ''}>${e(l)}</option>`).join('')}</select></label>`; }
export function check(label, name, value, description = '') { return `<label class="toggle-row"><span><strong>${e(label)}</strong>${description ? `<small>${e(description)}</small>` : ''}</span><input type="checkbox" role="switch" name="${name}" ${value ? 'checked' : ''}></label>`; }
export function adminDues(state, period) {
  return (state.admin?.students || []).filter(s => s.active).map(s => {
    const paid = state.admin.transactions.filter(t => t.type === 'income' && t.studentId === s.id && t.period === period).reduce((a, t) => a + t.amount, 0);
    return { ...s, paid, remaining: Math.max(0, state.admin.settings.kasAmount - paid) };
  });
}
