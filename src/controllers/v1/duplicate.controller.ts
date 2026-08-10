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

export const listDuplicates = asyncHandler(async (req, res) => {
  const result = await container.duplicateService.listOpen(req.query);
  return ApiResponse.paginated(res, result.data, result.pagination);
});

export const resolveDuplicate = asyncHandler(async (req, res) => {
  const group = await container.duplicateService.resolve(
    req.params.id, req.body.action, requestContext(req),
  );
  return ApiResponse.ok(res, group, 'Duplikat aufgelöst');
});

export default {
  listDuplicates,
  resolveDuplicate,
};
