import { container } from '../../di/container.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

function requestContext(req) {
  return {
    userId: req.user?._id || req.user?.id,
    userName: req.user?.firstName || req.user?.email,
    ip: req.ip || req.socket?.remoteAddress,
    userAgent: req.get('user-agent'),
  };
}

export const listRules = asyncHandler(async (req, res) => {
  const result = await container.ruleService.list(req.query);
  return ApiResponse.paginated(res, result.data, result.pagination);
});

export const getRule = asyncHandler(async (req, res) => {
  const rule = await container.ruleService.getById(req.params.id);
  return ApiResponse.ok(res, rule);
});

export const createRule = asyncHandler(async (req, res) => {
  const rule = await container.ruleService.create(req.body, requestContext(req));
  return ApiResponse.created(res, rule);
});

export const updateRule = asyncHandler(async (req, res) => {
  const rule = await container.ruleService.update(req.params.id, req.body, requestContext(req));
  return ApiResponse.ok(res, rule, 'Regel aktualisiert');
});

export const deleteRule = asyncHandler(async (req, res) => {
  const result = await container.ruleService.remove(req.params.id, requestContext(req));
  return ApiResponse.ok(res, result, 'Regel gelöscht');
});

export const enableRule = asyncHandler(async (req, res) => {
  const rule = await container.ruleService.enable(req.params.id, requestContext(req));
  return ApiResponse.ok(res, rule, 'Regel aktiviert');
});

export const disableRule = asyncHandler(async (req, res) => {
  const rule = await container.ruleService.disable(req.params.id, requestContext(req));
  return ApiResponse.ok(res, rule, 'Regel deaktiviert');
});

export const testRule = asyncHandler(async (req, res) => {
  const result = await container.ruleService.testDryRun(req.body, requestContext(req));
  return ApiResponse.ok(res, result);
});

export const seedOptionalRule = asyncHandler(async (req, res) => {
  const rule = await container.ruleService.seedOptional(requestContext(req));
  return ApiResponse.ok(res, rule, 'Inventar-Regel erstellt/vorhanden');
});

export default {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  enableRule,
  disableRule,
  testRule,
  seedOptionalRule,
};
