export class AppError extends Error {
  constructor(message, statusCode, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // CORS errors arrive here from the cors middleware callback
  if (err.message?.startsWith('CORS:')) {
    return res.status(403).json({ error: err.message });
  }

  if (err.isOperational) {
    const body = { error: err.message };
    if (err.code) body.code = err.code;
    return res.status(err.statusCode).json(body);
  }

  // Multer file size limit
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large — maximum size is 20MB' });
  }

  // Multer fileFilter rejection — a client mistake, not a server fault
  if (err.message === 'Only PDF files are accepted') {
    return res.status(400).json({ error: err.message });
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'An unexpected error occurred' });
}
