import { e, money, days, adminDues } from './ui.js';
import { overview, tasks, schedule, cash, students, botView, botStatus, settings } from './views.js';
import { recordForm, authForm } from './forms.js';

const state = { data: null, admin: null, session: {}, page: 'ringkasan', search: '', filter: 'all', period: '', cashTab: 'ledger', groups: null };
const content = document.querySelector('#content');
const modal = document.querySelector('#modal');
const routeNames = { ringkasan: 'Ringkasan', tugas: 'Tugas', jadwal: 'Jadwal kuliah', kas: 'Kas kelas', mahasiswa: 'Mahasiswa', bot: 'Bot WhatsApp', pengaturan: 'Pengaturan' };
const adminPages = ['mahasiswa', 'bot', 'pengaturan'];
let toastTimer;
function toast(message, error = false) {
  const node = document.querySelector('#toast');
  node.textContent = message; node.hidden = false; node.classList.toggle('error', error);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, 5500);
}
async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(state.session.csrf ? { 'X-CSRF-Token': state.session.csrf } : {}), ...options.headers }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const data = await response.json().catch(() => ({ error: 'Respons server tidak dapat dibaca.' }));
  if (!response.ok) { const error = new Error(data.error || 'Permintaan gagal.'); error.status = response.status; throw error; }
  return data;
}
async function load() {
  const [data, session] = await Promise.all([request('/api/public'), request('/api/session')]);
  const admin = session.authenticated ? await request('/api/admin') : null;
  state.data = data; state.session = session; state.admin = admin;
  if (!state.period) state.period = data.clock.period;
  if (!session.authenticated) { state.groups = null; state.cashTab = 'ledger'; }
  renderShell(); render();
}
function renderShell() {
  document.querySelector('#class-name').textContent = state.data.settings.className;
  document.querySelector('#semester').textContent = state.data.settings.semester;
  document.querySelector('#task-count').textContent = state.data.tasks.filter(t => !t.done).length;
  document.querySelectorAll('.admin-nav').forEach(node => { node.hidden = !state.session.authenticated; });
  document.querySelector('#today-label').textContent = new Date(`${state.data.clock.date}T12:00:00+07:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' });
  document.querySelector('#viewer-label').textContent = state.session.authenticated ? 'Ruang admin' : 'Akses mahasiswa';
  const auth = document.querySelector('#auth-button');
  auth.dataset.action = state.session.authenticated ? 'logout' : 'login';
  auth.innerHTML = `<span class="account-avatar">${e((state.session.username || 'a').slice(0, 1))}</span><span><strong>${e(state.session.authenticated ? state.session.username : state.session.setupRequired ? 'Buat akun admin' : 'Masuk sebagai admin')}</strong><small>${state.session.authenticated ? 'Keluar dari akun ↗' : 'Kelola data kelas'}</small></span>${state.session.authenticated ? '' : '<span aria-hidden="true">↗</span>'}`;
}
function render() {
  if (!state.data) return;
  if (adminPages.includes(state.page) && !state.session.authenticated) {
    content.innerHTML = `<section class="access-state"><h1>Ruang khusus admin</h1><p>Masuk untuk mengelola data kelas.</p><button class="button primary" data-action="login">Masuk admin</button></section>`;
  } else {
    const renderers = { ringkasan: overview, tugas: tasks, jadwal: schedule, kas: cash, mahasiswa: students, bot: botView, pengaturan: settings };
    content.innerHTML = (renderers[state.page] || overview)(state);
    if (state.page === 'bot' && state.groups) populateGroups();
  }
  document.querySelectorAll('[data-nav]').forEach(node => { const active = node.dataset.nav === state.page; node.classList.toggle('active', active); if (active) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); });
  document.querySelector('#breadcrumb-page').textContent = routeNames[state.page] || 'Ringkasan';
  document.title = `${routeNames[state.page] || 'Ringkasan'} · ${state.data.settings.className}`;
}
function route() {
  const name = location.hash.slice(1);
  state.page = Object.hasOwn(routeNames, name) ? name : 'ringkasan';
  state.search = ''; state.filter = 'all';
  document.querySelector('#sidebar').classList.remove('open');
  document.querySelector('#mobile-menu').setAttribute('aria-expanded', 'false');
  render();
}
function openModal(html) {
  document.querySelector('#modal-content').innerHTML = html;
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
  const focus = modal.querySelector('[autofocus]') || modal.querySelector('input,button');
  if (focus) focus.focus();
}
function modalError(error) {
  const node = modal.querySelector('#form-error');
  if (node) { node.textContent = error.message; node.hidden = false; }
  else toast(error.message, true);
}
async function busy(button, action) {
  if (button?.disabled) return;
  const old = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Sebentar…'; }
  try { await action(); }
  catch (error) { if (modal.open) modalError(error); else toast(error.message, true); if (error.status === 401 && state.session.authenticated) await load().catch(() => {}); }
  finally { if (button?.isConnected) { button.disabled = false; button.textContent = old; } }
}
function findItem(entity, id) { return (state.admin?.[entity] || state.data[entity] || []).find(item => item.id === Number(id)); }
function populateGroups() {
  const node = document.querySelector('#group-select');
  if (!node) return;
  const selected = node.value || state.admin.settings.groupId;
  const list = state.groups || [];
  node.innerHTML = `<option value="">Pilih grup kelas</option>${list.map(g => `<option value="${e(g.id)}" ${g.id === selected ? 'selected' : ''}>${e(g.name)}</option>`).join('')}${selected && !list.some(g => g.id === selected) ? `<option selected value="${e(selected)}">Grup tersimpan · ${e(selected)}</option>` : ''}`;
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, entity, id } = button.dataset;
  if (action === 'close') { modal.close(); return; }
  if (action === 'login') { openModal(authForm(state.session.setupRequired)); return; }
  if (action === 'new' || action === 'edit') { openModal(recordForm(state, entity, action === 'edit' ? findItem(entity, id) : {})); return; }
  if (action === 'cash-tab') { state.cashTab = button.dataset.tab; state.filter = 'all'; state.search = ''; render(); return; }
  if (action === 'pay') {
    const student = adminDues(state, state.period).find(s => s.id === Number(id));
    openModal(recordForm(state, 'transactions', { type: 'income', studentId: student.id, amount: student.remaining, period: state.period, description: `Iuran kas ${state.period}` })); return;
  }
  if (action === 'delete') {
    const item = findItem(entity, id);
    const name = item.name || item.title || item.description;
    openModal(`<div class="modal-heading"><h2 id="modal-title">Hapus data ini?</h2><button class="close-button" data-action="close" aria-label="Tutup">×</button></div><p class="modal-intro">${e(name)}</p><p class="helper-text">${entity === 'courses' ? 'Tugas terkait tetap tersimpan tanpa mata kuliah.' : entity === 'transactions' ? 'Saldo kas dan status pembayaran terkait akan dihitung ulang.' : 'Data yang dihapus tidak bisa dikembalikan dari web.'}</p><p class="form-error" id="form-error" role="alert" hidden></p><div class="modal-actions"><button class="button secondary" data-action="close">Batal</button><button class="button danger" data-action="confirm-delete" data-entity="${entity}" data-id="${id}">Ya, hapus</button></div>`); return;
  }
  busy(button, async () => {
    if (action === 'logout') { await request('/api/logout', { method: 'POST', body: {} }); await load(); toast('Kamu sudah keluar dari akun admin.'); }
    else if (action === 'confirm-delete') { await request(`/api/${entity}/${id}`, { method: 'DELETE', body: {} }); modal.close(); await load(); toast('Data berhasil dihapus.'); }
    else if (action === 'toggle-task') { const task = findItem('tasks', id); await request(`/api/tasks/${id}`, { method: 'PUT', body: { ...task, done: !task.done } }); await load(); toast(task.done ? 'Tugas dibuka kembali.' : 'Tugas ditutup. Pengingat dihentikan.'); }
    else if (action === 'refresh') { await load(); toast('Data sudah diperbarui.'); }
    else if (action === 'connect') { const bot = await request('/api/bot/connect', { method: 'POST', body: {} }); state.admin.bot = bot; state.groups = null; render(); toast('Menyiapkan koneksi WhatsApp.'); }
    else if (action === 'disconnect') { state.admin.bot = await request('/api/bot/disconnect', { method: 'POST', body: {} }); await load(); toast('Koneksi dan pengingat otomatis dihentikan. Sesi pasangan tetap tersimpan.'); }
    else if (action === 'groups') { if (state.admin.bot.status !== 'ready') throw new Error('Hubungkan WhatsApp terlebih dahulu.'); state.groups = await request('/api/bot/groups'); populateGroups(); toast(`${state.groups.length} grup tersedia.`); }
    else if (action === 'preview') {
      const preview = await request('/api/bot/preview');
      openModal(`<div class="modal-heading"><div><p class="eyebrow">Sebelum dikirim</p><h2 id="modal-title">Pratinjau jadwal besok</h2></div><button class="close-button" data-action="close" aria-label="Tutup">×</button></div><pre class="message-preview">${e(preview.schedule)}</pre><p class="helper-text">Pesan akan dikirim ke grup yang tersimpan pada pengaturan bot. Pengiriman manual terpisah dari jadwal otomatis.</p>${preview.due.filter(j => j.kind !== 'schedule').length ? `<details><summary>Pengingat tugas / kas yang jatuh tempo</summary>${preview.due.filter(j => j.kind !== 'schedule').map(j => `<pre class="message-preview">${e(j.message)}</pre>`).join('')}</details>` : ''}<p class="form-error" id="form-error" role="alert" hidden></p><div class="modal-actions"><button class="button secondary" data-action="close">Tutup</button><button class="button primary" data-action="announce" ${state.admin.bot.status !== 'ready' || !state.admin.settings.groupId ? 'disabled' : ''}>Kirim jadwal ke grup</button></div>`);
    } else if (action === 'announce') { await request('/api/bot/announce', { method: 'POST', body: {} }); modal.close(); await load(); toast('Pengumuman berhasil dikirim ke grup.'); }
  });
});
document.addEventListener('submit', event => {
  const form = event.target;
  if (!['auth-form', 'record-form', 'settings-form', 'bot-settings-form', 'password-form'].includes(form.id)) return;
  event.preventDefault();
  const error = form.querySelector('#form-error'); if (error) error.hidden = true;
  busy(form.querySelector('[type="submit"]'), async () => {
    const values = Object.fromEntries(new FormData(form));
    if (form.id === 'auth-form') {
      state.session = await request(form.dataset.setup === 'true' ? '/api/setup' : '/api/login', { method: 'POST', body: values });
      modal.close(); await load(); toast('Selamat datang di ruang admin.');
    } else if (form.id === 'record-form') {
      const entity = form.dataset.entity, id = form.dataset.id;
      if (entity === 'tasks') { values.courseId = values.courseId ? Number(values.courseId) : null; values.done = form.elements.done.checked; }
      if (entity === 'courses') values.day = Number(values.day);
      if (entity === 'students') values.active = form.elements.active.checked;
      if (entity === 'transactions') { values.amount = Number(values.amount); values.studentId = values.studentId ? Number(values.studentId) : null; if (!values.studentId) values.period = null; }
      await request(`/api/${entity}${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: values });
      modal.close(); await load(); toast('Data berhasil disimpan.');
    } else if (form.id === 'settings-form') {
      values.kasAmount = Number(values.kasAmount); values.kasWeekday = Number(values.kasWeekday);
      for (const key of ['scheduleEnabled', 'taskEnabled', 'kasEnabled']) values[key] = form.elements[key].checked;
      await request('/api/settings', { method: 'PUT', body: values }); await load(); toast('Pengaturan kelas disimpan.');
    } else if (form.id === 'bot-settings-form') {
      values.botEnabled = form.elements.botEnabled.checked;
      if (values.botEnabled && !values.groupId) throw new Error('Pilih grup sebelum mengaktifkan pengingat otomatis.');
      await request('/api/settings', { method: 'PUT', body: values }); await load(); toast('Tujuan dan pengingat bot disimpan.');
    } else if (form.id === 'password-form') {
      state.session = await request('/api/password', { method: 'POST', body: values }); await load(); toast('Password diperbarui. Sesi lainnya sudah dikeluarkan.');
    }
  });
});
document.addEventListener('change', event => {
  if (event.target.id === 'filter') { state.filter = event.target.value; render(); }
  if (event.target.id === 'period' && /^20\d\d-(0[1-9]|1[0-2])$/.test(event.target.value)) { state.period = event.target.value; render(); }
  if (event.target.name === 'studentId' && event.target.closest('#record-form') && event.target.value) {
    const form = event.target.form; form.elements.type.value = 'income';
    if (!form.elements.description.value) form.elements.description.value = `Iuran kas ${form.elements.period.value}`;
  }
});
document.addEventListener('input', event => {
  if (event.target.id !== 'search') return;
  state.search = event.target.value;
  const selection = event.target.selectionStart;
  render();
  const next = document.querySelector('#search'); next.focus(); next.setSelectionRange(selection, selection);
});
document.querySelector('#mobile-menu').addEventListener('click', () => {
  const open = document.querySelector('#sidebar').classList.toggle('open');
  document.querySelector('#mobile-menu').setAttribute('aria-expanded', String(open));
});
modal.addEventListener('click', event => { if (event.target === modal) { const rect = modal.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) modal.close(); } });
window.addEventListener('hashchange', route);
window.addEventListener('keydown', event => { if (event.key === 'Escape') { document.querySelector('#sidebar').classList.remove('open'); document.querySelector('#mobile-menu').setAttribute('aria-expanded', 'false'); } });
setInterval(async () => {
  if (document.hidden || state.page !== 'bot' || !state.session.authenticated || modal.open) return;
  try { const bot = await request('/api/bot/status'); state.admin.bot = bot; const node = document.querySelector('#bot-status'); if (node) node.innerHTML = botStatus(bot); }
  catch (error) { if (error.status === 401) await load().catch(() => {}); }
}, 5000);
setInterval(() => {
  if (!document.hidden && !modal.open && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName) && !['pengaturan', 'bot'].includes(state.page)) load().catch(() => {});
}, 60000);
route();
load().catch(error => { content.innerHTML = `<section class="access-state"><h1>Belum bisa memuat kelas</h1><p>${e(error.message)}</p><button class="button primary" data-action="refresh">Coba lagi</button></section>`; });
