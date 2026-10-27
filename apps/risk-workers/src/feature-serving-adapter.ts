import { constants as C, openSync, closeSync, fstatSync, readSync, lstatSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { FeatureServingError, validateFeatureStoreScope, validateFeaturePublication, featurePublicationContentHash, type FeaturePublication } from '@lmps/contracts/feature-serving';
import { validateFeatureStreamDelivery } from '@lmps/contracts/feature-stream';
import { restoreFeatureStream, applyFeatureStreamDelivery, serveFeatureSnapshot } from '@lmps/risk';
import { openFeatureStreamConsumer } from './feature-stream-consumer.js';
import { openFeatureSnapshotStore, type FeatureSnapshotCommitFault } from './feature-snapshot-store.js';

const encode = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
const hash = (s: string): string => createHash('sha256').update(s).digest('hex').match(/.{8}/g)!.join(' ');
function check(v: unknown): asserts v { if (!v) throw new FeatureServingError(); }
function exists(path: string): boolean { try { lstatSync(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
function read(path: string, max: number): string {
  const fd = openSync(path, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK);
  try {
    const s = fstatSync(fd); check(s.isFile() && s.nlink === 1 && s.uid === process.getuid?.() && (s.mode & 0o777) === 0o600 && s.size <= max);
    const b = Buffer.alloc(max + 1); let n = 0, count;
    while ((count = readSync(fd, b, n, b.length - n, null)) > 0) { n += count; check(n <= max); }
    const text = b.subarray(0, n).toString('utf8'); check(Buffer.from(text).equals(b.subarray(0, n))); return text;
  } finally { closeSync(fd); }
}

/** Import-inert synchronous no-cache synthetic API. Open takes disjoint absolute
 * consumer/store paths and exact US-701 scope. Creates a missing pair or restores
 * owned closed evidence; an existing store requires an existing consumer.
 * publish(positionedDeliveries, published_at, expires_at) accepts <=2000 detached
 * deliveries, prevalidates replay/extension, consumes and freezes every configured
 * query, closes/reopens B06, independently validates its bounded checkpoint and
 * receipt, then commits US-702. Identical state/time retries preserve generation.
 * read/receipt return detached store data; serve(request) invokes US-703 with its
 * explicit now/policy. close releases the store lock. Consumer ACK and publication
 * are separate commits: on failure close/reopen and replay to converge; never an
 * atomic cross-store claim. Optional fault is trusted unit API only.
 * Stable ancestors/cooperating writers required. Stranded locks block without
 * takeover. No crash/HA proof, real identity/enforcement or production TTL.
 */
export function openFeatureServingAdapter(consumerDirectory: string, storeDirectory: string, config: unknown, fault?: FeatureSnapshotCommitFault) {
  try {
    const scope = validateFeatureStoreScope(config);
    check(consumerDirectory === resolve(consumerDirectory) && storeDirectory === resolve(storeDirectory));
    check(consumerDirectory !== storeDirectory && !consumerDirectory.startsWith(storeDirectory + sep) && !storeDirectory.startsWith(consumerDirectory + sep));
    check(!exists(storeDirectory) || exists(consumerDirectory));
    const evidence = (consumer: ReturnType<typeof openFeatureStreamConsumer>) => {
      const receipt = consumer.receipt();
      const markerText = read(join(consumerDirectory, 'owner.json'), 200), marker = JSON.parse(markerText);
      check(typeof marker.owner === 'string' && /^[0-9a-f-]{36}$/.test(marker.owner));
      check(markerText === encode({ version: 1, owner: marker.owner }));
      const text = read(join(consumerDirectory, 'checkpoint.json'), Math.min(1048576, scope.plan.limits.state_bytes));
      const raw = JSON.parse(text), state = restoreFeatureStream(raw.state, scope.plan);
      const expected = { version: 1, owner: marker.owner, plan_hash: hash(encode(scope.plan)), state_hash: hash(encode(state)), next_offset: state.next_offset, state };
      check(text === encode(expected));
      check(encode(receipt) === encode({ version: 1, production_ready: false, next_offset: state.next_offset, snapshots: state.snapshots.length,
        checkpoint_hash: hash(text), state_hash: expected.state_hash, plan_hash: expected.plan_hash }));
      return state;
    };
    const initial = openFeatureStreamConsumer(consumerDirectory, scope.plan);
    try { evidence(initial); } finally { initial.close(); }
    const store = openFeatureSnapshotStore(storeDirectory, scope, fault);
    let closed = false;
    return {
      publish(input: readonly unknown[], published_at: string, expires_at: string) {
        try {
          check(!closed && Array.isArray(input) && input.length <= 2000);
          check(Object.getPrototypeOf(input) === Array.prototype && Reflect.ownKeys(input).length === input.length + 1);
          const deliveries = Array.from({ length: input.length }, (_, i) => {
            const d = Object.getOwnPropertyDescriptor(input, String(i)); check(d && d.enumerable && 'value' in d);
            return validateFeatureStreamDelivery(d.value, scope.plan);
          });
          check(exists(consumerDirectory));
          const consumer = openFeatureStreamConsumer(consumerDirectory, scope.plan);
          try {
            let preview = evidence(consumer);
            for (const d of deliveries) preview = applyFeatureStreamDelivery(preview, d);
            validateFeaturePublication({ version: scope.version, scope, generation: 1, predecessor: null, state: preview,
              published_at, expires_at, content_hash: Array(8).fill('00000000').join('-') });
            for (const q of scope.plan.queries) check(Date.parse(published_at) >= Date.parse(q.as_of));
            for (const d of deliveries) consumer.consume(d);
            for (const q of scope.plan.queries) consumer.materialize(q.id);
            evidence(consumer);
          } finally { consumer.close(); }
          const reopened = openFeatureStreamConsumer(consumerDirectory, scope.plan);
          try {
            // Keep the reopened consumer locked through the separate store commit.
            const state = evidence(reopened);
            const previous = store.read();
            if (previous && encode(previous.state) === encode(state) && previous.published_at === published_at && previous.expires_at === expires_at) return store.publish(previous);
            const publication: FeaturePublication = { version: scope.version, scope, generation: (previous?.generation ?? 0) + 1,
              predecessor: previous ? { generation: previous.generation, content_hash: previous.content_hash } : null,
              state, published_at, expires_at, content_hash: Array(8).fill('00000000').join('-') };
            publication.content_hash = featurePublicationContentHash(publication);
            return store.publish(publication);
          } finally { reopened.close(); }
        } catch { throw new FeatureServingError(); }
      },
      read() { return store.read(); },
      receipt() { return store.receipt(); },
      serve(request: unknown) { return serveFeatureSnapshot(store.read(), scope, request); },
      close() { store.close(); closed = true; },
    };
  } catch { throw new FeatureServingError(); }
}

/** Rebuild retained consumer evidence into a NEW absent destination, never an
 * existing directory or active-store pointer. Requires all queries frozen.
 * Returns generation-1 metadata; reopen adapter to read/serve. State/source
 * positions match; owner/envelope hashes need not. Explicit UTC fixture times.
 */
export function rebuildFeatureServingStore(consumerDirectory: string, newStoreDirectory: string, config: unknown, published_at: string, expires_at: string) {
  try {
    check(exists(consumerDirectory) && !exists(newStoreDirectory));
    const scope = validateFeatureStoreScope(config);
    const c = openFeatureStreamConsumer(consumerDirectory, scope.plan);
    try { check(c.receipt().snapshots === scope.plan.queries.length); } finally { c.close(); }
    const adapter = openFeatureServingAdapter(consumerDirectory, newStoreDirectory, scope);
    try { return adapter.publish([], published_at, expires_at); } finally { adapter.close(); }
  } catch { throw new FeatureServingError(); }
}
