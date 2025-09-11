/**
 * Enhanced Claude usage data loader and analyzer for Sentinel
 * Based on ccusage with custom naming and billing block support
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Toggle verbose logging via env var
const DEBUG = process.env.SENTINEL_DEBUG === '1'

// Cache for loaded data to prevent repeated file I/O
let cachedData: SentinelUsageEntry[] | null = null
let lastCacheTime = 0
// Cache processed analysis too to avoid recomputing on each call
let cachedAnalysis: SentinelUsageAnalysis | null = null
let fileModTimes: Map<string, number> = new Map() // Track file modification times
const CACHE_DURATION = 60000 // 1 minute cache
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
  totalSessions: number
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
  const home = homedir()
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
function findUsageFiles(dataPaths: string[]): Array<{ path: string; project: string }> {
  const files: Array<{ path: string; project: string }> = []
  
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
          .map(file => ({ path: join(projectPath, file), project }))
        
        files.push(...jsonlFiles)
      }
    } catch (error) {
      console.warn(`Failed to scan directory ${basePath}:`, error)
    }
  }
  
  return files
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
 * Find all historical billing blocks to determine maximum usage per block
 * This replicates ccusage's exact method from identifySessionBlocks function
 */
interface HistoricalBlockMeta { isActive: boolean; usage: number; blockStart: Date; blockEnd: Date; entryCount: number }
function findAllHistoricalBlocks(entries: SentinelUsageEntry[]): HistoricalBlockMeta[] {
  if (entries.length === 0) return []
  
  const sessionDurationMs = 5 * 60 * 60 * 1000 // 5 hours in milliseconds
  const blocks: HistoricalBlockMeta[] = []
  const sortedEntries = [...entries].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )
  
  let currentBlockStart: Date | null = null
  let currentBlockEntries: SentinelUsageEntry[] = []
  const now = new Date()
  
  // Floor to hour function (matches ccusage exactly)
  function floorToHour(timestamp: Date): Date {
    const floored = new Date(timestamp)
    floored.setMinutes(0, 0, 0)
    return floored
  }
  
  for (const entry of sortedEntries) {
    const entryTime = new Date(entry.timestamp)
    
    if (currentBlockStart == null) {
      // First entry - start a new block (floored to the hour like ccusage)
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
      
      if (timeSinceBlockStart > sessionDurationMs || timeSinceLastEntry > sessionDurationMs) {
        // Close current block (matches ccusage logic exactly)
        const blockEnd = new Date(currentBlockStart.getTime() + sessionDurationMs)
        const blockUsage = currentBlockEntries.reduce((sum, e) => sum + e.totalTokens, 0)
        const lastEntryInBlock = currentBlockEntries[currentBlockEntries.length - 1]
        const actualEndTime = lastEntryInBlock ? new Date(lastEntryInBlock.timestamp) : currentBlockStart
        const isActive = now.getTime() - actualEndTime.getTime() < sessionDurationMs && now < blockEnd
        blocks.push({ isActive, usage: blockUsage, blockStart: currentBlockStart, blockEnd, entryCount: currentBlockEntries.length })
        
        // Start new block (floored to the hour like ccusage)
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
    const lastEntryInBlock = currentBlockEntries[currentBlockEntries.length - 1]
    const actualEndTime = lastEntryInBlock ? new Date(lastEntryInBlock.timestamp) : currentBlockStart
    const isActive = now.getTime() - actualEndTime.getTime() < sessionDurationMs && now < blockEnd
    blocks.push({ isActive, usage: blockUsage, blockStart: currentBlockStart, blockEnd, entryCount: currentBlockEntries.length })
  }
  
  return blocks
}

/**
 * Identify current billing block based on most recent activity
 * Claude's actual billing works in 5-hour windows from when you first start using it
 */
function identifyBillingBlocks(entries: SentinelUsageEntry[]): SentinelBillingBlock[] {
  if (entries.length === 0) return []
  
  const now = new Date()
  
  // Find the most recent entry to determine the current block
  const sortedEntries = [...entries].sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
  
  const mostRecentEntry = sortedEntries[0]
  const mostRecentTime = new Date(mostRecentEntry.timestamp)
  
  // Check if the most recent activity was within the last 5 hours
  const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000)
  
  if (mostRecentTime < fiveHoursAgo) {
    if (DEBUG) console.log(`Sentinel: No active billing block (last activity was ${mostRecentTime})`)
    return []
  }
  
  // Find all entries within the current 5-hour window from the most recent activity
  // First, find the billing block start time (rounded down to nearest hour from first activity)
  const firstPossibleTime = new Date(mostRecentTime.getTime() - 5 * 60 * 60 * 1000)
  
  // Get all entries in the potential 5-hour window
  const potentialEntries = entries.filter(entry => {
    const entryTime = new Date(entry.timestamp)
    return entryTime >= firstPossibleTime && entryTime <= mostRecentTime
  }).sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )
  
  if (potentialEntries.length === 0) return []
  
  // Find the actual billing block start (rounded down from first entry)
  const actualFirstEntry = potentialEntries[0]
  const actualBlockStart = new Date(actualFirstEntry.timestamp)
  actualBlockStart.setMinutes(0, 0, 0) // Round down to nearest hour
  const actualBlockEnd = new Date(actualBlockStart.getTime() + 5 * 60 * 60 * 1000)
  
  // Use ccusage-style block detection: apply the same algorithm we use for historical blocks
  // but only for the most recent timeframe
  const recentEntries = entries
    .filter(entry => new Date(entry.timestamp) >= firstPossibleTime)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  
  // Apply the same block detection logic that ccusage uses
  const recentBlocks = findAllHistoricalBlocks(recentEntries)
  const activeBlock = recentBlocks.find(block => block.isActive)
  
  if (!activeBlock) {
    if (DEBUG) console.log(`Sentinel: No active block found using ccusage logic`)
    return []
  }
  
  // Get the entries for this active block by re-running the block detection
  // This ensures we use exactly the same logic as ccusage
  if (DEBUG) console.log(`Sentinel: Using ccusage-style active block with ${activeBlock.usage} tokens`)
  
  // For now, approximate the current block entries since we need to match ccusage exactly
  // TODO: Modify findAllHistoricalBlocks to also return the actual entries for each block
  const currentBlockEntries = recentEntries
  
  if (currentBlockEntries.length === 0) return []
  
  // Use the active block data from our ccusage-compatible algorithm
  const blockStart = activeBlock.blockStart || actualBlockStart
  const blockEnd = activeBlock.blockEnd || actualBlockEnd
  
  // Use the active block usage from our algorithm
  const usage = activeBlock.usage
  const cost = currentBlockEntries.reduce((sum, e) => sum + (e.costUSD || 0), 0)
  
  // Debug: Show some sample token values
  const sampleEntries = currentBlockEntries.slice(0, 5)
  if (DEBUG) {
    console.log(`Sentinel: Sample token values from first 5 entries:`)
    sampleEntries.forEach((entry, idx) => {
      console.log(`  Entry ${idx + 1}: ${entry.totalTokens} tokens (input: ${entry.inputTokens}, output: ${entry.outputTokens})`)
    })
  }
  
  // Check for unusually large entries
  const largeEntries = currentBlockEntries.filter(e => e.totalTokens > 50000)
  if (DEBUG && largeEntries.length > 0) {
    console.log(`Sentinel: Found ${largeEntries.length} entries with >50K tokens:`)
    largeEntries.slice(0, 3).forEach((entry, idx) => {
      console.log(`  Large entry ${idx + 1}: ${entry.totalTokens} tokens (${entry.model})`)
    })
  }
  
  // A block is active if current time is within the 5-hour window
  const isActive = now >= blockStart && now <= blockEnd
  const timeRemaining = isActive ? Math.max(0, Math.floor((blockEnd.getTime() - now.getTime()) / (1000 * 60))) : null
  
  if (DEBUG) {
    console.log(`Sentinel: Current billing block: ${usage} tokens from ${currentBlockEntries.length} entries (${isActive ? 'ACTIVE' : 'EXPIRED'})`)
    console.log(`Sentinel: Block window: ${blockStart.toLocaleString()} - ${blockEnd.toLocaleString()}`)
    console.log(`Sentinel: Average tokens per entry: ${Math.round(usage / currentBlockEntries.length)}`)
  }
  
  // Calculate dynamic limit based on historical max (like ccusage does)
  // Find all historical completed blocks to determine the maximum usage
  const allBlocks = findAllHistoricalBlocks(entries)
  
  // Debug: show top 5 blocks
  const topBlocks = allBlocks
    .filter(block => !block.isActive && block.usage > 0)
    .sort((a, b) => b.usage - a.usage)
    .slice(0, 5)
  
  if (DEBUG) console.log(`Sentinel: Found ${allBlocks.length} historical blocks, top 5:`)
  topBlocks.forEach((block, idx) => {
    const startDate = block.blockStart ? block.blockStart.toLocaleString() : 'unknown'
    const entryCount = block.entryCount || 'unknown'
    if (DEBUG) console.log(`  Block ${idx + 1}: ${block.usage.toLocaleString()} tokens (${entryCount} entries) ${block.isActive ? '(ACTIVE)' : '(completed)'} - ${startDate}`)
  })
  
  // Use the maximum from historical blocks detected by our algorithm
  const algorithmMax = topBlocks.length > 0 ? topBlocks[0].usage : 100000000 // fallback to reasonable default limit
  
  if (DEBUG) console.log(`Sentinel: Algorithm found max: ${algorithmMax.toLocaleString()}`)
  const dynamicLimit = algorithmMax
  
  if (DEBUG) console.log(`Sentinel: Using token limit from historical max: ${dynamicLimit.toLocaleString()} tokens (like ccusage)`)

  return [{
    startTime: blockStart,
    endTime: blockEnd,
    isActive,
    usage,
    limit: dynamicLimit,
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
  const sortedFiles = usageFiles
    .map(fileInfo => ({
      ...fileInfo,
      mtime: statSync(fileInfo.path).mtime.getTime()
    }))
    .sort((a, b) => b.mtime - a.mtime)
  
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
export function loadSentinelUsageData(): SentinelUsageAnalysis {
  const now = Date.now()
  
  // If we have cached data, try incremental updates first
  if (cachedData && (now - lastCacheTime) < CACHE_DURATION) {
    // For very recent requests, return cached analysis immediately
    if (cachedAnalysis) return cachedAnalysis
    // Fallback: compute once and cache
    cachedAnalysis = processUsageEntries(cachedData)
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
      cachedAnalysis = processUsageEntries(uniqueEntries)
      return cachedAnalysis
    }
    // No updates found, return cached analysis if present
    if (cachedAnalysis) return cachedAnalysis
    // Fallback: compute once and cache
    cachedAnalysis = processUsageEntries(cachedData)
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
    fileModTimes.set(fileInfo.path, statSync(fileInfo.path).mtime.getTime())
  }
  
  if (DEBUG) console.log(`Sentinel: Full reload - loaded ${allEntries.length} usage entries`)
  
  // Cache the loaded data and processed analysis
  cachedData = allEntries
  lastCacheTime = now
  cachedAnalysis = processUsageEntries(allEntries)
  return cachedAnalysis
}

function processUsageEntries(allEntries: SentinelUsageEntry[]): SentinelUsageAnalysis {
  // Work on a sorted copy to avoid mutating cached arrays
  const sortedEntries = [...allEntries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  
  // Group by date
  const dailyMap = groupByDate(sortedEntries)
  const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date))
  
  // Calculate totals
  const totalCost = daily.reduce((sum, day) => sum + day.cost, 0)
  const totalTokens = daily.reduce((sum, day) => sum + day.totalTokens, 0)
  const allSessions = new Set(sortedEntries.map(entry => entry.sessionId))
  
  // Identify billing blocks
  const blocks = identifyBillingBlocks(sortedEntries)
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
    currentBlock,
    dateRange
  }
}

