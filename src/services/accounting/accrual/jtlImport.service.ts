import { ApiError } from '../../../utils/ApiError.js';
import { parseJtlCsv, parseJtlXlsx } from '../../../helpers/accounting/accrual/jtl-parser.js';
import { normalizeMarketplaceOrderId } from '../../../helpers/accounting/accrual/matching.util.js';
import { buildJtlRecordKey } from '../../../helpers/accounting/accrual/duplicate-guard.js';
import {
  accrualFileBuffer,
  accrualFileContent,
  accrualFileMeta,
  handleDuplicateFileHash,
  isExcelSpreadsheetName,
  isLegacyXlsName,
} from './accrualImport.util.js';

function taxKeyFromRaw(rawRow: Record<string, string> | null | undefined): string {
  if (!rawRow) return '';
  for (const [k, v] of Object.entries(rawRow)) {
    const key = k.toLowerCase().replace(/[^a-z]/g, '');
    if (key.includes('steuerschl') || key === 'taxkey') return String(v || '').trim();
  }
  return '';
}

function recordRank(recordType: string): number {
  if (recordType === 'order') return 0;
  if (recordType === 'invoice' || recordType === 'sale') return 1;
  return 2;
}

export class JtlImportService {
  constructor(deps: {
    importBatchRepository: any;
    jtlRecordRepository: any;
    matchingService: any;
    auditRepository?: any;
  }) {
    this.importBatches = deps.importBatchRepository;
    this.jtlRecords = deps.jtlRecordRepository;
    this.matching = deps.matchingService;
    this.audit = deps.auditRepository;
  }

  importBatches;
  jtlRecords;
  matching;
  audit;

