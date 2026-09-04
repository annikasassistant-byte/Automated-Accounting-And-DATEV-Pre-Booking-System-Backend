import { Router } from 'express';
import * as datevExportController from '../../controllers/v1/datevExport.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import { ROLES } from '../../enums/roles.js';

const router = Router();

router.use(authenticate);

router.post('/datev/preview', datevExportController.previewExport);
router.post('/datev/validate', datevExportController.validateExport);
router.post('/datev', authorize(ROLES.ADMIN), datevExportController.createExport);
router.get('/', datevExportController.listExports);
router.get('/:id/download', datevExportController.downloadExport);

export default router;
