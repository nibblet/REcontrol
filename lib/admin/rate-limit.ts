/**
 * Rate limiting for admin write operations
 * Simple in-memory implementation (10 writes/minute per admin)
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

// In-memory store (consider Redis for production multi-instance deployments)
const rateLimitStore = new Map<string, RateLimitEntry>()

const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10

/**
 * Check if user has exceeded rate limit
 * @param userId User ID to check
 * @returns { allowed: boolean, remaining: number, resetAt: number }
 */
export function checkRateLimit(userId: string): {
  allowed: boolean
  remaining: number
  resetAt: number
} {
  const now = Date.now()
  const entry = rateLimitStore.get(userId)

  // No entry or window expired - allow and create new entry
  if (!entry || now > entry.resetAt) {
    const resetAt = now + RATE_LIMIT_WINDOW_MS
    rateLimitStore.set(userId, { count: 1, resetAt })
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
      resetAt,
    }
  }

  // Within window - check count
  if (entry.count < RATE_LIMIT_MAX_REQUESTS) {
    entry.count += 1
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - entry.count,
      resetAt: entry.resetAt,
    }
  }

  // Exceeded limit
  return {
    allowed: false,
    remaining: 0,
    resetAt: entry.resetAt,
  }
}

/**
 * Cleanup expired entries (run periodically)
 */
export function cleanupRateLimitStore() {
  const now = Date.now()
  for (const [userId, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(userId)
    }
  }
}

// Cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupRateLimitStore, 5 * 60 * 1000)
}
