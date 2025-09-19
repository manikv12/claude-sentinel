/**
 * Enhanced Claude usage data loader and analyzer for Sentinel
 * Based on ccusage with custom naming and billing block support
 */

const { readFileSync, existsSync, readdirSync, statSync } = require('fs')
const { join } = require('path')
// import { homedir } from 'os' // No longer used - moved to userData
import {
  logBlockEvent,
  saveBlockSnapshot,
  loadBlockSnapshot,
  createBlockId,
  detectBlockChanges
} from './block-tracker'
import { normalizeClaudePlan, ClaudePlan } from './plan-utils'

// Toggle verbose logging via env var (default off for performance)
const DEBUG = process.env.SENTINEL_DEBUG === '1'

// Cache for loaded data to prevent repeated file I/O
let cachedData: SentinelUsageEntry[] | null = null
let lastCacheTime = 0
// Cache processed analysis too to avoid recomputing on each call
let cachedAnalysis: SentinelUsageAnalysis | null = null

let fileModTimes: Map<string, number> = new Map() // Track file modification times
const CACHE_DURATION = 300000 // 5 minute cache
const INCREMENTAL_CHECK_INTERVAL = 10000 // 10 second interval for incremental checks
let lastIncrementalCheck = 0

/**
 * Simple cost estimation for Claude models
 * Based on approximate pricing as of 2025
 */
function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Pricing per 1M tokens (approximate)
  const pricing: Record<string, { input: number; output: number }> = {
    'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
    'claude-opus-4-20250514': { input: 15.0, output: 75.0 },
    'claude-sonnet-3.5-20250514': { input: 3.0, output: 15.0 },
    'claude-haiku-3.5-20250514': { input: 0.8, output: 4.0 }
  }
  
  const modelPricing = pricing[model] || pricing['claude-sonnet-4-20250514'] // Default to Sonnet 4
  
  const inputCost = (inputTokens / 1_000_000) * modelPricing.input
  const outputCost = (outputTokens / 1_000_000) * modelPricing.output
  
  return inputCost + outputCost
}

export interface SentinelUsageEntry {
  timestamp: string
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUSD?: number
  sessionId: string
  messageId: string
  requestId?: string
  project?: string
}

export interface SentinelDailyUsage {
  date: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  sessions: Set<string>
  blocks: Set<string> // Billing blocks for this day
  entries: SentinelUsageEntry[]
  avgSessionLength?: number
}

export interface SentinelBillingBlock {
  startTime: Date
  endTime: Date
  isActive: boolean
  usage: number
  limit: number
  timeRemaining: number | null
  entries: SentinelUsageEntry[]
  cost: number
}

export interface SentinelUsageAnalysis {
  daily: SentinelDailyUsage[]
  totalCost: number
  totalTokens: number
  totalSessions: number // Keep for conversations
  totalBlocks: number   // Add for billing blocks
  currentBlock: SentinelBillingBlock | null
  dateRange: {
    start: string
    end: string
  }
}

/**
 * Get possible Claude data directories
 */
export function getClaudeDataPaths(): string[] {
  const home = require('os').homedir()
  return [
    join(home, '.config', 'claude', 'projects'),
    join(home, '.claude', 'projects')
  ].filter(path => existsSync(path))
}

/**
 * Parse a single JSONL line safely
 */
function parseJSONLLine(line: string, projectName?: string): SentinelUsageEntry | null {
  try {
    const data = JSON.parse(line.trim())
    
    // Skip if not an assistant message with usage data
    if (data.type !== 'assistant' || !data.message?.usage) return null
    
    const usage = data.message.usage
    const model = data.message.model || 'unknown'
    
    // Calculate input tokens (including cache tokens)
    const inputTokens = (usage.input_tokens || 0) + 
                       (usage.cache_read_input_tokens || 0) + 
                       (usage.cache_creation_input_tokens || 0)
    
    const outputTokens = usage.output_tokens || 0
    const totalTokens = inputTokens + outputTokens
    
    // Skip entries with no tokens
    if (totalTokens === 0) return null
    
    // Simple cost estimation based on known pricing
    const costUSD = estimateCost(model, inputTokens, outputTokens)
    
    return {
      timestamp: data.timestamp,
      model: model,
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      totalTokens: totalTokens,
      costUSD: costUSD,
      sessionId: data.sessionId || '',
      messageId: data.message?.id || data.uuid || '',
      requestId: data.requestId || '',
      project: projectName
    }
  } catch (error) {
    console.warn('Failed to parse JSONL line:', line.slice(0, 100))
    return null
  }
}

