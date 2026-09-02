import { Router } from 'express';
import * as accrualController from '../../controllers/v1/accrual.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import { ROLES } from '../../enums/roles.js';

const router = Router();

router.use(authenticate);

router.get('/inbox', accrualController.getInbox);

router.get('/events', accrualController.listEvents);
router.get('/events/:id', accrualController.getEvent);

router.get('/exceptions', accrualController.listExceptions);
router.patch('/exceptions/:id', accrualController.patchException);

router.get('/clearing', accrualController.getClearingConfig);
router.get('/clearing/:marketplace', accrualController.getMarketplaceClearing);
router.patch('/clearing', authorize(ROLES.ADMIN), accrualController.patchClearingConfig);

router.get('/journal', accrualController.listJournal);
router.get('/journal/:id', accrualController.getJournal);
router.post('/journal/build/:eventId', authorize(ROLES.ADMIN), accrualController.buildJournalDraft);
router.post('/journal/:id/post', authorize(ROLES.ADMIN), accrualController.postJournal);

router.get('/tax-codes', accrualController.listTaxCodes);
router.post('/tax-codes', authorize(ROLES.ADMIN), accrualController.upsertTaxCode);

export default router;
