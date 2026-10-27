import { createOfflineDatasets, validateDatasetSnapshot } from '@lmps/database';
import { DATASET_CHUNK_ROWS, datasetMode, OfflineDatasetError } from '@lmps/contracts/offline-dataset';

export async function importOfflineDataset(dsn: string, input: unknown) {
  datasetMode(); const snapshot = validateDatasetSnapshot(input), repo = createOfflineDatasets(dsn);
  try {
    const registered = await repo.register(snapshot.manifest);
    snapshot.manifest.batch_ref = registered.batch_ref;
    let progress = registered;
    while (progress.loaded_rows < snapshot.rows.length) {
      if (progress.status === 'blocked') throw new OfflineDatasetError('DATASET_BLOCKED');
      const next = await repo.append(snapshot.manifest, progress.loaded_rows + 1, snapshot.rows.slice(progress.loaded_rows, progress.loaded_rows + DATASET_CHUNK_ROWS));
      if (next.loaded_rows <= progress.loaded_rows) throw new OfflineDatasetError('DATASET_STORAGE_UNAVAILABLE');
      progress = { ...registered, ...next };
    }
    return { registration: registered.registration, ...await repo.reconcile(snapshot) };
  } finally { await repo.close(); }
}

export async function reconcileOfflineDataset(dsn: string, input: unknown) {
  datasetMode(); const snapshot = validateDatasetSnapshot(input), repo = createOfflineDatasets(dsn);
  try {
    snapshot.manifest = await repo.resolve(snapshot.manifest);
    return await repo.reconcile(snapshot);
  } finally { await repo.close(); }
}
