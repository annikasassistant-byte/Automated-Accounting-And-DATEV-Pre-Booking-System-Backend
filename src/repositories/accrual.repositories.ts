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
import { MARKETPLACES } from '../enums/accrual.js';
import {
  CLEARING_PLACEHOLDERS,
  DEFAULT_FX_POLICY_NOTE,
  DEFAULT_REVENUE_ACCOUNT,
  fillMarketplaceAccounts,
} from '../helpers/accounting/accrual/clearing-placeholders.js';

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
    const seededMarketplaces = Object.fromEntries(
      MARKETPLACES.map((mp) => [mp, CLEARING_PLACEHOLDERS[mp]]),
    );
    if (!doc) {
      doc = await this.create({
        singletonKey: 'default',
        revenueAccountDefault: DEFAULT_REVENUE_ACCOUNT,
        fxPolicyNote: DEFAULT_FX_POLICY_NOTE,
        provisionalFxEnabled: true,
        marketplaces: seededMarketplaces,
      });
    } else {
      const mp = doc.marketplaces || {};
      const needsSeed = MARKETPLACES.some((key) => !mp[key]?.revenueAccount);
      const staleFx =
        !doc.fxPolicyNote ||
        /provisional|SEK/i.test(String(doc.fxPolicyNote)) ||
        String(doc.fxPolicyNote).includes('ECB daily reference rate');
      if (needsSeed || staleFx) {
        doc = await this.update(doc._id, {
          marketplaces: Object.fromEntries(
            MARKETPLACES.map((key) => [
              key,
              fillMarketplaceAccounts(mp[key], CLEARING_PLACEHOLDERS[key]),
            ]),
          ),
          fxPolicyNote: staleFx ? DEFAULT_FX_POLICY_NOTE : doc.fxPolicyNote,
        });
      }
    }
    return doc;
  }
}
