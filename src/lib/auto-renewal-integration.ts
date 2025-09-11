/**
 * Auto-renewal service integrationits 
 * Extracted from ClaudeCodeAutoRenew for integration into Claude Sentinel
 */

import * as fs from 'fs'
import * as childProcess from 'child_process'
import * as path from 'path'
import * as os from 'os'

const { existsSync, readFileSync, writeFileSync, unlinkSync, appendFileSync } = fs
const { spawn, spawnSync } = childProcess
const { join } = path
const { homedir } = os

export interface RenewalConfig {
  enabled: boolean
  startTime?: Date // When to start auto-renewal (optional)
  checkInterval: number // Minutes between checks
  enableLogging: boolean
}

export interface RenewalStatus {
  enabled: boolean
  running: boolean
  pid?: number
  lastActivity?: Date
  nextCheck?: Date
  timeUntilReset?: number // minutes
  error?: string
}

const HOME = homedir()
const PID_FILE = join(HOME, '.claude-sentinel-renewal.pid')
const CONFIG_FILE = join(HOME, '.claude-sentinel-config.json')
const LAST_ACTIVITY_FILE = join(HOME, '.claude-last-activity')
const START_TIME_FILE = join(HOME, '.claude-auto-renew-start-time')

// Import renewal logger (dynamic import to avoid circular dependency)
let renewalLogger: any = null
try {
  renewalLogger = require('../../electron/services/log-service').renewalLogger
} catch (error) {
  console.warn('Renewal logger not available in this context')
}

/**
 * Log a message using the renewal log service
 */
function log(message: string, level: 'info' | 'warn' | 'error' = 'info', category: 'schedule' | 'service' | 'renewal' | 'session' = 'service') {
  if (renewalLogger) {
    renewalLogger.log(level, message, category)
  } else {
    // Fallback to console logging
    console.log(`[RENEWAL ${level.toUpperCase()}] [${category.toUpperCase()}] ${message}`)
  }
}

/**
 * Check if ccusage is available and get the command
 */
function getCcUsageCommand(): string | null {
  const commands = ['ccusage', 'bunx ccusage', 'npx ccusage@latest']
  
  for (const cmd of commands) {
    try {
      const result = spawnSync('bash', ['-lc', `command -v ${cmd.split(' ')[0]}`], { 
        encoding: 'utf8' 
      })
      if (result.status === 0) {
        return cmd
      }
    } catch (error) {
      // Continue to next command
    }
  }
  
  return null
}

/**
 * Get minutes until the next billing cycle reset using cached block info
 * This avoids blocking spawnSync calls to ccusage CLI
 */
function getMinutesUntilReset(): number | null {
  try {
    // Import here to avoid circular dependencies
    const { getCurrentBlockInfo } = require('./ccusage-integration')
    const blockInfo = getCurrentBlockInfo()
    
    if (blockInfo && blockInfo.isActive && blockInfo.timeRemaining !== null) {
      return blockInfo.timeRemaining
    }
    
    return null
  } catch (error) {
    log(`Error getting time until reset from cache: ${error}`)
    return null
  }
}

/**
 * Start a new Claude session to keep the billing cycle active
 */
