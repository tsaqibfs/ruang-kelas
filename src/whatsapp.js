import whatsapp from 'whatsapp-web.js';
import QRCode from 'qrcode';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

function deadline(promise, ms, label, uncertain = false) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error(label); error.uncertain = uncertain; reject(error); }, ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
export class WhatsApp {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.client = null;
    this.status = 'disconnected';
    this.qr = null;
    this.error = '';
    this.desired = false;
    this.starting = false;
    this.reconnectTimer = null;
    this.stopping = false;
  }
  snapshot() { return { status: this.status, qr: this.qr, error: this.error }; }
  isReady() { return this.status === 'ready'; }
  async start() {
    this.desired = true;
    if (this.starting || this.stopping || ['starting', 'qr', 'ready'].includes(this.status)) return;
    this.starting = true;
    clearTimeout(this.reconnectTimer);
    try {
      if (this.client) await this.client.destroy().catch(() => {});
      const paths = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
      const executablePath = paths.find(path => existsSync(path));
      const client = new whatsapp.Client({ authStrategy: new whatsapp.LocalAuth({ dataPath: join(this.dataDir, 'whatsapp') }), puppeteer: { headless: true, ...(executablePath ? { executablePath } : {}) } });
      this.client = client;
      this.status = 'starting'; this.qr = null; this.error = '';
      client.on('qr', async raw => {
        try { const qr = await QRCode.toDataURL(raw, { width: 280, margin: 2 }); if (this.client === client && this.status !== 'ready') { this.qr = qr; this.status = 'qr'; } }
        catch { this.error = 'Gagal membuat QR. Hubungkan ulang.'; }
      });
      client.on('ready', () => { if (this.client === client) { this.status = 'ready'; this.qr = null; this.error = ''; } });
      client.on('auth_failure', () => { this.status = 'error'; this.qr = null; this.error = 'Autentikasi WhatsApp gagal. Hubungkan ulang dan pindai QR baru.'; });
      client.on('disconnected', () => {
        if (this.client !== client) return;
        this.status = 'disconnected'; this.qr = null;
        this.error = 'Koneksi WhatsApp terputus.';
        if (this.desired && !this.stopping) this.reconnectTimer = setTimeout(() => { this.start().catch(() => {}); }, 30000);
      });
      // QR scanning may take time; initialization continues outside the HTTP request.
      client.initialize().catch(async error => {
        if (this.client !== client) return;
        this.status = 'error'; this.qr = null;
        this.error = `Gagal membuka WhatsApp: ${String(error.message).slice(0, 300)}`;
        await client.destroy().catch(() => {});
      });
    } finally { this.starting = false; }
  }
  async groups() {
    if (!this.isReady()) return [];
    const chats = await deadline(this.client.getChats(), 45000, 'Daftar grup belum tersedia. Coba lagi sebentar.');
    return chats.filter(c => c.isGroup).map(c => ({ id: c.id._serialized, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  }
  async send(target, message) {
    if (!this.isReady()) throw new Error('WhatsApp belum terhubung.');
    if (!/^\d+(?:-\d+)?@g\.us$/.test(target)) throw new Error('Pilih grup WhatsApp yang valid.');
    await deadline(this.client.sendMessage(target, message), 60000, 'Hasil pengiriman belum pasti. Periksa grup sebelum mengirim ulang.', true);
    await delay(1500);
  }
  async stop() {
    this.desired = false; this.stopping = true;
    clearTimeout(this.reconnectTimer);
    const client = this.client;
    this.client = null;
    try { if (client) await deadline(client.destroy(), 10000, 'Browser WhatsApp belum tertutup.'); }
    finally { this.status = 'disconnected'; this.qr = null; this.stopping = false; }
  }
}