/**
 * Load usage data from a single JSONL file
 */
function loadUsageFile(filePath: string, projectName?: string): SentinelUsageEntry[] {
  try {
    if (!existsSync(filePath)) return []
    
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.trim().split('\n').filter(line => line.trim())
    
    return lines
      .map(line => parseJSONLLine(line, projectName))
      .filter((entry): entry is SentinelUsageEntry => entry !== null)
  } catch (error) {
    console.error(`Failed to load usage file ${filePath}:`, error)
    return []
  }
}

/**
 * Find all JSONL files in Claude data directories
 */
function findUsageFiles(dataPaths: string[]): Array<{ path: string; project: string; mtime: number }> {
  const files: Array<{ path: string; project: string; mtime: number }> = []
  const cutoffMs = Date.now() - (7 * 24 * 60 * 60 * 1000) // 7 days

  for (const basePath of dataPaths) {
    if (!existsSync(basePath)) continue

    try {
      const projects = readdirSync(basePath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)

      for (const project of projects) {
        const projectPath = join(basePath, project)
        const jsonlFiles = readdirSync(projectPath)
          .filter(file => file.endsWith('.jsonl'))
          .map(file => {
            const fullPath = join(projectPath, file)
            let mtime = 0
            try {
              mtime = statSync(fullPath).mtime.getTime()
            } catch (statError) {
              if (DEBUG) {
                console.warn(`Failed to stat usage file ${fullPath}:`, statError)
              }
            }
            return { path: fullPath, project, mtime }
          })

        files.push(...jsonlFiles)
      }
    } catch (error) {
      console.warn(`Failed to scan directory ${basePath}:`, error)
    }
  }

  if (files.length === 0) return []

  const sortedFiles = [...files].sort((a, b) => b.mtime - a.mtime)

  const recentFiles = sortedFiles.filter(file => file.mtime >= cutoffMs)
  let selected: Array<{ path: string; project: string; mtime: number }>

  if (recentFiles.length > 0) {
    selected = recentFiles.slice(0, 20)
  } else {
    selected = sortedFiles.slice(0, 10)
  }

  if (selected.length === 0) {
    selected = files.slice(0, Math.min(files.length, 10))
  }

  if (DEBUG) {
    const oldestSelected = selected[selected.length - 1]
    const oldestLabel = oldestSelected ? new Date(oldestSelected.mtime).toISOString() : 'n/a'
    console.log(
      `Sentinel: Filtered usage files - total=${files.length}, recent=${recentFiles.length}, selected=${selected.length}, oldestSelected=${oldestLabel}`
    )
  }

  return selected
}

/**
 * Generate a block ID from a block start time
 */
function generateBlockId(blockStart: Date): string {
  return `block_${blockStart.getTime()}`
}

/**
 * Group usage entries by date
 */
function groupByDate(entries: SentinelUsageEntry[]): Map<string, SentinelDailyUsage> {
  const dailyMap = new Map<string, SentinelDailyUsage>()

  for (const entry of entries) {
    const date = entry.timestamp.split('T')[0] // Extract YYYY-MM-DD

    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0,
        sessions: new Set(),
        blocks: new Set(),
        entries: []
      })
    }

    const daily = dailyMap.get(date)!
    daily.inputTokens += entry.inputTokens
    daily.outputTokens += entry.outputTokens
    daily.totalTokens += entry.totalTokens
    daily.cost += entry.costUSD || 0
    daily.sessions.add(entry.sessionId)
    daily.entries.push(entry)
  }

  return dailyMap
}

/**
 * Unified block detection algorithm that matches Claude's actual billing behavior
 * - Sessions start at the hour of first activity (4:50 PM → 4:00 PM)  
 * - Sessions last exactly 5 hours from that floored hour
 * - Blocks are active if current time < blockEnd
 */