export function startClaudeSession(): boolean {
  try {
    log('Attempting to start Claude session...', 'info', 'session')
    
    // Check if claude command is available with detailed logging
    log('Checking if Claude command is available...', 'info', 'session')
    const checkResult = spawnSync('bash', ['-lc', 'command -v claude'], { encoding: 'utf8' })
    
    log(`Claude command check result: status=${checkResult.status}, stdout="${checkResult.stdout?.trim()}", stderr="${checkResult.stderr?.trim()}"`, 'info', 'session')
    
    if (checkResult.status !== 0) {
      log('Claude command not found - cannot start session', 'error', 'session')
      log(`PATH environment: ${process.env.PATH}`, 'info', 'session')
      return false
    }
    
    log(`Claude command found at: ${checkResult.stdout?.trim()}`, 'info', 'session')
    log('Starting new Claude session...', 'info', 'session')
    
    // Start claude session with a simple greeting
    const child = spawn('bash', ['-lc', 'echo "hi" | claude'], { 
      detached: false,
      stdio: 'pipe',
      env: { ...process.env }
    })
    
    log(`Child process spawned with PID: ${child.pid}`, 'info', 'session')
    
    let completed = false
    let stdoutData = ''
    let stderrData = ''
    
    // Capture stdout and stderr for debugging
    if (child.stdout) {
      child.stdout.on('data', (data) => {
        stdoutData += data.toString()
        log(`Claude session stdout: ${data.toString().trim()}`, 'info', 'session')
      })
    }
    
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        stderrData += data.toString()
        log(`Claude session stderr: ${data.toString().trim()}`, 'warn', 'session')
      })
    }
    
    // Set timeout for the session start
    const timeout = setTimeout(() => {
      if (!completed) {
        log('Claude session timeout after 15s', 'warn', 'session')
        log(`Timeout - stdout: "${stdoutData.trim()}", stderr: "${stderrData.trim()}"`, 'warn', 'session')
        child.kill('SIGTERM')
        
        // Only assume successful if we got some reasonable output
        if (stdoutData.trim().length > 0) {
          log('Timeout but got output - marking as successful', 'info', 'session')
          writeFileSync(LAST_ACTIVITY_FILE, Math.floor(Date.now() / 1000).toString())
          log(`Last activity file written: ${LAST_ACTIVITY_FILE}`, 'info', 'session')
        } else {
          log('Timeout with no output - marking as failed', 'error', 'session')
        }
        completed = true
      }
    }, 15000) // 15 second timeout
    
    child.on('exit', (code: number | null, signal: string | null) => {
      if (completed) return
      
      log(`Child process exited with code: ${code}, signal: ${signal}`, 'info', 'session')
      log(`Final stdout: "${stdoutData.trim()}", stderr: "${stderrData.trim()}"`, 'info', 'session')
      
      clearTimeout(timeout)
      completed = true
      
      if (code === 0) {
        log('Claude session started successfully', 'info', 'session')
        try {
          writeFileSync(LAST_ACTIVITY_FILE, Math.floor(Date.now() / 1000).toString())
          log(`Last activity file written successfully: ${LAST_ACTIVITY_FILE}`, 'info', 'session')
        } catch (writeError) {
          log(`Failed to write last activity file: ${writeError}`, 'error', 'session')
        }
      } else {
        log(`Claude session failed with exit code ${code}`, 'error', 'session')
      }
    })
    
    child.on('error', (error: Error) => {
      if (completed) return
      
      log(`Child process error: ${error.message}`, 'error', 'session')
      log(`Error stack: ${error.stack}`, 'error', 'session')
      
      clearTimeout(timeout)
      completed = true
      log(`Failed to start Claude session: ${error.message}`, 'error', 'session')
    })
    
    child.on('spawn', () => {
      log('Child process spawned successfully', 'info', 'session')
    })
    
    log('Claude session spawn initiated, waiting for completion...', 'info', 'session')
    return true
  } catch (error) {
    log(`Exception starting Claude session: ${error}`, 'error', 'session')
    if (error instanceof Error) {
      log(`Exception stack: ${error.stack}`, 'error', 'session')
    }
    return false
  }
}

/**
 * Calculate appropriate sleep duration based on current status
 * Non-blocking implementation using cached data
 */
function calculateSleepDuration(): number {
  const minutesUntilReset = getMinutesUntilReset()
  
  if (minutesUntilReset && minutesUntilReset > 0) {
    log(`Time remaining in current block: ${minutesUntilReset} minutes`, 'info', 'renewal')
    
    // More frequent checks as we approach reset time
    if (minutesUntilReset <= 5) return 30 // 30 seconds
    if (minutesUntilReset <= 30) return 120 // 2 minutes
    return 600 // 10 minutes
  }
  
  // Fallback to time-based estimation if block info isn't available
  if (existsSync(LAST_ACTIVITY_FILE)) {
    try {
      const lastActivity = parseInt(readFileSync(LAST_ACTIVITY_FILE, 'utf8').trim())
      const now = Math.floor(Date.now() / 1000)
      const timeSinceActivity = now - lastActivity
      const timeUntilReset = 18000 - timeSinceActivity // 5 hours in seconds
      
      if (timeUntilReset <= 300) return 30 // 30 seconds if close to reset
      if (timeUntilReset <= 1800) return 120 // 2 minutes if within 30 min
      return 600 // 10 minutes otherwise
    } catch (error) {
      log(`Error reading last activity: ${error}`, 'error', 'service')
    }
  }
  
  return 300 // Default 5 minutes
}

/**
 * Load renewal configuration
 */
export function loadConfig(): RenewalConfig {
  const defaultConfig: RenewalConfig = {
    enabled: false,
    checkInterval: 5,
    enableLogging: true
  }
  
  try {
    if (existsSync(CONFIG_FILE)) {
      const configData = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
      return { ...defaultConfig, ...configData }
    }
  } catch (error) {
    log(`Error loading config: ${error}`)
  }
  
  return defaultConfig
}

/**
 * Save renewal configuration
 */
export function saveConfig(config: RenewalConfig): void {
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
    log(`Configuration saved: enabled=${config.enabled}`)
  } catch (error) {
    log(`Error saving config: ${error}`)
    throw error
  }
}

