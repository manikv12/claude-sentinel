import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, Notification } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { isDev } from './utils'
import { loadUsageData, getRecentUsage, getCurrentBlockInfo, resetUsageCache } from './services/ccusage-service'
import { 
  getRenewalStatus, 
  startRenewalService, 
  stopRenewalService,
  performRenewalCheck,
  setScheduledStartTime,
  loadConfig
} from './services/renewal-service'
import { renewalLogger } from './services/log-service'

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'] || 'http://localhost:5173'

let mainWindow: BrowserWindow | null = null
let floatingWindow: BrowserWindow | null = null
let tray: Tray | null = null
let trayUsageInterval: NodeJS.Timeout | null = null

// Create a small dot icon for auto-renewal status
const createStatusDotIcon = (options?: { size?: number; enabled?: boolean }) => {
  const size = options?.size ?? 18
  const isEnabled = options?.enabled ?? false
  
  // Use red for disabled, green for enabled
  const color = isEnabled ? '#22c55e' : '#ef4444' // Green or red
  
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${size/2}" cy="${size/2}" r="4" fill="${color}"/>
  </svg>`
  
  console.log(`Creating status dot: ${isEnabled ? 'enabled (green)' : 'disabled (red)'}`)
  
  const image = nativeImage.createFromBuffer(Buffer.from(svg))
  image.setTemplateImage(false) // Don't use template mode for colored dots
  
  if (image.isEmpty()) {
    console.error('Status dot creation failed - falling back to activity icon')
    return createActivityIcon({ size, color: '#000000', template: true })
  }
  
  return image
}

// Create an app icon matching the sidebar's Activity logo (lucide) - keep for non-tray uses
const createActivityIcon = (options?: { size?: number; color?: string; template?: boolean }) => {
  const size = options?.size ?? 24
  const color = options?.color ?? '#3b82f6' // Tailwind blue-500
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M22 12h-4l-3 7-4-14-3 7H2" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <title>Claude Sentinel</title>
</svg>`
  const image = nativeImage.createFromBuffer(Buffer.from(svg))
  if (process.platform === 'darwin' && options?.template) {
    image.setTemplateImage(true)
  }
  return image
}

// Helpers for tray usage display
const formatMinutes = (minutes: number | null) => {
  if (minutes === null || minutes < 0) return '—'
  const h = Math.floor(minutes / 60)
  const m = Math.floor(minutes % 60)
  if (h <= 0) return `${m}m`
  if (m <= 0) return `${h}h`
  return `${h}h ${m}m`
}

