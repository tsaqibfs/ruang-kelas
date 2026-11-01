import whatsapp from 'whatsapp-web.js';
import { rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// WhatsApp Web emits LOGOUT before Chromium releases its profile. The library's
// navigation callback awaits logout() without catching filesystem errors.
// Defer that filesystem operation to our serialized, caught shutdown path.
export class DeferredLocalAuth extends whatsapp.LocalAuth {
  async logout() { this.logoutRequested = true; }
  async cleanupAfterClose() {
    if (!this.logoutRequested || !this.userDataDir) return;
    const expected = resolve(join(this.dataPath, this.clientId ? `session-${this.clientId}` : 'session'));
    if (resolve(this.userDataDir) !== expected) throw new Error('Lokasi sesi WhatsApp tidak cocok. Penghapusan dibatalkan.');
    await rm(expected, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    this.logoutRequested = false;
  }
}
