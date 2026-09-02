import {
  buildBusinessEventKey,
  buildEvidenceKey,
} from '../../../helpers/accounting/accrual/duplicate-guard.js';
import {
  jtlRecordToEventType,
  marketplaceTxnToEventType,
  normalizeMarketplaceOrderId,
} from '../../../helpers/accounting/accrual/matching.util.js';

export class MatchingService {
  constructor(deps: {
    businessEventRepository: any;
    marketplaceTxnRepository: any;
    jtlRecordRepository: any;
    evidenceRepository: any;
    exceptionService: any;
  }) {
    this.events = deps.businessEventRepository;
    this.marketplaceTxns = deps.marketplaceTxnRepository;
    this.jtlRecords = deps.jtlRecordRepository;
    this.evidence = deps.evidenceRepository;
    this.exceptions = deps.exceptionService;
  }

  events;
  marketplaceTxns;
  jtlRecords;
  evidence;
  exceptions;

  async #attachEvidence(businessEventId: string, source: string, sourceRecordId: string) {
    const sourceIdentityKey = buildEvidenceKey(source, sourceRecordId);
    const existing = await this.evidence.findBySourceIdentityKey(sourceIdentityKey);
    if (existing) return existing;
    return this.evidence.create({
      businessEventId,
      source,
      sourceRecordId,
      sourceIdentityKey,
      attachedAt: new Date(),
    });
  }

  async upsertEventFromMarketplaceTxn(txn: any, importBatchId: string) {
    const eventType = marketplaceTxnToEventType(txn.txnType);
    const sourceIdentityKey = buildBusinessEventKey({
      eventType,
      marketplace: txn.marketplace,
      marketplaceOrderId: txn.marketplaceOrderId,
      sourceRecordId: txn.sourceRecordId,
      financialTransactionId: txn.financialTransactionId,
    });

    const existing = await this.events.findBySourceIdentityKey(sourceIdentityKey);
    if (existing) {
      await this.exceptions.createDuplicateException({
        importBatchId,
        marketplace: txn.marketplace,
        sourceRecordId: txn.sourceRecordId,
        title: `Duplikat Marktplatz: ${txn.sourceRecordId}`,
      });
      return { event: existing, duplicate: true };
    }

    let matchStatus = txn.marketplaceOrderId ? 'UNMATCHED' : null;
    if (txn.marketplaceOrderId) {
      const jtl = await this.jtlRecords.findByMarketplaceOrderId(txn.marketplaceOrderId);
      if (jtl.data?.length) matchStatus = 'MATCHED';
    }

    const event = await this.events.create({
      eventType,
      marketplace: txn.marketplace,
      source: `marketplace_${txn.marketplace}`,
      sourceRecordId: txn.sourceRecordId,
      sourceIdentityKey,
      marketplaceOrderId: txn.marketplaceOrderId,
      financialTransactionId: txn.financialTransactionId,
      settlementId: txn.settlementId,
      eventDate: txn.txnDate,
      accountingDate: txn.txnDate,
      fx: {
        originalCurrency: txn.originalCurrency,
        originalAmountCents: txn.originalAmountCents,
        eurAmountCents: txn.eurAmountCents,
        exchangeRate: txn.exchangeRate,
        exchangeRateDate: txn.exchangeRateDate,
        exchangeRateSource: txn.exchangeRateSource,
      },
      status: matchStatus === 'MATCHED' ? 'matched' : 'pending_match',
      matchStatus,
      importBatchId,
      metadata: { description: txn.description },
    });

    await this.marketplaceTxns.update(txn._id, { businessEventId: event._id });
    await this.#attachEvidence(event._id, 'marketplace_csv', txn.sourceRecordId);

    if (txn.originalCurrency && txn.originalCurrency !== 'EUR' && !txn.eurAmountCents) {
      await this.exceptions.createFxReview({
        businessEventId: event._id,
        importBatchId,
        marketplace: txn.marketplace,
        marketplaceOrderId: txn.marketplaceOrderId,
        title: `FX-Prüfung: ${txn.originalCurrency}`,
        detail: 'Betrag ist nicht in EUR umgerechnet',
      });
    }

    return { event, duplicate: false };
  }

  async upsertEventFromJtlRecord(record: any, importBatchId: string) {
    const mpOrderId = normalizeMarketplaceOrderId(record.marketplaceOrderId);
    let hasMarketplaceMatch = false;
    if (mpOrderId) {
      const mp = await this.marketplaceTxns.findMany(
        { marketplaceOrderId: mpOrderId },
        { limit: 1, page: 1 },
      );
      hasMarketplaceMatch = (mp.data?.length || 0) > 0;
    }

    const eventType = jtlRecordToEventType(record.recordType, hasMarketplaceMatch);
    const sourceIdentityKey = buildBusinessEventKey({
      eventType,
      marketplace: record.marketplace,
      marketplaceOrderId: mpOrderId,
      sourceRecordId: record.sourceRecordId,
    });

    const existing = await this.events.findBySourceIdentityKey(sourceIdentityKey);
    if (existing) {
      await this.exceptions.createDuplicateException({
        importBatchId,
        marketplace: record.marketplace,
        sourceRecordId: record.sourceRecordId,
        title: `Duplikat JTL: ${record.sourceRecordId}`,
      });
      return { event: existing, duplicate: true };
    }

    const matchStatus = hasMarketplaceMatch ? 'MATCHED' : mpOrderId ? 'UNMATCHED' : null;

    const event = await this.events.create({
      eventType,
      marketplace: record.marketplace,
      source: 'jtl_csv',
      sourceRecordId: record.sourceRecordId,
      sourceIdentityKey,
      marketplaceOrderId: mpOrderId,
      jtlOrderId: record.jtlOrderId,
      jtlInvoiceNumber: record.jtlInvoiceNumber,
      eventDate: record.invoiceDate || record.orderDate || new Date(),
      accountingDate: record.invoiceDate || record.orderDate || null,
      fx: {
        originalCurrency: record.currency,
        originalAmountCents: record.grossAmountCents,
        eurAmountCents: record.currency === 'EUR' ? record.grossAmountCents : null,
      },
      status: matchStatus === 'MATCHED' ? 'matched' : mpOrderId ? 'pending_match' : 'draft',
      matchStatus,
      importBatchId,
      metadata: { recordType: record.recordType, salesChannel: record.salesChannel },
    });

    await this.jtlRecords.update(record._id, { businessEventId: event._id });
    await this.#attachEvidence(event._id, 'jtl_csv', record.sourceRecordId);

    if (!hasMarketplaceMatch && mpOrderId) {
      await this.exceptions.create({
        exceptionType: 'UNMATCHED_MARKETPLACE_EVENT',
        status: 'open',
        businessEventId: event._id,
        importBatchId,
        marketplace: record.marketplace,
        marketplaceOrderId: mpOrderId,
        sourceRecordId: record.sourceRecordId,
        title: `Kein Marktplatz-Match für ${mpOrderId}`,
        detail: 'JTL-Datensatz ohne passende Marktplatzzeile',
      });
    }

    return { event, duplicate: false };
  }

  async rematchByOrderId(marketplaceOrderId: string) {
    const orderId = normalizeMarketplaceOrderId(marketplaceOrderId);
    if (!orderId) return { updated: 0 };

    const jtl = await this.jtlRecords.findByMarketplaceOrderId(orderId);
    const mp = await this.marketplaceTxns.findMany({ marketplaceOrderId: orderId }, { limit: 100, page: 1 });

    let updated = 0;
    if (jtl.data?.length && mp.data?.length) {
      for (const record of jtl.data) {
        if (record.businessEventId) {
          await this.events.update(record.businessEventId, {
            matchStatus: 'MATCHED',
            status: 'matched',
            eventType: 'SALE',
          });
          updated += 1;
        }
      }
      for (const txn of mp.data) {
        if (txn.businessEventId) {
          await this.events.update(txn.businessEventId, { matchStatus: 'MATCHED', status: 'matched' });
          updated += 1;
        }
      }
    }
    return { updated };
  }
}

export default MatchingService;
