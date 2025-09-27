export type ClaudePlan = 'auto' | 'pro' | 'max-5x' | 'max-20x'

const PLAN_ALIASES: Record<string, ClaudePlan> = {
  auto: 'auto',
  automatic: 'auto',
  autodetect: 'auto',
  'auto-detect': 'auto',
  pro: 'pro',
  'claude-pro': 'pro',
  claudepro: 'pro',
  'max-5x': 'max-5x',
  max5x: 'max-5x',
  'max_5x': 'max-5x',
  'max 5x': 'max-5x',
  '5x': 'max-5x',
  'max-20x': 'max-20x',
  max20x: 'max-20x',
  'max_20x': 'max-20x',
  'max 20x': 'max-20x',
  '20x': 'max-20x'
}

/**
 * Normalize persisted Claude plan strings to the canonical identifiers
 */
export function normalizeClaudePlan(plan?: string | null): ClaudePlan {
  if (!plan) return 'auto'

  const cleaned = plan.toString().trim().toLowerCase()
  if (!cleaned) return 'auto'

  // Replace multiple separators with single hyphen to collapse variants
  const normalizedKey = cleaned
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')

  if (normalizedKey in PLAN_ALIASES) {
    return PLAN_ALIASES[normalizedKey]
  }

  // Handle shorthand like "max5x" or values missing separator
  const compactKey = normalizedKey.replace(/-/g, '')
  if (compactKey in PLAN_ALIASES) {
    return PLAN_ALIASES[compactKey]
  }

  return 'auto'
}