interface HistoricalBlockMeta { isActive: boolean; usage: number; blockStart: Date; blockEnd: Date; entryCount: number; entries: SentinelUsageEntry[] }
function findAllHistoricalBlocks(entries: SentinelUsageEntry[]): HistoricalBlockMeta[] {
  if (entries.length === 0) return []

  const sessionDurationMs = 5 * 60 * 60 * 1000 // 5 hours in milliseconds
  const blocks: HistoricalBlockMeta[] = []
  const sortedEntries = [...entries].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )
  const now = new Date()

  // Floor to hour function - consistent with Claude's behavior
  function floorToHour(timestamp: Date): Date {
    const floored = new Date(timestamp)
    floored.setMinutes(0, 0, 0)
    floored.setMilliseconds(0)
    return floored
  }

  // Create gap block representing periods with no activity (adapted from ccusage-main)
  function createGapBlock(lastActivityTime: Date, nextActivityTime: Date): HistoricalBlockMeta | null {
    // Only create gap blocks for gaps longer than the session duration
    const gapDuration = nextActivityTime.getTime() - lastActivityTime.getTime()
    if (gapDuration <= sessionDurationMs) {
      return null
    }

    const gapStart = new Date(lastActivityTime.getTime() + sessionDurationMs)
    const gapEnd = nextActivityTime

    return {
      isActive: false,
      usage: 0,
      blockStart: gapStart,
      blockEnd: gapEnd,
      entryCount: 0,
      entries: []
    }
  }

  // Improved block detection logic adapted from ccusage-main
  let currentBlockStart: Date | null = null
  let currentBlockEntries: SentinelUsageEntry[] = []

  for (const entry of sortedEntries) {
    const entryTime = new Date(entry.timestamp)

    if (currentBlockStart == null) {
      // First entry - start a new block (floored to the hour)
      currentBlockStart = floorToHour(entryTime)
      currentBlockEntries = [entry]
    } else {
      const timeSinceBlockStart = entryTime.getTime() - currentBlockStart.getTime()
      const lastEntry = currentBlockEntries[currentBlockEntries.length - 1]
      if (lastEntry == null) {
        continue
      }
      const lastEntryTime = new Date(lastEntry.timestamp)
      const timeSinceLastEntry = entryTime.getTime() - lastEntryTime.getTime()

      // Key fix: Check BOTH conditions like ccusage-main does
      if (timeSinceBlockStart > sessionDurationMs || timeSinceLastEntry > sessionDurationMs) {
        // Close current block
        const blockEnd = new Date(currentBlockStart.getTime() + sessionDurationMs)
        const blockUsage = currentBlockEntries.reduce((sum, e) => sum + e.totalTokens, 0)
        const isActive = now < blockEnd

        blocks.push({
          isActive,
          usage: blockUsage,
          blockStart: currentBlockStart,
          blockEnd,
          entryCount: currentBlockEntries.length,
          entries: currentBlockEntries
        })

        // Log block event for tracking
        logBlockEvent({
          eventType: isActive ? 'block_detected' : 'block_ended',
          blockId: createBlockId(currentBlockStart),
          blockStart: currentBlockStart.toISOString(),
          blockEnd: blockEnd.toISOString(),
          usage: blockUsage,
          isActive,
          entryCount: currentBlockEntries.length,
          source: 'ccusage_analysis',
          details: `Block ${isActive ? 'active' : 'ended'} with ${currentBlockEntries.length} entries`
        })

        // Add gap block if there's a significant gap
        if (timeSinceLastEntry > sessionDurationMs) {
          const gapBlock = createGapBlock(lastEntryTime, entryTime)
          if (gapBlock != null) {
            blocks.push(gapBlock)
          }
        }

        // Start new block (floored to the hour)
        currentBlockStart = floorToHour(entryTime)
        currentBlockEntries = [entry]
      } else {
        // Add to current block
        currentBlockEntries.push(entry)
      }
    }
  }

  // Close the last block
  if (currentBlockStart != null && currentBlockEntries.length > 0) {
    const blockEnd = new Date(currentBlockStart.getTime() + sessionDurationMs)
    const blockUsage = currentBlockEntries.reduce((sum, e) => sum + e.totalTokens, 0)
    const isActive = now < blockEnd

    blocks.push({
      isActive,
      usage: blockUsage,
      blockStart: currentBlockStart,
      blockEnd,
      entryCount: currentBlockEntries.length,
      entries: currentBlockEntries
    })

    // Log block event for tracking
    logBlockEvent({
      eventType: isActive ? 'block_detected' : 'block_ended',
      blockId: createBlockId(currentBlockStart),
      blockStart: currentBlockStart.toISOString(),
      blockEnd: blockEnd.toISOString(),
      usage: blockUsage,
      isActive,
      entryCount: currentBlockEntries.length,
      source: 'ccusage_analysis',
      details: `Block ${isActive ? 'active' : 'ended'} with ${currentBlockEntries.length} entries`
    })
  }

  return blocks
}

