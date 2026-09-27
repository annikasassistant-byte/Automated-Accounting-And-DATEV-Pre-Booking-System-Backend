import { ApiError } from '../../../utils/ApiError.js';
import { sha256 } from '../../../helpers/accounting/csv.util.js';

/** Accrual import sources (excludes bank/paypal cash). */
export const ACCRUAL_IMPORT_SOURCES = [
  'jtl',
  'marketplace_amazon',
  'marketplace_backmarket',
  'marketplace_refurbed',
] as const;

export function isAccrualImportSource(source: string | null | undefined): boolean {
  if (!source) return false;
  return (
    source === 'jtl' ||
    source.startsWith('marketplace_') ||
    (ACCRUAL_IMPORT_SOURCES as readonly string[]).includes(source)
  );
}

export async function markBatchFailed(
  importBatches: { update: (id: string, d: any) => Promise<any> },
  batchId: string,
  opts: { errorCode?: string; errorMessage?: string } = {},
) {
  const errorCode = opts.errorCode || 'IMPORT_FAILED';
  const errorMessage = opts.errorMessage || 'Import fehlgeschlagen';
  return importBatches.update(batchId, {
    status: 'failed',
    errorCode,
    errorMessage: String(errorMessage).slice(0, 2000),
    failedAt: new Date(),
  });
}

export async function touchHeartbeat(
  importBatches: { update: (id: string, d: any) => Promise<any> },
  batchId: string,
) {
  return importBatches.update(batchId, { lastHeartbeatAt: new Date() });
}

/**
 * Supersede file hash on a failed batch so the same file can be re-uploaded.
 */
export async function supersedeFailedBatchHash(
  importBatches: {
    findById: (id: string) => Promise<any>;
    update: (id: string, d: any) => Promise<any>;
  },
  batchId: string,
) {
  const batch = await importBatches.findById(batchId);
  if (!batch) throw ApiError.notFound('Import-Batch nicht gefunden');
  if (!isAccrualImportSource(batch.source)) {
    throw ApiError.badRequest('Retry nur für Accrual-Importe (JTL/Marktplatz)');
  }
  if (batch.status !== 'failed') {
    throw ApiError.badRequest('Nur fehlgeschlagene Importe können erneut hochgeladen werden');
  }
  const rawHash = String(batch.fileHash || '').split(':superseded:')[0];
  const updated = await importBatches.update(batch._id, {
    fileHash: `${rawHash}:superseded:${batch._id}`,
  });
  return { batch: updated, reuploadRequired: true as const };
}

export function accrualOriginalName(file: { originalname?: string } | string, fallback = '') {
  if (typeof file === 'string') return fallback;
  return file?.originalname || fallback;
}

export function isExcelSpreadsheetName(name: string): boolean {
  const lower = String(name || '').toLowerCase();
  return lower.endsWith('.xlsx') || lower.endsWith('.xls');
}

export function isLegacyXlsName(name: string): boolean {
  return String(name || '').toLowerCase().endsWith('.xls') && !String(name || '').toLowerCase().endsWith('.xlsx');
}

export function accrualFileBuffer(file: { buffer?: Buffer } | string): Buffer | null {
  if (typeof file === 'string') return Buffer.from(file, 'utf8');
  if (file?.buffer) return file.buffer;
  return null;
}

export function accrualFileContent(file: { buffer?: Buffer; originalname?: string } | string) {
  if (typeof file === 'string') return file;
  if (file?.buffer) return file.buffer.toString('utf-8');
  throw ApiError.badRequest('Keine gültige Datei empfangen');
}

export function accrualFileHash(file: { buffer?: Buffer; originalname?: string } | string): string {
  const buf = accrualFileBuffer(file);
  if (buf) return sha256(buf);
  return sha256(accrualFileContent(file));
}

export function accrualFileMeta(file: { originalname?: string } | string, fallback: string) {
  if (typeof file === 'string') return { filename: fallback };
  return { filename: file?.originalname || fallback };
}

export async function handleDuplicateFileHash(
  importBatches: { findByFileHash: (h: string) => Promise<any>; update: (id: string, d: any) => Promise<any> },
  content: string | Buffer,
) {
  const fileHash = typeof content === 'string' ? sha256(content) : sha256(content);
  const existing = await importBatches.findByFileHash(fileHash);
  if (existing && existing.status !== 'failed') {
    return {
      fileHash,
      duplicate: true as const,
      batch: existing,
      message: 'Diese Datei wurde bereits importiert',
    };
  }
  if (existing?.status === 'failed' && existing._id) {
    await importBatches.update(existing._id, {
      fileHash: `${fileHash}:superseded:${existing._id}`,
    });
  }
  return { fileHash, duplicate: false as const, batch: null, message: null };
}

export function marketplaceImportSource(marketplace: string): string {
  return `marketplace_${marketplace}`;
}
