export interface SqliteRetryOptions {
  retries: number;
  delayMs: number;
}

export async function withSqliteRetry<T>(
  operation: () => Promise<T>,
  options: SqliteRetryOptions = { retries: 3, delayMs: 100 }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isSqliteLockError(error) || attempt >= options.retries) {
        throw error;
      }
      await sleep(options.delayMs * (attempt + 1));
    }
  }
  throw lastError;
}

function isSqliteLockError(error: unknown) {
  return error instanceof Error && /database is locked|SQLITE_BUSY/i.test(error.message);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
