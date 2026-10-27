import { constants } from 'node:fs';
import { lstat, mkdir, open, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { MAX_SNAPSHOT_BYTES, UUID, validateSnapshot } from '../dist/snapshot.js';

async function privateDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || info.uid !== process.getuid()) throw new Error('Unsafe snapshot directory.');
}
async function checkBase(base) {
  if (!isAbsolute(base)) throw new Error('Absolute private spool path required.');
  await privateDirectory(dirname(base));
  await privateDirectory(base);
}
async function syncDirectory(path) {
  const directory = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function saveSnapshot(base, input) {
  const snapshot = validateSnapshot(input);
  await privateDirectory(dirname(base));
  await mkdir(base, { recursive: true, mode: 0o700 });
  await checkBase(base);
  await syncDirectory(dirname(base));
  const directory = join(base, snapshot.capture_id);
  await mkdir(directory, { mode: 0o700 }); // Exclusive capture publication; never replace an earlier snapshot.
  await syncDirectory(base);
  const pending = join(directory, 'pending.json');
  const file = await open(pending, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(snapshot)); await file.sync(); }
  finally { await file.close(); }
  await rename(pending, join(directory, 'snapshot.json'));
  await syncDirectory(directory);
  return snapshot.capture_id;
}

export async function readSnapshot(base, id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('Invalid local capture ID.');
  await checkBase(base);
  const directory = join(base, id);
  await privateDirectory(directory);
  const file = await open(join(directory, 'snapshot.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) || info.uid !== process.getuid() || info.size > MAX_SNAPSHOT_BYTES) throw new Error('Unsafe snapshot file.');
    const buffer = Buffer.alloc(MAX_SNAPSHOT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await file.read(buffer, length, buffer.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot too large.');
    const snapshot = validateSnapshot(JSON.parse(buffer.subarray(0, length).toString('utf8')));
    if (snapshot.capture_id !== id) throw new Error('Capture ID mismatch.');
    return snapshot;
  } finally { await file.close(); }
}
