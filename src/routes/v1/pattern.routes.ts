import { Router } from 'express';
import * as suggestionController from '../../controllers/v1/suggestion.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import { uploadSingleMemory, requireFile } from '../../middlewares/upload.middleware.js';
import { ROLES } from '../../enums/roles.js';

const router = Router();

router.use(authenticate);

router.post('/analyze', authorize(ROLES.ADMIN), suggestionController.analyzePatterns);
router.post(
  '/lexoffice',
  authorize(ROLES.ADMIN),
  uploadSingleMemory('file'),
  requireFile('file'),
  suggestionController.seedLexoffice,
);

export default router;
