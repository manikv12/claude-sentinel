/**
 * Auto-renewal service integration
 * Extracted from ClaudeCodeAutoRenew for integration into Claude Sentinel
 */

const fs = require('fs')
const childProcess = require('child_process')
const path = require('path')
const os = require('os')

// Import ccusage-integration at the top
import { getCurrentBlockInfo as getCurrentBlockInfoLib } from './ccusage-integration'

const { existsSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, mkdirSync } = fs
const { spawn, spawnSync } = childProcess
const { join } = path
const { homedir } = os

// Get app data directory - prefer Electron app.getPath if available, fallback to home
function getAppDataDir(): string {
  try {
    // Try to use Electron's app.getPath if available
    const electron = require('electron')
    const app = electron.app || electron.remote?.app
    if (app) {
      return app.getPath('userData')
    }
  } catch {
    // Fallback to home directory if not in Electron context
  }
  return join(homedir(), '.claude-sentinel')
}

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

const APP_DATA_DIR = getAppDataDir()
const PID_FILE = join(APP_DATA_DIR, 'renewal.pid')
const CONFIG_FILE = join(APP_DATA_DIR, 'config.json')
const LAST_ACTIVITY_FILE = join(APP_DATA_DIR, 'last-activity')
const START_TIME_FILE = join(APP_DATA_DIR, 'auto-renew-start-time')

// Helper function to ensure directory exists before file operations
function ensureAppDataDir() {
  if (!existsSync(APP_DATA_DIR)) {
    mkdirSync(APP_DATA_DIR, { recursive: true })
  }
}

