import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, Notification } from 'electron'
import { join } from 'path'
import { isDev } from './utils'
import { loadUsageData, getRecentUsage, getCurrentBlockInfo } from './services/ccusage-service'
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

// Create an app icon matching the sidebar's Activity logo (lucide)
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

  // Hide floating window when main window is restored/shown
  mainWindow.on('restore', () => {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.close()
    }
  })

  mainWindow.on('show', () => {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.close()
    }
  })

  // Handle minimize to system tray and show floating window
  mainWindow.on('minimize', (event: Electron.Event) => {
    // Show floating window when main window is minimized
    createFloatingWindow()
    
    if (process.platform === 'darwin') {
      // On macOS, hide to dock
      return
    }
    // On Windows/Linux, hide to system tray
    event.preventDefault()
    mainWindow?.hide()
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
  }

  return floatingWindow
}

const createTray = () => {
  // Create tray icon
  const icon = nativeImage.createFromPath(
    join(__dirname, process.platform === 'darwin' ? '../assets/tray-icon-mac.png' : '../assets/tray-icon.png')
  )
  
  // Use template monochrome icon on macOS so the OS tints it
  const trayIcon = process.platform === 'darwin'
    ? createActivityIcon({ size: 24, color: '#000000', template: true })
    : createActivityIcon({ size: 24, color: '#3b82f6' })

  tray = new Tray(trayIcon.isEmpty() ? icon : trayIcon)
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Claude Sentinel',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
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

  // Handle tray click
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    } else {
      createWindow()
    }
  })
}

// App event handlers
app.whenReady().then(() => {
  createWindow()
  createTray()
  // Set Dock icon on macOS to match the sidebar logo (colored variant)
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = createActivityIcon({ size: 256, color: '#3b82f6' })
    app.dock.setIcon(dockIcon)
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
})


// Auto-renewal monitoring interval
let renewalInterval: NodeJS.Timeout | null = null
let scheduleCheckInterval: NodeJS.Timeout | null = null
let scheduledStartReached = false

// Start renewal monitoring when app starts
const startRenewalMonitoring = () => {
  if (renewalInterval) return

  // Determine if scheduled start time already passed
  const statusAtStart = getRenewalStatus()
  if (statusAtStart.scheduledStartTime) {
    scheduledStartReached = new Date(statusAtStart.scheduledStartTime) <= new Date()
  } else {
    scheduledStartReached = true
  }

  if (!scheduledStartReached && !scheduleCheckInterval) {
    scheduleCheckInterval = setInterval(() => {
      const s = getRenewalStatus()
      if (!s.scheduledStartTime || new Date(s.scheduledStartTime) <= new Date()) {
        scheduledStartReached = true
    renewalLogger.info('Scheduled start time reached; enabling renewal checks', 'schedule')
        if (scheduleCheckInterval) {
          clearInterval(scheduleCheckInterval)
          scheduleCheckInterval = null
        }
        // Fire an immediate renewal check once gate opens
        try {
          const result = performRenewalCheck()
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('renewal-status-update', getRenewalStatus())
          }
          if (result.success && result.action) updateTrayMenu()
        } catch (e) {
          console.error('Immediate scheduled-start renewal check failed:', e)
        }
      }
    }, 15000)
  renewalLogger.info('Waiting for scheduled start time before beginning renewal checks', 'schedule')
  }

  renewalInterval = setInterval(() => {
    try {
      const status = getRenewalStatus()
      if (status.scheduledStartTime && !scheduledStartReached) return
      if (status.enabled && status.running) {
        setImmediate(() => {
          try {
            const result = performRenewalCheck()
            if (mainWindow && !mainWindow.isDestroyed()) {
              setImmediate(() => {
                mainWindow?.webContents.send('renewal-status-update', getRenewalStatus())
              })
            }
            if (result.success && result.action && tray) {
              setImmediate(() => updateTrayMenu())
            }
          } catch (error) {
            console.error('Error in async renewal check:', error)
          }
        })
      }
    } catch (error) {
      console.error('Error in renewal monitoring:', error)
    }
  }, 60000)
  renewalLogger.info('Renewal monitoring loop started', 'service')
}

const stopRenewalMonitoring = () => {
  if (renewalInterval) {
    clearInterval(renewalInterval)
    renewalInterval = null
  }
  if (scheduleCheckInterval) {
    clearInterval(scheduleCheckInterval)
    scheduleCheckInterval = null
  }
  scheduledStartReached = false
  renewalLogger.info('Renewal monitoring loop stopped', 'service')
}

