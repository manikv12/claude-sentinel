/**
 * Auto-renewal service for Electron main process
 * Non-blocking implementations that avoid shelling out on the main thread.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { setImmediate, setTimeout } from 'timers'

import { 
  startRenewalService as startRenewalServiceLib,
  stopRenewalService as stopRenewalServiceLib,
  startClaudeSession
} from './auto-renewal-integration'
import { renewalLogger } from './log-service'

import { getCurrentBlockInfo as getCurrentBlockInfoLib } from './ccusage-integration'

const USER_DATA = app.getPath('userData')
const PID_FILE = join(USER_DATA, 'renewal.pid')
const CONFIG_FILE = join(USER_DATA, 'renewal-config.json')
const START_TIME_FILE = join(USER_DATA, 'auto-renew-start-time')
const LAST_BLOCK_STATE_FILE = join(USER_DATA, 'last-block-state')
const RENEWAL_LOCK_FILE = join(USER_DATA, 'renewal-lock')
const LAST_RENEWAL_CHECK_FILE = join(USER_DATA, 'last-renewal-check')
const SCHEDULED_RENEWAL_STATE_FILE = join(USER_DATA, 'scheduled-renewal-state')
const LAST_SUCCESSFUL_RENEWAL_FILE = join(USER_DATA, 'last-successful-renewal')

type SimpleConfig = { 
  enabled: boolean; 
  checkInterval?: number; 
  enableLogging?: boolean;
}

// Exported so the main process can auto-start monitoring on launch
export function loadConfig(): SimpleConfig {
  try {
    // Read from main settings file instead of separate renewal config
    const SETTINGS_FILE = join(USER_DATA, 'settings.json')
    if (existsSync(SETTINGS_FILE)) {
      const settings = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))
      const autoRenewal = settings.autoRenewal || {}
      return { 
        enabled: !!autoRenewal.enabled, 
        checkInterval: autoRenewal.checkInterval || 5, 
        enableLogging: autoRenewal.enableLogging !== false
      }
    }
    
    // Fallback to old renewal config file for backwards compatibility
    if (existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
      return { 
        enabled: !!cfg.enabled, 
        checkInterval: cfg.checkInterval, 
        enableLogging: cfg.enableLogging
      }
    }
  } catch {}
  return { enabled: false }
}

function isProcessRunning(): { running: boolean; pid?: number } {
  if (!existsSync(PID_FILE)) return { running: false }
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10)
    try {
      process.kill(pid, 0)
      return { running: true, pid }
    } catch {
      try { unlinkSync(PID_FILE) } catch {}
      return { running: false }
    }
  } catch {
    return { running: false }
  }
}


function readScheduledStart(): string | null {
  try {
    if (!existsSync(START_TIME_FILE)) return null
    const raw = readFileSync(START_TIME_FILE, 'utf8').trim()
    return raw || null
  } catch {
    return null
  }
}

interface BlockState {
  isActive: boolean
  startTime: string | null
  blockId: string | null
  lastLoggedAt?: number  // Add timestamp tracking for rate limiting
}

// Rate limiting for block change logs (prevent spam from frequent UI updates)
let lastBlockLogTime = 0
const BLOCK_LOG_COOLDOWN = 30000 // 30 seconds minimum between identical block change logs

function readLastBlockState(): BlockState | null {
  try {
    if (!existsSync(LAST_BLOCK_STATE_FILE)) return null
    const raw = readFileSync(LAST_BLOCK_STATE_FILE, 'utf8').trim()
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeBlockState(state: BlockState) {
  try {
    writeFileSync(LAST_BLOCK_STATE_FILE, JSON.stringify(state))
  } catch (error) {
    renewalLogger.error(`Failed to write block state: ${error instanceof Error ? error.message : String(error)}`, 'service')
  }
}

/**
 * Normalize timestamp to floored hour format for consistent block ID comparison
 * This matches Claude's actual 5-hour block behavior (blocks start at floored hours)
 */
