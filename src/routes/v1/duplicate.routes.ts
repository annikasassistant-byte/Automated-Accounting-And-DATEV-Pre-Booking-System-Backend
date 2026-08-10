import { Router } from 'express';
import * as duplicateController from '../../controllers/v1/duplicate.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/', duplicateController.listDuplicates);
router.post('/:id/resolve', duplicateController.resolveDuplicate);

export default router;