/**
 * Identify current billing block using the unified algorithm
 * Now uses the same logic as findAllHistoricalBlocks for consistency
 */
async function identifyBillingBlocks(entries: SentinelUsageEntry[], userPlan: string = 'auto'): Promise<SentinelBillingBlock[]> {
  if (entries.length === 0) return []

  const plan = normalizeClaudePlan(userPlan)
  
  // Use the unified block detection algorithm
  const allBlocks = findAllHistoricalBlocks(entries)
  
  // Find the currently active block
  const activeBlock = allBlocks.find(block => block.isActive)
  
  if (!activeBlock) {
    if (DEBUG) console.log(`Sentinel: No active billing block found`)
    return []
  }
  
  if (DEBUG) console.log(`Sentinel: Found active block with ${activeBlock.usage.toLocaleString()} tokens`)
  
  // Use the exact entries from the unified algorithm (no more approximations!)
  const currentBlockEntries = activeBlock.entries
  const usage = activeBlock.usage
  const cost = currentBlockEntries.reduce((sum, e) => sum + (e.costUSD || 0), 0)
  
  // Use the block's start and end times directly from the unified algorithm
  const blockStart = activeBlock.blockStart
  const blockEnd = activeBlock.blockEnd
  const isActive = activeBlock.isActive
  const now = new Date()
  const timeRemaining = isActive ? Math.max(0, Math.floor((blockEnd.getTime() - now.getTime()) / (1000 * 60))) : null
  
  // Debug: Show detailed token breakdown for current block
  if (DEBUG) {
    console.log(`\n=== CURRENT BLOCK TOKEN BREAKDOWN ===`)
    console.log(`Block start: ${blockStart.toLocaleString()}`)
    console.log(`Block end: ${blockEnd.toLocaleString()}`)
    console.log(`Total entries in block: ${currentBlockEntries.length}`)
    console.log(`Total tokens: ${usage.toLocaleString()}`)
    console.log(`Average tokens per entry: ${Math.round(usage / currentBlockEntries.length)}`)
    console.log(`Block is: ${isActive ? 'ACTIVE' : 'EXPIRED'}`)
    console.log(`Time remaining: ${timeRemaining ? `${timeRemaining} minutes` : 'None'}`)
    console.log(`=====================================\n`)
  }
  
  // Calculate stable limit based on historical data with smoothing  
  // We already have allBlocks from the unified algorithm above
  const topBlocks = allBlocks
    .filter(block => !block.isActive && block.usage > 0)
    .sort((a, b) => b.usage - a.usage)
    .slice(0, 10) // Look at top 10 for stability
  
  if (DEBUG) console.log(`Sentinel: Found ${allBlocks.length} total blocks, top 5 completed:`)
  topBlocks.slice(0, 5).forEach((block, idx) => {
    const startDate = block.blockStart.toLocaleString()
    if (DEBUG) console.log(`  Block ${idx + 1}: ${block.usage.toLocaleString()} tokens (${block.entryCount} entries) - ${startDate}`)
  })
  
  // Use a more stable limit calculation based on Claude's actual limits and historical data
  // Reference: Claude Pro ~45 messages per 5-hour block, Max 5x ~225 messages, Max 20x ~900 messages
  // Estimated token equivalents: Pro ~400K, Max 5x ~880K, Max 20x ~3.5M tokens per block
  
  // Use userPlan parameter passed to function
  if (DEBUG) console.log(`Sentinel: Using user plan: ${plan}`)

  // Define plan-specific limits (based on actual Claude limits from ccusage)
  const PLAN_LIMITS: Record<Exclude<ClaudePlan, 'auto'>, number> = {
    'pro': 31_000_000,        // 31M tokens (base plan limit)
    'max-5x': 155_000_000,    // 155M tokens (5x base plan)
    'max-20x': 620_000_000    // 620M tokens (20x base plan)
  }

  let stableLimit: number

  if (plan === 'pro' || plan === 'max-5x' || plan === 'max-20x') {
    // User explicitly set their plan - use that limit
    stableLimit = Math.max(PLAN_LIMITS[plan], usage * 1.05)
    if (DEBUG) console.log(`Sentinel: Using user-configured ${plan} plan limit: ${stableLimit.toLocaleString()} tokens`)

  } else if (topBlocks.length >= 3) {
    // Auto-detect: Calculate stable limit from top 3 historical blocks with reasonable bounds
    const top3Average = Math.round((topBlocks[0].usage + topBlocks[1].usage + topBlocks[2].usage) / 3)
    
    // Apply reasonable bounds based on Claude plan limits
    const MIN_REASONABLE_LIMIT = PLAN_LIMITS['pro']
    const MAX_REASONABLE_LIMIT = PLAN_LIMITS['max-20x']
    
    // Use the smaller of: plan limits or historical average (don't exceed plan limits)
    const boundedLimit = Math.min(Math.max(top3Average, MIN_REASONABLE_LIMIT), MAX_REASONABLE_LIMIT)
    
    // Respect plan limits - don't exceed them even if current usage is higher
    if (usage > MAX_REASONABLE_LIMIT) {
      stableLimit = MAX_REASONABLE_LIMIT // Cap at max plan limit
    } else if (usage > boundedLimit) {
      stableLimit = Math.min(usage * 1.05, MAX_REASONABLE_LIMIT) // 5% above usage but capped at plan limit
    } else {
      stableLimit = boundedLimit
    }
    
  } else if (topBlocks.length > 0) {
    // Single historical block - apply same bounds
    const MIN_REASONABLE_LIMIT = PLAN_LIMITS['pro']
    const MAX_REASONABLE_LIMIT = PLAN_LIMITS['max-20x']
    
    const boundedLimit = Math.min(Math.max(topBlocks[0].usage, MIN_REASONABLE_LIMIT), MAX_REASONABLE_LIMIT)
    
    // Respect plan limits - don't exceed them even if current usage is higher
    if (usage > MAX_REASONABLE_LIMIT) {
      stableLimit = MAX_REASONABLE_LIMIT // Cap at max plan limit
    } else if (usage > boundedLimit) {
      stableLimit = Math.min(usage * 1.05, MAX_REASONABLE_LIMIT) // 5% above usage but capped at plan limit
    } else {
      stableLimit = boundedLimit
    }

  } else {
    // No historical data - use intelligent default based on current usage
    if (usage > 3_500_000) {
      stableLimit = Math.max(PLAN_LIMITS['max-20x'], usage * 1.1) // Assume Max 20x plan for heavy users
    } else if (usage > 880_000) {
      stableLimit = Math.max(PLAN_LIMITS['max-5x'], usage * 1.1)   // Assume Max 5x plan for moderate users
    } else {
      stableLimit = Math.max(PLAN_LIMITS['pro'], usage * 1.1)      // Assume Pro plan for light users
    }
  }
  
  if (DEBUG) console.log(`Sentinel: Top blocks: ${topBlocks.slice(0, 3).map(b => b.usage.toLocaleString()).join(', ')}`)
  if (DEBUG) console.log(`Sentinel: Using stable token limit: ${stableLimit.toLocaleString()} tokens (averaged from top 3 historical blocks)`)

  return [{
    startTime: blockStart,
    endTime: blockEnd,
    isActive,
    usage,
    limit: stableLimit,
    timeRemaining,
    entries: currentBlockEntries,
    cost
  }]
}

