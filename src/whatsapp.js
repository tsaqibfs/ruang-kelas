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
  constructor(dataDir, { createClient = options => new whatsapp.Client(options) } = {}) {
    this.createClient = createClient;
    this.operations = Promise.resolve();
    this.initialization = null;
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
  serialize(operation) {
    const pending = this.operations.then(operation);
    this.operations = pending.catch(() => {});
    return pending;
  }
  start() { return this.serialize(() => this.startClient()); }
  async disposeClient() {
    const client = this.client;
    if (!client) return;
    this.stopping = true;
    try {
      // Wait for the actual browser process to exit before reusing LocalAuth's profile.
      const process = client.pupBrowser?.process?.();
      const exited = process && process.exitCode === null ? new Promise(resolve => process.once('exit', resolve)) : Promise.resolve();
      await deadline(client.destroy(), 15000, 'Browser WhatsApp lama belum tertutup. Coba hubungkan lagi.');
      if (this.initialization) await deadline(this.initialization, 15000, 'Inisialisasi WhatsApp lama belum berhenti. Coba lagi.');
      // initialize() may have still been launching when destroy() was first called.
      if (client.pupBrowser?.isConnected?.()) await deadline(client.destroy(), 15000, 'Browser WhatsApp belum tertutup.');
      await deadline(exited, 15000, 'Proses browser WhatsApp belum berhenti. Coba lagi.');
      this.client = null;
      this.initialization = null;
    } finally { this.stopping = false; }
  }
  async startClient() {
    this.desired = true;
    if (this.starting || this.stopping || ['starting', 'qr', 'ready'].includes(this.status)) return;
    this.starting = true;
    clearTimeout(this.reconnectTimer);
    try {
      await this.disposeClient();
      const paths = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
      const executablePath = paths.find(path => existsSync(path));
      const client = this.createClient({ authStrategy: new whatsapp.LocalAuth({ dataPath: join(this.dataDir, 'whatsapp') }), puppeteer: { headless: true, ...(executablePath ? { executablePath } : {}) } });
      this.client = client;
      this.status = 'starting'; this.qr = null; this.error = '';
      client.on('qr', async raw => {
        try { const qr = await QRCode.toDataURL(raw, { width: 280, margin: 2 }); if (this.client === client && !this.stopping && this.status !== 'ready') { this.qr = qr; this.status = 'qr'; } }
        catch { if (this.client === client && !this.stopping) this.error = 'Gagal membuat QR. Hubungkan ulang.'; }
      });
      client.on('ready', () => { if (this.client === client && !this.stopping) { this.status = 'ready'; this.qr = null; this.error = ''; } });
      client.on('auth_failure', () => { if (this.client !== client || this.stopping) return; this.status = 'error'; this.qr = null; this.error = 'Autentikasi WhatsApp gagal. Hubungkan ulang dan pindai QR baru.'; });
      client.on('disconnected', () => {
        if (this.client !== client || this.stopping) return;
        this.status = 'disconnected'; this.qr = null;
        this.error = 'Koneksi WhatsApp terputus.';
        clearTimeout(this.reconnectTimer);
        if (this.desired) this.reconnectTimer = setTimeout(() => { this.start().catch(() => {}); }, 30000);
      });
      // QR scanning may take time; initialization continues outside the HTTP request.
      this.initialization = Promise.resolve().then(() => client.initialize()).catch(error => {
        if (this.client !== client || this.stopping) return;
        this.status = 'error'; this.qr = null;
        this.error = `Gagal membuka WhatsApp: ${String(error.message).slice(0, 300)}`;
      });
    } catch (error) {
      this.status = 'error'; this.qr = null; this.error = error.message;
      throw error;
    } finally { this.starting = false; }
  }
  async groups() {
    if (!this.isReady() || this.stopping) throw new Error('WhatsApp belum siap. Tunggu sampai terhubung.');
    const client = this.client;
    const chats = await deadline(client.getChats(), 45000, 'Daftar grup belum tersedia. Coba lagi sebentar.');
    if (this.client !== client || !this.isReady() || this.stopping) throw new Error('Koneksi berubah saat memuat grup. Coba lagi.');
    const groups = new Map();
    for (const chat of chats) {
      const id = chat.id?._serialized;
      if (typeof id === 'string' && id.endsWith('@g.us')) groups.set(id, { id, name: chat.name || id });
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  async send(target, message) {
    if (!this.isReady()) throw new Error('WhatsApp belum terhubung.');
    if (!/^\d+(?:-\d+)?@g\.us$/.test(target)) throw new Error('Pilih grup WhatsApp yang valid.');
    await deadline(this.client.sendMessage(target, message), 60000, 'Hasil pengiriman belum pasti. Periksa grup sebelum mengirim ulang.', true);
    await delay(1500);
  }
  stop() {
    return this.serialize(async () => {
      this.desired = false;
      clearTimeout(this.reconnectTimer);
      this.status = 'disconnected'; this.qr = null;
      try { await this.disposeClient(); this.error = ''; }
      catch (error) { this.status = 'error'; this.error = error.message; throw error; }
    });
  }
}