const formatTokens = (tokens: number) => {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(2)}B`
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toLocaleString()
}

const getUsagePercent = () => {
  try {
    const block = getCurrentBlockInfo()
    if (!block || !block.limit || block.limit <= 0) return { percent: null as number | null, block }
    const percent = Math.max(0, Math.min(100, Math.round((block.usage / block.limit) * 100)))
    return { percent, block }
  } catch {
    return { percent: null as number | null, block: null as any }
  }
}

const updateTrayUsage = () => {
  if (!tray) return
  const { percent, block } = getUsagePercent()

  // Update tray icon to colored dot based on auto-renewal status
  try {
    // Check auto-renewal status for dot color
    let isRenewalEnabled = false
    try {
      const configFile = path.join(os.homedir(), '.claude-sentinel-config.json')
      if (fs.existsSync(configFile)) {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
        isRenewalEnabled = config.enabled || false
      }
    } catch (configError) {
      // Keep disabled state if we can't read config
    }
    
    const statusDotIcon = createStatusDotIcon({ 
      size: 18, 
      enabled: isRenewalEnabled
    })
    tray.setImage(statusDotIcon)
    console.log(`Updated tray dot icon: ${isRenewalEnabled ? 'green (enabled)' : 'red (disabled)'}`)
  } catch (error) {
    console.warn('Failed to update tray dot icon:', error)
  }

  // Show percentage text on macOS
  if (process.platform === 'darwin') {
    try {
      const displayText = percent === null ? '—' : `${percent}%`
      tray.setTitle(displayText)
    } catch {}
  }

  // Tooltip with details including next renewal time
  const timeLeft = block?.timeRemaining ?? null
  const usageText = block ? `${formatTokens(block.usage)} / ${formatTokens(block.limit || 0)} tokens` : 'Usage unavailable'
  
  // Get next renewal time
  let renewalInfo = ''
  try {
    const configFile = path.join(os.homedir(), '.claude-sentinel-config.json')
    if (fs.existsSync(configFile)) {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
      if (config.enabled) {
        renewalInfo = '\nAuto-renewal: ON'
        // Calculate next renewal time (assuming monthly billing cycle)
        const now = new Date()
        const nextRenewal = new Date(now.getFullYear(), now.getMonth() + 1, 1) // First day of next month
        const daysUntilRenewal = Math.ceil((nextRenewal.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        renewalInfo += `\nNext renewal: ${daysUntilRenewal} days`
      } else {
        renewalInfo = '\nAuto-renewal: OFF'
      }
    }
  } catch (configError) {
    renewalInfo = '\nAuto-renewal: Status unknown'
  }
  
  const tooltip = `Claude Sentinel\n${percent === null ? '' : `Usage: ${percent}%\n`}${usageText}${timeLeft !== null ? `\nTime remaining: ${formatMinutes(timeLeft)}` : ''}${renewalInfo}`.trim()
  try { tray.setToolTip(tooltip) } catch {}

  // Refresh tray context menu to reflect latest usage
  try { updateTrayMenu() } catch {}
}

const startTrayUsageUpdates = () => {
  // Immediately update once tray exists
  updateTrayUsage()
  // Refresh every minute
  if (trayUsageInterval) { clearInterval(trayUsageInterval); trayUsageInterval = null }
  trayUsageInterval = setInterval(updateTrayUsage, 60 * 1000)
}

const createWindow = () => {
  // Prevent creating multiple windows
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return mainWindow
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    transparent: true,
    backgroundColor: 'rgba(0, 0, 0, 0)',
    // Use inset style on macOS for a more integrated look
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 20, y: 10 } : undefined,
    icon: process.platform !== 'darwin' ? createActivityIcon({ size: 256, color: '#3b82f6' }) : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Load the app
  if (isDev) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Open DevTools for debugging
  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Hide floating window when main window is restored/shown and show dock icon
  mainWindow.on('restore', () => {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.close()
    }
    // Show dock icon when window is restored on macOS
    if (process.platform === 'darwin') {
      try { if (app.dock) app.dock.show() } catch {}
    }
  })

  mainWindow.on('show', () => {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.close()
    }
    // Show dock icon when window is shown on macOS
    if (process.platform === 'darwin') {
      try { if (app.dock) app.dock.show() } catch {}
    }
  })

  // Handle minimize behavior based on user settings
  mainWindow.on('minimize', async (event: Electron.Event) => {
    try {
      // Load user settings to check minimize behavior preference
      const settingsFile = getSettingsFilePath()
      let userSettings = getDefaultSettings()
      
      if (fs.existsSync(settingsFile)) {
        try {
          const fileContent = fs.readFileSync(settingsFile, 'utf8')
          const savedSettings = JSON.parse(fileContent)
          userSettings = { ...userSettings, ...savedSettings }
        } catch (parseError) {
          console.warn('Could not parse settings file, using defaults for minimize behavior')
        }
      }
      
      // Handle minimize behavior based on user preference
      if (userSettings.minimizeBehavior === 'floating') {
        // Show floating window when main window is minimized
        createFloatingWindow()
      }
      
      if (process.platform === 'darwin') {
        // On macOS, hide dock icon when minimized since app is only in top bar
        try { if (app.dock) app.dock.hide() } catch {}
        return
      }
      
      // On Windows/Linux, respect tray setting
      if (userSettings.minimizeToTray) {
        event.preventDefault()
        mainWindow?.hide()
      }
    } catch (error) {
      console.error('Error handling minimize event:', error)
      // Fallback to default behavior
      createFloatingWindow()
    }
  })
}

const createFloatingWindow = () => {
  // Prevent creating multiple floating windows
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.show()
    floatingWindow.focus()
    return floatingWindow
  }

  floatingWindow = new BrowserWindow({
    width: 320,
    height: 180,
    minWidth: 280,
    minHeight: 160,
    maxWidth: 400,
    maxHeight: 220,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: 'rgba(0, 0, 0, 0)',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    titleBarOverlay: process.platform !== 'darwin' ? {
      color: 'rgba(0, 0, 0, 0)',
      symbolColor: 'white',
      height: 30
    } : false,
    trafficLightPosition: process.platform === 'darwin' ? { x: 15, y: 15 } : undefined,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Load the floating view
  if (isDev) {
    floatingWindow.loadURL(VITE_DEV_SERVER_URL + '/#/floating')
  } else {
    floatingWindow.loadFile(join(__dirname, '../renderer/index.html'), { 
      hash: '#/floating' 
    })
  }

  // Handle window closed
  floatingWindow.on('closed', () => {
    floatingWindow = null
  })

  // Handle close button clicked (from traffic lights or custom button)
  floatingWindow.on('close', (event) => {
    // Allow window to close normally
    floatingWindow = null
  })

  // Keep window always on top
  floatingWindow.setAlwaysOnTop(true, 'floating')
  
  // Set window level for macOS to ensure it stays on top
  if (process.platform === 'darwin') {
    floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  try { if (app.dock) app.dock.show() } catch {}
  }

  return floatingWindow
}

const createTray = () => {
  // Create initial red dot (auto-renewal disabled by default)
  let trayIcon
  try {
    trayIcon = createStatusDotIcon({ 
      size: 18, 
      enabled: false // Start with red dot (disabled)
    })
    
    // If dot icon is empty, fall back to activity icon
    if (trayIcon.isEmpty()) {
      console.warn('Status dot icon is empty, falling back to activity icon')
      trayIcon = createActivityIcon({ size: 18, color: '#000000', template: true })
    }
  } catch (error) {
    console.error('Failed to create status dot icon, falling back to activity icon:', error)
    trayIcon = createActivityIcon({ size: 18, color: '#000000', template: true })
  }

  console.log('Creating tray with status dot icon')
  tray = new Tray(trayIcon)
  
  // Verify tray was created successfully
  if (!tray || tray.isDestroyed()) {
    console.error('Failed to create tray')
    return
  }
  
  console.log('Tray created successfully')
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Usage: updating…',
      enabled: false
    },
    {
      label: 'Time remaining: —',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Show Claude Sentinel',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
          // Show dock icon when showing window on macOS
          if (process.platform === 'darwin') {
            try { if (app.dock) app.dock.show() } catch {}
          }
        } else {
          createWindow()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Auto-Renewal Status',
      enabled: false
    },
    {
      label: 'Enable Auto-Renewal',
      type: 'checkbox',
      checked: false,
      click: (menuItem) => {
        // Toggle auto-renewal
        mainWindow?.webContents.send('toggle-auto-renewal', menuItem.checked)
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      accelerator: process.platform === 'darwin' ? 'Command+Q' : 'Ctrl+Q',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setToolTip('Claude Sentinel - Usage Monitor & Auto-Renewal')
  tray.setContextMenu(contextMenu)

  // Handle tray click - show context menu only (no direct app opening)
  // Note: The context menu will be shown automatically on click, we don't need to handle direct clicks

  // Start periodic usage updates for tray title/tooltip
  startTrayUsageUpdates()
}

// App event handlers
app.whenReady().then(() => {
  createWindow()
  createTray()
  // Ensure Dock icon is explicitly set and shown on macOS
  if (process.platform === 'darwin' && app.dock) {
    try {
      const icnsPath = path.join(process.resourcesPath, 'icon.icns')
      if (fs.existsSync(icnsPath)) {
        app.dock.setIcon(icnsPath)
      } else {
        // Fallback to generated colored icon
        const dockIcon = createActivityIcon({ size: 256, color: '#3b82f6' })
        app.dock.setIcon(dockIcon)
      }
      app.dock.show()
    } catch {
      // Best-effort; ignore failures
    }
  }
  try {
    const cfg = loadConfig()
    if (cfg.enabled) startRenewalMonitoring()
  } catch {}
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  // Keep app running in system tray
  if (process.platform !== 'darwin') {
    // On Windows/Linux, keep running for system tray
    return
  }
  app.quit()
})

app.on('before-quit', () => {
  // Clean up tray
  if (tray) {
    tray.destroy()
  }
  if (trayUsageInterval) {
    clearInterval(trayUsageInterval)
    trayUsageInterval = null
  }
})


// Timer-based renewal scheduling
let renewalTimer: NodeJS.Timeout | null = null

// Configuration for grace periods
const RENEWAL_CONFIG = {
  gracePeriod: {
    min: 30,  // seconds
    max: 60   // seconds
  },
  fallbackCheckInterval: 30 * 60 * 1000, // 30 minutes in ms for emergency fallback only
}

// Helper to add grace period to any time
const addGracePeriod = (targetTime: Date) => {
  const gracePeriodMs = (RENEWAL_CONFIG.gracePeriod.min + Math.random() * (RENEWAL_CONFIG.gracePeriod.max - RENEWAL_CONFIG.gracePeriod.min)) * 1000
  return {
    renewalTime: new Date(targetTime.getTime() + gracePeriodMs),
    gracePeriodSeconds: Math.round(gracePeriodMs / 1000)
  }
}

// Smart timer-based renewal scheduling
const scheduleNextRenewal = () => {
  // Clear any existing timer
  if (renewalTimer) {
    clearTimeout(renewalTimer)
    renewalTimer = null
  }

  try {
    const status = getRenewalStatus()
    
    // Only schedule if auto-renewal is enabled
    if (!status.enabled || !status.running) {
      renewalLogger.info('Auto-renewal disabled, not scheduling next renewal', 'service')
      return
    }

    const now = new Date()
    let targetTime: Date | null = null
    let reason = ''

    // Priority 1: User scheduled time (always takes precedence if set)
    if (status.scheduledStartTime) {
      const scheduledTime = new Date(status.scheduledStartTime)
      
      if (scheduledTime > now) {
        targetTime = scheduledTime
        reason = 'scheduled start'
        renewalLogger.info(`User scheduled time found: ${targetTime.toISOString()} - ignoring block expiration`, 'schedule')
      } else {
        // Scheduled time has just passed (within last 5 minutes) - trigger immediate renewal
        const timeSinceScheduled = now.getTime() - scheduledTime.getTime()
        const fiveMinutesInMs = 5 * 60 * 1000
        
        if (timeSinceScheduled <= fiveMinutesInMs) {
          renewalLogger.info(`Scheduled time recently passed (${Math.round(timeSinceScheduled / 1000)}s ago), triggering immediate renewal`, 'schedule')
          
          // Trigger immediate renewal
          setTimeout(() => {
            try {
              renewalLogger.info('Executing immediate scheduled renewal', 'renewal')
              const result = performRenewalCheck()
              
              // Send status updates
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('renewal-status-update', getRenewalStatus())
              }
              if (result.success && result.action && tray) {
                updateTrayMenu()
              }
              
              // Schedule next renewal after immediate execution
              setTimeout(() => scheduleNextRenewal(), 2000)
            } catch (error) {
              renewalLogger.error(`Error in immediate scheduled renewal: ${error instanceof Error ? error.message : String(error)}`, 'renewal')
            }
          }, 1000) // Small delay to ensure proper execution
          
          return // Exit early after scheduling immediate renewal
        }
      }
    }
    // Priority 2: Block expiration (only if no scheduled time)
    else if (status.currentBlock?.endTime && new Date(status.currentBlock.endTime) > now) {
      targetTime = new Date(status.currentBlock.endTime)
      reason = 'block expiration'
    }
    // Priority 3: Next renewal time (fallback calculation)
    else if (status.nextRenewal && status.nextRenewal > now) {
      targetTime = status.nextRenewal
      reason = 'calculated renewal'
    }

    if (targetTime && targetTime > now) {
      const { renewalTime, gracePeriodSeconds } = addGracePeriod(targetTime)
      const delay = renewalTime.getTime() - now.getTime()

      if (delay > 0) {
        renewalTimer = setTimeout(() => {
          try {
            renewalLogger.info(`Executing scheduled renewal (${reason})`, 'renewal')
            const result = performRenewalCheck()
            
            // Send status updates
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('renewal-status-update', getRenewalStatus())
            }
            if (result.success && result.action && tray) {
              updateTrayMenu()
            }
            
            // Schedule next renewal
            setTimeout(() => scheduleNextRenewal(), 2000) // Brief delay before rescheduling
          } catch (error) {
            renewalLogger.error(`Error in scheduled renewal: ${error instanceof Error ? error.message : String(error)}`, 'renewal')
            // Retry scheduling in 1 minute
            renewalTimer = setTimeout(() => scheduleNextRenewal(), 60000)
          }
        }, delay)

        renewalLogger.info(`Next ${reason} at ${targetTime.toISOString()}, renewal scheduled for ${renewalTime.toISOString()} (${gracePeriodSeconds}s grace period)`, 'schedule')
      } else {
        renewalLogger.warn(`Target time ${targetTime.toISOString()} is in the past, checking immediately`, 'schedule')
        // Schedule immediate check
        renewalTimer = setTimeout(() => {
          performRenewalCheck()
          scheduleNextRenewal()
        }, 1000)
      }
    } else {
      // No valid target time - only use emergency fallback if system is in unknown state
      const currentStatus = getRenewalStatus()
      if (!currentStatus.currentBlock && currentStatus.enabled && currentStatus.running) {
        renewalLogger.warn(`No current block detected and no renewal time available, using emergency fallback check in ${RENEWAL_CONFIG.fallbackCheckInterval / 60000} minutes`, 'schedule')
        renewalTimer = setTimeout(() => {
          try {
            performRenewalCheck()
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('renewal-status-update', getRenewalStatus())
            }
            scheduleNextRenewal() // Reschedule once to see if we now have valid timing
          } catch (error) {
            renewalLogger.error(`Error in emergency fallback renewal check: ${error instanceof Error ? error.message : String(error)}`, 'renewal')
          }
        }, RENEWAL_CONFIG.fallbackCheckInterval)
      } else {
        renewalLogger.info(`No specific renewal time available but system appears stable - waiting for next status change`, 'schedule')
        // Do not schedule any fallback - wait for external triggers or schedule changes
      }
    }
  } catch (error) {
    renewalLogger.error(`Error scheduling next renewal: ${error instanceof Error ? error.message : String(error)}`, 'schedule')
    // Retry in 1 minute
    renewalTimer = setTimeout(() => scheduleNextRenewal(), 60000)
  }
}

// Start renewal monitoring when app starts
const startRenewalMonitoring = () => {
  if (renewalTimer) {
    renewalLogger.info('Renewal monitoring already active', 'service')
    return
  }

  renewalLogger.info('Starting timer-based renewal monitoring', 'service')
  scheduleNextRenewal()
}

const stopRenewalMonitoring = () => {
  if (renewalTimer) {
    clearTimeout(renewalTimer)
    renewalTimer = null
  }
  renewalLogger.info('Renewal monitoring stopped', 'service')
}

const updateTrayMenu = () => {
  if (!tray) return
  
  const status = getRenewalStatus()
  const block = getCurrentBlockInfo()
  const percent = block && block.limit > 0 ? Math.max(0, Math.min(100, Math.round((block.usage / block.limit) * 100))) : null
  const usageLine = percent === null ? 'Usage: unknown' : `Usage: ${percent}% (${formatTokens(block.usage)} / ${formatTokens(block.limit)})`
  const timeLine = `Time remaining: ${formatMinutes(block?.timeRemaining ?? null)}`
  const contextMenu = Menu.buildFromTemplate([
    {
      label: usageLine,
      enabled: false
    },
    {
      label: timeLine,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Show Claude Sentinel',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
          // Show dock icon when showing window on macOS
          if (process.platform === 'darwin') {
            try { if (app.dock) app.dock.show() } catch {}
          }
        } else {
          createWindow()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Auto-Renewal Status',
      enabled: false
    },
    {
      label: 'Enable Auto-Renewal',
      type: 'checkbox',
      checked: status.enabled,
      click: async (menuItem) => {
        try {
          if (menuItem.checked) {
            await startRenewalService()
            startRenewalMonitoring()
          } else {
            await stopRenewalService()
            stopRenewalMonitoring()
          }
          
          // Notify renderer
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('renewal-status-update', getRenewalStatus())
          }
          
          // Update tray menu
          updateTrayMenu()
        } catch (error) {
          console.error('Error toggling auto-renewal from tray:', error)
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      accelerator: process.platform === 'darwin' ? 'Command+Q' : 'Ctrl+Q',
      click: () => {
        app.quit()
      }
    }
  ])
  
  tray.setContextMenu(contextMenu)
}

// IPC handlers
ipcMain.handle('app-version', () => {
  return app.getVersion()
})

ipcMain.handle('get-usage-data', async () => {
  try {
    const recentData = getRecentUsage(30) // Last 30 days
    const blockInfo = getCurrentBlockInfo()
    
    return {
      daily: recentData.daily.map(day => ({
        date: day.date,
        inputTokens: day.inputTokens,
        outputTokens: day.outputTokens,
        totalTokens: day.totalTokens,
        cost: day.cost,
        model: 'mixed', // Could be enhanced to show model breakdown
        // Expose session count for per-day summaries on the dashboard
        sessionsCount: Array.from(day.sessions).length
      })),
      summary: {
        totalCost: recentData.totalCost,
        totalTokens: recentData.totalTokens,
        totalSessions: recentData.totalSessions,
        averageTokensPerSession: recentData.totalSessions > 0 ? 
          recentData.totalTokens / recentData.totalSessions : 0
      },
      currentBlock: blockInfo
    }
  } catch (error) {
    console.error('Error loading usage data:', error)
    return { 
      daily: [], 
      summary: { totalCost: 0, totalTokens: 0, totalSessions: 0, averageTokensPerSession: 0 },
      currentBlock: null 
    }
  }
})

ipcMain.handle('get-renewal-status', async () => {
  try {
    return getRenewalStatus()
  } catch (error) {
    console.error('Error getting renewal status:', error)
    return { 
      enabled: false, 
      running: false,
      timeUntilReset: null,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

ipcMain.handle('toggle-auto-renewal', async (_, enabled: boolean, scheduledTime?: string) => {
  try {
    let result
    
    if (enabled) {
      result = startRenewalService()
      if (scheduledTime) setScheduledStartTime(scheduledTime)
      if (result.success) {
        startRenewalMonitoring()
        
        // When auto-renewal is first turned on, perform immediate check with random delay
        // This ensures we start a session if needed without waiting for the next scheduled check
        renewalLogger.info('🚀 AUTO-RENEWAL ENABLED: Performing immediate renewal check with delay', 'service')
        setTimeout(() => {
          try {
            const renewalResult = performRenewalCheck()
            if (renewalResult.success && renewalResult.action) {
              renewalLogger.info(`✅ Initial renewal check completed: ${renewalResult.action}`, 'service')
            }
            
            // Update status after initial check
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('renewal-status-update', getRenewalStatus())
            }
          } catch (error) {
            renewalLogger.error(`❌ Error in initial renewal check: ${error instanceof Error ? error.message : String(error)}`, 'service')
          }
        }, 5000) // 5 second delay to let the UI update and avoid immediate execution
      }
    } else {
      result = stopRenewalService()
      if (result.success) {
        stopRenewalMonitoring()
      }
    }
    
    // Update tray menu
    updateTrayMenu()
    
    return { success: result.success, enabled, error: result.error }
  } catch (error) {
    console.error('Error toggling auto-renewal:', error)
    return { 
      success: false, 
      enabled: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
})

ipcMain.handle('set-scheduled-start-time', async (_, isoTime: string | null) => {
  try {
    const result = setScheduledStartTime(isoTime)
    if (result.success) {
      // Reschedule with new time
      const status = getRenewalStatus()
      if (status.enabled && status.running) {
        renewalLogger.info('Scheduled time changed, rescheduling renewal', 'schedule')
        scheduleNextRenewal()
      }
    }
    return result
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('minimize-to-tray', async () => {
  if (mainWindow) {
    // Load user settings to check minimize behavior preference
    const settingsFile = getSettingsFilePath()
    let userSettings = getDefaultSettings()
    
    if (fs.existsSync(settingsFile)) {
      try {
        const fileContent = fs.readFileSync(settingsFile, 'utf8')
        const savedSettings = JSON.parse(fileContent)
        userSettings = { ...userSettings, ...savedSettings }
      } catch (parseError) {
        console.warn('Could not parse settings file, using defaults for minimize behavior')
      }
    }
    
    if (process.platform === 'darwin') {
      // On macOS, hide dock icon when minimized and minimize
      try { if (app.dock) app.dock.hide() } catch {}
      mainWindow.minimize()
    } else {
      // On Windows/Linux, respect user preference
      if (userSettings.minimizeToTray) {
        mainWindow.hide()
      } else {
        mainWindow.minimize()
      }
      
      if (userSettings.minimizeBehavior === 'floating') {
        createFloatingWindow()
      }
    }
  }
})

ipcMain.handle('refresh-usage-data', async () => {
  try {
    const recentData = getRecentUsage(30) // Last 30 days
    const blockInfo = getCurrentBlockInfo()
    
    const data = {
      daily: recentData.daily.map(day => ({
        date: day.date,
        inputTokens: day.inputTokens,
        outputTokens: day.outputTokens,
        totalTokens: day.totalTokens,
        cost: day.cost,
        model: 'mixed', // Could be enhanced to show model breakdown
        sessionsCount: Array.from(day.sessions).length
      })),
      summary: {
        totalCost: recentData.totalCost,
        totalTokens: recentData.totalTokens,
        totalSessions: recentData.totalSessions,
        averageTokensPerSession: recentData.totalSessions > 0 ? 
          recentData.totalTokens / recentData.totalSessions : 0
      },
      currentBlock: blockInfo
    }
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('usage-update', data)
    }
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.webContents.send('usage-update', data)
    }
    // Update tray usage immediately
    updateTrayUsage()
    return data
  } catch (error) {
    console.error('Error refreshing usage data:', error)
    throw error
  }
})

// Force reset usage cache and perform a fresh usage read (hard refresh)
ipcMain.handle('hard-refresh-usage-data', async () => {
  try {
    // Reset analysis/cache so next read hits disk
    resetUsageCache()

    // Small delay to allow filesystem writes to settle when called after imports
    await new Promise((r) => setTimeout(r, 200))

    const recentData = getRecentUsage(30)
    const blockInfo = getCurrentBlockInfo()

    const data = {
      daily: recentData.daily.map(day => ({
        date: day.date,
        inputTokens: day.inputTokens,
        outputTokens: day.outputTokens,
        totalTokens: day.totalTokens,
        cost: day.cost,
        model: 'mixed',
        sessionsCount: Array.from(day.sessions).length
      })),
      summary: {
        totalCost: recentData.totalCost,
        totalTokens: recentData.totalTokens,
        totalSessions: recentData.totalSessions,
        averageTokensPerSession: recentData.totalSessions > 0 ?
          recentData.totalTokens / recentData.totalSessions : 0
      },
      currentBlock: blockInfo
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('usage-update', data)
    }
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.webContents.send('usage-update', data)
    }
    // Update tray usage immediately
    updateTrayUsage()
    return data
  } catch (error) {
    console.error('Error performing hard refresh:', error)
    return { success: false }
  }
})

ipcMain.handle('perform-renewal-check', async () => {
  try {
    // Return immediately to avoid blocking the UI
    setImmediate(() => {
      try {
        const result = performRenewalCheck()
        
        // Send status update to renderer after check completes
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('renewal-status-update', getRenewalStatus())
        }
        
        // Update tray menu if needed
        if (result.success && result.action && tray) {
          updateTrayMenu()
        }
        
        // Reschedule next renewal after manual check (in case block state changed)
        const status = getRenewalStatus()
        if (status.enabled && status.running) {
          setTimeout(() => scheduleNextRenewal(), 2000)
        }
      } catch (error) {
        console.error('Error in manual renewal check:', error)
      }
    })
    
    return { success: true, message: 'Renewal check initiated' }
  } catch (error) {
    console.error('Error initiating renewal check:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
})

// Renewal logs IPC handlers
ipcMain.handle('get-renewal-logs', async (_, days: number = 7) => {
  try {
    const logs = renewalLogger.getAllLogs(days)
    return logs
  } catch (error) {
    console.error('Error getting renewal logs:', error)
    return []
  }
})

ipcMain.handle('export-renewal-logs', async (_, content: string) => {
  try {
    const { dialog } = require('electron')
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Renewal Logs',
      defaultPath: `claude-sentinel-logs-${new Date().toISOString().split('T')[0]}.txt`,
      filters: [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    
    if (!result.canceled && result.filePath) {
      const fs = require('fs')
      fs.writeFileSync(result.filePath, content)
      return { success: true, path: result.filePath }
    }
    
    return { success: false, error: 'Export cancelled' }
  } catch (error) {
    console.error('Error exporting logs:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
})

ipcMain.handle('clear-renewal-logs', async (_, beforeDate: string) => {
  try {
    const date = new Date(beforeDate)
    renewalLogger.clearLogsBefore(date)
    return { success: true }
  } catch (error) {
    console.error('Error clearing logs:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
})

ipcMain.handle('get-logs-path', async () => {
  try {
    return renewalLogger.getLogsPath()
  } catch (error) {
    console.error('Error getting logs path:', error)
    return null
  }
})

// Session tracking reset handler
ipcMain.handle('reset-session-tracking', async () => {
  try {
    const { resetSessionTracking } = await import('./services/renewal-service')
    const result = resetSessionTracking()
    return result
  } catch (error) {
    console.error('Error resetting session tracking:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// Session files management IPC
ipcMain.handle('get-session-files', async () => {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    const home = os.homedir()

    // Known session/tracking files used by the app
    const candidates: string[] = [
      path.join(home, '.claude-sentinel-renewal.pid'),
      path.join(home, '.claude-sentinel-config.json'),
      path.join(home, '.claude-last-activity'),
      path.join(home, '.claude-auto-renew-start-time'),
      path.join(home, '.claude-last-block-state'),
      path.join(home, '.claude-sentinel-renewal-lock'),
      path.join(home, '.claude-last-renewal-check'),
      path.join(home, '.claude-sentinel-block-log.jsonl'),
      path.join(home, '.claude-sentinel-block-snapshot.json'),
    ]

    const MAX_PREVIEW = 64 * 1024 // 64KB preview cap

    const files = candidates
      .filter((p) => {
        try { return fs.existsSync(p) } catch { return false }
      })
      .map((p) => {
        try {
          const stat = fs.statSync(p)
          let content: string | undefined
          try {
            if (stat.size <= MAX_PREVIEW) {
              content = fs.readFileSync(p, 'utf8')
            } else {
              const fd = fs.openSync(p, 'r')
              const buf = Buffer.allocUnsafe(MAX_PREVIEW)
              fs.readSync(fd, buf, 0, MAX_PREVIEW, 0)
              fs.closeSync(fd)
              content = buf.toString('utf8') + `\n... (truncated, file size ${stat.size} bytes)`
            }
          } catch {
            content = undefined
          }
          return {
            name: path.basename(p),
            path: p,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            content,
          }
        } catch (e) {
          return null
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => new Date(b!.modified).getTime() - new Date(a!.modified).getTime())

    return files
  } catch (error) {
    console.error('Error getting session files:', error)
    return []
  }
})

ipcMain.handle('delete-session-file', async (_evt, filePath: string) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    const home = os.homedir()

    // Whitelist only known files to prevent arbitrary deletion
    const allowed = new Set([
      '.claude-sentinel-renewal.pid',
      '.claude-sentinel-config.json',
      '.claude-last-activity',
      '.claude-auto-renew-start-time',
      '.claude-last-block-state',
      '.claude-sentinel-renewal-lock',
      '.claude-last-renewal-check',
      '.claude-sentinel-block-log.jsonl',
      '.claude-sentinel-block-snapshot.json',
    ])

    const base = path.dirname(filePath)
    const name = path.basename(filePath)
    if (base !== home || !allowed.has(name)) {
      return { success: false, error: 'Not allowed to delete this file' }
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File does not exist' }
    }

    fs.unlinkSync(filePath)
    return { success: true }
  } catch (error) {
    console.error('Error deleting session file:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// Export Claude usage raw JSONL logs (for session management diagnostics)
ipcMain.handle('export-claude-usage-logs', async (_, fromDate?: string, toDate?: string) => {
  try {
    const { dialog } = require('electron')
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    // Candidate Claude data directories
    const home = os.homedir()
    const candidates = [
      path.join(home, '.config', 'claude', 'projects'),
      path.join(home, '.claude', 'projects')
    ]
    const existing = candidates.filter((p: string) => fs.existsSync(p))
    if (existing.length === 0) {
      return { success: false, error: 'No Claude data directories found' }
    }
    // Parse date range using local calendar day boundaries to avoid TZ off-by-one
    const parseLocalDayStart = (dateStr: string) => {
      const [y, m, d] = dateStr.split('-').map((n: string) => parseInt(n, 10))
      return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
    }
    const parseLocalDayEnd = (dateStr: string) => {
      const [y, m, d] = dateStr.split('-').map((n: string) => parseInt(n, 10))
      return new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
    }

    const fromTime = fromDate ? parseLocalDayStart(fromDate) : 0
    const toTime = toDate ? parseLocalDayEnd(toDate) : Date.now()
    
    // Collect .jsonl files
    const files: string[] = []
    for (const base of existing) {
      try {
        const projects = fs.readdirSync(base, { withFileTypes: true }).filter((d: any) => d.isDirectory())
        for (const proj of projects) {
          const projPath = path.join(base, proj.name)
          const jsonlFiles = (fs.readdirSync(projPath) as string[]).filter(f => f.endsWith('.jsonl'))
          
          for (const f of jsonlFiles) {
            const fullPath = path.join(projPath, f)
            try {
              const stat = fs.statSync(fullPath)
              const fileTime = stat.mtime.getTime()
              
              // Only include files within date range
              if (fileTime >= fromTime && fileTime <= toTime) {
                files.push(fullPath)
              }
            } catch {
              // If we can't stat the file, include it anyway
              files.push(fullPath)
            }
          }
        }
      } catch {}
    }
    if (files.length === 0) {
      return { success: false, error: 'No JSONL usage files found' }
    }
    // Create temporary zip
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-export-'))
    const zipPath = path.join(tmpDir, `claude-usage-${Date.now()}.zip`)
    const AdmZip = require('adm-zip')
    const zip = new AdmZip()
    files.forEach(f => {
      // Extract relative path from projects directory
      const projectsIndex = f.indexOf('/projects/')
      if (projectsIndex !== -1) {
        const rel = f.substring(projectsIndex + '/projects/'.length)
        const dirPath = path.dirname(rel)
        console.log(`Adding file: ${f} -> ${rel} (dir: ${dirPath})`)
        zip.addLocalFile(f, dirPath === '.' ? '' : dirPath)
      } else {
        // Fallback: use filename only in root
        const filename = path.basename(f)
        console.log(`Adding file (fallback): ${f} -> ${filename}`)
        zip.addLocalFile(f, '')
      }
    })
    zip.writeZip(zipPath)
    // Generate filename based on date range
    const today = new Date().toISOString().split('T')[0]
    let filename: string
    if (fromDate && toDate) {
      const from = fromDate
      const to = toDate
      if (from === to) {
        filename = `claude-usage-${from}.zip`
      } else {
        filename = `claude-usage-${from}-to-${to}.zip`
      }
    } else {
      filename = `claude-usage-${today}.zip`
    }
    
    // Prompt user where to save/share (user can then AirDrop via Finder)
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Claude Usage Logs',
      defaultPath: filename,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Export cancelled' }
    }
    fs.copyFileSync(zipPath, result.filePath)
    return { success: true, path: result.filePath, fileCount: files.length }
  } catch (error) {
    console.error('Failed to export Claude usage logs:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// Import Claude usage JSONL logs from a ZIP archive
ipcMain.handle('import-claude-usage-logs', async (_, options: { mergeMode?: boolean, skipDuplicates?: boolean } = {}) => {
  try {
    const { dialog } = require('electron')
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    const AdmZip = require('adm-zip')
    
    // Default to merge mode
    const { mergeMode = true, skipDuplicates = true } = options
    
    const home = os.homedir()
    const targetCandidates = [
      path.join(home, '.config', 'claude', 'projects'),
      path.join(home, '.claude', 'projects')
    ]
    const targetBase = targetCandidates.find((p: string) => fs.existsSync(p)) || targetCandidates[0]
    if (!fs.existsSync(targetBase)) {
      fs.mkdirSync(targetBase, { recursive: true })
    }

    const openResult = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import Claude Usage Logs (ZIP)',
      properties: ['openFile'],
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    })
    if (openResult.canceled || !openResult.filePaths[0]) {
      return { success: false, error: 'Import cancelled' }
    }

    const zipPath = openResult.filePaths[0]
    console.log('Importing from ZIP:', zipPath)
    
    let zip: any
    let entries: any[]
    
    try {
      zip = new AdmZip(zipPath)
      entries = zip.getEntries()
      console.log(`[Import] ZIP entries found: ${entries.length}`)
      
      if (!entries.length) {
        return { success: false, error: 'Empty archive - no files found in ZIP' }
      }
    } catch (error) {
      console.error(`[Import] Failed to read ZIP file: ${zipPath}`, error)
      return { success: false, error: `Invalid ZIP file: ${error instanceof Error ? error.message : 'Unknown error'}` }
    }
    
    // Validate that we have some JSONL files
    const jsonlEntries = entries.filter((entry: any) => !entry.isDirectory && entry.entryName.endsWith('.jsonl'))
    if (jsonlEntries.length === 0) {
      return { success: false, error: 'No .jsonl files found in archive. Please ensure you exported Claude usage logs.' }
    }
    
    console.log(`[Import] Found ${jsonlEntries.length} JSONL files out of ${entries.length} total entries`)
    
    // Log entry names for debugging
    entries.forEach((entry: any) => {
      console.log(`[Import] Entry: ${entry.entryName} (directory: ${entry.isDirectory})`)
    })

    // Helper function to get existing message IDs from a JSONL file (for proper deduplication)
    const getExistingMessageIds = (filePath: string): Set<string> => {
      const messageIds = new Set<string>()
      if (!fs.existsSync(filePath)) return messageIds
      
      try {
        const content = fs.readFileSync(filePath, 'utf8')
        const lines = content.trim().split('\n').filter((line: string) => line.trim())
        
        console.log(`[Import] Checking existing messages in ${path.basename(filePath)} (${lines.length} lines)`)
        
        for (const line of lines) {
          try {
            const entry = JSON.parse(line)
            // Use multiple possible message ID fields for robustness
            const messageId = entry.message?.id || entry.messageId || entry.uuid
            if (messageId) {
              messageIds.add(messageId)
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
        
        console.log(`[Import] Found ${messageIds.size} existing message IDs in ${path.basename(filePath)}`)
      } catch (e) {
        console.warn(`[Import] Could not read existing messages from ${filePath}:`, e)
      }
      
      return messageIds
    }

    // Helper function to detect current machine's path pattern
    const getCurrentMachinePattern = (): string => {
      try {
        const existingProjects = fs.readdirSync(targetBase)
        console.log(`[Import] Existing projects on this machine:`, existingProjects.slice(0, 3))
        
        // Look for pattern like "-Users-currentuser-"
        const userPatterns = existingProjects
          .filter(name => name.startsWith('-Users-'))
          .map(name => {
            const match = name.match(/^(-Users-[^-]+-)/)
            return match ? match[1] : null
          })
          .filter(Boolean)
        
        if (userPatterns.length > 0) {
          const currentPattern = userPatterns[0]
          console.log(`[Import] Detected current machine pattern: "${currentPattern}"`)
          return currentPattern
        }
        
        // Fallback: create pattern from current user
        const currentUser = os.userInfo().username
        const fallbackPattern = `-Users-${currentUser}-`
        console.log(`[Import] No existing pattern found, using fallback: "${fallbackPattern}"`)
        return fallbackPattern
      } catch (error) {
        // Ultimate fallback
        const currentUser = os.userInfo().username
        const fallbackPattern = `-Users-${currentUser}-`
        console.log(`[Import] Error detecting pattern, using fallback: "${fallbackPattern}"`)
        return fallbackPattern
      }
    }

    // Helper function to map imported project name to current machine
    const mapProjectNameToCurrentMachine = (importedName: string): string => {
      console.log(`[Import] Mapping project name: "${importedName}"`)
      
      // If it doesn't look like a path-based name, keep it as-is
      if (!importedName.includes('-Users-')) {
        console.log(`[Import] Not a path-based name, keeping as-is: "${importedName}"`)
        return importedName
      }
      
      // Extract the non-user part of the path
      const match = importedName.match(/^-Users-[^-]+-(.+)$/)
      if (match) {
        const pathSuffix = match[1]
        const currentMachinePattern = getCurrentMachinePattern()
        const mappedName = currentMachinePattern + pathSuffix
        
        console.log(`[Import] Mapped: "${importedName}" -> "${mappedName}"`)
        return mappedName
      }
      
      // If pattern doesn't match expected format, keep original
      console.log(`[Import] Couldn't parse path pattern, keeping original: "${importedName}"`)
      return importedName
    }

    // Only clear existing data if not in merge mode
    if (!mergeMode) {
      try {
        const existingEntries = fs.readdirSync(targetBase, { withFileTypes: true })
        for (const entry of existingEntries) {
          if (entry.isDirectory()) {
            const dirPath = path.join(targetBase, entry.name)
            fs.rmSync(dirPath, { recursive: true, force: true })
          }
        }
        console.log('Cleared existing data for replace mode')
      } catch (error) {
        console.warn('Warning: Could not fully clear existing usage data:', error)
      }
    }

    // Extract directly to the projects directory for proper recognition
    const importRoot = targetBase
    fs.mkdirSync(importRoot, { recursive: true })

    // Count total files to import for progress tracking
  const totalFiles = entries.filter((entry: any) => !entry.isDirectory && entry.entryName.endsWith('.jsonl')).length
    let importedFiles = 0
    
    // Send initial progress
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('import-progress', { current: 0, total: totalFiles, phase: 'importing' })
    }

    for (const entry of entries) {
      if (entry.isDirectory) {
        console.log('Skipping directory:', entry.entryName)
        continue
      }
      if (!entry.entryName.endsWith('.jsonl')) {
        console.log('Skipping non-JSONL file:', entry.entryName)
        continue
      }
      
      console.log(`[Import] Processing JSONL file: ${entry.entryName}`)
      
      // entry.entryName should be like projectName/file.jsonl or nested paths
      const segments = entry.entryName.split(/[\\\/]+/).filter(Boolean)
      let projectName: string
      let fileName: string
      
      console.log(`[Import] Entry segments:`, segments)
      
      if (segments.length === 1) {
        // File at root level - create a generic project
        projectName = 'imported-project'
        fileName = segments[0]
        console.log(`[Import] Root level file detected, using generic project`)
      } else if (segments.length >= 2) {
        // Normal case: projectName/file.jsonl or nested structure
        fileName = segments[segments.length - 1]
        
        // Extract the original project name (preserve the full path-based name)
        let rawProjectName = segments[0]
        
        // If we have nested segments, the first one should be the project directory name
        // This preserves the original Claude naming like "-Users-john-Documents-MyProject"
        projectName = mapProjectNameToCurrentMachine(rawProjectName)
        
        console.log(`[Import] Preserved and mapped project: "${rawProjectName}" -> "${projectName}" from path: ${entry.entryName}`)
      } else {
        // Fallback
        projectName = 'imported-project'
        fileName = entry.entryName
        console.log(`[Import] Fallback case for entry: ${entry.entryName}`)
      }
      
      const projectDir = path.join(importRoot, projectName)
      const destPath = path.join(projectDir, fileName)
      
      console.log('Final project name:', projectName)
      console.log('Creating project directory:', projectDir)
      console.log('Writing file to:', destPath)
      
      // Handle merge mode with message deduplication (enables cross-computer session continuity)
      if (mergeMode && skipDuplicates && fs.existsSync(destPath)) {
        console.log(`[Import] File already exists: ${destPath}`)
        
        // Get existing message IDs from the target file (not session IDs)
        const existingMessageIds = getExistingMessageIds(destPath)
        console.log(`[Import] Found ${existingMessageIds.size} existing messages in target file`)
        
        if (existingMessageIds.size > 0) {
          // Parse the new content and filter out duplicate messages
          const newContent = entry.getData().toString('utf8')
          const newLines = newContent.trim().split('\n').filter((line: string) => line.trim())
          const uniqueNewLines: string[] = []
          let skippedDuplicates = 0
          
          for (const line of newLines) {
            try {
              const parsed = JSON.parse(line)
              // Check for duplicate messages, not sessions (enables session continuity)
              const messageId = parsed.message?.id || parsed.messageId || parsed.uuid
              
              if (!messageId || !existingMessageIds.has(messageId)) {
                uniqueNewLines.push(line)
              } else {
                skippedDuplicates++
                console.log(`[Import] Skipping duplicate message: ${messageId}`)
              }
            } catch (e) {
              // Include lines that can't be parsed (might be valid JSONL)
              uniqueNewLines.push(line)
              console.warn(`[Import] Could not parse line, including anyway: ${e}`)
            }
          }
          
          if (uniqueNewLines.length > 0) {
            // Append only new messages to existing file
            const newContentToAppend = uniqueNewLines.join('\n') + '\n'
            fs.appendFileSync(destPath, newContentToAppend)
            console.log(`[Import] Appended ${uniqueNewLines.length} new messages to existing file (skipped ${skippedDuplicates} duplicates)`)
          } else {
            console.log(`[Import] No new messages to add - all ${skippedDuplicates} were duplicates`)
          }
          
          importedFiles++
        } else {
          // No existing messages, just append the new content
          fs.appendFileSync(destPath, entry.getData())
          console.log(`[Import] No existing messages found, appending all content`)
          importedFiles++
        }
      } else {
        // Create directory and write file (original behavior or replace mode)
        try {
          fs.mkdirSync(projectDir, { recursive: true })
          
          // Validate JSONL content before writing
          const content = entry.getData().toString('utf8')
          const lines = content.trim().split('\n').filter((line: string) => line.trim())
          let validLines = 0
          let invalidLines = 0
          
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line)
              // Basic validation - ensure it has required fields
              if (parsed.timestamp && (parsed.message || parsed.type)) {
                validLines++
              } else {
                invalidLines++
                console.warn(`[Import] Line missing required fields: ${line.substring(0, 100)}...`)
              }
            } catch (e) {
              invalidLines++
              console.warn(`[Import] Invalid JSON line: ${line.substring(0, 100)}...`)
            }
          }
          
          if (validLines === 0) {
            console.error(`[Import] No valid entries found in ${fileName}`)
            // Skip this file but continue with others
            continue
          }
          
          fs.writeFileSync(destPath, content)
          console.log(`[Import] Wrote ${fileName}: ${validLines} valid entries, ${invalidLines} invalid entries`)
          importedFiles++
        } catch (writeError) {
          console.error(`[Import] Failed to write file ${destPath}:`, writeError)
          // Continue with other files
          continue
        }
      }
      
      console.log(`[Import] Processed file ${importedFiles}/${totalFiles}: ${fileName}`)
      
      // Send progress update
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('import-progress', { current: importedFiles, total: totalFiles, phase: 'importing' })
      }
    }

    // Send progress for cache rebuild phase
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('import-progress', { current: importedFiles, total: totalFiles, phase: 'rebuilding' })
    }

    // Trigger usage cache rebuild by resetting cache then pushing updated usage
    try {
      const { resetUsageCache } = require('../src/lib/ccusage-integration')
      resetUsageCache()
      setTimeout(() => {
        try {
          const data = getRecentUsage(30)
          const usageUpdateData = {
            daily: data.daily.map(day => ({
              date: day.date,
              inputTokens: day.inputTokens,
              outputTokens: day.outputTokens,
              totalTokens: day.totalTokens,
              cost: day.cost,
              model: 'mixed',
              sessionsCount: Array.from(day.sessions).length
            })),
            summary: {
              totalCost: data.totalCost,
              totalTokens: data.totalTokens,
              totalSessions: data.totalSessions,
              averageTokensPerSession: data.totalSessions > 0 ? data.totalTokens / data.totalSessions : 0
            },
            currentBlock: getCurrentBlockInfo()
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('usage-update', usageUpdateData)
            
            // Send completion signal
            mainWindow.webContents.send('import-progress', { current: importedFiles, total: totalFiles, phase: 'completed' })
          }
          if (floatingWindow && !floatingWindow.isDestroyed()) {
            floatingWindow.webContents.send('usage-update', usageUpdateData)
          }
        } catch (e) {
          console.error('Post-import usage refresh failed:', e)
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('import-progress', { current: importedFiles, total: totalFiles, phase: 'error', error: e instanceof Error ? e.message : 'Unknown error' })
          }
        }
      }, 300)
    } catch (e) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('import-progress', { current: importedFiles, total: totalFiles, phase: 'error', error: e instanceof Error ? e.message : 'Unknown error' })
      }
    }

    console.log(`[Import] Import completed successfully: ${importedFiles} files imported to ${targetBase}`)
    return { 
      success: true, 
      importedFiles, 
      importRoot: targetBase,
      message: `Successfully imported ${importedFiles} files. Sessions can now be continued across computers.`
    }
  } catch (error) {
    console.error('Failed to import Claude usage logs:', error)
    // Send error progress update
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('import-progress', { 
        current: 0, 
        total: 0, 
        phase: 'error', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      })
    }
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// Settings management
const getSettingsFilePath = () => path.join(os.homedir(), '.claude-sentinel-settings.json')

