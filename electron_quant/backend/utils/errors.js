class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = Number(status || 500);
    this.details = details;
  }
}

function toErrorPayload(error) {
  if (!error) return { error: 'Unknown error' };
  if (error instanceof ApiError) {
    return {
      error: error.message,
      details: error.details || null
    };
  }
  return {
    error: String(error.message || error)
  };
}

module.exports = {
  ApiError,
  toErrorPayload
};