function normalizeBlockTimestamp(timestamp?: string | null): string | null {
  if (!timestamp) return null
  try {
    const date = new Date(timestamp)
    // Floor to the hour (same logic as ccusage-integration.ts)
    date.setMinutes(0, 0, 0)
    date.setMilliseconds(0)
    return date.toISOString()
  } catch {
    return timestamp // Fallback to original if parsing fails
  }
}

/**
 * Check if enough time has passed since last log to avoid spam
 */
function shouldLogBlockChange(changeType: string): boolean {
  const now = Date.now()
  const timeSinceLastLog = now - lastBlockLogTime

  // Allow immediate logging for state transitions (inactive -> active, active -> inactive)
  // But rate limit repeated "replacing previous" logs which are usually false positives
  if (changeType === 'replacing_previous' && timeSinceLastLog < BLOCK_LOG_COOLDOWN) {
    return false
  }

  lastBlockLogTime = now
  return true
}

function detectAndLogBlockChanges(currentBlock: any) {
  const lastState = readLastBlockState()

  // Normalize current block timestamp for consistent comparison
  const normalizedStartTime = normalizeBlockTimestamp(currentBlock?.startTime)

  const currentState: BlockState = {
    isActive: !!(currentBlock && currentBlock.isActive),
    startTime: currentBlock?.startTime || null,
    blockId: normalizedStartTime, // Use normalized timestamp as block ID
    lastLoggedAt: Date.now()
  }

  if (!lastState) {
    // First time running - just save current state
    if (currentState.isActive && shouldLogBlockChange('initial')) {
      renewalLogger.info(`Initial block detected: started at ${currentState.startTime}`, 'renewal')
    }
    writeBlockState(currentState)
    return
  }

  // Normalize last state's blockId for consistent comparison
  const normalizedLastBlockId = normalizeBlockTimestamp(lastState.blockId)

  // Check for new block starting (inactive -> active)
  if (!lastState.isActive && currentState.isActive) {
    if (shouldLogBlockChange('new_start')) {
      renewalLogger.info(`New usage block started at ${currentState.startTime}`, 'renewal')
    }
    writeBlockState(currentState)
    return
  }

  // Check for block ID change (new block with different start time)
  // Only log if the normalized timestamps are actually different
  if (lastState.isActive && currentState.isActive &&
      normalizedLastBlockId !== currentState.blockId &&
      currentState.blockId && normalizedLastBlockId) {

    if (shouldLogBlockChange('replacing_previous')) {
      renewalLogger.info(`New usage block started (replacing previous): started at ${currentState.startTime}`, 'renewal')
      renewalLogger.debug(`Block ID comparison: ${normalizedLastBlockId} -> ${currentState.blockId}`, 'renewal')
    }
    writeBlockState(currentState)
    return
  }

  // Check for block ending (active -> inactive)
  if (lastState.isActive && !currentState.isActive) {
    if (shouldLogBlockChange('end')) {
      renewalLogger.info(`Usage block ended. Previous block started at ${lastState.startTime}`, 'renewal')
    }
    writeBlockState(currentState)
    return
  }

  // Only update state file if there's a meaningful change (not just timestamp formatting)
  const meaningfulChange = (
    lastState.isActive !== currentState.isActive ||
    normalizedLastBlockId !== currentState.blockId
  )

  if (meaningfulChange) {
    writeBlockState(currentState)
  }
}