/**
 * Get usage data for the last N days with Sentinel enhancements
 */
export function getRecentSentinelUsage(days: number = 30): SentinelUsageAnalysis {
  const analysis = loadSentinelUsageData()
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
export function getCurrentSentinelBlockInfo() {
  const analysis = loadSentinelUsageData()
  const currentBlock = analysis.currentBlock
  
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
export function loadUsageData() {
  const sentinelData = loadSentinelUsageData()
  return {
    daily: sentinelData.daily.map(day => ({
      ...day,
      sessions: day.sessions
    })),
    totalCost: sentinelData.totalCost,
    totalTokens: sentinelData.totalTokens,
    totalSessions: sentinelData.totalSessions,
    dateRange: sentinelData.dateRange
  }
}

export function getRecentUsage(days: number = 30) {
  const sentinelData = getRecentSentinelUsage(days)
  return {
    daily: sentinelData.daily.map(day => ({
      ...day,
      sessions: day.sessions
    })),
    totalCost: sentinelData.totalCost,
    totalTokens: sentinelData.totalTokens,
    totalSessions: sentinelData.totalSessions,
    dateRange: sentinelData.dateRange
  }
}

export function getCurrentBlockInfo() {
  return getCurrentSentinelBlockInfo()
}

// Allow external invalidation (e.g., after importing logs)
export function resetUsageCache() {
  cachedData = null
  cachedAnalysis = null
  fileModTimes = new Map()
  lastCacheTime = 0
  lastIncrementalCheck = 0
}
