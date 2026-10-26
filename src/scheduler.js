import { buildReminders } from './domain.js';
export class Scheduler {
  constructor(store, transport) { this.store = store; this.transport = transport; this.busy = false; }
  async deliver(job, target, now = new Date()) {
    if (!this.store.claim(job, target, now)) return false;
    try {
      await this.transport.send(target, job.message);
      this.store.sent(job.key, new Date(Math.max(now.getTime(), Date.now())));
      return true;
    } catch (error) {
      if (error.uncertain) this.store.uncertain(job.key, error.message, now);
      else this.store.failed(job.key, error.message, now);
      return false;
    }
  }
  async tick(now = new Date()) {
    if (this.busy || !this.transport.isReady()) return;
    const data = this.store.data();
    if (!data.settings.botEnabled || !data.settings.groupId) return;
    this.busy = true;
    try {
      for (const job of buildReminders(data, now)) {
        if (!this.transport.isReady()) break;
        await this.deliver(job, data.settings.groupId, now);
      }
      this.store.prune();
    } finally { this.busy = false; }
  }
}
