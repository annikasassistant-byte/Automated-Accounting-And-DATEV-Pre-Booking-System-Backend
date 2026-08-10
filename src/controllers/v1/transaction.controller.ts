import { container } from '../../di/container.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

function requestContext(req) {
  return {
    userId: req.user?._id || req.user?.id,
    userName: req.user?.firstName || req.user?.email,
    ip: req.ip || req.socket?.remoteAddress,
    userAgent: req.get('user-agent'),
  };
}

export const listTransactions = asyncHandler(async (req, res) => {
  const result = await container.transactionService.list(req.query);
  return ApiResponse.paginated(res, result.data, result.pagination);
});

export const getTransaction = asyncHandler(async (req, res) => {
  const tx = await container.transactionService.getById(req.params.id);
  return ApiResponse.ok(res, tx);
});

export const listOpen = asyncHandler(async (req, res) => {
  const result = await container.transactionService.listOpen(req.query);
  return ApiResponse.paginated(res, result.data, result.pagination);
});

export const listConflicts = asyncHandler(async (req, res) => {
  const result = await container.transactionService.listConflicts(req.query);
  return ApiResponse.paginated(res, result.data, result.pagination);
});

export const applyRules = asyncHandler(async (req, res) => {
  const ids = req.body?.ids || null;
  const result = await container.transactionService.applyRules(ids, requestContext(req));
  return ApiResponse.ok(res, result, 'Regeln angewendet');
});

export const assignTransaction = asyncHandler(async (req, res) => {
  const tx = await container.transactionService.assign(req.params.id, req.body, requestContext(req));
  return ApiResponse.ok(res, tx, 'Transaktion zugewiesen');
});

export const bulkAssign = asyncHandler(async (req, res) => {
  const results = await container.transactionService.bulkAssign(req.body.items, requestContext(req));
  return ApiResponse.ok(res, results, 'Transaktionen zugewiesen');
});

export const setTransactionStatus = asyncHandler(async (req, res) => {
  const tx = await container.transactionService.setStatus(req.params.id, req.body.status, requestContext(req));
  return ApiResponse.ok(res, tx, 'Status aktualisiert');
});

export const bulkStatus = asyncHandler(async (req, res) => {
  const results = await container.transactionService.bulkStatus(req.body.ids, req.body.status, requestContext(req));
  return ApiResponse.ok(res, results, 'Status aktualisiert');
});

export const createRuleFromTransaction = asyncHandler(async (req, res) => {
  const tx = await container.transactionService.getById(req.params.id);
  const body = req.body || {};
  const purposeToken = String(tx.purpose || tx.rawDescription || tx.counterpartyName || '')
    .trim()
    .slice(0, 80);
  const name =
    body.name ||
    tx.counterpartyName ||
    purposeToken ||
    `Regel ${String(tx._id || tx.id).slice(-6)}`;

  const conditions =
    Array.isArray(body.conditions) && body.conditions.length
      ? body.conditions
      : [
          {
            field: purposeToken ? 'purpose' : 'counterpartyName',
            operator: 'contains',
            value: purposeToken || tx.counterpartyName || 'TODO',
            caseSensitive: false,
          },
        ];

  const defaultGegen = tx.source === 'paypal' ? '1203' : '1201';
  const actions = body.actions || {
    konto: body.konto || tx.booking?.konto,
    gegenkonto: body.gegenkonto || tx.booking?.gegenkonto || defaultGegen,
    buKey: body.buKey ?? tx.booking?.buKey ?? '',
    bookingTextTemplate: body.bookingTextTemplate || null,
  };

  if (!actions.konto || !actions.gegenkonto) {
    throw ApiError.badRequest('Konto und Gegenkonto sind erforderlich');
  }

  const rule = await container.ruleService.create(
    {
      name,
      enabled: body.enabled !== false,
      priority: body.priority ?? 100,
      conditions,
      actions,
      source: 'manual',
    },
    requestContext(req),
  );

  return ApiResponse.created(res, rule, 'Regel aus Transaktion erstellt');
});

export default {
  listTransactions,
  getTransaction,
  listOpen,
  listConflicts,
  applyRules,
  assignTransaction,
  bulkAssign,
  setTransactionStatus,
  bulkStatus,
  createRuleFromTransaction,
};