const getDefaultSettings = () => ({
  autoStart: false,
  minimizeToTray: true,
  minimizeBehavior: 'floating', // 'floating' or 'tray'
  notifications: true,
  refreshInterval: 5,
  theme: 'system',
  dataPath: '',
  claudePlan: 'auto',
  autoRenewal: {
    enabled: false,
    checkInterval: 5,
    enableLogging: true,
    notifyOnRenewal: true,
    waitTimeBeforeSession: 60
  }
})

ipcMain.handle('get-settings', async () => {
  try {
    const settingsFile = getSettingsFilePath()
    
    // Load settings from file if it exists
    if (fs.existsSync(settingsFile)) {
      try {
        const fileContent = fs.readFileSync(settingsFile, 'utf8')
        const savedSettings = JSON.parse(fileContent)
        
        // Merge with defaults to ensure all properties exist
        const defaultSettings = getDefaultSettings()
        const mergedSettings = {
          ...defaultSettings,
          ...savedSettings,
          autoRenewal: {
            ...defaultSettings.autoRenewal,
            ...(savedSettings.autoRenewal || {})
          }
        }
        
        return mergedSettings
      } catch (parseError) {
        console.warn('Could not parse settings file, using defaults:', parseError)
        return getDefaultSettings()
      }
    }
    
    // Return default settings if file doesn't exist
    return getDefaultSettings()
  } catch (error) {
    console.error('Error getting settings:', error)
    return getDefaultSettings()
  }
})

