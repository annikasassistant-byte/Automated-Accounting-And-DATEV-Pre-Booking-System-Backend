import {
  buildBusinessEventKey,
  buildEvidenceKey,
} from '../../../helpers/accounting/accrual/duplicate-guard.js';
import {
  jtlRecordToEventType,
  marketplaceTxnToEventType,
  normalizeMarketplaceOrderId,
} from '../../../helpers/accounting/accrual/matching.util.js';
import { FxService } from './fx.service.js';

function amazonCancelledFromTxn(txn: any): boolean {
  return (
    txn?.rawRow?._amazonCancelled === '1' ||
    txn?.rawRow?._amazonCancelled === true ||
    String(txn?.rawRow?.['order-status'] || '').toLowerCase().includes('cancel')
  );
}

function amazonShippedFromTxn(txn: any): boolean {
  return (
    txn?.rawRow?._amazonShipped === '1' ||
    txn?.rawRow?._amazonShipped === true ||
    String(txn?.rawRow?.['order-status'] || '').toLowerCase().includes('ship')
  );
}

export class MatchingService {
  constructor(deps: {
    businessEventRepository: any;
    marketplaceTxnRepository: any;
    jtlRecordRepository: any;
    evidenceRepository: any;
    exceptionService: any;
    fxService?: FxService;
  }) {
    this.events = deps.businessEventRepository;
    this.marketplaceTxns = deps.marketplaceTxnRepository;
    this.jtlRecords = deps.jtlRecordRepository;
    this.evidence = deps.evidenceRepository;
    this.exceptions = deps.exceptionService;
    this.fx = deps.fxService || new FxService();
  }

  events;
  marketplaceTxns;
  jtlRecords;
  evidence;
  exceptions;
  fx;

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

