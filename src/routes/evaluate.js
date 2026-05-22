import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/requireAuth.js';
import { submitAndEvaluate } from '../controllers/evaluateController.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter(_req, file, cb) {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted'));
    }
  },
});

const router = Router();

// POST /evaluate  — submit a script PDF for evaluation (requires valid JWT)
router.post('/', requireAuth, upload.single('script'), submitAndEvaluate);

export default router;
