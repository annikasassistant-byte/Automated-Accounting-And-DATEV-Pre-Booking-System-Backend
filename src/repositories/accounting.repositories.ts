import { BaseRepository } from './base.repository.js';
import ImportBatch from '../models/accounting/importBatch.model.js';
import Transaction from '../models/accounting/transaction.model.js';
import Rule from '../models/accounting/rule.model.js';
import RuleSuggestion from '../models/accounting/ruleSuggestion.model.js';
import ExportBatch from '../models/accounting/exportBatch.model.js';
import ExportItem from '../models/accounting/exportItem.model.js';
import CompanySettings from '../models/accounting/companySettings.model.js';
import DuplicateGroup from '../models/accounting/duplicateGroup.model.js';
import SystemPolicy from '../models/accounting/systemPolicy.model.js';
import { cloneDefaultSystemPolicy } from '../helpers/accounting/system-policy-defaults.js';
import { toPolicyPlain } from '../helpers/accounting/system-policies.js';

export class ImportBatchRepository extends BaseRepository {
  constructor() {
    super(ImportBatch, 'ImportBatch');
  }

  async findByFileHash(fileHash: string) {
    return this.findOne({ fileHash });
  }
}

export class TransactionRepository extends BaseRepository {
  constructor() {
    super(Transaction, 'Transaction');
  }

  async findByFingerprint(fingerprint: string) {
    return this.findOne({ fingerprint });
  }

  async findByFingerprints(fingerprints: string[]) {
    if (!fingerprints.length) return [];
    const result = await this.findMany(
      { fingerprint: { $in: fingerprints } },
      { limit: Math.min(500, fingerprints.length), page: 1 },
    );
    return result.data;
  }
}

export class RuleRepository extends BaseRepository {
  constructor() {
    super(Rule, 'Rule');
  }

  async findEnabled() {
    const result = await this.findMany(
      { enabled: true },
      { limit: 500, page: 1, sort: 'priority' },
    );
    return result.data;
  }
}

export class RuleSuggestionRepository extends BaseRepository {
  constructor() {
    super(RuleSuggestion, 'RuleSuggestion');
  }
}

export class ExportBatchRepository extends BaseRepository {
  constructor() {
    super(ExportBatch, 'ExportBatch');
  }
}

export class ExportItemRepository extends BaseRepository {
  constructor() {
    super(ExportItem, 'ExportItem');
  }

  async existsForTransaction(transactionId: string) {
    return this.exists({ transactionId });
  }
}

export class CompanySettingsRepository extends BaseRepository {
  constructor() {
    super(CompanySettings, 'CompanySettings');
  }

  async getOrCreateDefault() {
    let doc = await this.findOne({ singletonKey: 'default' });
    if (!doc) {
      doc = await this.create({ singletonKey: 'default' });
    }
    return doc;
  }
}

export class SystemPolicyRepository extends BaseRepository {
  constructor() {
    super(SystemPolicy, 'SystemPolicy');
  }

  async getOrCreateDefault() {
    let doc = await this.findOne({ singletonKey: 'default' });
    if (!doc) {
      const defaults = cloneDefaultSystemPolicy();
      doc = await this.create({ singletonKey: 'default', ...defaults });
    }
    return doc;
  }

  async getPlainConfig() {
    const doc = await this.getOrCreateDefault();
    return toPolicyPlain(doc.toObject ? doc.toObject() : doc);
  }
}

export class DuplicateGroupRepository extends BaseRepository {
  constructor() {
    super(DuplicateGroup, 'DuplicateGroup');
  }
}
