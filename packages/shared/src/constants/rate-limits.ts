/**
 * API rate limit tiers (from 03-api-contracts.md Section 1)
 */
export const RATE_LIMIT_TIERS = {
  STRICT: { max: 10, window: 60 },    // Auth endpoints
  LOW: { max: 30, window: 60 },       // Write operations
  MEDIUM: { max: 100, window: 60 },   // Read operations
  HIGH: { max: 300, window: 60 },     // Frequent reads
  BULK: { max: 1000, window: 60 },    // Search, autocomplete
} as const;

export type RateLimitTier = keyof typeof RATE_LIMIT_TIERS;