function acquireLock(): boolean {
  try {
    if (existsSync(RENEWAL_LOCK_FILE)) {
      // Check if lock is stale (older than 10 minutes to be safe)
      const lockData = readFileSync(RENEWAL_LOCK_FILE, 'utf8').trim()
      const lockInfo = JSON.parse(lockData || '{}')
      const lockTimestamp = lockInfo.timestamp || parseInt(lockData, 10)
      const lockAge = Date.now() - lockTimestamp
      
      if (lockAge < 600000) { // 10 minutes
        const lockAgeMinutes = (lockAge / 60000).toFixed(1)
        // Additional check: verify if the PID actually exists
        if (lockInfo.pid) {
          try {
            process.kill(lockInfo.pid, 0) // Check if process exists
            renewalLogger.info(`🔒 Lock held by active PID ${lockInfo.pid} (${lockAgeMinutes} min ago)`, 'service')
            return false // Lock is held by active process
          } catch (e) {
            // Process doesn't exist, remove stale lock
            renewalLogger.warn(`🔓 Removing lock from dead process PID ${lockInfo.pid} (${lockAgeMinutes} min ago)`, 'service')
            unlinkSync(RENEWAL_LOCK_FILE)
          }
        } else {
          renewalLogger.info(`🔒 Lock held by unknown PID (${lockAgeMinutes} min ago)`, 'service')
          return false // Lock is held by another process
        }
      } else {
        // Stale lock, remove it
        renewalLogger.warn(`🔓 Removing stale lock (${(lockAge / 60000).toFixed(1)} min old)`, 'service')
        unlinkSync(RENEWAL_LOCK_FILE)
      }
    }
    
    // Acquire lock with more information
    const lockInfo = {
      timestamp: Date.now(),
      pid: process.pid,
      operation: 'renewal-check'
    }
    writeFileSync(RENEWAL_LOCK_FILE, JSON.stringify(lockInfo))
    renewalLogger.info(`🔒 Lock acquired by PID ${process.pid}`, 'service')
    return true
  } catch (error) {
    renewalLogger.error(`Failed to acquire lock: ${error instanceof Error ? error.message : String(error)}`, 'service')
    return false
  }
}

function releaseLock() {
  try {
    if (existsSync(RENEWAL_LOCK_FILE)) {
      unlinkSync(RENEWAL_LOCK_FILE)
    }
  } catch (error) {
    renewalLogger.warn(`Failed to release lock: ${error instanceof Error ? error.message : String(error)}`, 'service')
  }
}

function canPerformRenewalCheck(): boolean {
  try {
    if (!existsSync(LAST_RENEWAL_CHECK_FILE)) return true
    
    const lastCheck = parseInt(readFileSync(LAST_RENEWAL_CHECK_FILE, 'utf8').trim(), 10)
    const now = Math.floor(Date.now() / 1000)
    const timeSinceLastCheck = now - lastCheck
    
    // Minimum 30 seconds between renewal checks
    return timeSinceLastCheck >= 30
  } catch {
    return true
  }
}

function recordRenewalCheck() {
  try {
    writeFileSync(LAST_RENEWAL_CHECK_FILE, Math.floor(Date.now() / 1000).toString())
  } catch (error) {
    renewalLogger.warn(`Failed to record renewal check time: ${error instanceof Error ? error.message : String(error)}`, 'service')
  }
}

function recordSuccessfulRenewal() {
  try {
    const renewalData = {
      timestamp: Math.floor(Date.now() / 1000),
      isoTime: new Date().toISOString()
    }
    writeFileSync(LAST_SUCCESSFUL_RENEWAL_FILE, JSON.stringify(renewalData))
    renewalLogger.info(`Recorded successful renewal at ${renewalData.isoTime}`, 'renewal')
  } catch (error) {
    renewalLogger.warn(`Failed to record successful renewal: ${error instanceof Error ? error.message : String(error)}`, 'service')
  }
}

function getLastSuccessfulRenewal(): number | null {
  try {
    if (!existsSync(LAST_SUCCESSFUL_RENEWAL_FILE)) return null
    
    const data = JSON.parse(readFileSync(LAST_SUCCESSFUL_RENEWAL_FILE, 'utf8'))
    return data.timestamp || null
  } catch {
    return null
  }
}

function canPerformRenewal(): { allowed: boolean; reason?: string; hoursRemaining?: number } {
  // Auto-renewal should be purely based on block expiration, not arbitrary time delays
  return { allowed: true }
}

// Generate random delay between 1-2 minutes (60-120 seconds)
function getRandomRenewalDelay(): number {
  const minSeconds = 60   // 1 minute
  const maxSeconds = 120  // 2 minutes
  const randomDelay = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds
  renewalLogger.info(`Generated random renewal delay: ${randomDelay}s (${(randomDelay / 60).toFixed(1)} minutes)`, 'renewal')
  return randomDelay
}