ipcMain.handle('save-settings', async (_, settings: any) => {
  try {
    // Save all settings to the main settings file
    const settingsFile = getSettingsFilePath()
    
    try {
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2))
      console.log('Settings saved to:', settingsFile)
    } catch (writeError) {
      console.error('Error writing settings file:', writeError)
      return { success: false, error: 'Failed to write settings file' }
    }
    
    // Also save renewal settings to the config file that the backend reads from
    if (settings.autoRenewal) {
      const configFile = path.join(os.homedir(), '.claude-sentinel-config.json')
      let currentConfig: any = { enabled: false }
      
      try {
        if (fs.existsSync(configFile)) {
          currentConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'))
        }
      } catch (error) {
        console.warn('Could not read existing config, starting fresh:', error)
      }
      
      // Update config with new settings
      currentConfig.checkInterval = settings.autoRenewal.checkInterval
      currentConfig.enableLogging = settings.autoRenewal.enableLogging
      currentConfig.notifyOnRenewal = settings.autoRenewal.notifyOnRenewal
      currentConfig.waitTimeBeforeSession = settings.autoRenewal.waitTimeBeforeSession
      
      // Preserve the enabled state
      if (currentConfig.enabled === undefined) {
        currentConfig.enabled = settings.autoRenewal.enabled || false
      }
      
      fs.writeFileSync(configFile, JSON.stringify(currentConfig, null, 2))
      renewalLogger.info(`Settings saved: checkInterval=${currentConfig.checkInterval}min, enableLogging=${currentConfig.enableLogging}`, 'service')
    }
    
    console.log('Settings saved:', settings)
    return { success: true }
  } catch (error) {
    console.error('Error saving settings:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('select-directory', async () => {
  try {
    const { dialog } = require('electron')
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Claude Data Directory'
    })
    
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  } catch (error) {
    console.error('Error selecting directory:', error)
    return null
  }
})