  async #amazonStatus(orderId: string | null) {
    const id = normalizeMarketplaceOrderId(orderId);
    if (!id) return { cancelled: false, shipped: false };
    const mp = await this.marketplaceTxns.findMany(
      { marketplace: 'amazon', marketplaceOrderId: id, txnType: 'order' },
      { limit: 20, page: 1 },
    );
    const rows = mp.data || [];
    return {
      cancelled: rows.some((t: any) => amazonCancelledFromTxn(t)),
      shipped: rows.some((t: any) => amazonShippedFromTxn(t)),
    };
  }

  async #hasJtlInvoice(orderId: string | null) {
    const id = normalizeMarketplaceOrderId(orderId);
    if (!id) return false;
    const jtl = await this.jtlRecords.findByMarketplaceOrderId(id);
    return (jtl.data || []).some(
      (r: any) => r.recordType === 'invoice' || r.recordType === 'sale',
    );
  }

  async #fxForJtl(record: any) {
    return this.fx.resolve({
      originalCurrency: record.currency || 'EUR',
      originalAmountCents: record.grossAmountCents ?? record.netAmountCents ?? 0,
      txnDate: record.invoiceDate || record.orderDate || new Date(),
    });
  }

  async upsertEventFromMarketplaceTxn(txn: any, importBatchId: string) {
    const cancelBefore =
      txn.rawRow?._cancelBeforeFulfilment === '1' ||
      txn.rawRow?._cancelBeforeFulfilment === true ||
      amazonCancelledFromTxn(txn);
    let eventType = marketplaceTxnToEventType(txn.txnType);
    if (cancelBefore && (txn.txnType === 'order' || eventType === 'ORDER_CREATED')) {
      eventType = 'CANCELLATION';
    }

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

    const jtl = txn.marketplaceOrderId
      ? await this.jtlRecords.findByMarketplaceOrderId(txn.marketplaceOrderId)
      : { data: [] };
    const hasJtl = (jtl.data?.length || 0) > 0;
    const hasInvoice = (jtl.data || []).some(
      (r: any) => r.recordType === 'invoice' || r.recordType === 'sale',
    );
    const shipped = amazonShippedFromTxn(txn);

    let matchStatus = txn.marketplaceOrderId ? 'UNMATCHED' : null;
    if (hasJtl) matchStatus = 'MATCHED';

    let status: string = cancelBefore
      ? 'void'
      : matchStatus === 'MATCHED'
        ? 'matched'
        : txn.marketplaceOrderId
          ? 'pending_match'
          : 'draft';

    if (!cancelBefore && eventType === 'ORDER_CREATED' && shipped && !hasInvoice) {
      status = 'invoice_pending';
      matchStatus = hasJtl ? 'MATCHED' : 'UNMATCHED';
    }

    if (!cancelBefore && eventType === 'ORDER_CREATED' && shipped && hasInvoice) {
      eventType = 'SALE';
      status = 'matched';
      matchStatus = 'MATCHED';
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
      status,
      matchStatus: cancelBefore ? null : matchStatus,
      importBatchId,
      metadata: {
        description: txn.description,
        clearingOnly: eventType === 'SETTLEMENT' || eventType === 'PAYOUT',
        cancelBeforeFulfilment: cancelBefore,
        amazonCancelled: amazonCancelledFromTxn(txn),
        invoicePending: status === 'invoice_pending',
      },
    });

    await this.marketplaceTxns.update(txn._id, { businessEventId: event._id });
    await this.#attachEvidence(event._id, 'marketplace_csv', txn.sourceRecordId);

    if (status === 'invoice_pending') {
      await this.exceptions.create({
        exceptionType: 'MISSING_INVOICE',
        status: 'open',
        businessEventId: event._id,
        importBatchId,
        marketplace: txn.marketplace,
        marketplaceOrderId: txn.marketplaceOrderId,
        sourceRecordId: txn.sourceRecordId,
        title: `Rechnung ausstehend: ${txn.marketplaceOrderId}`,
        detail:
          'Amazon-Bestellung versendet, JTL-Rechnung fehlt — bleibt offen und wird bei Folgeimporten erneut geprüft',
      });
    } else if (
      !cancelBefore &&
      eventType === 'ORDER_CREATED' &&
      txn.marketplaceOrderId &&
      matchStatus === 'UNMATCHED' &&
      status !== 'invoice_pending'
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
        detail: 'Betrag ist nicht in EUR umgerechnet — ECB/Marktplatz-Kurs fehlt',
      });
    }

    return { event, duplicate: false };
  }

  async upsertEventFromJtlRecord(record: any, importBatchId: string) {
    const mpOrderId = normalizeMarketplaceOrderId(record.marketplaceOrderId);
    const amazon = await this.#amazonStatus(mpOrderId);
    const fx = await this.#fxForJtl(record);
    const fxPayload = {
      originalCurrency: fx.originalCurrency,
      originalAmountCents: fx.originalAmountCents,
      eurAmountCents: fx.eurAmountCents,
      exchangeRate: fx.exchangeRate,
      exchangeRateDate: fx.exchangeRateDate,
      exchangeRateSource: fx.exchangeRateSource,
    };

    // Amazon is authoritative: cancelled Amazon order never creates sales revenue.
    if (amazon.cancelled) {
      const sourceIdentityKey = buildBusinessEventKey({
        eventType: 'CANCELLATION',
        marketplace: record.marketplace || 'amazon',
        marketplaceOrderId: mpOrderId,
        sourceRecordId: `jtl-cancel-blocked:${record.sourceRecordId}`,
      });
      const existing = await this.events.findBySourceIdentityKey(sourceIdentityKey);
      if (existing) return { event: existing, duplicate: true };
      const event = await this.events.create({
        eventType: 'CANCELLATION',
        marketplace: record.marketplace || 'amazon',
        source: 'jtl_csv',
        sourceRecordId: record.sourceRecordId,
        sourceIdentityKey,
        marketplaceOrderId: mpOrderId,
        jtlOrderId: record.jtlOrderId,
        jtlInvoiceNumber: record.jtlInvoiceNumber,
        eventDate: record.invoiceDate || record.orderDate || new Date(),
        accountingDate: record.invoiceDate || record.orderDate || null,
        fx: fxPayload,
        status: 'void',
        matchStatus: 'MATCHED',
        importBatchId,
        metadata: {
          recordType: record.recordType,
          blockedByAmazonCancel: true,
          salesChannel: record.salesChannel,
        },
      });
      await this.jtlRecords.update(record._id, { businessEventId: event._id });
      await this.#attachEvidence(event._id, 'jtl_csv', record.sourceRecordId);
      return { event, duplicate: false };
    }

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
      fx: fxPayload,
      status: matchStatus === 'MATCHED' ? 'matched' : mpOrderId ? 'pending_match' : 'draft',
      matchStatus,
      importBatchId,
      metadata: { recordType: record.recordType, salesChannel: record.salesChannel },
    });

    await this.jtlRecords.update(record._id, { businessEventId: event._id });
    await this.#attachEvidence(event._id, 'jtl_csv', record.sourceRecordId);

    if (fx.fxReview) {
      await this.exceptions.createFxReview({
        businessEventId: event._id,
        importBatchId,
        marketplace: record.marketplace,
        marketplaceOrderId: mpOrderId,
        title: `FX-Prüfung: ${fx.originalCurrency}`,
        detail: 'JTL-Betrag ist nicht in EUR umgerechnet — ECB-Kurs fehlt',
      });
    }

    if (record.salesChannel && !record.marketplace) {
      await this.exceptions.create({
        exceptionType: 'UNKNOWN_TRANSACTION_TYPE',
        status: 'open',
        businessEventId: event._id,
        importBatchId,
        marketplace: null,
        marketplaceOrderId: mpOrderId,
        sourceRecordId: record.sourceRecordId,
        title: `Unbekannter JTL-Kanal: ${record.salesChannel}`,
        detail: 'Shop-Feld keinem Marktplatz zugeordnet (Amazon/Back Market/refurbed/Kaufland)',
      });
    }

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

    const amazon = await this.#amazonStatus(orderId);
    const jtl = await this.jtlRecords.findByMarketplaceOrderId(orderId);
    const mp = await this.marketplaceTxns.findMany(
      { marketplaceOrderId: orderId },
      { limit: 100, page: 1 },
    );
    const hasInvoice = (jtl.data || []).some(
      (r: any) => r.recordType === 'invoice' || r.recordType === 'sale',
    );

    let updated = 0;

    if (amazon.cancelled) {
      const related = [...(jtl.data || []), ...(mp.data || [])];
      for (const rec of related) {
        if (!rec.businessEventId) continue;
        await this.events.update(rec.businessEventId, {
          eventType: 'CANCELLATION',
          status: 'void',
          matchStatus: 'MATCHED',
          metadata: { amazonCancelled: true },
        });
        updated += 1;
      }
      await this.exceptions.resolveOpenForOrder(orderId, 'Amazon storniert — kein Umsatz');
      return { updated };
    }

    if (jtl.data?.length && mp.data?.length) {
      for (const record of jtl.data) {
        if (record.businessEventId) {
          const ev = await this.events.findById(record.businessEventId);
          const patch: Record<string, unknown> = {
            matchStatus: 'MATCHED',
            status: 'matched',
          };
          if (ev?.eventType === 'ORDER_CREATED' && record.recordType !== 'order' && hasInvoice) {
            patch.eventType = 'SALE';
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
          if (ev?.eventType === 'SETTLEMENT' || ev?.eventType === 'PAYOUT') {
            /* clearing stays clearing */
          } else if (ev?.eventType === 'ORDER_CREATED' || ev?.status === 'invoice_pending') {
            if (hasInvoice) {
              patch.eventType = 'SALE';
              patch.status = 'matched';
            } else if (amazon.shipped || amazonShippedFromTxn(txn)) {
              patch.status = 'invoice_pending';
              patch.eventType = 'ORDER_CREATED';
            }
          }
          await this.events.update(txn.businessEventId, patch);
          updated += 1;
        }
      }
    }

    if (hasInvoice) {
      await this.exceptions.resolveOpenForOrder(orderId, 'JTL-Rechnung nachträglich zugeordnet');
    }

    return { updated };
  }
}

export default MatchingService;