// Track scheduled renewal execution to prevent duplicates
function markScheduledRenewalExecuted(scheduledTime: string) {
  try {
    const state = {
      executedAt: new Date().toISOString(),
      scheduledTime: scheduledTime,
      timestamp: Math.floor(Date.now() / 1000)
    }
    writeFileSync(SCHEDULED_RENEWAL_STATE_FILE, JSON.stringify(state))
    renewalLogger.info(`Marked scheduled renewal as executed: ${scheduledTime}`, 'schedule')
  } catch (error) {
    renewalLogger.warn(`Failed to mark scheduled renewal as executed: ${error instanceof Error ? error.message : String(error)}`, 'service')
  }
}

function wasScheduledRenewalExecuted(scheduledTime: string): boolean {
  try {
    if (!existsSync(SCHEDULED_RENEWAL_STATE_FILE)) return false
    
    const state = JSON.parse(readFileSync(SCHEDULED_RENEWAL_STATE_FILE, 'utf8'))
    const stateAge = Math.floor(Date.now() / 1000) - state.timestamp
    
    // Consider executed if same scheduled time and within last hour
    return state.scheduledTime === scheduledTime && stateAge < 3600
  } catch (error) {
    return false
  }
}

export function setScheduledStartTime(isoTime: string | null) {
  try {
    if (!isoTime) {
      if (existsSync(START_TIME_FILE)) unlinkSync(START_TIME_FILE)
      renewalLogger.info('Cleared scheduled start time', 'schedule')
      return { success: true }
    }
    writeFileSync(START_TIME_FILE, isoTime)
    renewalLogger.info(`Scheduled start time set to ${isoTime}`, 'schedule')
    return { success: true }
  } catch (error) {
    renewalLogger.error(`Failed to set scheduled start time: ${error instanceof Error ? error.message : String(error)}`, 'schedule')
    return { success: false, error: error instanceof Error ? error.message : 'Failed to set scheduled start time' }
  }
}

// Compose renewal status using cached usage analysis instead of blocking ccusage CLI
export async function getRenewalStatus() {
  const cfg = loadConfig()
  const proc = isProcessRunning()
  const block = await getCurrentBlockInfoLib()

  // Only perform block monitoring if auto-renewal is enabled
  if (cfg.enabled) {
    // Detect and log any block state changes using original block data
    detectAndLogBlockChanges(block)
  }

  const scheduledStartTime = readScheduledStart()
  
  // Calculate next renewal time based on block data instead of lastActivity
  let nextRenewal: Date | null = null
  
  // Debug logging for next renewal calculation
  renewalLogger.debug(`Next renewal calculation: scheduledStartTime=${scheduledStartTime}, block=${block ? `active=${block.isActive}, startTime=${block.startTime}, endTime=${block.endTime}` : 'null'}`, 'renewal')
  
  if (scheduledStartTime) {
    // If user has scheduled a time, that's the next renewal
    nextRenewal = new Date(scheduledStartTime)
    renewalLogger.debug(`Using scheduled start time: ${nextRenewal.toISOString()}`, 'renewal')
  } else if (block && block.isActive && block.endTime) {
    // Next renewal is when current block ends
    nextRenewal = new Date(block.endTime)
    renewalLogger.debug(`Using active block end time: ${nextRenewal.toISOString()}`, 'renewal')
  } else if (block && block.startTime) {
    // Fallback: 5 hours after block start time
    nextRenewal = new Date(new Date(block.startTime).getTime() + 5 * 60 * 60 * 1000)
    renewalLogger.debug(`Using block start time + 5h: ${nextRenewal.toISOString()}`, 'renewal')
  } else if (block && block.endTime) {
    // Block exists but is not active - next renewal is when it ends
    nextRenewal = new Date(block.endTime)
    renewalLogger.debug(`Using inactive block end time: ${nextRenewal.toISOString()}`, 'renewal')
  } else {
    // No block data available - estimate next renewal as 5 hours from now
    nextRenewal = new Date(Date.now() + 5 * 60 * 60 * 1000)
    renewalLogger.debug(`Using fallback time (now + 5h): ${nextRenewal.toISOString()}`, 'renewal')
  }
  
  // Use the current block's time remaining instead of calculating from lastActivity
  const timeRemaining = block && block.isActive ? block.timeRemaining : null

  const currentBlock = block && block.isActive ? {
    startTime: block.startTime ? new Date(block.startTime) : null,
    endTime: block.endTime ? new Date(block.endTime) : null,
    usage: block.usage || 0,
    limit: block.limit || 0
  } : null

  // For lastActivity, use block start time if available, otherwise null
  const lastActivity = block && block.startTime ? new Date(block.startTime) : null

  return {
    enabled: cfg.enabled,
    running: proc.running,
    pid: proc.pid,
    lastActivity,
    timeRemaining,
    nextRenewal,
    scheduledStartTime,
    currentBlock
  }
}