export function setScheduledStartTime(isoTime: string | null): { success: boolean; error?: string } {
  try {
    if (!isoTime) {
      if (existsSync(START_TIME_FILE)) unlinkSync(START_TIME_FILE)
      return { success: true }
    }
    writeFileSync(START_TIME_FILE, isoTime)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to set scheduled start time' }
  }
}

/**
 * Get current renewal status
 */
export function getRenewalStatus(): RenewalStatus {
  const config = loadConfig()
  let running = false
  let pid: number | undefined
  
  // Check if process is running
  if (existsSync(PID_FILE)) {
    try {
      const pidString = readFileSync(PID_FILE, 'utf8').trim()
      pid = parseInt(pidString)
      
      // Check if process is still running (Node.js specific)  
      try {
        // In Electron, we have access to process
        const nodeProcess = require('process') as NodeJS.Process
        nodeProcess.kill(pid, 0) // Signal 0 just checks if process exists
        running = true
      } catch (error) {
        // Process not running, clean up stale PID file
        try {
          unlinkSync(PID_FILE)
        } catch {}
        pid = undefined
      }
    } catch (error) {
      log(`Error reading PID file: ${error}`)
    }
  }
  
  // Get last activity
  let lastActivity: Date | undefined
  if (existsSync(LAST_ACTIVITY_FILE)) {
    try {
      const timestamp = parseInt(readFileSync(LAST_ACTIVITY_FILE, 'utf8').trim())
      lastActivity = new Date(timestamp * 1000)
    } catch (error) {
      log(`Error reading last activity: ${error}`, 'error', 'service')
    }
  }
  
  // Get time until reset
  const timeUntilReset = getMinutesUntilReset()
  
  return {
    enabled: config.enabled,
    running,
    pid,
    lastActivity,
  timeUntilReset: timeUntilReset == null ? undefined : timeUntilReset,
    nextCheck: running ? new Date(Date.now() + calculateSleepDuration() * 1000) : undefined
  }
}

/**
 * Start the auto-renewal service
 */
export function startRenewalService(): { success: boolean; error?: string } {
  try {
    const status = getRenewalStatus()
    
    if (status.running) {
      return { success: false, error: 'Service already running' }
    }
    
    log('Auto-renewal service starting...', 'info', 'service')
    
    // Mark as enabled and save config
    const config = loadConfig()
    config.enabled = true
    saveConfig(config)
    
    // Write PID file
    writeFileSync(PID_FILE, process.pid.toString())
    
    // Start monitoring loop (this would run in the main process)
    // For now, just log that we're starting
    log(`Service started with PID ${process.pid}`, 'info', 'service')
    
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    log(`Failed to start service: ${errorMessage}`, 'error', 'service')
    return { success: false, error: errorMessage }
  }
}

/**
 * Stop the auto-renewal service
 */
export function stopRenewalService(): { success: boolean; error?: string } {
  try {
    const config = loadConfig()
    config.enabled = false
    saveConfig(config)
    
    // Clean up PID file
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE)
    }
    
    log('Auto-renewal service stopped', 'info', 'service')
    
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    log(`Failed to stop service: ${errorMessage}`, 'error', 'service')
    return { success: false, error: errorMessage }
  }
}

/**
 * Perform a single renewal check and action if needed
 * Non-blocking implementation that returns immediately
 */
export function performRenewalCheck(): { success: boolean; action?: string; error?: string } {
  try {
    const minutesUntilReset = getMinutesUntilReset()
    let shouldRenew = false
    let reason = ''
    
    if (minutesUntilReset !== null && minutesUntilReset <= 2) {
      shouldRenew = true
      reason = `Reset imminent (${minutesUntilReset} minutes remaining)`
    } else if (existsSync(LAST_ACTIVITY_FILE)) {
      const lastActivity = parseInt(readFileSync(LAST_ACTIVITY_FILE, 'utf8').trim())
      const now = Math.floor(Date.now() / 1000)
      const timeSinceActivity = now - lastActivity
      
      if (timeSinceActivity >= 18000) { // 5 hours
        shouldRenew = true
        reason = '5 hours elapsed since last activity'
      }
    } else {
      shouldRenew = true
      reason = 'No previous activity recorded'
    }
    
    if (shouldRenew) {
      log(`Renewal needed: ${reason}`, 'info', 'renewal')
      
      // Start session asynchronously without blocking (fire and forget)
      setImmediate(() => {
        try {
          startClaudeSession()
        } catch (error) {
          log(`Error starting Claude session asynchronously: ${error}`, 'error', 'renewal')
        }
      })
      
      return { success: true, action: reason }
    } else {
      const nextCheckIn = Math.round(calculateSleepDuration() / 60)
      log(`No renewal needed. Next check in ${nextCheckIn} minutes`, 'info', 'renewal')
      return { success: true }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    log(`Error during renewal check: ${errorMessage}`, 'error', 'renewal')
    return { success: false, error: errorMessage }
  }
}
