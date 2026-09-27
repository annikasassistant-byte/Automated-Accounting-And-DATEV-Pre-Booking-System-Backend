import { ApiError } from '../../../utils/ApiError.js';
import {
  buildAccrualDatevExtf,
  validateDatevRows,
  type AccrualDatevLineInput,
} from '../../../helpers/accounting/accrual/accrual-datev-extf.js';
import AccrualDatevExportJob from '../../../models/accrual/accrualDatevExportJob.model.js';

/**
 * Accrual DATEV export — locks JournalLines only. Never touches Transaction / cash ExportItem.
 */
export class AccrualDatevExportService {
  constructor(deps: {
    journalEntryRepository: any;
    journalLineRepository: any;
    companySettingsRepository: any;
    settingsService?: any;
    auditRepository?: any;
  }) {
    this.entries = deps.journalEntryRepository;
    this.lines = deps.journalLineRepository;
    this.companySettings = deps.companySettingsRepository;
    this.policySettings = deps.settingsService;
    this.audit = deps.auditRepository;
  }

  entries;
  lines;
  companySettings;
  policySettings;
  audit;

  async #settings() {
    const doc = await this.companySettings.getOrCreateDefault?.()
      || (await this.companySettings.findOne?.({}))
      || {};
    return {
      advisorNumber: doc.advisorNumber || doc.datev?.advisorNumber || '',
      clientNumber: doc.clientNumber || doc.datev?.clientNumber || '',
    };
  }

  async #forbiddenCollectives() {
    if (this.policySettings?.getSystemPolicyConfig) {
      const policy = await this.policySettings.getSystemPolicyConfig();
      if (policy?.enabled?.s12ForbiddenCollectives === false) return [];
      return policy?.accounts?.forbiddenCollectives || ['10001', '70002'];
    }
    return ['10001', '70002'];
  }

  async #gatherExportable(from: string, to: string) {
    const filter: Record<string, unknown> = {
      status: 'posted',
      postingDate: {
        $gte: new Date(from),
        $lte: new Date(`${to}T23:59:59.000Z`),
      },
    };
    const entries = await this.entries.findMany(filter, {
      limit: 5000,
      page: 1,
      sort: 'postingDate',
    });

    const lineInputs: AccrualDatevLineInput[] = [];
    const journalEntryIds: string[] = [];
    const journalLineIds: string[] = [];
    const entryDocs: any[] = [];

    for (const entry of entries.data || []) {
      const journalLines = await this.lines.findByJournalEntryId(entry._id);
      const unexported = (journalLines || []).filter((l: any) => !l.exportedAt && !l.exportJobId);
      if (!unexported.length) continue;
      journalEntryIds.push(entry._id);
      entryDocs.push(entry);
      for (const line of unexported) {
        journalLineIds.push(line._id);
        lineInputs.push({
          amountCents: line.amountCents,
          sollHaben: line.sollHaben,
          accountNumber: line.accountNumber,
          buKey: line.buKey,
          postingDate: line.postingDate || entry.postingDate,
          documentReference: line.documentReference || entry.description || '',
          bookingText: line.bookingText || '',
        });
      }
    }

    return { lineInputs, journalEntryIds, journalLineIds, entryDocs, settings: await this.#settings() };
  }

  async preview(from: string, to: string) {
    if (!from || !to) throw ApiError.badRequest('from und to sind erforderlich');
    const { lineInputs, settings } = await this.#gatherExportable(from, to);
    const built = buildAccrualDatevExtf(lineInputs, {
      advisorNumber: settings.advisorNumber,
      clientNumber: settings.clientNumber,
      periodStart: new Date(from),
      periodEnd: new Date(to),
      description: 'Accrual Buchungsstapel (Vorschau)',
    });
    const validation = validateDatevRows(built.rows, await this.#forbiddenCollectives());
    return {
      rowCount: built.rowCount,
      from,
      to,
      validation,
      samples: built.rows.slice(0, 20),
      settings,
      note: 'Accrual-DATEV-Vorschau — sperrt keine Cash-Transaktionen',
    };
  }

  async validate(from: string, to: string) {
    if (!from || !to) throw ApiError.badRequest('from und to sind erforderlich');
    const { lineInputs } = await this.#gatherExportable(from, to);
    const built = buildAccrualDatevExtf(lineInputs, {
      advisorNumber: '',
      clientNumber: '',
      periodStart: new Date(from),
      periodEnd: new Date(to),
    });
    const validation = validateDatevRows(built.rows, await this.#forbiddenCollectives());
    return {
      valid: validation.errors.length === 0,
      rowCount: built.rowCount,
      validation,
    };
  }

  async create(from: string, to: string, userId: string, ctx: Record<string, unknown> = {}) {
    if (!from || !to) throw ApiError.badRequest('from und to sind erforderlich');
    const { lineInputs, journalEntryIds, journalLineIds, entryDocs, settings } =
      await this.#gatherExportable(from, to);

    if (!lineInputs.length) {
      throw ApiError.badRequest('Keine exportierbaren Accrual-Journalzeilen im Zeitraum');
    }

    const built = buildAccrualDatevExtf(lineInputs, {
      advisorNumber: settings.advisorNumber,
      clientNumber: settings.clientNumber,
      periodStart: new Date(from),
      periodEnd: new Date(to),
      description: 'Accrual Buchungsstapel',
    });
    const validation = validateDatevRows(built.rows, await this.#forbiddenCollectives());
    if (validation.errors.length > 0) {
      throw ApiError.badRequest('Accrual-DATEV-Validierung fehlgeschlagen', validation.errors);
    }

    const totalsByAccount: Record<string, number> = {};
    for (const r of built.rows) {
      totalsByAccount[r.konto] = (totalsByAccount[r.konto] || 0) + Math.abs(r.amountCents);
      if (r.gegenkonto) {
        totalsByAccount[r.gegenkonto] = (totalsByAccount[r.gegenkonto] || 0) + Math.abs(r.amountCents);
      }
    }

    const job = await AccrualDatevExportJob.create({
      periodType: 'custom',
      periodStart: new Date(from),
      periodEnd: new Date(to),
      fileName: built.fileName.replace('EXTF_Buchungsstapel_', 'EXTF_Accrual_'),
      fileHash: built.fileHash,
      fileContent: built.content,
      encoding: 'cp1252',
      rowCount: built.rowCount,
      checksum: built.fileHash,
      totalsByAccount,
      validationResults: { errors: [], warnings: validation.warnings, passed: true },
      journalEntryIds,
      journalLineIds,
      createdByUser: userId,
      status: 'created',
    });

    const now = new Date();
    for (const lineId of journalLineIds) {
      await this.lines.update(lineId, {
        exportedAt: now,
        exportJobId: job._id,
      });
    }
    for (const entry of entryDocs) {
      await this.entries.update(entry._id, {
        status: 'exported',
        exportedInBatchId: job._id,
      });
    }

    await this.audit?.log({
      actor: userId,
      action: 'accrual.datev.create',
      resource: 'accrualDatevExportJob',
      resourceId: job._id,
      meta: { rowCount: built.rowCount, from, to },
      ip: (ctx as any).ip,
      userAgent: (ctx as any).userAgent,
    });

    return job;
  }

  async listJobs(query: Record<string, unknown> = {}) {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 50, 200);
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      AccrualDatevExportJob.find({ ...filter, isDeleted: { $ne: true } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-fileContent')
        .lean(),
      AccrualDatevExportJob.countDocuments({ ...filter, isDeleted: { $ne: true } }),
    ]);
    return {
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
  }

  async getDownload(jobId: string) {
    const job = await AccrualDatevExportJob.findById(jobId);
    if (!job || job.isDeleted) throw ApiError.notFound('Accrual-DATEV-Job nicht gefunden');
    if (!job.fileContent) throw ApiError.badRequest('Keine Dateiinhalt für diesen Job');
    return {
      fileName: job.fileName,
      content: job.fileContent,
      encoding: job.encoding || 'cp1252',
    };
  }
}

export default AccrualDatevExportService;
