/**
 * Persistent block tracking to prevent losing session data
 * Logs all detected blocks and their transitions for debugging
 */

import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface BlockEvent {
  timestamp: string
  eventType: 'block_detected' | 'block_started' | 'block_ended' | 'block_updated'
  blockId: string
  blockStart: string
  blockEnd: string
  usage: number
  isActive: boolean
  entryCount: number
  source: 'ccusage_analysis' | 'session_tracking' | 'auto_renewal'
  details?: string
}

export interface BlockSnapshot {
  timestamp: string
  activeBlocks: {
    blockId: string
    blockStart: string
    blockEnd: string
    usage: number
    timeRemaining: number | null
    entryCount: number
  }[]
  historicalBlocks: {
    blockId: string
    blockStart: string
    blockEnd: string
    usage: number
    entryCount: number
  }[]
  lastAnalysis: string
}

const BLOCK_LOG_FILE = join(homedir(), '.claude-sentinel-block-log.jsonl')
const BLOCK_SNAPSHOT_FILE = join(homedir(), '.claude-sentinel-block-snapshot.json')

/**
 * Log a block event for debugging
 */
export function logBlockEvent(event: Omit<BlockEvent, 'timestamp'>) {
  const fullEvent: BlockEvent = {
    timestamp: new Date().toISOString(),
    ...event
  }
  
  try {
    appendFileSync(BLOCK_LOG_FILE, JSON.stringify(fullEvent) + '\n')
  } catch (error) {
    console.warn('Failed to log block event:', error)
  }
}

/**
 * Save a complete snapshot of current block state
 */
export function saveBlockSnapshot(snapshot: Omit<BlockSnapshot, 'timestamp'>) {
  const fullSnapshot: BlockSnapshot = {
    timestamp: new Date().toISOString(),
    ...snapshot
  }
  
  try {
    writeFileSync(BLOCK_SNAPSHOT_FILE, JSON.stringify(fullSnapshot, null, 2))
  } catch (error) {
    console.warn('Failed to save block snapshot:', error)
  }
}

/**
 * Load the last block snapshot
 */
export function loadBlockSnapshot(): BlockSnapshot | null {
  try {
    if (!existsSync(BLOCK_SNAPSHOT_FILE)) return null
    const content = readFileSync(BLOCK_SNAPSHOT_FILE, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    console.warn('Failed to load block snapshot:', error)
    return null
  }
}

/**
 * Get recent block events for debugging
 */
export function getRecentBlockEvents(hours: number = 24): BlockEvent[] {
  try {
    if (!existsSync(BLOCK_LOG_FILE)) return []
    
    const content = readFileSync(BLOCK_LOG_FILE, 'utf8')
    const lines = content.trim().split('\n').filter(line => line.length > 0)
    const events = lines.map(line => JSON.parse(line) as BlockEvent)
    
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000)
    return events.filter(event => new Date(event.timestamp) >= cutoffTime)
  } catch (error) {
    console.warn('Failed to read block events:', error)
    return []
  }
}

/**
 * Clear old block events (keep last N days)
 */
export function cleanupBlockLogs(daysToKeep: number = 7) {
  try {
    if (!existsSync(BLOCK_LOG_FILE)) return
    
    const content = readFileSync(BLOCK_LOG_FILE, 'utf8')
    const lines = content.trim().split('\n').filter(line => line.length > 0)
    const events = lines.map(line => JSON.parse(line) as BlockEvent)
    
    const cutoffTime = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000)
    const recentEvents = events.filter(event => new Date(event.timestamp) >= cutoffTime)
    
    const newContent = recentEvents.map(event => JSON.stringify(event)).join('\n') + '\n'
    writeFileSync(BLOCK_LOG_FILE, newContent)
  } catch (error) {
    console.warn('Failed to cleanup block logs:', error)
  }
}

/**
 * Helper to create a block ID from start time
 */
export function createBlockId(blockStart: Date): string {
  return `block_${blockStart.getTime()}_${blockStart.toISOString().slice(0, 16)}`
}

/**
 * Compare two blocks and detect changes
 */
export function detectBlockChanges(
  oldBlocks: Array<{blockStart: Date, usage: number, isActive: boolean}>,
  newBlocks: Array<{blockStart: Date, usage: number, isActive: boolean}>
): { added: any[], removed: any[], modified: any[] } {
  const oldBlockMap = new Map(oldBlocks.map(b => [b.blockStart.toISOString(), b]))
  const newBlockMap = new Map(newBlocks.map(b => [b.blockStart.toISOString(), b]))
  
  const added = newBlocks.filter(b => !oldBlockMap.has(b.blockStart.toISOString()))
  const removed = oldBlocks.filter(b => !newBlockMap.has(b.blockStart.toISOString()))
  const modified = newBlocks.filter(b => {
    const old = oldBlockMap.get(b.blockStart.toISOString())
    return old && (old.usage !== b.usage || old.isActive !== b.isActive)
  })
  
  return { added, removed, modified }
}