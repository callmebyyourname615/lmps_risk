import { constants } from 'node:fs';
import { lstat, mkdir, open, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export async function privateDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || info.uid !== process.getuid()) throw new Error();
}
async function syncDirectory(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
  try { await file.sync(); } finally { await file.close(); }
}
async function ensureDirectory(path) {
  try { await mkdir(path, { mode: 0o700 }); await syncDirectory(dirname(path)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateDirectory(path);
}
async function readPrivateContent(path, maximum) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) || info.uid !== process.getuid() || info.size > maximum) throw new Error();
    const buffer = Buffer.alloc(maximum + 1); let length = 0;
    while (length < buffer.length) {
      const read = await file.read(buffer, length, buffer.length - length, length);
      if (!read.bytesRead) break; length += read.bytesRead;
    }
    if (length > maximum) throw new Error();
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
  } finally { await file.close(); }
}
export async function readPrivateJson(path, maximum) {
  return JSON.parse(await readPrivateContent(path, maximum));
}
export async function savePrivateReport(base, version, id, filename, report, maximum) {
  if (!/^[a-z-]+\.json$/.test(filename)) throw new Error();
  return savePrivateReportFiles(base, version, id, [{ filename, content: JSON.stringify(report), maximum }]);
}
export async function savePrivateReportFiles(base, version, id, files) {
  if (!isAbsolute(base) || !/^v[1-9]\d*$/.test(version) || !/^[0-9a-f-]{36}$/.test(id)
    || !Array.isArray(files) || !files.length || files.length > 2 || new Set(files.map(f => f.filename)).size !== files.length) throw new Error();
  for (const file of files) {
    if (!/^[a-z-]+\.(json|csv)$/.test(file.filename) || typeof file.content !== 'string'
      || !Number.isSafeInteger(file.maximum) || file.maximum < 1 || Buffer.byteLength(file.content) > file.maximum) throw new Error();
    if (file.filename.endsWith('.json')) JSON.parse(file.content);
  }
  await privateDirectory(dirname(base)); await ensureDirectory(base);
  const versions = join(base, version); await ensureDirectory(versions);
  const directory = join(versions, id); let created = false;
  try { await mkdir(directory, { mode: 0o700 }); created = true; await syncDirectory(versions); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateDirectory(directory);
  if (!created) {
    for (const file of files) {
      const prior = await readPrivateContent(join(directory, file.filename), file.maximum);
      if (file.filename.endsWith('.json') ? !isDeepStrictEqual(JSON.parse(prior), JSON.parse(file.content)) : prior !== file.content) throw new Error();
    }
    await syncDirectory(directory);
    return false;
  }
  // Only the exclusive directory creator publishes; retries never replace an existing or partial report.
  for (const entry of files) {
    const file = await open(join(directory, 'pending-' + entry.filename), 'wx', 0o600);
    try { await file.writeFile(entry.content); await file.sync(); } finally { await file.close(); }
  }
  for (const entry of files) await rename(join(directory, 'pending-' + entry.filename), join(directory, entry.filename));
  await syncDirectory(directory);
  return true;
}