/**
 * Check for new/modified files and update incrementally
 */
function loadIncrementalUpdates(): SentinelUsageEntry[] | null {
  // Avoid checking too frequently
  const now = Date.now()
  if (now - lastIncrementalCheck < INCREMENTAL_CHECK_INTERVAL) {
    return null
  }
  lastIncrementalCheck = now

  const dataPaths = getClaudeDataPaths()
  const usageFiles = findUsageFiles(dataPaths)
  
  let hasUpdates = false
  const newEntries: SentinelUsageEntry[] = []
  
  // Sort files by modification time (newest first) to prioritize recent files
  const sortedFiles = usageFiles.sort((a, b) => b.mtime - a.mtime)
  
  // Check only the most recent few files for changes
  const filesToCheck = sortedFiles.slice(0, 3) // Check only 3 most recent files
  
  for (const fileInfo of filesToCheck) {
    const currentMtime = fileInfo.mtime
    const lastKnownMtime = fileModTimes.get(fileInfo.path)
    
    if (!lastKnownMtime || currentMtime > lastKnownMtime) {
      // File is new or modified
      const entries = loadUsageFile(fileInfo.path, fileInfo.project)
      
      if (lastKnownMtime) {
        // For modified files, only add entries newer than our last cache time
        const newFileEntries = entries.filter(entry => 
          new Date(entry.timestamp).getTime() > (lastCacheTime || 0)
        )
        newEntries.push(...newFileEntries)
        if (DEBUG) console.log(`Sentinel: Found ${newFileEntries.length} new entries in ${fileInfo.path}`)
      } else {
        // New file, add all entries
        newEntries.push(...entries)
        if (DEBUG) console.log(`Sentinel: Loaded new file ${fileInfo.path} with ${entries.length} entries`)
      }
      
      fileModTimes.set(fileInfo.path, currentMtime)
      hasUpdates = true
    }
  }
  
  return hasUpdates ? newEntries : null
}

