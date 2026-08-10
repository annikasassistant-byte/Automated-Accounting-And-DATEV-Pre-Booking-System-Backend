import { Router } from 'express';
import * as suggestionController from '../../controllers/v1/suggestion.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import { ROLES } from '../../enums/roles.js';

const router = Router();

router.use(authenticate);

router.post('/analyze', authorize(ROLES.ADMIN), suggestionController.analyzePatterns);

export default router;
