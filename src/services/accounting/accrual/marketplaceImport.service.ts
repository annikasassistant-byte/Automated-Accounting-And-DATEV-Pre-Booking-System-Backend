import type { CsvImportMarketplace } from '../../../enums/accrual.js';
import { CSV_IMPORT_MARKETPLACES } from '../../../enums/accrual.js';
import { ApiError } from '../../../utils/ApiError.js';
import { getMarketplaceParser } from '../../../helpers/accounting/accrual/marketplace-registry.js';
import {
  detectAmazonReportType,
  detectBackMarketReportType,
} from '../../../helpers/accounting/accrual/marketplace-types.js';
import { buildMarketplaceTxnKey } from '../../../helpers/accounting/accrual/duplicate-guard.js';
import {
  accrualFileContent,
  accrualFileMeta,
  handleDuplicateFileHash,
  isExcelSpreadsheetName,
  marketplaceImportSource,
  markBatchFailed,
  touchHeartbeat,
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

  #resolveReportKind(
    marketplace: CsvImportMarketplace,
    reportType: string,
    content: string,
  ): 'order' | 'financial' {
    if (reportType === 'order' || reportType === 'financial') return reportType;
    if (marketplace === 'amazon') return detectAmazonReportType(content);
    if (marketplace === 'backmarket') return detectBackMarketReportType(content);
    return 'financial';
  }

  async importMarketplace(channel: string, file: any, userId: string, ctx: Record<string, unknown> = {}) {
    const marketplace = this.#assertMarketplace(channel);
    const { filename } = accrualFileMeta(file, `${marketplace}-import.csv`);
    if (isExcelSpreadsheetName(filename)) {
      throw ApiError.badRequest('Marktplatz-Import akzeptiert nur CSV/TXT, keine Excel-Dateien');
    }
    const content = accrualFileContent(file);
    const dup = await handleDuplicateFileHash(this.importBatches, content);
    if (dup.duplicate) {
      return { batch: dup.batch, status: 'duplicate_file', message: dup.message };
    }

    const reportType = (ctx.reportType as string) || 'auto';
    const resolvedKind = this.#resolveReportKind(marketplace, reportType, content);
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
      lastHeartbeatAt: new Date(),
      importErrors: parseResult.errors,
      summary: { reportType: resolvedKind },
    });

    try {
      let createdCount = 0;
      let duplicateCount = 0;
      let eventCount = 0;

      let loopIndex = 0;
      for (const line of parseResult.lines) {
        loopIndex += 1;
        if (loopIndex % 50 === 0) {
          await touchHeartbeat(this.importBatches, batch._id);
        }

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
        lastHeartbeatAt: new Date(),
        summary: {
          eventCount,
          marketplace,
          parseErrors: parseResult.errors.length,
          reportType: resolvedKind,
        },
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
    } catch (err: any) {
      await markBatchFailed(this.importBatches, batch._id, {
        errorCode: err?.errorCode || err?.code || 'MARKETPLACE_IMPORT_FAILED',
        errorMessage: err?.message || String(err),
      });
      throw err;
    }
  }
}

export default MarketplaceImportService;