/**
 * Load and analyze Claude usage data with Sentinel enhancements
 */
export async function loadSentinelUsageData(userPlan: string = 'auto'): Promise<SentinelUsageAnalysis> {
  const now = Date.now()
  const plan = normalizeClaudePlan(userPlan)
  
  // If we have cached data, try incremental updates first
  if (cachedData && (now - lastCacheTime) < CACHE_DURATION) {
    // For very recent requests, return cached analysis immediately
    if (cachedAnalysis) return cachedAnalysis
    // Fallback: compute once and cache
    cachedAnalysis = await processUsageEntries(cachedData, plan)
    return cachedAnalysis
  }
  
  // Check for incremental updates if cache is somewhat stale
  if (cachedData && (now - lastCacheTime) < CACHE_DURATION * 3) { // 3 minutes
    const incrementalEntries = loadIncrementalUpdates()
    if (incrementalEntries && incrementalEntries.length > 0) {
      // Merge new entries with cached data, removing duplicates
      const mergedEntries = [...cachedData, ...incrementalEntries]
      const uniqueEntries = Array.from(
        new Map(mergedEntries.map(entry => [entry.messageId, entry])).values()
      )
      
      cachedData = uniqueEntries
      lastCacheTime = now
      if (DEBUG) console.log(`Sentinel: Added ${incrementalEntries.length} new entries via incremental update`)
      // Recompute analysis once and cache
      cachedAnalysis = await processUsageEntries(uniqueEntries, plan)
      return cachedAnalysis
    }
    // No updates found, return cached analysis if present
    if (cachedAnalysis) return cachedAnalysis
    // Fallback: compute once and cache
    cachedAnalysis = await processUsageEntries(cachedData, plan)
    return cachedAnalysis
  }
  
  // Full reload for very stale cache or initial load
  const dataPaths = getClaudeDataPaths()
  const usageFiles = findUsageFiles(dataPaths)
  
  if (DEBUG) console.log(`Sentinel: Full reload - found ${usageFiles.length} usage files in ${dataPaths.length} data directories`)
  
  // Load all usage entries
  const allEntries: SentinelUsageEntry[] = []
  for (const fileInfo of usageFiles) {
    const entries = loadUsageFile(fileInfo.path, fileInfo.project)
    allEntries.push(...entries)
    // Update modification time tracking
    if (fileInfo.mtime) {
      fileModTimes.set(fileInfo.path, fileInfo.mtime)
    }
  }
  
  if (DEBUG) console.log(`Sentinel: Full reload - loaded ${allEntries.length} usage entries`)
  
  // Cache the loaded data and processed analysis
  cachedData = allEntries
  lastCacheTime = now
  cachedAnalysis = await processUsageEntries(allEntries, plan)
  return cachedAnalysis
}

