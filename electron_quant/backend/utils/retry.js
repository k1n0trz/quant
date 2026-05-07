async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryWithBackoff(task, options = {}) {
  const retries = Math.max(0, Number(options.retries ?? 2));
  const baseDelayMs = Math.max(50, Number(options.baseDelayMs ?? 250));
  const factor = Math.max(1, Number(options.factor ?? 2));
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await wait(baseDelayMs * (factor ** attempt));
    }
  }

  throw lastError;
}

module.exports = {
  retryWithBackoff
};
