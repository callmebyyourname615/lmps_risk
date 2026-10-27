import { constants as C, closeSync, openSync, fstatSync, fsyncSync, readSync, writeFileSync, lstatSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { FeatureStreamError, validateFeatureStreamPlan, type FeatureStreamState } from '@lmps/contracts/feature-stream';
import { initializeFeatureStream, restoreFeatureStream, applyFeatureStreamDelivery, materializeFeatureStreamSnapshot } from '@lmps/risk';

const MAX = 1048576;
const encode = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
const hash = (s: string): string => createHash('sha256').update(s).digest('hex').match(/.{8}/g)!.join(' ');
function check(v: unknown): asserts v { if (!v) throw new FeatureStreamError(); }
function syncDir(path: string): void { const fd = openSync(path, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
function readPrivate(path: string, max: number): string {
  const fd = openSync(path, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK);
  try {
    const s = fstatSync(fd); check(s.isFile() && s.nlink === 1 && (s.mode & 0o777) === 0o600 && s.uid === process.getuid?.() && s.size <= max);
    const b = Buffer.alloc(max + 1); let n = 0, count = 0;
    while ((count = readSync(fd, b, n, b.length - n, null)) > 0) { n += count; check(n <= max); }
    const text = b.subarray(0, n).toString('utf8'); check(Buffer.from(text).equals(b.subarray(0, n))); return text;
  } finally { closeSync(fd); }
}
function exclusive(path: string, text: string): void {
  const fd = openSync(path, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
}
function safePath(path: string): void {
  check(isAbsolute(path) && !path.split(sep).some(p => p === '..' || p === '.') && path === resolve(path));
  let current = parse(path).root;
  for (const component of path.slice(current.length).split(sep).slice(0, -1)) {
    current = join(current, component); const s = lstatSync(current);
    check(s.isDirectory() && !s.isSymbolicLink() && (s.mode & 0o022) === 0);
  }
}
export type FeatureStreamCommitFault = (point: 'before_publish' | 'after_publish') => void;
/** Synchronous inert US-604 API: open creates a new private directory or restores
 * an owned closed directory; consume ACKs only after durable commit; materialize
 * freezes evidence; receipt returns detached committed hashes/position; close
 * releases this live writer lock and retains evidence. No completion marker.
 * Local cooperating-writer filesystem only: requires exclusive create, atomic
 * rename and fsync. Hostile ancestor replacement is outside this protocol.
 * Crash-stranded locks/initialization/stages BLOCK; no stale-PID takeover or
 * automatic crash-owner cleanup. Failed publication poisons the handle: close,
 * reopen and validated replay recover a published prefix. No HA/SIGKILL proof.
 * fault is a trusted unit seam only, never CLI/config input.
 */
export function openFeatureStreamConsumer(directory: string, config: unknown, fault?: FeatureStreamCommitFault) {
  const plan = validateFeatureStreamPlan(config);
  try { safePath(directory); } catch { throw new FeatureStreamError(); }
  const path = directory, ownerPath = join(path, 'owner.json'), checkpoint = join(path, 'checkpoint.json'), lock = join(path, 'writer.lock');
  const token = randomUUID(); let owner: string, state: FeatureStreamState, committed = '', closed = false, poisoned = false, locked = false;
  const assertDirectory = (): void => { safePath(path); const s = lstatSync(path); check(s.isDirectory() && !s.isSymbolicLink() && (s.mode & 0o777) === 0o700 && s.uid === process.getuid?.()); };
  const serialized = (s: FeatureStreamState): string => {
    const text = encode({ version: 1, owner, plan_hash: hash(encode(plan)), state_hash: hash(encode(s)), next_offset: s.next_offset, state: s });
    check(Buffer.byteLength(text) <= Math.min(MAX, plan.limits.state_bytes)); return text;
  };
  const release = (): void => { assertDirectory(); check(readPrivate(lock, 100) === token); unlinkSync(lock); syncDir(path); locked = false; };
  try {
    let fresh = false;
    try { mkdirSync(path, { mode: 0o700 }); fresh = true; syncDir(dirname(path)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    assertDirectory();
    if (!fresh) {
      // Do not create even a transient lock in an unowned existing directory.
      const names = readdirSync(path).sort();
      check(encode(names) === encode(['checkpoint.json', 'owner.json']));
      const raw = readPrivate(ownerPath, 200), marker = JSON.parse(raw);
      check(typeof marker.owner === 'string' && /^[0-9a-f-]{36}$/.test(marker.owner));
      check(raw === encode({ version: 1, owner: marker.owner }));
      readPrivate(checkpoint, Math.min(MAX, plan.limits.state_bytes));
    }
    exclusive(lock, token); locked = true; syncDir(path);
    if (fresh) {
      owner = randomUUID(); state = initializeFeatureStream(plan); committed = serialized(state);
      exclusive(ownerPath, encode({ version: 1, owner })); exclusive(checkpoint, committed); syncDir(path);
    } else {
      check(encode(readdirSync(path).sort()) === encode(['checkpoint.json', 'owner.json', 'writer.lock']));
      const raw = readPrivate(ownerPath, 200), parsedOwner = JSON.parse(raw);
      check(typeof parsedOwner.owner === 'string' && /^[0-9a-f-]{36}$/.test(parsedOwner.owner)); owner = parsedOwner.owner;
      check(raw === encode({ version: 1, owner }));
      committed = readPrivate(checkpoint, Math.min(MAX, plan.limits.state_bytes));
      const parsed = JSON.parse(committed); state = restoreFeatureStream(parsed.state, plan); check(serialized(state) === committed);
    }
  } catch { if (locked) { try { release(); } catch { /* unresolved ownership remains blocked */ } } throw new FeatureStreamError(); }
  const live = (): void => {
    check(!closed && !poisoned); assertDirectory(); check(readPrivate(lock, 100) === token);
    check(readPrivate(ownerPath, 200) === encode({ version: 1, owner }));
    check(encode(readdirSync(path).sort()) === encode(['checkpoint.json', 'owner.json', 'writer.lock']));
    check(readPrivate(checkpoint, MAX) === committed);
  };
  const commit = (next: FeatureStreamState): void => {
    live(); const text = serialized(next); if (text === committed) return;
    const stage = join(path, `stage-${token}`); let staged = false;
    try {
      exclusive(stage, text); staged = true; fault?.('before_publish');
      renameSync(stage, checkpoint); staged = false; fault?.('after_publish'); syncDir(path);
      state = next; committed = text;
    } catch {
      poisoned = true;
      if (staged) { try { check(readPrivate(stage, MAX) === text); unlinkSync(stage); syncDir(path); } catch { /* retain ambiguous evidence */ } }
      throw new FeatureStreamError();
    }
  };
  const receipt = () => ({ version: 1, production_ready: false as const, next_offset: state.next_offset, snapshots: state.snapshots.length,
    checkpoint_hash: hash(committed), state_hash: hash(encode(state)), plan_hash: hash(encode(plan)) });
  return {
    consume(delivery: unknown) { try { live(); commit(applyFeatureStreamDelivery(state, delivery)); return receipt(); } catch { throw new FeatureStreamError(); } },
    materialize(queryId: string) { try { live(); const result = materializeFeatureStreamSnapshot(state, queryId); commit(result.state); return structuredClone(result.snapshot); } catch { throw new FeatureStreamError(); } },
    receipt() { try { live(); return receipt(); } catch { throw new FeatureStreamError(); } },
    close() { if (closed) return; try { release(); closed = true; } catch { throw new FeatureStreamError(); } },
  };
}
