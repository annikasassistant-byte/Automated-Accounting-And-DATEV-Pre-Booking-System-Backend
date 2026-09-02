import { ApiError } from '../../utils/ApiError.js';
import { sha256 } from '../../helpers/accounting/csv.util.js';

export function accrualFileContent(file: { buffer?: Buffer; originalname?: string } | string) {
  if (typeof file === 'string') return file;
  if (file?.buffer) return file.buffer.toString('utf-8');
  throw ApiError.badRequest('Keine gültige Datei empfangen');
}

export function accrualFileMeta(file: { originalname?: string } | string, fallback: string) {
  if (typeof file === 'string') return { filename: fallback };
  return { filename: file?.originalname || fallback };
}

export async function handleDuplicateFileHash(
  importBatches: { findByFileHash: (h: string) => Promise<any>; update: (id: string, d: any) => Promise<any> },
  content: string,
) {
  const fileHash = sha256(content);
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
