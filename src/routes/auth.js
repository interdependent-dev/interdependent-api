import { Router } from 'express';
import { verifyPasscode } from '../controllers/authController.js';

const router = Router();

// POST /auth/verify  — exchange a 4-digit passcode for a JWT
router.post('/verify', verifyPasscode);

export default router;
