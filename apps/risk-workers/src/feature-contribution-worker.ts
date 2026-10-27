import { constants as C, openSync, closeSync, fstatSync, fsyncSync, readSync, writeFileSync, lstatSync, mkdirSync, opendirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateFeaturePolicy, featureGroupedHash } from '@lmps/contracts/feature-catalog';
export class FeatureContributionWorkerError extends Error { readonly code = 'FEATURE_WORKER'; constructor() { super('FEATURE_WORKER'); } }
const validateFeatureStoreScope = validateFeaturePolicy;
const featureStoreScopeIdentity = (x: unknown) => featureGroupedHash([x]);
type FeaturePublication = { generation: number; predecessor: {content_hash: string} | null; scope: ReturnType<typeof validateFeaturePolicy>; state: FeatureWindowState; content_hash: string };
const featurePublicationContentHash = (p: FeaturePublication) => featureGroupedHash([{generation:p.generation, predecessor:p.predecessor, scope:p.scope, state:p.state}]);
function validateFeaturePublication(x: unknown): FeaturePublication {
 const p = detachFeatureJSON(x) as FeaturePublication;
 if (Object.keys(p).sort().join(',') !== 'content_hash,generation,predecessor,scope,state' || !Number.isSafeInteger(p.generation) || p.generation < 1) throw new FeatureContributionWorkerError();
 if (p.generation === 1 ? p.predecessor !== null : !p.predecessor || Object.keys(p.predecessor).join() !== "content_hash" || !/^[a-f0-9]{64}$/.test(p.predecessor.content_hash)) throw new FeatureContributionWorkerError();
 validateFeaturePolicy(p.scope); return p;
}
import { detachFeatureJSON } from '@lmps/contracts/feature-catalog';
import { restoreFeatureWindowState, initializeFeatureWindowState, applyFeatureWindowState, advanceFeatureWatermark, snapshotFeatureWindowState, type FeatureWindowState } from '@lmps/risk';

// Public checksum of the reviewed P04 plan, grouped for source readability.
const PLAN = "708101d3 86b0fa4f 7e1e66bd 961f87d3 865c744f 6af7bf7a f46dc449 5a46952a".replaceAll(" ", "");
const MAX = 2097152;
const encode = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
function check(v: unknown): asserts v { if (!v) throw new FeatureContributionWorkerError(); }
function names(path: string): string[] {
  const dir = opendirSync(path, { bufferSize: 4 }), result: string[] = [];
  try { let entry; while ((entry = dir.readSync()) !== null) { check(result.length < 3); result.push(entry.name); } }
  finally { dir.closeSync(); }
  return result.sort();
}
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
export type FeatureSnapshotCommitFault = (point: 'before_publish' | 'after_publish') => void;
/** Import-inert synchronous no-cache local cooperating-writer protocol.
 * open(directory, scope, fault?) creates a private owned store or validates a
 * closed one, binding one exact synthetic policy. Internal publication returns
 * metadata only after file and parent fsync; exact retries never rewrite.
 * read() returns detached validated publication or null; receipt() returns only
 * counts/hashes/position. close() releases only this live lock, including after
 * a fault; repeated successful close is inert. Poisoned operations require
 * close/reopen validation. Stranded locks/stages block without PID takeover.
 * No TTL deletion, distributed linearizability, SIGKILL recovery, live tenancy
 * or HA claim. Requires stable ancestors and cooperating writers. The optional
 * fault callback is trusted unit API only, never environment or CLI input.
 */
