import { Router } from 'express';
import * as accountController from '../../controllers/v1/account.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import { uploadSingleMemory, requireFile } from '../../middlewares/upload.middleware.js';
import { ROLES } from '../../enums/roles.js';

const router = Router();

router.use(authenticate);

router.get('/', accountController.listAccounts);
router.post('/', authorize(ROLES.ADMIN), accountController.createAccount);
router.patch('/:id', authorize(ROLES.ADMIN), accountController.updateAccount);
router.post('/seed', authorize(ROLES.ADMIN), accountController.seedAccounts);
router.post(
  '/import-csv',
  authorize(ROLES.ADMIN),
  uploadSingleMemory('file'),
  requireFile('file'),
  accountController.importAccountsCsv,
);
router.get('/export-csv', accountController.exportAccountsCsv);
router.get('/overview', accountController.accountOverview);

export default router;
