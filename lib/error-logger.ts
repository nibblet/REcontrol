/**
 * Client-side error logging for REcontrol
 * Captures errors and logs them for debugging
 */

export interface ErrorLog {
  timestamp: string
  message: string
  stack?: string
  context?: Record<string, unknown>
  userAgent: string
  url: string
}

/**
 * Log an error to console and optionally to a remote service
 */
export function logError(
  error: Error | string,
  context?: Record<string, unknown>
): void {
  const errorLog: ErrorLog = {
    timestamp: new Date().toISOString(),
    message: typeof error === 'string' ? error : error.message,
    stack: typeof error === 'string' ? undefined : error.stack,
    context,
    userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'unknown',
    url: typeof window !== 'undefined' ? window.location.href : 'unknown',
  }

  // Log to console
  console.error('[REcontrol Error]', errorLog)

  // TODO: Send to error tracking service (Sentry, LogRocket, etc.)
  // sendToErrorTrackingService(errorLog)

  // Store in session storage for debugging (last 10 errors)
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const stored = sessionStorage.getItem('recontrol_errors')
      const errors: ErrorLog[] = stored ? JSON.parse(stored) : []
      errors.push(errorLog)

      // Keep only last 10 errors
      const recentErrors = errors.slice(-10)
      sessionStorage.setItem('recontrol_errors', JSON.stringify(recentErrors))
    } catch (e) {
      // Ignore storage errors
    }
  }
}

/**
 * Get recent errors from session storage
 */
export function getRecentErrors(): ErrorLog[] {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return []
  }

  try {
    const stored = sessionStorage.getItem('recontrol_errors')
    return stored ? JSON.parse(stored) : []
  } catch (e) {
    return []
  }
}

/**
 * Clear error log
 */
export function clearErrorLog(): void {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    sessionStorage.removeItem('recontrol_errors')
  }
}