function openStore(directory: string, config: unknown, fault?: FeatureSnapshotCommitFault) {
  const scope = validateFeatureStoreScope(config), identity = featureStoreScopeIdentity(scope);
  const path = directory, ownerPath = join(path, 'owner.json'), checkpoint = join(path, 'publication.json'), lock = join(path, 'writer.lock');
  const token = randomUUID(); let owner = '', committed = '', publication: FeaturePublication | null = null;
  let closed = false, poisoned = false, locked = false;
  const assertDirectory = (): void => { safePath(path); const s = lstatSync(path); check(s.isDirectory() && !s.isSymbolicLink() && (s.mode & 0o777) === 0o700 && s.uid === process.getuid?.()); };
  const validate = (input: unknown): FeaturePublication => {
    const p = validateFeaturePublication(input); check(featureStoreScopeIdentity(p.scope) === identity);
    p.state = restoreFeatureWindowState(p.state, scope);
    check(p.content_hash === featurePublicationContentHash(p));
    check(Buffer.byteLength(encode(p)) <= MAX); return p;
  };
  const serialized = (p: FeaturePublication | null): string => {
    const text = encode({ version: 1, plan_sha256: PLAN, owner, scope, publication: p }); check(Buffer.byteLength(text) <= scope.limits.bytes); return text;
  };
  const marker = () => encode({ version: 1, owner });
  const release = (): void => { assertDirectory(); check(readPrivate(lock, 100) === token); unlinkSync(lock); syncDir(path); locked = false; };
  try {
    safePath(path); let fresh = false;
    try { mkdirSync(path, { mode: 0o700 }); fresh = true; syncDir(dirname(path)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    assertDirectory();
    if (!fresh) {
      check(encode(names(path)) === encode(['owner.json', 'publication.json']));
      const raw = readPrivate(ownerPath, 200), parsed = JSON.parse(raw);
      check(typeof parsed.owner === 'string' && /^[0-9a-f-]{36}$/.test(parsed.owner)); owner = parsed.owner; check(raw === marker());
      const text = readPrivate(checkpoint, MAX), envelope = JSON.parse(text);
      publication = envelope.publication === null ? null : validate(envelope.publication);
      check(text === serialized(publication)); committed = text;
    }
    exclusive(lock, token); locked = true; syncDir(path);
    if (fresh) {
      owner = randomUUID(); committed = serialized(null);
      exclusive(ownerPath, marker()); exclusive(checkpoint, committed); syncDir(path);
    }
  } catch { if (locked) { try { release(); } catch { /* retain ambiguous ownership */ } } throw new FeatureContributionWorkerError(); }
  const live = (): void => {
    check(!closed && !poisoned); assertDirectory(); check(readPrivate(lock, 100) === token);
    check(readPrivate(ownerPath, 200) === marker());
    check(encode(names(path)) === encode(['owner.json', 'publication.json', 'writer.lock']));
    check(readPrivate(checkpoint, MAX) === committed);
  };
  const receipt = () => ({ version: 1, plan_sha256: PLAN, production_ready: false as const, generation: publication?.generation ?? 0,
    policy_hash: identity, watermark: publication?.state.contributions.evidence.watermark ?? scope.watermark,
    content_hash: publication?.content_hash ?? null, next_offset: publication?.state.contributions.evidence.next_position ?? 0,
    deliveries: publication?.state.contributions.evidence.deliveries.length ?? 0, snapshots: publication?.state.contributions.evidence.snapshots.length ?? 0,
    publication_hash: createHash('sha256').update(committed).digest('hex').match(/.{8}/g)!.join('-') });
  return {
    publish(input: unknown) {
      try {
        live(); const next = validate(input), text = serialized(next);
        if (publication && next.generation === publication.generation) { check(text === committed); return receipt(); }
        check(next.generation === (publication?.generation ?? 0) + 1);
        if (publication) {
          check(next.predecessor?.content_hash === publication.content_hash);
          check(next.state.contributions.evidence.next_position >= publication.state.contributions.evidence.next_position);
          check(encode(next.state.contributions.evidence.deliveries.slice(0, publication.state.contributions.evidence.deliveries.length)) === encode(publication.state.contributions.evidence.deliveries));
          check(encode(next.state.contributions.evidence.snapshots.slice(0, publication.state.contributions.evidence.snapshots.length)) === encode(publication.state.contributions.evidence.snapshots));
        }
        const stage = join(path, `stage-${token}`); let staged = false;
        try {
          exclusive(stage, text); staged = true; fault?.('before_publish');
          renameSync(stage, checkpoint); staged = false; fault?.('after_publish'); syncDir(path);
          publication = next; committed = text;
        } catch {
          poisoned = true;
          if (staged) { try { check(readPrivate(stage, MAX) === text); unlinkSync(stage); syncDir(path); } catch { /* retain unresolved evidence; reopen blocks */ } }
          throw new FeatureContributionWorkerError();
        }
        return receipt();
      } catch { throw new FeatureContributionWorkerError(); }
    },
    read() { try { live(); return publication === null ? null : validate(publication); } catch { throw new FeatureContributionWorkerError(); } },
    receipt() { try { live(); return receipt(); } catch { throw new FeatureContributionWorkerError(); } },
    close() {
      if (closed) return;
      try {
        assertDirectory();
        check(encode(names(path)) === encode(['owner.json', 'publication.json', 'writer.lock']));
        check(readPrivate(ownerPath, 200) === marker());
        const text = readPrivate(checkpoint, MAX), envelope = JSON.parse(text);
        const actual = envelope.publication === null ? null : validate(envelope.publication);
        check(text === serialized(actual));
        // After rename but before acknowledgment the disk, rather than memory,
        // determines the actual committed generation. Never remove a lock over
        // unresolved staged or malformed evidence.
        release(); closed = true;
      } catch { throw new FeatureContributionWorkerError(); }
    },
  };
}

/** Durable synthetic lifecycle API. Policy binds exact run/namespace/input and semantics.
 * Consume ACK follows atomic checkpoint publication and directory fsync.
 * Rejected admission never advances the cursor. Fault callback is trusted unit-only.
 * After a publication fault close and validated reopen are required.
 */
export function openFeatureContributionWorker(directory: string, config: unknown, fault?: FeatureSnapshotCommitFault) {
 let policy: ReturnType<typeof validateFeaturePolicy>;
 let initial: FeatureWindowState;
 // Validate initialization before acquiring filesystem ownership; tiny byte
 // budgets must not strand a writer lock during deterministic setup failure.
 try { policy = validateFeaturePolicy(config); initial = initializeFeatureWindowState(policy); } catch { throw new FeatureContributionWorkerError(); }
 const store = openStore(directory, policy, fault);
 let current = store.read();
 let state = current?.state ?? initial;
 const publish = (next: FeatureWindowState) => {
   if (encode(next) === encode(state)) return;
   const body = { generation: (current?.generation ?? 0) + 1, predecessor: current ? {content_hash:current.content_hash} : null, scope:policy, state:next };
   const publication = {...body,content_hash:featureGroupedHash([body])};
   store.publish(publication); current = publication; state = next;
 };
 try {
   if (!current) {
     const body = {generation:1, predecessor:null, scope:policy, state};
     current = {...body,content_hash:featureGroupedHash([body])}; store.publish(current);
   }
 } catch (e) { try {store.close();} catch {} throw e; }
 return {
   consume(delivery: unknown) {
     try { store.receipt(); const out = applyFeatureWindowState(state,delivery);
     if(out.status === 'rejected') return {status:out.status,reason:out.reason,receipt:store.receipt()};
     publish(out.state); return {status:out.status,corrections:out.corrections,receipt:store.receipt()};
     } catch { throw new FeatureContributionWorkerError(); }
   },
   watermark(value: unknown) {try {store.receipt(); publish(advanceFeatureWatermark(state,value)); return store.receipt();} catch {throw new FeatureContributionWorkerError();}},
   materialize(query: unknown) {try {store.receipt(); const out=snapshotFeatureWindowState(state,query); publish(out.state); return out.snapshot;} catch {throw new FeatureContributionWorkerError();}},
   receipt: () => store.receipt(),
   close: () => store.close(),
 };
}
