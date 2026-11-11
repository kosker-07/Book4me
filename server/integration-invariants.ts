/** External supplier retry policy for transient failures only. */
export function isRetryableSupplierStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}
export function supplierRetryDelayMs(attempt: number, retryAfterMs?: number): number {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > 8) throw new Error("INVALID_RETRY_ATTEMPT");
  if (retryAfterMs !== undefined) {
    if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0) throw new Error("INVALID_RETRY_AFTER");
    return Math.min(30000, Math.ceil(retryAfterMs));
  }
  return Math.min(30000, 500 * 2 ** attempt);
}
