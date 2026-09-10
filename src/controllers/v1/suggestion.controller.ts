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

export const listSuggestions = asyncHandler(async (req, res) => {
  const result = await container.suggestionService.listPending(req.query);
  return ApiResponse.paginated(res, result.data, result.pagination);
});

export const acceptSuggestion = asyncHandler(async (req, res) => {
  const result = await container.suggestionService.accept(req.params.id, requestContext(req));
  return ApiResponse.ok(res, result, 'Vorschlag angenommen');
});

export const rejectSuggestion = asyncHandler(async (req, res) => {
  const result = await container.suggestionService.reject(req.params.id, requestContext(req));
  return ApiResponse.ok(res, result, 'Vorschlag abgelehnt');
});

export const analyzePatterns = asyncHandler(async (req, res) => {
  const result = await container.suggestionService.analyzePatterns(requestContext(req));
  return ApiResponse.ok(res, result, 'Musteranalyse abgeschlossen');
});

export const seedLexoffice = asyncHandler(async (req, res) => {
  const file = req.file;
  const content = file?.buffer
    ? file.buffer.toString('utf8')
    : typeof req.body?.content === 'string'
      ? req.body.content
      : '';
  const result = await container.suggestionService.seedFromLexofficeDatev(content, requestContext(req));
  return ApiResponse.ok(res, result, 'LexOffice-Vorschläge erzeugt');
});

export default {
  listSuggestions,
  acceptSuggestion,
  rejectSuggestion,
  analyzePatterns,
  seedLexoffice,
};
