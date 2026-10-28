import type { DetectionWorkerStatus } from '@lmps/contracts/detection-health';
import { createDetectionHandoff } from '@lmps/database';

export const DETECTION_RUNTIME = Symbol('DETECTION_RUNTIME');
export class DetectionRuntime {
  readonly service: ReturnType<typeof createDetectionHandoff> | null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<void> | null = null;
  private stopped = false;
  private status: DetectionWorkerStatus;
  constructor(dsn?: string, private readonly enabled = false, private readonly interval = 2000) {
    this.service = dsn ? createDetectionHandoff(dsn) : null;
    this.status = { configured: !!dsn, enabled: !!dsn && enabled, state: dsn && enabled ? 'starting' : 'disabled',
      last_completed_at: null, last_enqueued: null, last_processed: null, interval_seconds: interval / 1000 };
  }
  snapshot(): DetectionWorkerStatus { return { ...this.status }; }
  onModuleInit() { if (this.status.enabled) this.schedule(0); }
  private schedule(delay: number) {
    this.timer = setTimeout(() => { void this.tick().finally(() => { if (!this.stopped) this.schedule(this.interval); }); }, delay);
    this.timer.unref();
  }
  async tick() {
    if (this.active) return this.active;
    if (!this.service || this.stopped) return;
    this.active = (async () => {
      let enqueued: number | null = null, processed: number | null = null;
      try { enqueued = await this.service!.handoff(); } catch {}
      try { processed = await this.service!.work(); } catch {}
      const complete = enqueued !== null && processed !== null;
      this.status = { ...this.status, state: complete ? 'running' : 'unavailable',
        last_completed_at: complete ? new Date().toISOString() : this.status.last_completed_at, last_enqueued: enqueued, last_processed: processed };
    })();
    try { await this.active; } finally { this.active = null; }
  }
  async onApplicationShutdown() { this.stopped = true; clearTimeout(this.timer); await this.active; await this.service?.close(); }
}
