import { loadState } from '../../../../packages/database/scripts/local.mjs';
import { readPrivateJson } from '../../scripts/private-json.mjs';
import { runAutomatedIntakeBatch } from '../../../../tools/automated-intake.mjs';

try {
  const state = await loadState(process.argv[2]), input = await readPrivateJson(process.argv[3], 16384);
  await runAutomatedIntakeBatch(state, input, async stage => {
    if (stage === 'published') {
      process.send({ stage });
      await new Promise(() => {});
    }
  });
} catch { process.stderr.write('AUTOMATED_FIXTURE_FAILED\n'); process.exitCode = 1; }
