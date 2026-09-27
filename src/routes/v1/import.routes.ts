import { Router } from 'express';
import * as importController from '../../controllers/v1/import.controller.js';
import * as accrualController from '../../controllers/v1/accrual.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import { uploadSingleMemory, requireFile } from '../../middlewares/upload.middleware.js';
import { ROLES } from '../../enums/roles.js';

const router = Router();

router.use(authenticate);

router.post(
  '/bank',
  uploadSingleMemory('file'),
  requireFile('file'),
  importController.importBank,
);

router.post(
  '/paypal',
  uploadSingleMemory('file'),
  requireFile('file'),
  importController.importPaypal,
);

router.post(
  '/jtl',
  uploadSingleMemory('file'),
  requireFile('file'),
  accrualController.importJtl,
);

router.post(
  '/marketplace/:channel',
  uploadSingleMemory('file'),
  requireFile('file'),
  accrualController.importMarketplace,
);

router.get('/', importController.listImports);
router.get('/:id', importController.getImport);
router.post('/:id/reprocess', importController.reprocessImport);
router.post('/:id/fail', authorize(ROLES.ADMIN), importController.failImport);
router.post('/:id/retry', authorize(ROLES.ADMIN), importController.retryImport);

export default router;
