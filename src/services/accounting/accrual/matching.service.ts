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
    const cancelBefore =
      txn.rawRow?._cancelBeforeFulfilment === '1' || txn.rawRow?._cancelBeforeFulfilment === true;
    let eventType = marketplaceTxnToEventType(txn.txnType);
    if (cancelBefore) eventType = 'CANCELLATION';

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
      status: cancelBefore
        ? 'void'
        : matchStatus === 'MATCHED'
          ? 'matched'
          : txn.marketplaceOrderId
            ? 'pending_match'
            : 'draft',
      matchStatus: cancelBefore ? null : matchStatus,
      importBatchId,
      metadata: {
        description: txn.description,
        clearingOnly: eventType === 'SETTLEMENT' || eventType === 'PAYOUT',
        cancelBeforeFulfilment: cancelBefore,
      },
    });

    await this.marketplaceTxns.update(txn._id, { businessEventId: event._id });
    await this.#attachEvidence(event._id, 'marketplace_csv', txn.sourceRecordId);

    if (
      !cancelBefore &&
      eventType === 'ORDER_CREATED' &&
      txn.marketplaceOrderId &&
      matchStatus === 'UNMATCHED'
    ) {
      await this.exceptions.create({
        exceptionType: 'MISSING_JTL_ORDER',
        status: 'open',
        businessEventId: event._id,
        importBatchId,
        marketplace: txn.marketplace,
        marketplaceOrderId: txn.marketplaceOrderId,
        sourceRecordId: txn.sourceRecordId,
        title: `Kein JTL-Auftrag für ${txn.marketplaceOrderId}`,
        detail: 'Marketplace Order ohne JTL-Match',
      });
    }

    if (txn.originalCurrency && txn.originalCurrency !== 'EUR' && !txn.eurAmountCents) {
      await this.exceptions.createFxReview({
        businessEventId: event._id,
        importBatchId,
        marketplace: txn.marketplace,
        marketplaceOrderId: txn.marketplaceOrderId,
        title: `FX-Prüfung: ${txn.originalCurrency}`,
        detail: 'Betrag ist nicht in EUR umgerechnet — provisional/true-up erforderlich',
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
          const ev = await this.events.findById(record.businessEventId);
          const patch: Record<string, unknown> = {
            matchStatus: 'MATCHED',
            status: 'matched',
          };
          // Promote only ORDER_CREATED → SALE when JTL invoice/order evidence matches
          if (ev?.eventType === 'ORDER_CREATED' && record.recordType !== 'order') {
            patch.eventType = 'SALE';
          } else if (ev?.eventType === 'ORDER_CREATED' && record.recordType === 'order') {
            // Order↔order match only — not yet recognized revenue
          }
          await this.events.update(record.businessEventId, patch);
          updated += 1;
        }
      }
      for (const txn of mp.data) {
        if (txn.businessEventId) {
          const ev = await this.events.findById(txn.businessEventId);
          if (ev?.eventType === 'CANCELLATION' || ev?.status === 'void') continue;
          const patch: Record<string, unknown> = {
            matchStatus: 'MATCHED',
            status: 'matched',
          };
          // Financial SETTLEMENT stays clearing — never rewrite to SALE
          if (ev?.eventType === 'ORDER_CREATED') {
            const hasInvoice = jtl.data.some(
              (r: any) => r.recordType === 'invoice' || r.recordType === 'sale',
            );
            if (hasInvoice) patch.eventType = 'SALE';
          }
          await this.events.update(txn.businessEventId, patch);
          updated += 1;
        }
      }
    }
    return { updated };
  }
}

export default MatchingService;