// Decide renewal using current block info to avoid shelling out
export async function performRenewalCheck(): Promise<{ success: boolean; action?: string; error?: string }> {
  try {
    const cfg = loadConfig()
    if (!cfg.enabled) {
      return { success: true }
    }

    if (!canPerformRenewalCheck()) {
      renewalLogger.info('⏱️ Rate limiting: renewal check too frequent, skipping', 'renewal')
      return { success: true }
    }

    if (!acquireLock()) {
      renewalLogger.info('🔒 Another renewal check in progress, skipping', 'renewal')
      return { success: true }
    }

    try {
      renewalLogger.info('Starting renewal check...', 'renewal')
      recordRenewalCheck()

      const renewalCheck = canPerformRenewal()
      if (!renewalCheck.allowed) {
        renewalLogger.info(`🚫 RENEWAL BLOCKED: ${renewalCheck.reason}`, 'renewal')
        return { success: true, action: `Renewal blocked: ${renewalCheck.hoursRemaining?.toFixed(1)} hours remaining` }
      }

      const block = await getCurrentBlockInfoLib()
      detectAndLogBlockChanges(block)

      const scheduledStartTime = readScheduledStart()
      const now = new Date()

      renewalLogger.info(`Renewal check state: block=${block ? `${block.isActive ? 'ACTIVE' : 'EXPIRED'} (${block.startTime})` : 'NONE'}, scheduledStartTime=${scheduledStartTime}`, 'renewal')

      const triggerRenewal = (reason: string, source: 'scheduled' | 'automatic') => {
        const delaySeconds = getRandomRenewalDelay()
        const delayMinutes = (delaySeconds / 60).toFixed(1)
        const label = source === 'scheduled' ? 'SCHEDULED ' : ''

        renewalLogger.info(`🚀 ${label}SESSION START QUEUED: ${reason}`, 'renewal')
        renewalLogger.info(`⏰ Applying random ${delaySeconds}s (${delayMinutes} min) delay before starting Claude session...`, 'renewal')

        setTimeout(async () => {
          const maxAttempts = 3
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
              if (attempt > 0) {
                renewalLogger.info(`🔄 ${label}Retry ${attempt}/${maxAttempts - 1}`, 'session')
                await new Promise(resolve => setTimeout(resolve, attempt * 5000))
              }

              renewalLogger.info('📞 Calling startClaudeSession()', 'session')
              const result = await startClaudeSession()
              if (result) {
                renewalLogger.info(`🎯 ${label}Session started successfully`, 'session')
                recordSuccessfulRenewal()
                return
              }

              renewalLogger.error(`❌ ${label}Session start failed (attempt ${attempt + 1})`, 'session')
            } catch (sessionError) {
              renewalLogger.error(`💥 ${label}Error during session start attempt ${attempt + 1}: ${sessionError instanceof Error ? sessionError.message : String(sessionError)}`, 'session')
            }
          }

          renewalLogger.error(`💥 ${label}All session start attempts failed`, 'session')
          if (source === 'scheduled') {
            renewalLogger.warn('🔧 Scheduled renewal failed; system will rely on block-based renewal', 'renewal')
          }
        }, delaySeconds * 1000)

        const sourceLabel = source === 'scheduled' ? 'Scheduled renewal queued' : 'Auto renewal queued'
        return { success: true, action: `${sourceLabel}: ${reason}` }
      }

      if (scheduledStartTime) {
        const scheduledTime = new Date(scheduledStartTime)
        if (scheduledTime > now) {
          const hoursUntilScheduled = (scheduledTime.getTime() - now.getTime()) / (1000 * 60 * 60)
          renewalLogger.info(`⏰ SCHEDULED RENEWAL: Waiting for scheduled time in ${hoursUntilScheduled.toFixed(1)} hours`, 'renewal')
          return { success: true }
        }

        if (!wasScheduledRenewalExecuted(scheduledStartTime)) {
          renewalLogger.info(`⏰ Scheduled time reached for ${scheduledStartTime}`, 'schedule')
          setScheduledStartTime(null)
          markScheduledRenewalExecuted(scheduledStartTime)
          return triggerRenewal('Scheduled time reached', 'scheduled')
        }

        renewalLogger.info(`⏰ Scheduled renewal already executed for ${scheduledStartTime}, clearing schedule`, 'schedule')
        setScheduledStartTime(null)
      }

      let renewalReason: string | null = null

      if (!block) {
        const lastRenewal = getLastSuccessfulRenewal()
        const nowSeconds = Math.floor(Date.now() / 1000)

        if (!lastRenewal) {
          renewalReason = 'No current block detected - starting first session'
          renewalLogger.info('✅ TRIGGER: No block data and no previous renewal recorded', 'renewal')
        } else {
          const hoursSinceLastRenewal = (nowSeconds - lastRenewal) / 3600
          if (hoursSinceLastRenewal < 0.5) {
            renewalLogger.info(`⏳ WAITING: No block data but session started ${(hoursSinceLastRenewal * 60).toFixed(1)} minutes ago`, 'renewal')
          } else {
            renewalReason = `No block data for ${hoursSinceLastRenewal.toFixed(1)} hours`
            renewalLogger.info(`✅ TRIGGER: ${renewalReason}`, 'renewal')
          }
        }
      } else if (!block.isActive) {
        const timeRemainingHours = (block.timeRemaining || 0) / 60
        if (timeRemainingHours <= 0) {
          renewalReason = 'Current block has expired'
          renewalLogger.info('✅ TRIGGER: Block expired', 'renewal')
        } else {
          renewalLogger.info(`⏳ WAITING: Block inactive but has ${timeRemainingHours.toFixed(1)} hours remaining`, 'renewal')
        }
      } else {
        const timeRemainingHours = (block.timeRemaining || 0) / 60
        renewalLogger.info(`⏳ WAITING: Block still active, ${timeRemainingHours.toFixed(1)} hours remaining`, 'renewal')
      }

      if (renewalReason) {
        return triggerRenewal(renewalReason, 'automatic')
      }

      renewalLogger.info('✋ NO SESSION STARTED - conditions not met', 'renewal')
      return { success: true }
    } finally {
      releaseLock()
    }
  } catch (error) {
    renewalLogger.error(`Renewal check failed: ${error instanceof Error ? error.message : String(error)}`, 'renewal')
    releaseLock()
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

/**
 * Force reset session tracking files and clear block state
 */
export function resetSessionTracking(): { success: boolean; error?: string } {
  try {
    const filesToReset = [
      START_TIME_FILE,
      LAST_BLOCK_STATE_FILE,
      RENEWAL_LOCK_FILE,
      LAST_RENEWAL_CHECK_FILE,
      SCHEDULED_RENEWAL_STATE_FILE,
      LAST_SUCCESSFUL_RENEWAL_FILE
    ]
    const resetFiles: string[] = []
    
    for (const file of filesToReset) {
      if (existsSync(file)) {
        unlinkSync(file)
        resetFiles.push(file.split('/').pop() || file)
        renewalLogger.info(`Deleted session file: ${file}`, 'session')
      }
    }
    
    if (resetFiles.length > 0) {
      renewalLogger.info(`Session reset complete. Deleted ${resetFiles.length} files: ${resetFiles.join(', ')}`, 'session')
      return { success: true }
    } else {
      renewalLogger.info('No session files found to reset', 'session')
      return { success: true }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    renewalLogger.error(`Failed to reset session tracking: ${errorMessage}`, 'session')
    return { success: false, error: errorMessage }
  }
}

// Still re-export start/stop controls
export const startRenewalService = startRenewalServiceLib
export const stopRenewalService = stopRenewalServiceLib
