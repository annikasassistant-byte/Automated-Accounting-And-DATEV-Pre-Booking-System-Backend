import { ApiError } from '../../utils/ApiError.js';

export class DuplicateService {
  constructor(deps) {
    this.duplicateGroups = deps.duplicateGroupRepository;
    this.transactions = deps.transactionRepository;
    this.audit = deps.auditRepository;
  }

  async listOpen(query = {}) {
    return this.duplicateGroups.findMany(
      { status: 'open' },
      {
        page: query.page,
        limit: query.limit,
        sort: '-createdAt',
        populate: { path: 'transactionIds', select: 'fingerprint bookingDate amountCents counterpartyName purpose status' },
      },
    );
  }

  async resolve(id, action, ctx = {}) {
    const group = await this.duplicateGroups.findById(id);
    if (!group) throw ApiError.notFound('Duplikatgruppe nicht gefunden');
    if (group.status !== 'open') {
      throw ApiError.badRequest('Duplikatgruppe ist bereits aufgelöst');
    }

    const validActions = ['merge', 'ignore', 'keep_both'];
    if (!validActions.includes(action)) {
      throw ApiError.badRequest(`Ungültige Aktion: ${action}. Erlaubt: ${validActions.join(', ')}`);
    }

    let statusUpdate: string;
    if (action === 'merge') {
      statusUpdate = 'merged';
      const txIds = group.transactionIds || [];
      if (txIds.length > 1) {
        for (let i = 1; i < txIds.length; i++) {
          await this.transactions.update(txIds[i], {
            isDuplicate: true,
            duplicateOfId: txIds[0],
            status: 'skipped',
            $push: {
              history: {
                action: 'duplicate_merged',
                status: 'skipped',
                actor: ctx.userId,
                actorLabel: ctx.userName || 'User',
                note: `Als Duplikat von ${txIds[0]} zusammengeführt`,
              },
            },
          });
        }
      }
    } else if (action === 'ignore') {
      statusUpdate = 'ignored';
    } else {
      statusUpdate = 'keep_both';
    }

    await this.duplicateGroups.update(id, {
      status: statusUpdate,
      resolvedBy: ctx.userId,
      resolvedAt: new Date(),
    });

    await this.audit?.log({
      actor: ctx.userId,
      action: 'duplicate.resolve',
      resource: 'duplicateGroup',
      resourceId: id,
      meta: { action, status: statusUpdate },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return await this.duplicateGroups.findById(id);
  }
}

export default DuplicateService;