async function processUsageEntries(allEntries: SentinelUsageEntry[], userPlan: string = 'auto'): Promise<SentinelUsageAnalysis> {
  if (DEBUG) console.log(`🔍 SENTINEL DEBUG: processUsageEntries called with ${allEntries.length} entries`)

  const plan = normalizeClaudePlan(userPlan)

  // Work on a sorted copy to avoid mutating cached arrays
  const sortedEntries = [...allEntries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  // Group by date
  const dailyMap = groupByDate(sortedEntries)
  const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date))

  // Get all billing blocks to assign them to days
  const allHistoricalBlocks = findAllHistoricalBlocks(sortedEntries)

  // Add billing blocks to each day based on when the block started
  const today = new Date().toISOString().split('T')[0]
  if (DEBUG) console.log(`\n=== BILLING BLOCKS ASSIGNMENT (Today: ${today}) ===`)

  // Ensure today exists in the daily map (needed for active block counting)
  if (!dailyMap.has(today)) {
    dailyMap.set(today, {
      date: today,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cost: 0,
      sessions: new Set(),
      blocks: new Set(),
      entries: []
    })
    if (DEBUG) console.log(`✓ Created empty daily data for today: ${today}`)
  }

  for (const block of allHistoricalBlocks) {
    if (block.entryCount > 0) { // Only count blocks with actual usage
      const blockStartDate = block.blockStart.toISOString().split('T')[0]
      const blockId = generateBlockId(block.blockStart)
      const dailyData = dailyMap.get(blockStartDate)

      if (DEBUG) {
        console.log(`Block: ${block.blockStart.toLocaleString()} -> Date: ${blockStartDate}, Entries: ${block.entryCount}, IsActive: ${block.isActive}`)
        console.log(`  Daily data exists: ${!!dailyData}, Block ID: ${blockId}`)
      }

      if (dailyData) {
        dailyData.blocks.add(blockId)
        if (DEBUG && blockStartDate === today) {
          console.log(`  ✓ Added block to TODAY (${today}): ${blockId}`)
        }
      } else if (DEBUG) {
        console.log(`  ✗ No daily data found for ${blockStartDate}`)
      }

      // Also add active blocks to today's count for better UX
      if (block.isActive && blockStartDate !== today) {
        const todayData = dailyMap.get(today)
        if (todayData) {
          todayData.blocks.add(blockId)
          if (DEBUG) {
            console.log(`  ✓ Added ACTIVE block to TODAY (${today}): ${blockId}`)
          }
        }
      }
    } else if (DEBUG) {
      console.log(`Block: ${block.blockStart.toLocaleString()} -> SKIPPED (no entries)`)
    }
  }

  if (DEBUG) {
    console.log(`\n=== TODAY'S BLOCK COUNT ===`)
    const todayData = dailyMap.get(today)
    if (todayData) {
      console.log(`Today (${today}) has ${todayData.blocks.size} blocks:`, Array.from(todayData.blocks))
    } else {
      console.log(`No data found for today (${today})`)
    }
    console.log('=====================================\n')
  }

  // Calculate totals
  const totalCost = daily.reduce((sum, day) => sum + day.cost, 0)
  const totalTokens = daily.reduce((sum, day) => sum + day.totalTokens, 0)
  const allSessions = new Set(sortedEntries.map(entry => entry.sessionId))

  // Calculate total billing blocks across all days
  const allBlocks = new Set<string>()
  daily.forEach(day => {
    day.blocks.forEach(blockId => allBlocks.add(blockId))
  })

  // Identify billing blocks
  const blocks = await identifyBillingBlocks(sortedEntries, plan)
  const currentBlock = blocks.find(block => block.isActive) || null

  // Date range
  const dates = daily.map(d => d.date).sort()
  const dateRange = {
    start: dates[0] || new Date().toISOString().split('T')[0],
    end: dates[dates.length - 1] || new Date().toISOString().split('T')[0]
  }

  return {
    daily,
    totalCost,
    totalTokens,
    totalSessions: allSessions.size,
    totalBlocks: allBlocks.size,
    currentBlock,
    dateRange
  }
}

/**
 * Get usage data for the last N days with Sentinel enhancements
 */
export async function getRecentSentinelUsage(days: number = 30, userPlan: string = 'auto'): Promise<SentinelUsageAnalysis> {
  const plan = normalizeClaudePlan(userPlan)
  const analysis = await loadSentinelUsageData(plan)
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)
  const cutoffString = cutoffDate.toISOString().split('T')[0]
  
  const recentDaily = analysis.daily.filter((day: SentinelDailyUsage) => day.date >= cutoffString)
  
  return {
    ...analysis,
    daily: recentDaily,
    totalCost: recentDaily.reduce((sum: number, day: SentinelDailyUsage) => sum + day.cost, 0),
    totalTokens: recentDaily.reduce((sum: number, day: SentinelDailyUsage) => sum + day.totalTokens, 0),
    dateRange: {
      start: recentDaily[0]?.date || cutoffString,
      end: recentDaily[recentDaily.length - 1]?.date || new Date().toISOString().split('T')[0]
    }
  }
}

