/**
 * Auto-renewal service for Electron main process
 * Non-blocking implementations that avoid shelling out on the main thread.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { setImmediate, setTimeout } from 'timers'

import { 
  startRenewalService as startRenewalServiceLib,
  stopRenewalService as stopRenewalServiceLib,
  startClaudeSession
} from '../../src/lib/auto-renewal-integration'
import { renewalLogger } from './log-service'

import { getCurrentBlockInfo as getCurrentBlockInfoLib } from '../../src/lib/ccusage-integration'

const HOME = homedir()
const PID_FILE = join(HOME, '.claude-sentinel-renewal.pid')
const CONFIG_FILE = join(HOME, '.claude-sentinel-config.json')
const START_TIME_FILE = join(HOME, '.claude-auto-renew-start-time')
const LAST_BLOCK_STATE_FILE = join(HOME, '.claude-last-block-state')
const RENEWAL_LOCK_FILE = join(HOME, '.claude-sentinel-renewal-lock')
const LAST_RENEWAL_CHECK_FILE = join(HOME, '.claude-last-renewal-check')
const SCHEDULED_RENEWAL_STATE_FILE = join(HOME, '.claude-scheduled-renewal-state')
const LAST_SUCCESSFUL_RENEWAL_FILE = join(HOME, '.claude-last-successful-renewal')

type SimpleConfig = { 
  enabled: boolean; 
  checkInterval?: number; 
  enableLogging?: boolean;
}

// Exported so the main process can auto-start monitoring on launch
export function loadConfig(): SimpleConfig {
  try {
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
  blockId?: string
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
function normalizeBlockTimestamp(timestamp: string | null): string | null {
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
  const lastRenewal = getLastSuccessfulRenewal()
  
  if (!lastRenewal) {
    // No previous renewal recorded - allow first renewal
    return { allowed: true }
  }
  
  const now = Math.floor(Date.now() / 1000)
  const hoursSinceLastRenewal = (now - lastRenewal) / 3600
  const MINIMUM_HOURS_BETWEEN_RENEWALS = 5.0 // 5 hours minimum (Claude session duration)
  
  if (hoursSinceLastRenewal < MINIMUM_HOURS_BETWEEN_RENEWALS) {
    const hoursRemaining = MINIMUM_HOURS_BETWEEN_RENEWALS - hoursSinceLastRenewal
    const lastRenewalTime = new Date(lastRenewal * 1000).toLocaleString()
    return {
      allowed: false,
      reason: `Last renewal was ${hoursSinceLastRenewal.toFixed(1)} hours ago (${lastRenewalTime}). Must wait ${MINIMUM_HOURS_BETWEEN_RENEWALS} hours between renewals (Claude session duration).`,
      hoursRemaining: hoursRemaining
    }
  }
  
  return { allowed: true }
}

// Generate random delay between 1-5 minutes (60-300 seconds)
function getRandomRenewalDelay(): number {
  const minSeconds = 60   // 1 minute
  const maxSeconds = 300  // 5 minutes
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
export function getRenewalStatus() {
  const cfg = loadConfig()
  const proc = isProcessRunning()
  const block = getCurrentBlockInfoLib()

  // Only perform block monitoring if auto-renewal is enabled
  if (cfg.enabled) {
    // Detect and log any block state changes using original block data
    detectAndLogBlockChanges(block)
  }

  const scheduledStartTime = readScheduledStart()
  
  // Calculate next renewal time based on block data instead of lastActivity
  let nextRenewal: Date | null = null
  
  if (scheduledStartTime) {
    // If user has scheduled a time, that's the next renewal
    nextRenewal = new Date(scheduledStartTime)
  } else if (block && block.isActive && block.endTime) {
    // Next renewal is when current block ends
    nextRenewal = new Date(block.endTime)
  } else if (block && block.startTime) {
    // Fallback: 5 hours after block start time
    nextRenewal = new Date(new Date(block.startTime).getTime() + 5 * 60 * 60 * 1000)
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
export function performRenewalCheck(): { success: boolean; action?: string; error?: string } {
  try {
    // Check if auto-renewal is enabled first
    const cfg = loadConfig()
    if (!cfg.enabled) {
      return { success: true }
    }

    // Rate limiting check
    if (!canPerformRenewalCheck()) {
      renewalLogger.info('⏱️ Rate limiting: renewal check too frequent, skipping', 'renewal')
      return { success: true }
    }

    // Try to acquire lock to prevent concurrent checks
    if (!acquireLock()) {
      renewalLogger.info('🔒 Another renewal check in progress, skipping', 'renewal')
      return { success: true }
    }

    try {
      renewalLogger.info('Starting renewal check...', 'renewal')
      recordRenewalCheck()
      
      // Check if enough time has passed since last renewal (4-hour minimum)
      const renewalCheck = canPerformRenewal()
      if (!renewalCheck.allowed) {
        renewalLogger.info(`🚫 RENEWAL BLOCKED: ${renewalCheck.reason}`, 'renewal')
        return { success: true, action: `Renewal blocked: ${renewalCheck.hoursRemaining?.toFixed(1)} hours remaining` }
      }
      
      const block = getCurrentBlockInfoLib()
      
      // Detect and log any block state changes during renewal check
      detectAndLogBlockChanges(block)
      
      const scheduledStartTime = readScheduledStart()
      const now = new Date()

      renewalLogger.info(`Renewal check state: block=${block ? `${block.isActive ? 'ACTIVE' : 'EXPIRED'} (${block.startTime})` : 'NONE'}, scheduledStartTime=${scheduledStartTime}`, 'renewal')

      let shouldRenew = false
      let reason = ''

      // SCHEDULE-AWARE RENEWAL LOGIC
      
      // 1. Check if user has scheduled a future start time
      if (scheduledStartTime) {
        const scheduledTime = new Date(scheduledStartTime)
        
        if (scheduledTime > now) {
          // Scheduled time is in the future - wait until then
          const hoursUntilScheduled = (scheduledTime.getTime() - now.getTime()) / (1000 * 60 * 60)
          renewalLogger.info(`⏰ SCHEDULED RENEWAL: Waiting for scheduled time in ${hoursUntilScheduled.toFixed(1)} hours`, 'renewal')
          return { success: true }
        } else {
          // Check if this scheduled renewal was already executed
          if (wasScheduledRenewalExecuted(scheduledStartTime)) {
            renewalLogger.info(`⏰ SCHEDULED RENEWAL: Already executed for time ${scheduledStartTime}, clearing schedule`, 'renewal')
            setScheduledStartTime(null) // Clear the schedule
            renewalLogger.info(`⏰ SCHEDULED RENEWAL: Proceeding to block-based renewal check`, 'renewal')
            // Continue with normal block-based renewal logic below
          } else {
            // Scheduled time has passed - IMMEDIATELY clear schedule to prevent duplicates
            renewalLogger.info(`⏰ SCHEDULED TIME REACHED: Processing renewal for ${scheduledStartTime}`, 'renewal')

            // Clear scheduled time IMMEDIATELY to prevent duplicate executions
            setScheduledStartTime(null)
            markScheduledRenewalExecuted(scheduledStartTime)

            // Use random delay between 1-5 minutes
            const delaySeconds = getRandomRenewalDelay()

            // Force renewal regardless of block state when scheduled time is reached
            shouldRenew = true
            reason = `Scheduled time has been reached - starting renewal in ${(delaySeconds / 60).toFixed(1)} minutes`
            renewalLogger.info(`🚀 SCHEDULED SESSION START FORCED: ${reason}`, 'renewal')
            renewalLogger.info(`⏰ Applying random ${delaySeconds}s (${(delaySeconds / 60).toFixed(1)} min) delay before starting Claude session...`, 'renewal')

            // Start session with random delay (non-blocking) and retry logic
            setTimeout(async () => {
              let retryCount = 0
              const maxRetries = 2
              let sessionSuccess = false

              while (retryCount <= maxRetries && !sessionSuccess) {
                try {
                  if (retryCount > 0) {
                    renewalLogger.info(`🔄 Scheduled renewal retry attempt ${retryCount}/${maxRetries}`, 'session')
                    // Add exponential backoff for retries
                    await new Promise(resolve => setTimeout(resolve, retryCount * 5000))
                  }

                  renewalLogger.info(`⏳ ${retryCount === 0 ? 'Random delay complete' : 'Retrying scheduled'} - calling startClaudeSession() now`, 'renewal')
                  renewalLogger.info('📞 CALLING startClaudeSession() NOW (SCHEDULED)', 'session')
                  const result = await startClaudeSession()
                  renewalLogger.info(`✅ SCHEDULED SESSION START RESULT: ${result}`, 'session')

                  if (result) {
                    renewalLogger.info('🎯 NEW CLAUDE SESSION STARTED SUCCESSFULLY (SCHEDULED)', 'session')
                    recordSuccessfulRenewal() // Record the successful renewal
                    sessionSuccess = true
                  } else {
                    renewalLogger.error(`❌ SCHEDULED SESSION START FAILED (attempt ${retryCount + 1}/${maxRetries + 1})`, 'session')
                    retryCount++
                  }
                } catch (sessionError) {
                  renewalLogger.error(`💥 Error in scheduled session start attempt ${retryCount + 1}: ${sessionError instanceof Error ? sessionError.message : String(sessionError)}`, 'renewal')
                  retryCount++
                }
              }

              if (!sessionSuccess) {
                renewalLogger.error(`💥 ALL SCHEDULED SESSION START ATTEMPTS FAILED after ${maxRetries + 1} attempts`, 'session')
                renewalLogger.warn(`🔧 Scheduled renewal failed, system will rely on block-based renewal`, 'renewal')
              }
            }, delaySeconds * 1000) // Convert seconds to milliseconds

            return { success: true, action: reason }
          }
        }
      }

      // 2. Base renewal decision on block state instead of lastActivity
      if (!block) {
        // No block data - check if we recently started a session
        const lastRenewal = getLastSuccessfulRenewal()
        const now = Math.floor(Date.now() / 1000)

        if (lastRenewal) {
          const hoursSinceLastRenewal = (now - lastRenewal) / 3600
          if (hoursSinceLastRenewal < 0.5) { // Less than 30 minutes
            renewalLogger.info(`⏳ WAITING: No block data but recently started session ${(hoursSinceLastRenewal * 60).toFixed(1)} minutes ago`, 'renewal')
            shouldRenew = false
          } else {
            shouldRenew = true
            reason = 'No current block detected and sufficient time passed - starting fresh session'
            renewalLogger.info(`✅ TRIGGER: No block data and last renewal was ${hoursSinceLastRenewal.toFixed(1)} hours ago`, 'renewal')
          }
        } else {
          shouldRenew = true
          reason = 'No current block detected - starting first session'
          renewalLogger.info(`✅ TRIGGER: No block data and no previous renewal recorded`, 'renewal')
        }
      }
      else if (!block.isActive) {
        // Block has expired - check if we should start new session
        const timeRemainingHours = (block.timeRemaining || 0) / 60
        if (timeRemainingHours <= 0) {
          shouldRenew = true
          reason = 'Current block has expired - starting new session'
          renewalLogger.info(`✅ TRIGGER: Block expired`, 'renewal')
        } else {
          // Block shows as inactive but has time remaining - wait
          renewalLogger.info(`⏳ WAITING: Block inactive but has ${timeRemainingHours.toFixed(1)} hours remaining`, 'renewal')
          shouldRenew = false
        }
      }
      else {
        // Block is still active - wait for it to expire
        const timeRemainingHours = (block.timeRemaining || 0) / 60
        renewalLogger.info(`⏳ WAITING: Block still active, ${timeRemainingHours.toFixed(1)} hours remaining`, 'renewal')
        shouldRenew = false
      }

      if (shouldRenew) {
        // Use random delay between 1-5 minutes for all renewals
        const delaySeconds = getRandomRenewalDelay()

        renewalLogger.info(`🚀 SESSION START TRIGGERED: ${reason}`, 'renewal')
        renewalLogger.info(`⏰ Applying random ${delaySeconds}s (${(delaySeconds / 60).toFixed(1)} min) delay before starting Claude session...`, 'renewal')

        // Start session with random delay (non-blocking) and retry logic
        setTimeout(async () => {
          let retryCount = 0
          const maxRetries = 2
          let sessionSuccess = false

          while (retryCount <= maxRetries && !sessionSuccess) {
            try {
              if (retryCount > 0) {
                renewalLogger.info(`🔄 Retry attempt ${retryCount}/${maxRetries} for Claude session start`, 'session')
                // Add exponential backoff for retries
                await new Promise(resolve => setTimeout(resolve, retryCount * 5000))
              }

              renewalLogger.info(`⏳ ${retryCount === 0 ? 'Random delay complete' : 'Retrying'} - calling startClaudeSession() now`, 'renewal')
              renewalLogger.info('📞 CALLING startClaudeSession() NOW', 'session')
              const result = await startClaudeSession()
              renewalLogger.info(`✅ SESSION START RESULT: ${result}`, 'session')

              if (result) {
                renewalLogger.info('🎯 NEW CLAUDE SESSION STARTED SUCCESSFULLY', 'session')
                recordSuccessfulRenewal() // Record the successful renewal
                sessionSuccess = true
              } else {
                renewalLogger.error(`❌ SESSION START FAILED (attempt ${retryCount + 1}/${maxRetries + 1})`, 'session')
                retryCount++
              }
            } catch (sessionError) {
              renewalLogger.error(`💥 Error in session start attempt ${retryCount + 1}: ${sessionError instanceof Error ? sessionError.message : String(sessionError)}`, 'renewal')
              retryCount++
            }
          }

          if (!sessionSuccess) {
            renewalLogger.error(`💥 ALL SESSION START ATTEMPTS FAILED after ${maxRetries + 1} attempts`, 'session')
            renewalLogger.warn(`🔧 Consider checking Claude CLI installation and authentication`, 'session')
          }
        }, delaySeconds * 1000) // Convert seconds to milliseconds

        return { success: true, action: reason }
      } else {
        renewalLogger.info('✋ NO SESSION STARTED - conditions not met', 'renewal')
      }
      
      return { success: true }
    } finally {
      // Always release the lock
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