// Import renewal logger (dynamic import to avoid circular dependency)
let renewalLogger: any = null
try {
  renewalLogger = require('./log-service').renewalLogger
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
    const blockInfo = getCurrentBlockInfoLib()
    
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
export function startClaudeSession(): Promise<boolean> {
  try {
    log('Attempting to start Claude session...', 'info', 'session')
    
    // Check if claude command is available with detailed logging
    log('Checking if Claude command is available...', 'info', 'session')
    const checkResult = spawnSync('bash', ['-lc', 'command -v claude'], { encoding: 'utf8' })
    
    log(`Claude command check result: status=${checkResult.status}, stdout="${checkResult.stdout?.trim()}", stderr="${checkResult.stderr?.trim()}"`, 'info', 'session')
    
    if (checkResult.status !== 0) {
      log('Claude command not found - cannot start session', 'error', 'session')
      log(`PATH environment: ${process.env.PATH}`, 'info', 'session')
      return Promise.resolve(false)
    }
    
    log(`Claude command found at: ${checkResult.stdout?.trim()}`, 'info', 'session')
    log('Starting new Claude session...', 'info', 'session')
    
    // Start claude session with proper conversation initialization
    const child = spawn('bash', ['-lc', 'claude'], {
      detached: false,
      stdio: 'pipe',
      env: { ...process.env }
    })

    // Send a simple greeting to start the session
    if (child.stdin) {
      child.stdin.write('hi\n')
      child.stdin.end()
    }
    
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
        
        // Look for Claude's response patterns to determine success
        const hasClaudeResponse = stdoutData.includes('Hi!') || stdoutData.includes('Hello') ||
                                  stdoutData.includes('claude') || stdoutData.trim().length > 10

        if (hasClaudeResponse) {
          log('⏰ Timeout but detected Claude response - marking as successful', 'info', 'session')
          log(`🔄 Session activity detected at: ${new Date().toLocaleString()}`, 'info', 'session')
        } else {
          log('⏰ Timeout with no Claude response - marking as failed', 'error', 'session')
          log(`Stdout was: "${stdoutData.trim()}", stderr: "${stderrData.trim()}"`, 'error', 'session')
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
      
      // Check for successful session based on output content and exit code
      const hasValidResponse = stdoutData.trim().length > 5 && !stderrData.includes('Error')
      const sessionSuccessful = (code === 0 || hasValidResponse)

      if (sessionSuccessful) {
        log('✅ Claude session started successfully', 'info', 'session')
        log(`🔄 Session completed successfully at: ${new Date().toLocaleString()}`, 'info', 'session')
        log(`Session output: "${stdoutData.trim().slice(0, 100)}"`, 'info', 'session')
      } else {
        log(`❌ Claude session failed with exit code ${code}`, 'error', 'session')
        log(`Failed session stderr: "${stderrData.trim()}"`, 'error', 'session')
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

    // Return a promise-based result instead of always true
    return new Promise<boolean>((resolve) => {
      const originalTimeout = setTimeout(() => {
        if (!completed) {
          resolve(false) // Session failed
        }
      }, 16000) // Slightly longer than child timeout

      const originalExit = child.on('exit', (code) => {
        clearTimeout(originalTimeout)
        const hasValidResponse = stdoutData.trim().length > 5 && !stderrData.includes('Error')
        const sessionSuccessful = (code === 0 || hasValidResponse)
        resolve(sessionSuccessful)
      })

      const originalError = child.on('error', () => {
        clearTimeout(originalTimeout)
        resolve(false)
      })
    })
  } catch (error) {
    log(`Exception starting Claude session: ${error}`, 'error', 'session')
    if (error instanceof Error) {
      log(`Exception stack: ${error.stack}`, 'error', 'session')
    }
    return Promise.resolve(false)
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
  
  // No block info available, use default intervals
  log('No current block data available for sleep calculation', 'warn', 'service')
  
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
    ensureAppDataDir()
    
    // Save to legacy config file for backwards compatibility
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
    
    // Also save to main settings file to keep them synchronized
    const SETTINGS_FILE = join(APP_DATA_DIR, 'settings.json')
    let settings = {}
    try {
      if (existsSync(SETTINGS_FILE)) {
        settings = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))
      }
    } catch (error) {
      log(`Warning: Could not read main settings file: ${error}`, 'warn', 'service')
    }
    
    // Update autoRenewal section in main settings
    settings = {
      ...settings,
      autoRenewal: {
        ...(settings as any).autoRenewal || {},
        enabled: config.enabled,
        checkInterval: config.checkInterval || 5,
        enableLogging: config.enableLogging !== false
      }
    }
    
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
    log(`Configuration saved to both files: enabled=${config.enabled}`)
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
    ensureAppDataDir()
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
  
  // Get last activity from current block instead of file
  let lastActivity: Date | undefined
  let block: any = null
  try {
    block = getCurrentBlockInfoLib()
    lastActivity = block && block.startTime ? new Date(block.startTime) : undefined
  } catch (error) {
    // Fallback if ccusage-integration is not available
    lastActivity = undefined
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
    ensureAppDataDir()
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
 * Reset session tracking files to handle orphaned sessions
 */
export function resetSessionTracking(): { success: boolean; error?: string } {
  try {
    const filesToReset = [
      LAST_ACTIVITY_FILE, 
      START_TIME_FILE,
      join(APP_DATA_DIR, 'last-block-state'),
      join(homedir(), '.claude-last-renewal-check'),
      join(homedir(), '.claude-sentinel-renewal-lock')
    ]
    const resetFiles: string[] = []
    
    for (const file of filesToReset) {
      if (existsSync(file)) {
        unlinkSync(file)
        resetFiles.push(file)
        log(`Deleted session file: ${file}`, 'info', 'session')
      }
    }
    
    if (resetFiles.length > 0) {
      log(`Session reset complete. Deleted ${resetFiles.length} files: ${resetFiles.map(f => f.split('/').pop()).join(', ')}`, 'info', 'session')
      return { success: true }
    } else {
      log('No session files found to reset', 'info', 'session')
      return { success: true }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    log(`Failed to reset session tracking: ${errorMessage}`, 'error', 'session')
    return { success: false, error: errorMessage }
  }
}

/**
 * Force start a new Claude session and reset tracking
 */
export async function forceStartNewSession(): Promise<{ success: boolean; error?: string }> {
  try {
    log('Force starting new Claude session...', 'info', 'session')

    // Reset session tracking first
    const resetResult = resetSessionTracking()
    if (!resetResult.success) {
      return resetResult
    }

    // Start new session
    const sessionResult = await startClaudeSession()
    if (sessionResult) {
      log('New session forced successfully', 'info', 'session')
      return { success: true }
    } else {
      log('Failed to force start new session', 'error', 'session')
      return { success: false, error: 'Failed to start Claude session' }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    log(`Error forcing new session: ${errorMessage}`, 'error', 'session')
    return { success: false, error: errorMessage }
  }
}

/**
 * Get session status and detect potential orphans
 */
export function getSessionStatus(): { 
  hasLocalActivity: boolean; 
  lastActivityTime?: Date; 
  timeSinceActivity?: number;
  sessionFiles: string[];
  orphanedSession: boolean;
} {
  const sessionFiles: string[] = []
  // Include all Claude-related files that might exist
  const allSessionFiles = [
    LAST_ACTIVITY_FILE,
    START_TIME_FILE, 
    PID_FILE,
    CONFIG_FILE,
    join(APP_DATA_DIR, 'last-block-state'),
    join(homedir(), '.claude-last-renewal-check'),
    join(homedir(), '.claude-sentinel-renewal-lock')
  ]
  
  for (const file of allSessionFiles) {
    if (existsSync(file)) {
      sessionFiles.push(file.split('/').pop() || file)
    }
  }
  
  // Use block data instead of lastActivity file for session status
  let block: any = null
  try {
    block = getCurrentBlockInfoLib()
  } catch (error) {
    // Fallback if ccusage-integration is not available
    block = null
  }
  
  let lastActivityTime: Date | undefined
  let timeSinceActivity: number | undefined
  let orphanedSession = false
  
  if (block && block.startTime) {
    lastActivityTime = new Date(block.startTime)
    timeSinceActivity = Math.floor((Date.now() - lastActivityTime.getTime()) / 1000)
    
    // Consider session orphaned if block is inactive but should still be active
    if (!block.isActive && block.timeRemaining && block.timeRemaining > 0) {
      orphanedSession = true
      log(`Potential orphaned session detected: block shows inactive but should have ${block.timeRemaining} minutes remaining`, 'warn', 'session')
    }
  }
  
  return {
    hasLocalActivity: !!lastActivityTime,
    lastActivityTime,
    timeSinceActivity,
    sessionFiles,
    orphanedSession
  }
}

// Note: performRenewalCheck is now handled by renewal-service.ts to maintain single source of truth
