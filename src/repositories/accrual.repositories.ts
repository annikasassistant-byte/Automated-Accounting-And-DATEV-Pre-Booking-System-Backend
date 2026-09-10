import { BaseRepository } from './base.repository.js';
import BusinessEvent from '../models/accrual/businessEvent.model.js';
import Evidence from '../models/accrual/evidence.model.js';
import MarketplaceTxn from '../models/accrual/marketplaceTxn.model.js';
import JtlRecord from '../models/accrual/jtlRecord.model.js';
import JournalEntry from '../models/accrual/journalEntry.model.js';
import JournalLine from '../models/accrual/journalLine.model.js';
import AccountingException from '../models/accrual/accountingException.model.js';
import TaxCode from '../models/accrual/taxCode.model.js';
import ClearingConfig from '../models/accrual/clearingConfig.model.js';

export class BusinessEventRepository extends BaseRepository {
  constructor() {
    super(BusinessEvent, 'BusinessEvent');
  }

  async findBySourceIdentityKey(sourceIdentityKey: string) {
    return this.findOne({ sourceIdentityKey });
  }

  async findByMarketplaceOrderId(marketplace: string, marketplaceOrderId: string) {
    return this.findMany(
      { marketplace, marketplaceOrderId },
      { limit: 100, page: 1, sort: 'eventDate' },
    );
  }
}

export class EvidenceRepository extends BaseRepository {
  constructor() {
    super(Evidence, 'Evidence');
  }

  async findBySourceIdentityKey(sourceIdentityKey: string) {
    return this.findOne({ sourceIdentityKey });
  }

  async findByBusinessEventId(businessEventId: string) {
    const result = await this.findMany(
      { businessEventId },
      { limit: 200, page: 1, sort: 'attachedAt' },
    );
    return result.data;
  }
}

export class MarketplaceTxnRepository extends BaseRepository {
  constructor() {
    super(MarketplaceTxn, 'MarketplaceTxn');
  }

  async findBySourceIdentityKey(sourceIdentityKey: string) {
    return this.findOne({ sourceIdentityKey });
  }
}

export class JtlRecordRepository extends BaseRepository {
  constructor() {
    super(JtlRecord, 'JtlRecord');
  }

  async findBySourceIdentityKey(sourceIdentityKey: string) {
    return this.findOne({ sourceIdentityKey });
  }

  async findByMarketplaceOrderId(marketplaceOrderId: string) {
    return this.findMany({ marketplaceOrderId }, { limit: 50, page: 1 });
  }

  async findByInvoiceNumber(jtlInvoiceNumber: string) {
    return this.findMany({ jtlInvoiceNumber }, { limit: 50, page: 1 });
  }
}

export class JournalEntryRepository extends BaseRepository {
  constructor() {
    super(JournalEntry, 'JournalEntry');
  }

  async findByBusinessEventId(businessEventId: string) {
    return this.findOne({ businessEventId });
  }
}

export class JournalLineRepository extends BaseRepository {
  constructor() {
    super(JournalLine, 'JournalLine');
  }

  async findByJournalEntryId(journalEntryId: string) {
    const result = await this.findMany(
      { journalEntryId },
      { limit: 100, page: 1, sort: 'lineOrder' },
    );
    return result.data;
  }
}

export class AccountingExceptionRepository extends BaseRepository {
  constructor() {
    super(AccountingException, 'AccountingException');
  }

  async countOpen() {
    return this.count({ status: 'open' });
  }
}

export class TaxCodeRepository extends BaseRepository {
  constructor() {
    super(TaxCode, 'TaxCode');
  }

  async findByCode(code: string) {
    return this.findOne({ code });
  }

  async findEnabled() {
    const result = await this.findMany({ enabled: true }, { limit: 100, page: 1, sort: 'code' });
    return result.data;
  }
}

export class ClearingConfigRepository extends BaseRepository {
  constructor() {
    super(ClearingConfig, 'ClearingConfig');
  }

  async getOrCreateDefault() {
    let doc = await this.findOne({ singletonKey: 'default' });
    if (!doc) {
      doc = await this.create({
        singletonKey: 'default',
        revenueAccountDefault: '81971',
        fxPolicyNote:
          'ECB daily reference rate; marketplace actual EUR/rate wins; weekend/holiday = last ECB rate before that date. Store rate permanently on the event.',
        provisionalFxEnabled: true,
        marketplaces: {
          amazon: {
            revenueAccount: '81971',
            clearingAccount: '1400',
            feeAccount: '3100',
            refundAccount: '81971',
            debtorAccount: '1400',
            adjustmentAccount: '2160',
          },
          refurbed: {
            revenueAccount: '81972',
            clearingAccount: '1400',
            feeAccount: '3100',
            refundAccount: '81972',
            debtorAccount: '1400',
            adjustmentAccount: '2160',
          },
          backmarket: {
            revenueAccount: '81973',
            clearingAccount: '1400',
            feeAccount: '3100',
            refundAccount: '81973',
            debtorAccount: '1400',
            adjustmentAccount: '2160',
          },
        },
      });
    } else {
      const mp = doc.marketplaces || {};
      const amazonDefaults = {
        revenueAccount: '81971',
        clearingAccount: '1400',
        feeAccount: '3100',
        refundAccount: '81971',
        debtorAccount: '1400',
        adjustmentAccount: '2160',
      };
      const refurbedDefaults = {
        revenueAccount: '81972',
        clearingAccount: '1400',
        feeAccount: '3100',
        refundAccount: '81972',
        debtorAccount: '1400',
        adjustmentAccount: '2160',
      };
      const backmarketDefaults = {
        revenueAccount: '81973',
        clearingAccount: '1400',
        feeAccount: '3100',
        refundAccount: '81973',
        debtorAccount: '1400',
        adjustmentAccount: '2160',
      };
      const fill = (existing: Record<string, string | null> | undefined, defaults: Record<string, string>) => {
        const merged = { ...defaults, ...(existing || {}) };
        for (const key of Object.keys(defaults)) {
          if (!merged[key]) merged[key] = defaults[key];
        }
        return merged;
      };
      const needsSeed =
        !mp.amazon?.revenueAccount || !mp.refurbed?.revenueAccount || !mp.backmarket?.revenueAccount;
      if (needsSeed) {
        doc = await this.update(doc._id, {
          marketplaces: {
            amazon: fill(mp.amazon, amazonDefaults),
            refurbed: fill(mp.refurbed, refurbedDefaults),
            backmarket: fill(mp.backmarket, backmarketDefaults),
          },
          fxPolicyNote:
            doc.fxPolicyNote ||
            'ECB daily reference rate; marketplace actual EUR/rate wins; weekend/holiday = last ECB rate before that date.',
        });
      }
    }
    return doc;
  }
}
