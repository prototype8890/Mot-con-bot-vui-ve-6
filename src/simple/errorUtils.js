const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Execute an async function with retry logic and exponential backoff.
 * @template T
 * @param {() => Promise<T>} fn - Function to execute
 * @param {{
 *   retries?: number,
 *   baseDelayMs?: number,
 *   maxDelayMs?: number,
 *   backoffFactor?: number,
 *   jitter?: number,
 *   onError?: (error: Error, attempt: number) => void
 * }} [options]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, options = {}) {
  const {
    retries = 3,
    baseDelayMs = 200,
    maxDelayMs = 5000,
    backoffFactor = 2,
    jitter = 0.25,
    onError
  } = options;

  let attempt = 0;
  let lastError;

  while (attempt <= retries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (onError) {
        try { onError(error, attempt); } catch {}
      }

      if (attempt === retries) {
        throw error;
      }

      const delayBase = Math.min(baseDelayMs * (backoffFactor ** attempt), maxDelayMs);
      const jitterOffset = delayBase * jitter * (Math.random() - 0.5) * 2;
      const delay = Math.max(50, delayBase + jitterOffset);
      await sleep(delay);
      attempt += 1;
    }
  }

  throw lastError || new Error('Operation failed without throwing.');
}

export async function raceWithTimeout(promise, timeoutMs, timeoutMessage = 'Operation timed out') {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutHandle);
    return result;
  } catch (error) {
    clearTimeout(timeoutHandle);
    throw error;
  }
}

