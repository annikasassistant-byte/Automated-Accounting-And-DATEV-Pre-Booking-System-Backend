import { ApiError } from '../../../utils/ApiError.js';
import { parseJtlCsv } from '../../../helpers/accounting/accrual/jtl-parser.js';
import { buildJtlRecordKey } from '../../../helpers/accounting/accrual/duplicate-guard.js';
import {
  accrualFileContent,
  accrualFileMeta,
  handleDuplicateFileHash,
} from './accrualImport.util.js';

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
    const content = accrualFileContent(file);
    const { filename } = accrualFileMeta(file, 'jtl-import.csv');
    const dup = await handleDuplicateFileHash(this.importBatches, content);
    if (dup.duplicate) {
      return { batch: dup.batch, status: 'duplicate_file', message: dup.message };
    }

    const parseResult = parseJtlCsv(content);
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

    for (const row of parseResult.rows) {
      // Invoice dedupe by Rechnungsnummer — never book duplicate export rows
      if (row.jtlInvoiceNumber && (row.recordType === 'invoice' || row.recordType === 'sale')) {
        const existingInv = await this.jtlRecords.findByInvoiceNumber(row.jtlInvoiceNumber);
        if (existingInv.data?.length) {
          const taxKeys = new Set(
            existingInv.data
              .map((r: any) =>
                String(
                  r.rawRow?.['Steuerschlüssel'] ||
                    r.rawRow?.['Steuerschlьssel'] ||
                    r.rawRow?.tax_key ||
                    '',
                ).trim(),
              )
              .filter(Boolean),
          );
          const newTax = String(
            row.rawRow?.['Steuerschlüssel'] ||
              row.rawRow?.['Steuerschlьssel'] ||
              row.rawRow?.tax_key ||
              '',
          ).trim();
          if (newTax && taxKeys.size && !taxKeys.has(newTax)) {
            await this.matching.exceptions.create({
              exceptionType: 'MULTIPLE_TAX_CODES',
              status: 'open',
              importBatchId: batch._id,
              marketplace: row.marketplace,
              marketplaceOrderId: row.marketplaceOrderId,
              sourceRecordId: row.sourceRecordId,
              title: `Mehrere Steuerschlüssel: ${row.jtlInvoiceNumber}`,
              detail: `Bestehend: ${[...taxKeys].join(', ')}; neu: ${newTax}`,
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
        marketplaceOrderId: row.marketplaceOrderId,
        marketplace: row.marketplace,
        salesChannel: row.salesChannel,
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