const updateTrayMenu = () => {
  if (!tray) return
  
  const status = getRenewalStatus()
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Claude Sentinel',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
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
      scheduledStartReached = !isoTime || new Date(isoTime) <= new Date()
      if (!scheduledStartReached) startRenewalMonitoring()
    }
    return result
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('minimize-to-tray', () => {
  if (mainWindow) {
    mainWindow.hide()
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
    return data
  } catch (error) {
    console.error('Error refreshing usage data:', error)
    throw error
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
    // Parse date range
    const fromTime = fromDate ? new Date(fromDate).getTime() : 0
    const toTime = toDate ? new Date(toDate).getTime() + 24 * 60 * 60 * 1000 : Date.now() // Include end of day
    
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
    
    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries()
    console.log('ZIP entries found:', entries.length)
    
    if (!entries.length) return { success: false, error: 'Empty archive' }
    
    // Log entry names for debugging
    entries.forEach(entry => {
      console.log('Entry:', entry.entryName, 'isDirectory:', entry.isDirectory)
    })

    // Helper function to get existing session IDs from a JSONL file
    const getExistingSessionIds = (filePath: string): Set<string> => {
      const sessionIds = new Set<string>()
      if (!fs.existsSync(filePath)) return sessionIds
      
      try {
        const content = fs.readFileSync(filePath, 'utf8')
        const lines = content.trim().split('\n').filter(line => line.trim())
        
        for (const line of lines) {
          try {
            const entry = JSON.parse(line)
            if (entry.sessionId) {
              sessionIds.add(entry.sessionId)
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      } catch (e) {
        console.warn(`Could not read existing sessions from ${filePath}:`, e)
      }
      
      return sessionIds
    }

    // Helper function to normalize project names
    const normalizeProjectName = (rawName: string): string => {
      // Remove common path prefixes and clean up the name
      let cleaned = rawName
      
      // Remove user home directory patterns
      cleaned = cleaned.replace(/^-?Users-[^-]+-?/i, '')
      
      // Remove common directory patterns
      cleaned = cleaned.replace(/^(Documents|Downloads|Desktop|Library|Mobile-Documents)-?/i, '')
      
      // Remove iCloud path patterns
      cleaned = cleaned.replace(/com-apple-CloudDocs-?/i, '')
      
      // Extract the actual project name (usually the last meaningful part)
      const segments = cleaned.split('-').filter(Boolean)
      if (segments.length > 0) {
        // Take the last 1-2 segments as the project name
        const meaningfulSegments = segments.slice(-2)
        cleaned = meaningfulSegments.join('-')
      }
      
      // Final cleanup
      cleaned = cleaned
        .replace(/[^a-zA-Z0-9-_.]/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
      
      return cleaned || 'imported-project'
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
    const totalFiles = entries.filter(entry => !entry.isDirectory && entry.entryName.endsWith('.jsonl')).length
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
      
      console.log('Processing JSONL file:', entry.entryName)
      
      // entry.entryName should be like projectName/file.jsonl
      const segments = entry.entryName.split(/\\|\//).filter(Boolean)
      let projectName: string
      let fileName: string
      
      console.log('Entry segments:', segments)
      
      if (segments.length === 1) {
        // File at root level - create a generic project
        projectName = 'imported-project'
        fileName = segments[0]
      } else if (segments.length >= 2) {
        // Normal case: projectName/file.jsonl
        fileName = segments[segments.length - 1]
        
        // Use normalized project name
        const rawProjectName = segments[0]
        projectName = normalizeProjectName(rawProjectName)
        
        console.log(`Raw project name: "${rawProjectName}" -> normalized: "${projectName}"`)
      } else {
        // Fallback
        projectName = 'imported-project'
        fileName = entry.entryName
      }
      
      const projectDir = path.join(importRoot, projectName)
      const destPath = path.join(projectDir, fileName)
      
      console.log('Final project name:', projectName)
      console.log('Creating project directory:', projectDir)
      console.log('Writing file to:', destPath)
      
      // Handle merge mode with session deduplication
      if (mergeMode && skipDuplicates && fs.existsSync(destPath)) {
        console.log(`File already exists: ${destPath}`)
        
        // Get existing session IDs from the target file
        const existingSessionIds = getExistingSessionIds(destPath)
        console.log(`Found ${existingSessionIds.size} existing sessions in target file`)
        
        if (existingSessionIds.size > 0) {
          // Parse the new content and filter out duplicate sessions
          const newContent = entry.getData().toString('utf8')
          const newLines = newContent.trim().split('\n').filter(line => line.trim())
          const uniqueNewLines: string[] = []
          
          for (const line of newLines) {
            try {
              const parsed = JSON.parse(line)
              if (!parsed.sessionId || !existingSessionIds.has(parsed.sessionId)) {
                uniqueNewLines.push(line)
              } else {
                console.log(`Skipping duplicate session: ${parsed.sessionId}`)
              }
            } catch (e) {
              // Include lines that can't be parsed (might be valid JSONL)
              uniqueNewLines.push(line)
            }
          }
          
          if (uniqueNewLines.length > 0) {
            // Append only new sessions to existing file
            const newContentToAppend = uniqueNewLines.join('\n') + '\n'
            fs.appendFileSync(destPath, newContentToAppend)
            console.log(`Appended ${uniqueNewLines.length} new sessions to existing file`)
          } else {
            console.log('No new sessions to add - all were duplicates')
          }
          
          importedFiles++
        } else {
          // No existing sessions, just append the new content
          fs.appendFileSync(destPath, entry.getData())
          importedFiles++
        }
      } else {
        // Create directory and write file (original behavior or replace mode)
        fs.mkdirSync(projectDir, { recursive: true })
        fs.writeFileSync(destPath, entry.getData())
        importedFiles++
      }
      
      console.log(`Processed file ${importedFiles}/${totalFiles}: ${fileName}`)
      
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

    return { success: true, importedFiles, importRoot: targetBase }
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
ipcMain.handle('get-settings', async () => {
  try {
    // Return default settings for now - could be enhanced to load from storage
    return {
      autoStart: false,
      minimizeToTray: true,
      notifications: true,
      refreshInterval: 5,
      theme: 'system',
      dataPath: '',
      autoRenewal: {
        enabled: false,
        checkInterval: 5,
        enableLogging: true,
        notifyOnRenewal: true,
        waitTimeBeforeSession: 60
      }
    }
  } catch (error) {
    console.error('Error getting settings:', error)
    return {}
  }
})

ipcMain.handle('save-settings', async (_, settings: any) => {
  try {
    // For now, just return success - could be enhanced to save to storage
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
