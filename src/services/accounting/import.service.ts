import { ApiError } from '../../utils/ApiError.js';
import { sha256 } from '../../helpers/accounting/csv.util.js';
import { parseBankCsv } from '../../helpers/accounting/bank-parser.js';
import { parsePaypalCsv } from '../../helpers/accounting/paypal-parser.js';
import {
  detectBankPaypalClearing,
  detectMarketplacePark,
  detectManualParkPolicies,
  defaultGegenkonto,
} from '../../helpers/accounting/system-policies.js';
import {
  applyHumanRules,
  adjustInventoryGegenkonto,
} from '../../helpers/accounting/rule-engine.js';

function fileContent(file) {
  if (file?.buffer) return file.buffer.toString('utf-8');
  if (typeof file === 'string') return file;
  throw ApiError.badRequest('Keine gültige Datei empfangen');
}

export class ImportService {
  constructor(deps) {
    this.importBatches = deps.importBatchRepository;
    this.transactions = deps.transactionRepository;
    this.rules = deps.ruleRepository;
    this.duplicateGroups = deps.duplicateGroupRepository;
    this.audit = deps.auditRepository;
    this.settings = deps.settingsService;
  }

  async #policy() {
    if (this.settings?.getSystemPolicyConfig) {
      return this.settings.getSystemPolicyConfig();
    }
    return null;
  }

  async importBank(file, userId, ctx = {}) {
    const content = fileContent(file);
    const filename = file?.originalname || 'bank-import.csv';
    return this.#processImport(content, filename, 'bank', userId, ctx);
  }

  async importPaypal(file, userId, ctx = {}) {
    const content = fileContent(file);
    const filename = file?.originalname || 'paypal-import.csv';
    return this.#processImport(content, filename, 'paypal', userId, ctx);
  }

  async listImports(query = {}) {
    const filter: Record<string, unknown> = {};
    if (query.source) filter.source = query.source;
    if (query.status) filter.status = query.status;
    return this.importBatches.findMany(filter, {
      page: query.page,
      limit: query.limit,
      sort: query.sort || '-createdAt',
    });
  }

  async getImport(id) {
    const batch = await this.importBatches.findById(id);
    if (!batch) throw ApiError.notFound('Import-Batch nicht gefunden');
    return batch;
  }

  /**
   * Re-apply system policies + human rules to non-exported transactions of a batch.
   */
  async reprocess(id, userId, ctx = {}) {
    const batch = await this.getImport(id);
    const policy = await this.#policy();
    const enabledRules = await this.rules.findEnabled();
    const result = await this.transactions.findMany(
      {
        importBatchId: batch._id,
        status: { $nin: ['exported', 'skipped'] },
        bookability: { $ne: 'skipped' },
      },
      { limit: 10000, page: 1 },
    );

    let matchedCount = 0;
    let openCount = 0;
    let conflictCount = 0;
    let skippedCount = 0;

    for (const tx of result.data) {
      if (tx.systemMatched) {
        matchedCount++;
        continue;
      }

      const txLike = {
        source: tx.source,
        amountCents: tx.amountCents,
        counterpartyName: tx.counterpartyName || '',
        counterpartyIban: tx.counterpartyIban || null,
        counterpartyEmail: tx.counterpartyEmail || null,
        purpose: tx.purpose || '',
        article: tx.article || null,
        rawDescription: tx.rawDescription || '',
        paypal: tx.paypal
          ? { type: tx.paypal.type, subject: tx.paypal.subject, note: tx.paypal.note }
          : undefined,
      };

      const clearingResult = detectBankPaypalClearing({
        source: tx.source,
        counterpartyName: txLike.counterpartyName,
        purpose: txLike.purpose,
        rawDescription: txLike.rawDescription,
        amountCents: txLike.amountCents,
        paypalType: tx.paypal?.type || null,
      }, policy);

      if (clearingResult.matched) {
        await this.transactions.update(tx._id, {
          status: 'matched',
          systemMatched: true,
          systemRuleId: clearingResult.systemRuleId,
          booking: {
            konto: clearingResult.konto,
            gegenkonto: clearingResult.gegenkonto,
            buKey: clearingResult.buKey,
            bookingText: clearingResult.bookingText,
            sollHaben: clearingResult.sollHaben,
          },
          matchedRuleIds: [],
          $push: {
            history: {
              action: 'reprocess_system',
              status: 'matched',
              actorLabel: 'System',
              note: clearingResult.note,
            },
          },
        });
        matchedCount++;
        continue;
      }

      const marketplaceResult = detectMarketplacePark(txLike, policy);
      if (!marketplaceResult.matched && marketplaceResult.parkOpen) {
        await this.transactions.update(tx._id, {
          status: 'open',
          booking: {},
          matchedRuleIds: [],
          $push: {
            history: {
              action: 'reprocess_park',
              status: 'open',
              actorLabel: 'System',
              note: marketplaceResult.reason,
            },
          },
        });
        openCount++;
        continue;
      }

      const manualPark = detectManualParkPolicies(txLike, policy);
      if (!manualPark.matched && manualPark.parkOpen) {
        await this.transactions.update(tx._id, {
          status: 'open',
          booking: {},
          matchedRuleIds: [],
          $push: {
            history: {
              action: 'reprocess_park',
              status: 'open',
              actorLabel: 'System',
              note: manualPark.reason,
            },
          },
        });
        openCount++;
        continue;
      }

      const ruleResult = applyHumanRules(txLike, enabledRules, policy);
      if (ruleResult.status === 'matched' && ruleResult.booking) {
        const booking = adjustInventoryGegenkonto(ruleResult.booking, tx.source, policy);
        await this.transactions.update(tx._id, {
          status: 'matched',
          matchedRuleIds: ruleResult.matchedRuleIds,
          booking,
          confidence: ruleResult.confidence,
          $push: {
            history: {
              action: 'reprocess_matched',
              status: 'matched',
              actorLabel: 'System',
              note: 'Regeln neu angewendet',
            },
          },
        });
        matchedCount++;
      } else if (ruleResult.status === 'conflict') {
        await this.transactions.update(tx._id, {
          status: 'conflict',
          matchedRuleIds: ruleResult.matchedRuleIds,
          booking: {},
          $push: {
            history: {
              action: 'reprocess_conflict',
              status: 'conflict',
              actorLabel: 'System',
              note: 'Mehrere Regeln — manuell prüfen',
            },
          },
        });
        conflictCount++;
      } else {
        await this.transactions.update(tx._id, {
          status: 'open',
          matchedRuleIds: [],
          booking: {},
          $push: {
            history: {
              action: 'reprocess_open',
              status: 'open',
              actorLabel: 'System',
              note: 'Keine passende Regel',
            },
          },
        });
        openCount++;
      }
    }

    await this.importBatches.update(batch._id, {
      matchedCount,
      openCount,
      conflictCount,
    });

    await this.audit?.log({
      actor: userId,
      action: 'import.reprocess',
      resource: 'importBatch',
      resourceId: batch._id,
      meta: { matchedCount, openCount, conflictCount, skippedCount },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return {
      batchId: batch._id,
      processed: result.data.length,
      matchedCount,
      openCount,
      conflictCount,
      skippedCount,
    };
  }

  async #processImport(content, filename, source, userId, ctx) {
    const fileHash = sha256(content);
    const policy = await this.#policy();

    const existing = await this.importBatches.findByFileHash(fileHash);
    // Failed prior uploads must not permanently block the same content.
    if (existing && existing.status !== 'failed') {
      return {
        batch: existing,
        status: 'duplicate_file',
        message: 'Diese Datei wurde bereits importiert',
      };
    }
    if (existing?.status === 'failed' && existing._id) {
      // Free the hash so a new attempt can proceed with the same file bytes.
      await this.importBatches.update(existing._id, {
        fileHash: `${fileHash}:superseded:${existing._id}`,
      });
    }

    const parseResult =
      source === 'bank'
        ? parseBankCsv(content)
        : parsePaypalCsv(content, {
            excludeTypes: policy?.paypalExcludeTypes,
            enableExcludeTypes: policy?.enabled?.s1ExcludePaypalTypes !== false,
            enableGuthabenIntegrity: policy?.enabled?.s2GuthabenIntegrity !== false,
          });

    const batch = await this.importBatches.create({
      source,
      filename,
      fileHash,
      uploadedBy: userId,
      periodStart: parseResult.periodStart,
      periodEnd: parseResult.periodEnd,
      rowCount: parseResult.rows.length,
      status: 'processing',
      importErrors: parseResult.errors,
      balanceCheck: (parseResult as any).balanceCheck || null,
    });

    const enabledRules = await this.rules.findEnabled();

    let createdCount = 0;
    let duplicateCount = 0;
    let skippedCount = 0;
    let openCount = 0;
    let matchedCount = 0;
    let conflictCount = 0;
    const duplicateFingerprints: { fingerprint: string; existingId: string; newRow: any }[] = [];

    for (const row of parseResult.rows) {
      const existingTx = await this.transactions.findByFingerprint(row.fingerprint);
      if (existingTx) {
        duplicateCount++;
        duplicateFingerprints.push({
          fingerprint: row.fingerprint,
          existingId: existingTx._id,
          newRow: row,
        });
        continue;
      }

      const txData: Record<string, unknown> = {
        importBatchId: batch._id,
        source,
        fingerprint: row.fingerprint,
        rawRowHash: row.rawRowHash,
        bookingDate: row.bookingDate,
        valueDate: row.valueDate || null,
        amountCents: row.amountCents,
        currency: row.currency || 'EUR',
        counterpartyName: row.counterpartyName || '',
        purpose: row.purpose || '',
        rawDescription: row.rawDescription || '',
        rawRow: row.rawRow,
        status: 'imported',
        booking: {},
        history: [
          {
            action: 'imported',
            status: 'imported',
            actorLabel: 'System',
            note: `Import aus ${source}-CSV: ${filename}`,
          },
        ],
      };

      if (source === 'bank') {
        txData.counterpartyIban = (row as any).counterpartyIban || null;
        txData.bank = {
          bookingText: (row as any).bookingText || null,
          mandateRef: (row as any).mandateRef || null,
          creditorId: (row as any).creditorId || null,
          customerRef: (row as any).customerRef || null,
        };
      }

      if (source === 'paypal') {
        txData.counterpartyEmail = (row as any).counterpartyEmail || null;
        txData.article = (row as any).article || null;
        txData.bookability = (row as any).bookability || 'bookable';
        txData.skipReason = (row as any).skipReason || null;
        txData.paypal = {
          transactionCode: (row as any).transactionCode || null,
          type: (row as any).type || null,
          status: (row as any).status || null,
          feeCents: (row as any).feeCents ?? null,
          relatedTransactionCode: (row as any).relatedTransactionCode || null,
          guthabenAfter: (row as any).guthabenAfter ?? null,
          subject: (row as any).subject || null,
          note: (row as any).note || null,
        };
      }

      if (txData.bookability === 'skipped') {
        txData.status = 'skipped';
        skippedCount++;
        await this.transactions.create(txData);
        continue;
      }

      const tx = await this.transactions.create(txData);
      createdCount++;

      const txLike = {
        source,
        amountCents: row.amountCents,
        counterpartyName: row.counterpartyName || '',
        counterpartyIban: (row as any).counterpartyIban || null,
        counterpartyEmail: (row as any).counterpartyEmail || null,
        purpose: row.purpose || '',
        article: (row as any).article || null,
        rawDescription: row.rawDescription || '',
        paypal: source === 'paypal' ? { type: (row as any).type, subject: (row as any).subject, note: (row as any).note } : undefined,
      };

      const clearingResult = detectBankPaypalClearing({
        source,
        counterpartyName: txLike.counterpartyName,
        purpose: txLike.purpose,
        rawDescription: txLike.rawDescription,
        amountCents: txLike.amountCents,
        paypalType: source === 'paypal' ? (row as any).type : null,
      }, policy);

      if (clearingResult.matched) {
        await this.transactions.update(tx._id, {
          status: 'matched',
          systemMatched: true,
          systemRuleId: clearingResult.systemRuleId,
          booking: {
            konto: clearingResult.konto,
            gegenkonto: clearingResult.gegenkonto,
            buKey: clearingResult.buKey,
            bookingText: clearingResult.bookingText,
            sollHaben: clearingResult.sollHaben,
          },
          $push: {
            history: {
              action: 'system_matched',
              status: 'matched',
              actorLabel: 'System',
              note: clearingResult.note,
            },
          },
        });
        matchedCount++;
        continue;
      }

      const marketplaceResult = detectMarketplacePark(txLike, policy);
      if (!marketplaceResult.matched && (marketplaceResult as any).parkOpen) {
        await this.transactions.update(tx._id, {
          status: 'open',
          $push: {
            history: {
              action: 'marketplace_parked',
              status: 'open',
              actorLabel: 'System',
              note: (marketplaceResult as any).reason,
            },
          },
        });
        openCount++;
        continue;
      }

      const manualPark = detectManualParkPolicies(txLike, policy);
      if (!manualPark.matched && (manualPark as any).parkOpen) {
        await this.transactions.update(tx._id, {
          status: 'open',
          $push: {
            history: {
              action: 'system_parked',
              status: 'open',
              actorLabel: 'System',
              note: (manualPark as any).reason,
            },
          },
        });
        openCount++;
        continue;
      }

      const ruleResult = applyHumanRules(txLike, enabledRules, policy);
      if (ruleResult.status === 'matched' && ruleResult.booking) {
        const booking = adjustInventoryGegenkonto(ruleResult.booking, source, policy);
        await this.transactions.update(tx._id, {
          status: 'matched',
          matchedRuleIds: ruleResult.matchedRuleIds,
          booking,
          confidence: ruleResult.confidence,
          $push: {
            history: {
              action: 'rule_matched',
              status: 'matched',
              actorLabel: 'System',
              note: `Regel-Match: ${ruleResult.matchedRuleIds.join(', ')}`,
            },
          },
        });
        matchedCount++;
      } else if (ruleResult.status === 'conflict') {
        await this.transactions.update(tx._id, {
          status: 'conflict',
          matchedRuleIds: ruleResult.matchedRuleIds,
          $push: {
            history: {
              action: 'rule_conflict',
              status: 'conflict',
              actorLabel: 'System',
              note: `Regelkonflikt: ${ruleResult.matchedRuleIds.length} Regeln treffen zu`,
            },
          },
        });
        conflictCount++;
      } else {
        await this.transactions.update(tx._id, {
          status: 'open',
          $push: {
            history: {
              action: 'no_rule_match',
              status: 'open',
              actorLabel: 'System',
              note: 'Keine passende Regel gefunden',
            },
          },
        });
        openCount++;
      }
    }

    if (duplicateFingerprints.length > 0) {
      const existingIds = duplicateFingerprints.map((d) => d.existingId);
      await this.duplicateGroups.create({
        kind: 'fingerprint',
        transactionIds: existingIds,
        reason: `Re-Upload: ${filename} — ${duplicateFingerprints.length} Duplikat(e)`,
        status: 'open',
      });
    }

    const batchStatus = parseResult.errors.length > 0 && createdCount === 0 ? 'failed' : 'completed';
    await this.importBatches.update(batch._id, {
      status: batchStatus,
      createdCount,
      duplicateCount,
      skippedCount,
      openCount,
      matchedCount,
      conflictCount,
    });

    await this.audit?.log({
      actor: userId,
      action: 'import.create',
      resource: 'importBatch',
      resourceId: batch._id,
      meta: { source, filename, createdCount, duplicateCount, matchedCount, openCount, conflictCount },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    const finalBatch = await this.importBatches.findById(batch._id);
    return { batch: finalBatch, status: batchStatus };
  }
}

export default ImportService;
