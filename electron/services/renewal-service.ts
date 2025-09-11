/**
 * Auto-renewal service for Electron main process
 * Non-blocking implementations that avoid shelling out on the main thread.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

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
const LAST_ACTIVITY_FILE = join(HOME, '.claude-last-activity')
const START_TIME_FILE = join(HOME, '.claude-auto-renew-start-time')

type SimpleConfig = { enabled: boolean; checkInterval?: number; enableLogging?: boolean }

// Exported so the main process can auto-start monitoring on launch
export function loadConfig(): SimpleConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
      return { enabled: !!cfg.enabled, checkInterval: cfg.checkInterval, enableLogging: cfg.enableLogging }
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

function readLastActivity(): Date | null {
  try {
    if (!existsSync(LAST_ACTIVITY_FILE)) return null
    const ts = parseInt(readFileSync(LAST_ACTIVITY_FILE, 'utf8').trim(), 10)
    if (Number.isFinite(ts)) return new Date(ts * 1000)
  } catch {}
  return null
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
  const lastActivity = readLastActivity()
  const block = getCurrentBlockInfoLib()

  const timeRemaining = block?.timeRemaining ?? null
  const currentBlock = block && block.isActive ? {
    startTime: block.startTime ? new Date(block.startTime) : null,
    endTime: block.endTime ? new Date(block.endTime) : null,
    usage: block.usage || 0,
    limit: block.limit || 0
  } : null

  const scheduledStartTime = readScheduledStart()

  return {
    enabled: cfg.enabled,
    running: proc.running,
    pid: proc.pid,
    lastActivity,
    timeRemaining,
    nextRenewal: timeRemaining != null ? new Date(Date.now() + timeRemaining * 60 * 1000) : null,
    scheduledStartTime,
    currentBlock
  }
}

// Decide renewal using current block info to avoid shelling out
export function performRenewalCheck(): { success: boolean; action?: string; error?: string } {
  try {
    renewalLogger.info('Starting renewal check...', 'renewal')
    
    const block = getCurrentBlockInfoLib()
    const minutesUntilReset = block?.timeRemaining ?? null
    const lastActivity = readLastActivity()
    const nowSec = Math.floor(Date.now() / 1000)
    const lastActivitySec = lastActivity ? Math.floor(lastActivity.getTime() / 1000) : null
    const timeSinceActivity = lastActivitySec ? nowSec - lastActivitySec : null

    renewalLogger.info(`Renewal check state: block=${JSON.stringify(block)}, minutesUntilReset=${minutesUntilReset}, lastActivity=${lastActivity}, timeSinceActivity=${timeSinceActivity}`, 'renewal')

    let shouldRenew = false
    let reason = ''
    const hasActiveBlock = !!(block && block.isActive)

    renewalLogger.info(`Block analysis: hasActiveBlock=${hasActiveBlock}, isActive=${block?.isActive}, timeRemaining=${block?.timeRemaining}`, 'renewal')

    if (minutesUntilReset !== null && minutesUntilReset <= 2) {
      shouldRenew = true
      reason = `Reset imminent (${minutesUntilReset} minutes remaining)`
      renewalLogger.info(`Trigger condition: Reset imminent`, 'renewal')
    } else if (!hasActiveBlock) {
      // No active block detected; start a session unless we very recently had activity (< 60s)
      renewalLogger.info(`No active block detected. lastActivitySec=${lastActivitySec}, timeSinceActivity=${timeSinceActivity}`, 'renewal')
      if (!lastActivitySec || (timeSinceActivity != null && timeSinceActivity > 60)) {
        shouldRenew = true
        reason = 'No active block – starting new session'
        renewalLogger.info(`Trigger condition: No active block and sufficient time since activity`, 'renewal')
      } else {
        renewalLogger.info(`Skipping renewal: recent activity detected (${timeSinceActivity}s ago)`, 'renewal')
      }
    } else if (timeSinceActivity != null && timeSinceActivity >= 18000) { // 5h gap
      shouldRenew = true
      reason = '5 hours elapsed since last activity'
      renewalLogger.info(`Trigger condition: 5 hour gap`, 'renewal')
    } else if (lastActivitySec == null) {
      shouldRenew = true
      reason = 'No previous activity recorded'
      renewalLogger.info(`Trigger condition: No previous activity`, 'renewal')
    } else {
      renewalLogger.info(`No renewal needed: hasActiveBlock=${hasActiveBlock}, timeSinceActivity=${timeSinceActivity}`, 'renewal')
    }

    if (shouldRenew) {
      renewalLogger.info(`Renewal triggered: ${reason}`, 'renewal')
      renewalLogger.info('Starting Claude session via setTimeout...', 'renewal')
      
      // Start session asynchronously (non-blocking)
      setTimeout(() => {
        try { 
          renewalLogger.info('setTimeout callback executing - calling startClaudeSession()', 'renewal')
          const result = startClaudeSession()
          renewalLogger.info(`startClaudeSession() returned: ${result}`, 'renewal')
        } catch (sessionError) {
          renewalLogger.error(`Error in setTimeout callback: ${sessionError instanceof Error ? sessionError.message : String(sessionError)}`, 'renewal')
        }
      }, 0)
      return { success: true, action: reason }
    }
    renewalLogger.info('Renewal check: no action needed', 'renewal')
    return { success: true }
  } catch (error) {
    renewalLogger.error(`Renewal check failed: ${error instanceof Error ? error.message : String(error)}`, 'renewal')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Still re-export start/stop controls
export const startRenewalService = startRenewalServiceLib
export const stopRenewalService = stopRenewalServiceLib