/**
 * Get current billing block information with enhanced tracking
 */
export async function getCurrentSentinelBlockInfo(userPlan: string = 'auto') {
  const plan = normalizeClaudePlan(userPlan)
  const analysis = await loadSentinelUsageData(plan)
  const currentBlock = analysis.currentBlock
  
  // Save snapshot of current state for debugging
  const allBlocks = findAllHistoricalBlocks(cachedData || [])
  saveBlockSnapshot({
    activeBlocks: allBlocks.filter(b => b.isActive).map(b => ({
      blockId: createBlockId(b.blockStart),
      blockStart: b.blockStart.toISOString(),
      blockEnd: b.blockEnd.toISOString(),
      usage: b.usage,
      timeRemaining: currentBlock?.timeRemaining || null,
      entryCount: b.entryCount
    })),
    historicalBlocks: allBlocks.filter(b => !b.isActive).slice(-10).map(b => ({
      blockId: createBlockId(b.blockStart),
      blockStart: b.blockStart.toISOString(),
      blockEnd: b.blockEnd.toISOString(),
      usage: b.usage,
      entryCount: b.entryCount
    })),
    lastAnalysis: new Date().toISOString()
  })
  
  if (!currentBlock) {
    return {
      timeRemaining: null,
      usage: 0,
      limit: 0,
      startTime: null,
      endTime: null,
      isActive: false
    }
  }
  
  return {
    timeRemaining: currentBlock.timeRemaining,
    usage: currentBlock.usage,
    limit: currentBlock.limit,
    startTime: currentBlock.startTime.toISOString(),
    endTime: currentBlock.endTime.toISOString(),
    isActive: currentBlock.isActive,
    cost: currentBlock.cost
  }
}

// Backward compatibility functions that map to new Sentinel functions
export async function loadUsageData() {
  const sentinelData = await loadSentinelUsageData()
  return {
    daily: sentinelData.daily.map(day => ({
      ...day,
      sessions: day.sessions,
      blocks: day.blocks // Ensure blocks is exposed
    })),
    totalCost: sentinelData.totalCost,
    totalTokens: sentinelData.totalTokens,
    totalSessions: sentinelData.totalSessions, // Use actual sessions, not blocks
    dateRange: sentinelData.dateRange
  }
}

export async function getRecentUsage(days: number = 30, userPlan: string = 'auto') {
  const sentinelData = await getRecentSentinelUsage(days, userPlan)
  return {
    daily: sentinelData.daily.map(day => ({
      ...day,
      sessions: day.sessions,
      blocks: day.blocks // Ensure blocks is exposed
    })),
    totalCost: sentinelData.totalCost,
    totalTokens: sentinelData.totalTokens,
    totalSessions: sentinelData.totalSessions, // Use actual sessions, not blocks
    dateRange: sentinelData.dateRange
  }
}

export async function getCurrentBlockInfo(userPlan: string = 'auto') {
  return await getCurrentSentinelBlockInfo(userPlan)
}

// Allow external invalidation (e.g., after importing logs)
export function resetUsageCache() {
  console.log('🔄 Resetting usage cache - will recalculate with new plan limits')
  cachedData = null
  cachedAnalysis = null
  fileModTimes = new Map()
  lastCacheTime = 0
  lastIncrementalCheck = 0
  
  // Clear any existing logs to prevent duplicate events with new logic
  const { existsSync, writeFileSync } = require('fs')
  const { join } = require('path')
  const { tmpdir } = require('os')

  try {
    // Try to get userData path, fallback to temp directory
    let dataDir
    try {
      const electron = require('electron')
      const app = electron.app || electron.remote?.app
      dataDir = app?.getPath('userData') || join(tmpdir(), 'claude-sentinel')
    } catch {
      dataDir = join(tmpdir(), 'claude-sentinel')
    }

    const blockLogFile = join(dataDir, 'block-log.jsonl')
    if (existsSync(blockLogFile)) {
      writeFileSync(blockLogFile, '') // Clear the log file
    }

    // Also clear any cached snapshots
    const snapshotFile = join(dataDir, 'block-snapshot.json')
    if (existsSync(snapshotFile)) {
      writeFileSync(snapshotFile, '{}') // Clear the snapshot file
    }
  } catch (error) {
    console.warn('Failed to clear block logs and snapshots:', error)
  }
}
