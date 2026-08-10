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

export const importBank = asyncHandler(async (req, res) => {
  const ctx = requestContext(req);
  const file = req.file || req.body;
  const result = await container.importService.importBank(file, ctx.userId, ctx);
  if (result.status === 'duplicate_file') {
    return ApiResponse.ok(res, result, result.message);
  }
  return ApiResponse.created(res, result);
});

export const importPaypal = asyncHandler(async (req, res) => {
  const ctx = requestContext(req);
  const file = req.file || req.body;
  const result = await container.importService.importPaypal(file, ctx.userId, ctx);
  if (result.status === 'duplicate_file') {
    return ApiResponse.ok(res, result, result.message);
  }
  return ApiResponse.created(res, result);
});

export const listImports = asyncHandler(async (req, res) => {
  const result = await container.importService.listImports(req.query);
  return ApiResponse.paginated(res, result.data, result.pagination);
});

export const getImport = asyncHandler(async (req, res) => {
  const batch = await container.importService.getImport(req.params.id);
  return ApiResponse.ok(res, batch);
});

export const reprocessImport = asyncHandler(async (req, res) => {
  const ctx = requestContext(req);
  const result = await container.importService.reprocess(req.params.id, ctx.userId, ctx);
  return ApiResponse.ok(res, result, 'Import neu verarbeitet');
});

export default {
  importBank,
  importPaypal,
  listImports,
  getImport,
  reprocessImport,
};
