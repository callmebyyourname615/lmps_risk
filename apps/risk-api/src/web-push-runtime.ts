import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  createHash,
  createCipheriv,
  createDecipheriv,
  createECDH,
  ECDH,
  randomBytes,
} from "node:crypto";
import webpush from "web-push";
import type { Database } from "@lmps/database";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  validNotificationPreferences,
} from "./notification-settings.js";
export const WEB_PUSH = Symbol("WEB_PUSH");
export interface PushConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
  storageKey: string;
}
export interface DeviceSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
const decode = (s: string) => Buffer.from(s, "base64url");
export function validDeviceSubscription(
  value: unknown,
): value is DeviceSubscription {
  try {
    const v = value as DeviceSubscription;
    if (
      !v ||
      Object.keys(v).sort().join() !== "endpoint,keys" ||
      typeof v.endpoint !== "string" ||
      v.endpoint.length > 2048 ||
      !v.keys ||
      Object.keys(v.keys).sort().join() !== "auth,p256dh"
    )
      return false;
    const url = new URL(v.endpoint),
      host = url.hostname;
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && url.port !== "443") ||
      (![
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
      ].includes(host) &&
        !host.endsWith(".push.apple.com") &&
        !host.endsWith(".push.services.mozilla.com"))
    )
      return false;
    if (
      !/^[A-Za-z0-9_-]{87}$/.test(v.keys.p256dh) ||
      !/^[A-Za-z0-9_-]{22}$/.test(v.keys.auth)
    )
      return false;
    const key = decode(v.keys.p256dh);
    if (key.length !== 65 || key[0] !== 4 || decode(v.keys.auth).length !== 16)
      return false;
    ECDH.convertKey(key, "prime256v1");
    return true;
  } catch {
    return false;
  }
}
export async function readPushConfig(
  path: string | undefined,
): Promise<PushConfig | null> {
  if (path === undefined) return null;
  let file;
  try {
    if (!isAbsolute(path)) throw Error();
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid?.() ||
      stat.mode & 0o077 ||
      stat.size > 4096
    )
      throw Error();
    const v = JSON.parse(await file.readFile("utf8")) as PushConfig;
    if (
      Object.keys(v).sort().join() !==
        "privateKey,publicKey,storageKey,subject" ||
      typeof v.subject !== "string" ||
      (!/^mailto:[^\s@?]+@[^\s@?]+\.[^\s@?]+$/.test(v.subject) &&
        !/^https:\/\/[^\s]+$/.test(v.subject)) ||
      ![v.privateKey, v.storageKey].every(
        (k) => typeof k === "string" && /^[A-Za-z0-9_-]{43}$/.test(k),
      ) ||
      typeof v.publicKey !== "string" ||
      !/^[A-Za-z0-9_-]{87}$/.test(v.publicKey)
    )
      throw Error();
    const pair = createECDH("prime256v1");
    pair.setPrivateKey(decode(v.privateKey));
    if (!pair.getPublicKey().equals(decode(v.publicKey))) throw Error();
    return v;
  } catch {
    throw new Error("Invalid private Web Push configuration; values withheld.");
  } finally {
    await file?.close();
  }
}
export function endpointHash(value: DeviceSubscription) {
  return createHash("sha256").update(value.endpoint).digest("hex");
}
export function sealSubscription(
  value: DeviceSubscription,
  config: PushConfig,
  binding: string,
) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", decode(config.storageKey), iv);
  cipher.setAAD(Buffer.from(binding));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function openSubscription(
  sealed: string,
  config: PushConfig,
  binding: string,
): DeviceSubscription {
  const data = decode(sealed),
    cipher = createDecipheriv(
      "aes-256-gcm",
      decode(config.storageKey),
      data.subarray(0, 12),
    );
  cipher.setAuthTag(data.subarray(12, 28));
  cipher.setAAD(Buffer.from(binding));
  const value = JSON.parse(
    Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(
      "utf8",
    ),
  );
  if (!validDeviceSubscription(value)) throw Error();
  return value;
}
export function quietDelay(
  settings: typeof DEFAULT_NOTIFICATION_SETTINGS,
  now = new Date(),
) {
  const q = settings.quiet_hours;
  if (!q.enabled) return 0;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: q.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const minutes =
    Number(parts.find((p) => p.type === "hour")?.value) * 60 +
    Number(parts.find((p) => p.type === "minute")?.value);
  const parse = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const start = parse(q.start),
    end = parse(q.end);
  const quiet =
    start === end || start < end
      ? (minutes >= start && minutes < end) || start === end
      : minutes >= start || minutes < end;
  return quiet
    ? Math.min(3600, Math.max(60, ((end - minutes + 1440) % 1440 || 1440) * 60))
    : 0;
}
export class WebPushRuntime {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | null = null;
  private closed = false;
  constructor(
    private database: Database | null,
    readonly config: PushConfig | null,
    private sender: typeof webpush.sendNotification = webpush.sendNotification,
    private worker = true,
  ) {}
  status() {
    return {
      configured: !!this.config,
      reason: this.config ? null : "PUSH_PROVIDER_NOT_CONFIGURED",
    };
  }
  onModuleInit() {
    if (this.worker && this.config && this.database) {
      this.timer = setInterval(() => {
        void this.tick();
      }, 15000);
      this.timer.unref();
      void this.tick();
    }
  }
  async onModuleDestroy() {
    this.closed = true;
    clearInterval(this.timer);
    await this.running;
  }
  tick() {
    if (this.running || !this.config || !this.database || this.closed)
      return this.running ?? Promise.resolve();
    this.running = this.run()
      .catch(() => {})
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
  private async run() {
    const db = this.database!,
      config = this.config!;
    await db.pool.query("SELECT platform.queue_web_push_alerts()");
    const jobs = (
      await db.pool.query("SELECT * FROM platform.claim_web_push_deliveries()")
    ).rows;
    for (const job of jobs) {
      let code = "REJECTED",
        delay = 0;
      try {
        const row = (
          await db.pool.query(
            `SELECT s.encrypted_subscription,s.endpoint_hash,s.active,p.settings,a.severity,a.snapshot->'selected_risk_types' AS patterns FROM platform.local_web_push_subscriptions s LEFT JOIN platform.local_notification_preferences p ON p.workspace_key=s.workspace_key AND p.subject=s.subject LEFT JOIN platform.local_alerts a ON a.workspace_key=s.workspace_key AND a.alert_id=$2 WHERE s.subscription_id=$1 AND s.workspace_key=$3 AND s.subject=$4`,
            [job.subscription_id, job.alert_id, job.workspace_key, job.subject],
          )
        ).rows[0];
        const settings = row?.settings ?? DEFAULT_NOTIFICATION_SETTINGS;
        if (!row?.active) {
          code = "REVOKED";
        } else if (!validNotificationPreferences(settings)) {
          code = "REJECTED";
        } else if (
          !settings.enabled ||
          (job.kind === "alert" &&
            (!settings.severities.includes(row.severity) ||
              !Array.isArray(row.patterns) ||
              !row.patterns.some((p: string) =>
                settings.dimensions.includes(
                  p.startsWith("FRAUD_")
                    ? "fraud"
                    : p.startsWith("MULE_")
                      ? "mule_network"
                      : "aml",
                ),
              )))
        ) {
          code = "FILTERED";
        } else if ((delay = quietDelay(settings)) > 0) {
          code = "DEFERRED";
        } else {
          const device = openSubscription(
            row.encrypted_subscription,
            config,
            JSON.stringify([job.workspace_key, job.subject, row.endpoint_hash]),
          );
          await this.sender(
            device,
            JSON.stringify({ kind: "monitoring_update" }),
            {
              vapidDetails: {
                subject: config.subject,
                publicKey: config.publicKey,
                privateKey: config.privateKey,
              },
              TTL: 60,
              timeout: 5000,
              urgency: "normal",
            },
          );
          code = "ACCEPTED";
        }
      } catch (error) {
        const status = (error as { statusCode?: number })?.statusCode;
        code =
          status === 404 || status === 410
            ? "GONE"
            : status && status >= 400 && status < 500 && status !== 429
              ? "REJECTED"
              : "RETRY";
        delay = Math.min(3600, 30 * 2 ** Math.min(5, job.attempt_count));
      }
      await db.pool.query(
        "SELECT platform.finish_web_push_delivery($1,$2,$3,$4)",
        [job.delivery_id, job.lease_token, code, delay],
      );
    }
  }
}
