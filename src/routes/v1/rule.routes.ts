import { Router } from 'express';
import * as ruleController from '../../controllers/v1/rule.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import { ROLES } from '../../enums/roles.js';

const router = Router();

router.use(authenticate);

router.get('/', ruleController.listRules);
router.post('/', authorize(ROLES.ADMIN), ruleController.createRule);
router.post('/test', ruleController.testRule);
router.post('/seed-optional', authorize(ROLES.ADMIN), ruleController.seedOptionalRule);
router.get('/:id', ruleController.getRule);
router.patch('/:id', authorize(ROLES.ADMIN), ruleController.updateRule);
router.delete('/:id', authorize(ROLES.ADMIN), ruleController.deleteRule);
router.post('/:id/enable', authorize(ROLES.ADMIN), ruleController.enableRule);
router.post('/:id/disable', authorize(ROLES.ADMIN), ruleController.disableRule);

export default router;
