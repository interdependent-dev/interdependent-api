export class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
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
    return res.status(err.statusCode).json({ error: err.message });
  }

  // Multer file size limit
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large — maximum size is 20MB' });
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'An unexpected error occurred' });
}
