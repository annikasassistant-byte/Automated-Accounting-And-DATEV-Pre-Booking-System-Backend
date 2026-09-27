import logger from '../config/logger.js';
import { container } from '../di/container.js';
import { isAccrualImportSource, markBatchFailed } from '../services/accounting/accrual/accrualImport.util.js';

const STALE_MINUTES = 20;

/**
 * Mark stuck accrual ImportBatches (processing > 20 min without heartbeat) as failed TIMEOUT.
 */
export async function runImportWatchdog(): Promise<{ failed: number }> {
  const repo = container.importBatchRepository;
  const stale = await repo.findStaleProcessing(STALE_MINUTES);
  let failed = 0;
  for (const batch of stale) {
    if (!isAccrualImportSource(batch.source)) continue;
    try {
      await markBatchFailed(repo, batch._id, {
        errorCode: 'TIMEOUT',
        errorMessage: `Import hing länger als ${STALE_MINUTES} Minuten in processing (Watchdog)`,
      });
      failed += 1;
      logger.warn('Import watchdog marked batch failed', {
        batchId: String(batch._id),
        source: batch.source,
      });
    } catch (err: any) {
      logger.error('Import watchdog failed to mark batch', {
        batchId: String(batch._id),
        message: err?.message,
      });
    }
  }
  return { failed };
}

export default { runImportWatchdog };
