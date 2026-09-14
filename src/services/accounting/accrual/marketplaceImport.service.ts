import type { CsvImportMarketplace } from '../../../enums/accrual.js';
import { CSV_IMPORT_MARKETPLACES } from '../../../enums/accrual.js';
import { ApiError } from '../../../utils/ApiError.js';
import { getMarketplaceParser } from '../../../helpers/accounting/accrual/marketplace-registry.js';
import { buildMarketplaceTxnKey } from '../../../helpers/accounting/accrual/duplicate-guard.js';
import {
  accrualFileContent,
  accrualFileMeta,
  handleDuplicateFileHash,
  marketplaceImportSource,
} from './accrualImport.util.js';
import { FxService } from './fx.service.js';

export class MarketplaceImportService {
  constructor(deps: {
    importBatchRepository: any;
    marketplaceTxnRepository: any;
    matchingService: any;
    auditRepository?: any;
    fxService?: FxService;
  }) {
    this.importBatches = deps.importBatchRepository;
    this.marketplaceTxns = deps.marketplaceTxnRepository;
    this.matching = deps.matchingService;
    this.audit = deps.auditRepository;
    this.fx = deps.fxService || new FxService();
  }

  importBatches;
  marketplaceTxns;
  matching;
  audit;
  fx;

  #assertMarketplace(channel: string): CsvImportMarketplace {
    if (channel === 'kaufland') {
      throw ApiError.badRequest(
        'Kaufland ist ein JTL-Verkaufskanal (BuyBack / Kaufland.de) — kein Marktplatz-CSV-Import',
      );
    }
    if (!CSV_IMPORT_MARKETPLACES.includes(channel as CsvImportMarketplace)) {
      throw ApiError.badRequest(`Unbekannter Marktplatz: ${channel}`);
    }
    return channel as CsvImportMarketplace;
  }

  async importMarketplace(channel: string, file: any, userId: string, ctx: Record<string, unknown> = {}) {
    const marketplace = this.#assertMarketplace(channel);
    const content = accrualFileContent(file);
    const { filename } = accrualFileMeta(file, `${marketplace}-import.csv`);
    const dup = await handleDuplicateFileHash(this.importBatches, content);
    if (dup.duplicate) {
      return { batch: dup.batch, status: 'duplicate_file', message: dup.message };
    }

    const reportType = (ctx.reportType as string) || 'auto';
    const parser = getMarketplaceParser(
      marketplace,
      reportType as 'order' | 'financial' | 'auto',
      content,
    );
    const parseResult = parser.parse(content);
    const source = marketplaceImportSource(marketplace);

    const batch = await this.importBatches.create({
      source,
      filename,
      fileHash: dup.fileHash,
      uploadedBy: userId,
      periodStart: parseResult.periodStart,
      periodEnd: parseResult.periodEnd,
      rowCount: parseResult.lines.length,
      status: 'processing',
      importErrors: parseResult.errors,
    });

    let createdCount = 0;
    let duplicateCount = 0;
    let eventCount = 0;

    for (const line of parseResult.lines) {
      const sourceIdentityKey = buildMarketplaceTxnKey(
        marketplace,
        line.sourceRecordId,
        line.txnType,
      );
      const existing = await this.marketplaceTxns.findBySourceIdentityKey(sourceIdentityKey);
      if (existing) {
        duplicateCount += 1;
        continue;
      }

      const fx = await this.fx.resolve({
        originalCurrency: line.originalCurrency,
        originalAmountCents: line.originalAmountCents,
        txnDate: line.txnDate,
        marketplaceEurCents: line.eurAmountCents,
        marketplaceRate: line.exchangeRate,
        marketplaceRateDate: line.exchangeRateDate,
        marketplaceRateSource: line.exchangeRateSource,
      });

      const txn = await this.marketplaceTxns.create({
        importBatchId: batch._id,
        marketplace,
        txnType: line.txnType,
        sourceRecordId: line.sourceRecordId,
        sourceIdentityKey,
        marketplaceOrderId: line.marketplaceOrderId,
        financialTransactionId: line.financialTransactionId,
        settlementId: line.settlementId,
        txnDate: line.txnDate,
        description: line.description,
        originalCurrency: fx.originalCurrency,
        originalAmountCents: fx.originalAmountCents,
        eurAmountCents: fx.eurAmountCents,
        exchangeRate: fx.exchangeRate,
        exchangeRateDate: fx.exchangeRateDate,
        exchangeRateSource: fx.exchangeRateSource,
        rawRow: line.rawRow,
      });
      createdCount += 1;

      const { duplicate } = await this.matching.upsertEventFromMarketplaceTxn(txn, batch._id);
      if (!duplicate) eventCount += 1;

      if (line.marketplaceOrderId) {
        await this.matching.rematchByOrderId(line.marketplaceOrderId);
      }
    }

    const updatedBatch = await this.importBatches.update(batch._id, {
      status: 'completed',
      createdCount,
      duplicateCount,
      summary: { eventCount, marketplace, parseErrors: parseResult.errors.length },
    });

    await this.audit?.log({
      actor: userId,
      action: 'import.marketplace',
      resource: 'importBatch',
      resourceId: batch._id,
      meta: { marketplace, createdCount, duplicateCount, eventCount },
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

export default MarketplaceImportService;