  async importJtl(file: any, userId: string, ctx = {}) {
    const { filename } = accrualFileMeta(file, 'jtl-import.csv');
    if (isLegacyXlsName(filename)) {
      throw ApiError.badRequest('Altes .xls wird nicht unterstützt. Bitte .xlsx oder CSV/TXT verwenden.');
    }

    const buf = accrualFileBuffer(file);
    const hashSource = buf || accrualFileContent(file);
    const dup = await handleDuplicateFileHash(this.importBatches, hashSource);
    if (dup.duplicate) {
      return { batch: dup.batch, status: 'duplicate_file', message: dup.message };
    }

    let parseResult;
    if (isExcelSpreadsheetName(filename)) {
      if (!buf) throw ApiError.badRequest('JTL-Excel ohne Dateiinhalt');
      parseResult = await parseJtlXlsx(buf);
      if (!parseResult.rows.length) {
        const msg = parseResult.errors[0]?.message || 'JTL-Excel konnte nicht gelesen werden';
        throw ApiError.badRequest(msg);
      }
    } else {
      parseResult = parseJtlCsv(typeof hashSource === 'string' ? hashSource : hashSource.toString('utf8'));
    }

    const batch = await this.importBatches.create({
      source: 'jtl',
      filename,
      fileHash: dup.fileHash,
      uploadedBy: userId,
      periodStart: parseResult.periodStart,
      periodEnd: parseResult.periodEnd,
      rowCount: parseResult.rows.length,
      status: 'processing',
      importErrors: parseResult.errors,
    });

    let createdCount = 0;
    let duplicateCount = 0;
    let eventCount = 0;
    const shopByOrder = new Map<string, { marketplace: string; salesChannel: string | null }>();

    for (const row of parseResult.rows) {
      const oid = normalizeMarketplaceOrderId(row.marketplaceOrderId);
      if (oid && row.marketplace) {
        shopByOrder.set(oid, { marketplace: row.marketplace, salesChannel: row.salesChannel });
      }
    }

    const ordered = [...parseResult.rows].sort((a, b) => recordRank(a.recordType) - recordRank(b.recordType));

    for (const row of ordered) {
      const oid = normalizeMarketplaceOrderId(row.marketplaceOrderId);
      if (oid && !row.marketplace && !row.channelNeedsReview) {
        const fromFile = shopByOrder.get(oid);
        if (fromFile) {
          row.marketplace = fromFile.marketplace as typeof row.marketplace;
          if (!row.salesChannel) row.salesChannel = fromFile.salesChannel;
        } else {
          const prior = await this.jtlRecords.findByMarketplaceOrderId(oid);
          const withShop = (prior.data || []).find((r: any) => r.marketplace);
          if (withShop) {
            row.marketplace = withShop.marketplace;
            if (!row.salesChannel) row.salesChannel = withShop.salesChannel;
            shopByOrder.set(oid, {
              marketplace: withShop.marketplace,
              salesChannel: withShop.salesChannel,
            });
          }
        }
      }

      if (row.jtlInvoiceNumber && (row.recordType === 'invoice' || row.recordType === 'sale')) {
        const existingInv = await this.jtlRecords.findByInvoiceNumber(row.jtlInvoiceNumber);
        if (existingInv.data?.length) {
          const taxKeys = new Set(
            existingInv.data.map((r: any) => taxKeyFromRaw(r.rawRow)).filter(Boolean),
          );
          const newTax = taxKeyFromRaw(row.rawRow);
          if (newTax && taxKeys.size && !taxKeys.has(newTax)) {
            await this.matching.exceptions.create({
              exceptionType: 'MULTIPLE_TAX_CODES',
              status: 'open',
              importBatchId: batch._id,
              marketplace: row.marketplace,
              marketplaceOrderId: row.marketplaceOrderId,
              sourceRecordId: row.sourceRecordId,
              title: `Mehrere Steuerschlüssel: ${row.jtlInvoiceNumber}`,
              detail: `Bestehend: ${[...taxKeys].join(', ')}; neu: ${newTax}. Zweite Zeile nicht erneut gebucht.`,
            });
          }
          duplicateCount += 1;
          continue;
        }
      }

      const sourceIdentityKey = buildJtlRecordKey(row.sourceRecordId, row.recordType);
      const existing = await this.jtlRecords.findBySourceIdentityKey(sourceIdentityKey);
      if (existing) {
        duplicateCount += 1;
        continue;
      }

      const record = await this.jtlRecords.create({
        importBatchId: batch._id,
        recordType: row.recordType,
        sourceRecordId: row.sourceRecordId,
        sourceIdentityKey,
        jtlOrderId: row.jtlOrderId,
        jtlInvoiceNumber: row.jtlInvoiceNumber,
        relatedInvoiceNumber: row.relatedInvoiceNumber,
        marketplaceOrderId: row.marketplaceOrderId,
        marketplace: row.marketplace,
        salesChannel: row.salesChannel,
        channelNeedsReview: row.channelNeedsReview,
        orderDate: row.orderDate,
        invoiceDate: row.invoiceDate,
        netAmountCents: row.netAmountCents,
        vatAmountCents: row.vatAmountCents,
        grossAmountCents: row.grossAmountCents,
        currency: row.currency,
        rawRow: row.rawRow,
      });
      createdCount += 1;

      const { duplicate } = await this.matching.upsertEventFromJtlRecord(record, batch._id);
      if (!duplicate) eventCount += 1;

      if (row.marketplaceOrderId) {
        await this.matching.rematchByOrderId(row.marketplaceOrderId);
      }
    }

    const updatedBatch = await this.importBatches.update(batch._id, {
      status: 'completed',
      createdCount,
      duplicateCount,
      summary: { eventCount, parseErrors: parseResult.errors.length },
    });

    await this.audit?.log({
      actor: userId,
      action: 'import.jtl',
      resource: 'importBatch',
      resourceId: batch._id,
      meta: { createdCount, duplicateCount, eventCount },
      ip: (ctx as any).ip,
      userAgent: (ctx as any).userAgent,
    });

    return {
      batch: updatedBatch,
      status: 'completed',
      createdCount,
      duplicateCount,
      eventCount,
      errorCount: parseResult.errors.length,
    };
  }
}

export default JtlImportService;
