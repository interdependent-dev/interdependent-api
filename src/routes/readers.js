import { Router } from 'express';
import {
  registerBegin,
  registerComplete,
  authBegin,
  authComplete,
  getReader,
} from '../controllers/readerController.js';

const router = Router();

// Registration — new reader + first passkey
router.post('/register/begin', registerBegin);
router.post('/register/complete', registerComplete);

// Authentication — returning reader, get action token
router.post('/auth/begin', authBegin);
router.post('/auth/complete', authComplete);

// Public reader profile
router.get('/:handle', getReader);

export default router;