ipcMain.handle('show-notification', async (_, message: string) => {
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Claude Sentinel',
        body: message,
        icon: createActivityIcon({ size: 64, color: '#3b82f6' })
      }).show()
    }
    return { success: true }
  } catch (error) {
    console.error('Error showing notification:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// Clear Claude usage data with user-configurable time range
// Session status and management IPC handlers
ipcMain.handle('get-session-status', async () => {
  try {
    const { getSessionStatus } = await import('../src/lib/auto-renewal-integration')
    return getSessionStatus()
  } catch (error) {
    console.error('Error getting session status:', error)
    return { error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('force-start-new-session', async () => {
  try {
    const { forceStartNewSession } = await import('../src/lib/auto-renewal-integration')
    const result = forceStartNewSession()
    
    // Send status update to renderer after forcing new session
    if (mainWindow && !mainWindow.isDestroyed()) {
      const { getSessionStatus } = await import('../src/lib/auto-renewal-integration')
      mainWindow.webContents.send('session-status-update', getSessionStatus())
    }
    
    return result
  } catch (error) {
    console.error('Error forcing new session:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// Block tracking IPC handlers
ipcMain.handle('get-block-events', async (_, hours: number = 24) => {
  try {
    const { getRecentBlockEvents } = await import('../src/lib/block-tracker')
    return getRecentBlockEvents(hours)
  } catch (error) {
    console.error('Error getting block events:', error)
    return []
  }
})

ipcMain.handle('get-block-snapshot', async () => {
  try {
    const { loadBlockSnapshot } = await import('../src/lib/block-tracker')
    return loadBlockSnapshot()
  } catch (error) {
    console.error('Error getting block snapshot:', error)
    return null
  }
})

ipcMain.handle('get-daily-blocks', async (_, date?: string) => {
  try {
    const { getCurrentBlockInfo } = await import('./services/ccusage-service')
    const blockInfo = getCurrentBlockInfo()
    
    // For now, return current block info. This could be enhanced to filter by date
    return blockInfo ? [blockInfo] : []
  } catch (error) {
    console.error('Error getting daily blocks:', error)
    return []
  }
})

ipcMain.handle('clear-claude-usage-data', async (_, daysToKeep: number = 0) => {
  try {
    const { dialog } = require('electron')
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    
    // Show confirmation dialog first
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Clear Data', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Clear Usage Data',
      message: daysToKeep > 0 
        ? `Clear all usage data older than ${daysToKeep} days?`
        : 'Clear ALL usage data?',
      detail: daysToKeep > 0
        ? `This will permanently delete usage data older than ${daysToKeep} days. Recent data will be preserved.`
        : 'This will permanently delete ALL Claude usage data. This action cannot be undone.'
    })
    
    if (result.response === 1) {
      return { success: false, error: 'User cancelled' }
    }
    
    const home = os.homedir()
    const targetCandidates = [
      path.join(home, '.config', 'claude', 'projects'),
      path.join(home, '.claude', 'projects')
    ]
    
    let clearedFiles = 0
    let totalFiles = 0
    const cutoffTime = daysToKeep > 0 ? Date.now() - (daysToKeep * 24 * 60 * 60 * 1000) : 0
    
    for (const targetBase of targetCandidates) {
      if (!fs.existsSync(targetBase)) continue
      
      try {
        const projects = fs.readdirSync(targetBase, { withFileTypes: true })
          .filter((d: any) => d.isDirectory())
        
        for (const proj of projects) {
          const projPath = path.join(targetBase, proj.name)
          
          try {
            const files = fs.readdirSync(projPath) as string[]
            const jsonlFiles = files.filter(f => f.endsWith('.jsonl'))
            totalFiles += jsonlFiles.length
            
            for (const file of jsonlFiles) {
              const filePath = path.join(projPath, file)
              
              try {
                if (daysToKeep > 0) {
                  // Check file modification time
                  const stat = fs.statSync(filePath)
                  if (stat.mtime.getTime() > cutoffTime) {
                    continue // Keep this file
                  }
                }
                
                // Delete the file
                fs.unlinkSync(filePath)
                clearedFiles++
                
                // Send progress update
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('clear-progress', { 
                    current: clearedFiles, 
                    total: totalFiles, 
                    phase: 'clearing',
                    daysToKeep 
                  })
                }
              } catch (fileError) {
                console.warn(`Could not delete file ${filePath}:`, fileError)
              }
            }
            
            // Remove empty project directories
            try {
              const remainingFiles = fs.readdirSync(projPath)
              if (remainingFiles.length === 0) {
                fs.rmdirSync(projPath)
              }
            } catch {}
          } catch (projError) {
            console.warn(`Could not process project ${projPath}:`, projError)
          }
        }
      } catch (baseError) {
        console.warn(`Could not access base directory ${targetBase}:`, baseError)
      }
    }
    
    // Reset cache and refresh UI
    try {
      const { resetUsageCache } = require('../src/lib/ccusage-integration')
      resetUsageCache()
      
      setTimeout(() => {
        try {
          const data = getRecentUsage(30)
          const usageUpdateData = {
            daily: data.daily.map(day => ({
              date: day.date,
              inputTokens: day.inputTokens,
              outputTokens: day.outputTokens,
              totalTokens: day.totalTokens,
              cost: day.cost,
              model: 'mixed',
              sessionsCount: Array.from(day.sessions).length
            })),
            summary: {
              totalCost: data.totalCost,
              totalTokens: data.totalTokens,
              totalSessions: data.totalSessions,
              averageTokensPerSession: data.totalSessions > 0 ? data.totalTokens / data.totalSessions : 0
            },
            currentBlock: getCurrentBlockInfo()
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('usage-update', usageUpdateData)
            
            // Send completion signal
            mainWindow.webContents.send('clear-progress', { 
              current: clearedFiles, 
              total: totalFiles, 
              phase: 'completed',
              daysToKeep 
            })
          }
          if (floatingWindow && !floatingWindow.isDestroyed()) {
            floatingWindow.webContents.send('usage-update', usageUpdateData)
          }
        } catch (e) {
          console.error('Post-clear usage refresh failed:', e)
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('clear-progress', { 
              current: clearedFiles, 
              total: totalFiles, 
              phase: 'error', 
              error: e instanceof Error ? e.message : 'Unknown error',
              daysToKeep 
            })
          }
        }
      }, 300)
    } catch (e) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('clear-progress', { 
          current: clearedFiles, 
          total: totalFiles, 
          phase: 'error', 
          error: e instanceof Error ? e.message : 'Unknown error',
          daysToKeep 
        })
      }
    }
    
    return { 
      success: true, 
      clearedFiles, 
      totalFiles,
      message: daysToKeep > 0 
        ? `Cleared ${clearedFiles} files older than ${daysToKeep} days`
        : `Cleared all ${clearedFiles} usage files`
    }
  } catch (error) {
    console.error('Failed to clear Claude usage data:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// Floating window IPC handlers
ipcMain.handle('hide-floating-window', async () => {
  try {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.close()
    }
    return { success: true }
  } catch (error) {
    console.error('Error hiding floating window:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('show-main-window', async () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.show()
      mainWindow.focus()
      
      // Show dock icon when main window is shown on macOS
      if (process.platform === 'darwin') {
        try { if (app.dock) app.dock.show() } catch {}
      }
      
      // Hide floating window when showing main window
      if (floatingWindow && !floatingWindow.isDestroyed()) {
        floatingWindow.close()
      }
    } else {
      createWindow()
    }
    return { success: true }
  } catch (error) {
    console.error('Error showing main window:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})
