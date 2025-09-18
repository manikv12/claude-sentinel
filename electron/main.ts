import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, Notification, dialog, shell } from 'electron'
import { Worker } from 'node:worker_threads'
import { join } from 'path'
import { fileURLToPath } from 'url'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import ts from 'typescript'
import { isDev } from './utils'
import { loadUsageData, getRecentUsage, getCurrentBlockInfo, resetUsageCache } from './services/ccusage-service'
import { normalizeClaudePlan } from './services/plan-utils'
import { 
  getRenewalStatus, 
  startRenewalService, 
  stopRenewalService,
  performRenewalCheck,
  setScheduledStartTime,
  loadConfig
} from './services/renewal-service'
import { renewalLogger } from './services/log-service'
import { specService } from './services/spec-service'

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'] || 'http://localhost:5173'

let mainWindow: BrowserWindow | null = null
let floatingWindow: BrowserWindow | null = null
let tray: Tray | null = null
// Track when the tray menu is open so we avoid heavy work or menu rebuilds
let isTrayMenuOpen = false
let trayUsageInterval: NodeJS.Timeout | null = null
// Background worker for usage refresh to keep main thread responsive
let usageWorker: Worker | null = null
let usageWorkerReady = false
let workerBusy = false
let pendingRefresh = false
// Resolve Promises waiting for the next worker result
let workerResolvers: Array<(payload: any) => void> = []
let lastWorkerBlock: any = null
let pendingMenuRefreshFromClick = false

type RenewalStatusResult = ReturnType<typeof getRenewalStatus> extends Promise<infer T> ? T : ReturnType<typeof getRenewalStatus>

const initUsageWorker = () => {
  if (usageWorker) return
  try {
    const usingDevServer = !!process.env.VITE_DEV_SERVER_URL
    let workerScript: string
    const workerOptions: ConstructorParameters<typeof Worker>[1] = {}

    if (usingDevServer) {
      const projectRoot = process.cwd()
      const workerTsPath = path.join(projectRoot, 'electron', 'workers', 'usageWorker.ts')
      const tempDir = join(os.tmpdir(), 'claude-sentinel')
      try { fs.mkdirSync(tempDir, { recursive: true }) } catch {}
      const tempFile = join(tempDir, 'usageWorker-dev-bootstrap.js')

      const bootstrap = `const ts = require(${JSON.stringify(require.resolve('typescript'))});\n` +
        `const fs = require('fs');\n` +
        `require.extensions['.ts'] = (module, filename) => {\n` +
        `  const source = fs.readFileSync(filename, 'utf8');\n` +
        `  const out = ts.transpileModule(source, {\n` +
        `    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, skipLibCheck: true },\n` +
        `    fileName: filename\n` +
        `  }).outputText;\n` +
        `  module._compile(out, filename);\n` +
        `};\n` +
        `require(${JSON.stringify(workerTsPath)});\n`

      fs.writeFileSync(tempFile, bootstrap)
      workerScript = tempFile
    } else {
      // Find the actual worker file with hash
      const assetsDir = join(__dirname, 'assets')
      const workerFiles = fs.readdirSync(assetsDir).filter((f: string) => f.startsWith('usageWorker-') && f.endsWith('.js'))
      if (workerFiles.length === 0) {
        throw new Error('Usage worker file not found')
      }
      workerScript = join(assetsDir, workerFiles[0])
    }

    usageWorker = new Worker(workerScript, workerOptions)
    usageWorker.on('message', (msg: any) => {
      workerBusy = false
      usageWorkerReady = true
      if (msg?.ok && msg.data) {
        const data = msg.data
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('usage-update', data)
        }
        if (floatingWindow && !floatingWindow.isDestroyed()) {
          floatingWindow.webContents.send('usage-update', data)
        }
        lastWorkerBlock = data.currentBlock
        updateTrayUsage(data.currentBlock)
        if (pendingMenuRefreshFromClick) {
          pendingMenuRefreshFromClick = false
          // Refresh tray menu with the freshest data immediately on click
          Promise.resolve().then(() => updateTrayMenu()).catch((e) => console.error(e))
        }
      }
      // Resolve any pending Promises waiting for this result
      if (workerResolvers.length > 0) {
        const resolvers = workerResolvers
        workerResolvers = []
        resolvers.forEach((r) => r(msg))
      }
      if (pendingRefresh) {
        pendingRefresh = false
        scheduleBackgroundRefresh()
      }
    })
    usageWorker.on('error', (err) => {
      workerBusy = false
      usageWorkerReady = false
      console.error('Usage worker error:', err)
    })
    usageWorker.on('exit', (code) => {
      workerBusy = false
      usageWorker = null
      usageWorkerReady = false
      if (code !== 0) console.warn('Usage worker exited unexpectedly')
    })
  } catch (e) {
    console.error('Failed to create usage worker:', e)
  }
}

const scheduleBackgroundRefresh = async (hard = false) => {
  initUsageWorker()
  if (!usageWorker) return
  if (workerBusy) { pendingRefresh = true; return }
  workerBusy = true
  const userPlan = await getUserClaudePlan()
  usageWorker.postMessage({ 
    type: hard ? 'hard-refresh' : 'refresh',
    userPlan: userPlan
  })
}

// Request a refresh and return the worker's payload once it's ready
const requestUsageRefresh = async (hard = false): Promise<any> => {
  initUsageWorker()
  if (!usageWorker) return Promise.reject(new Error('Worker not initialized'))
  
  // Get user's Claude plan to pass to worker
  const userPlan = await getUserClaudePlan()
  
  return new Promise((resolve) => {
    workerResolvers.push((payload) => resolve(payload))
    if (workerBusy) {
      // Coalesce: mark pending and let current run finish
      pendingRefresh = true
    } else {
      workerBusy = true
      usageWorker!.postMessage({ 
        type: hard ? 'hard-refresh' : 'refresh',
        userPlan: userPlan
      })
    }
  })
}


// Create a high-quality PNG pulse icon for macOS menu bar
const createBatteryIcon = (options?: { size?: number; percentage?: number }) => {
  const baseSize = options?.size ?? 16 // Base size for menu bar
  const percentage = Math.max(0, Math.min(100, options?.percentage ?? 0))

  console.log(`Creating HD tray pulse icon: ${percentage}% - size: ${baseSize}px`)

  try {
    // Create ultra high-DPI canvas (4x for maximum Retina quality)
    const scale = 4 // Higher scale for ultra-crisp rendering
    const canvasSize = baseSize * scale

    const { createCanvas } = require('canvas')
    const canvas = createCanvas(canvasSize, canvasSize)
    const ctx = canvas.getContext('2d')

    // Scale the context for ultra high-DPI rendering
    ctx.scale(scale, scale)

    // Enable maximum quality rendering with all optimizations
    ctx.imageSmoothingEnabled = false // Disable for pixel-perfect edges
    ctx.patternQuality = 'best'
    ctx.textDrawingMode = 'path'
    ctx.antialias = 'subpixel'

    // Clear canvas with transparent background
    ctx.clearRect(0, 0, baseSize, baseSize)

    // Apple-style battery dimensions (exact proportions from macOS)
    const batteryWidth = 10.5
    const batteryHeight = 5.5
    const batteryX = (baseSize - batteryWidth) / 2
    const batteryY = (baseSize - batteryHeight) / 2

    // Apple-style terminal (precise proportions)
    const terminalWidth = 1
    const terminalHeight = 2.5
    const terminalX = batteryX + batteryWidth - 0.1 // Slight overlap for seamless connection
    const terminalY = batteryY + (batteryHeight - terminalHeight) / 2

    // Apple system colors with proper opacity
    let fillColor
    if (percentage <= 20) {
      fillColor = "#FF3B30" // Apple red
    } else if (percentage <= 50) {
      fillColor = "#FF9500" // Apple orange
    } else {
      fillColor = "#34C759" // Apple green
    }

    // Pixel-perfect alignment for ultra-sharp rendering
    const pixelAlign = (value: number) => Math.round(value * scale) / scale

    // Apple-style rendering with precise stroke width
    ctx.lineWidth = pixelAlign(0.8)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // Battery outline with Apple's exact styling
    ctx.strokeStyle = "#FFFFFF"
    ctx.fillStyle = "transparent"
    ctx.beginPath()
    const outlineX = pixelAlign(batteryX)
    const outlineY = pixelAlign(batteryY)
    const outlineW = pixelAlign(batteryWidth)
    const outlineH = pixelAlign(batteryHeight)
    const cornerRadius = pixelAlign(1.2)

    // Draw battery body with Apple's corner radius
    ctx.roundRect(outlineX, outlineY, outlineW, outlineH, cornerRadius)
    ctx.stroke()

    // Apple-style terminal with seamless connection
    ctx.fillStyle = "#FFFFFF"
    ctx.beginPath()
    const termX = pixelAlign(terminalX)
    const termY = pixelAlign(terminalY)
    const termW = pixelAlign(terminalWidth)
    const termH = pixelAlign(terminalHeight)
    ctx.roundRect(termX, termY, termW, termH, pixelAlign(0.4))
    ctx.fill()

    // Apple-style battery fill with proper padding
    if (percentage > 0) {
      const padding = pixelAlign(1.2)
      const fillWidth = pixelAlign(Math.max(0.8, (batteryWidth - padding * 2) * (percentage / 100)))
      const fillX = pixelAlign(batteryX + padding)
      const fillY = pixelAlign(batteryY + padding)
      const fillHeight = pixelAlign(batteryHeight - padding * 2)
      const fillRadius = pixelAlign(0.6)

      // Apple's battery fill style
      ctx.fillStyle = fillColor
      ctx.beginPath()
      ctx.roundRect(fillX, fillY, fillWidth, fillHeight, fillRadius)
      ctx.fill()
    }

    // Convert canvas to PNG with ultra-high quality settings
    const buffer = canvas.toBuffer('image/png', {
      compressionLevel: 0, // No compression for maximum quality
      filters: canvas.PNG_FILTER_NONE,
      resolution: 288, // Ultra-high DPI (4x base)
      palette: false // Full color depth
    })

    // Create image with proper scale factor for Retina
    const image = nativeImage.createFromBuffer(buffer, {
      scaleFactor: scale / 2, // Adjust scale factor for proper sizing
      width: baseSize,
      height: baseSize
    })

    // Ensure colored rendering (not template)
    image.setTemplateImage(false)

    // Verify the image was created successfully
    if (image.isEmpty()) {
      console.error('HD battery PNG creation failed - falling back to SVG')
      return createBatteryIconSVG(options)
    }

    console.log(`Successfully created HD battery icon: ${image.getSize().width}x${image.getSize().height} (scale: ${scale}x)`)
    return image

  } catch (error) {
    console.error('Failed to create HD battery PNG, falling back to SVG:', error)
    return createBatteryIconSVG(options)
  }
}

// Fallback SVG generation for battery icons
const createBatteryIconSVG = (options?: { size?: number; percentage?: number }) => {
  const size = options?.size ?? 16 // macOS menu bar standard size
  const percentage = options?.percentage ?? 0

  // Calculate battery dimensions with better proportions
  const batteryWidth = Math.max(14, size * 0.8)
  const batteryHeight = Math.max(9, size * 0.56)
  const batteryX = (size - batteryWidth) / 2
  const batteryY = (size - batteryHeight) / 2
  
  // Battery terminal (small rectangle on the right)
  const terminalWidth = Math.max(2, size * 0.12)
  const terminalHeight = Math.max(5, size * 0.31)
  const terminalX = batteryX + batteryWidth
  const terminalY = batteryY + (batteryHeight - terminalHeight) / 2

  // Fill level calculation with better precision
  const fillWidth = Math.max(0, (batteryWidth - 3) * (percentage / 100)) // -3 for border
  const fillX = batteryX + 1.5 // +1.5 for border
  const fillY = batteryY + 1.5 // +1.5 for border
  const fillHeight = batteryHeight - 3 // -3 for border

  // Determine colors based on percentage
  let fillColor, borderColor
  if (percentage <= 20) {
    fillColor = "#FF3B30" // Red for low battery
    borderColor = "#FF3B30"
  } else if (percentage <= 50) {
    fillColor = "#FF9500" // Orange for medium battery
    borderColor = "#FF9500"
  } else {
    fillColor = "#34C759" // Green for good battery
    borderColor = "#34C759"
  }

  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
      <defs>
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-opacity="0.3"/>
        </filter>
      </defs>
      <!-- Battery outline with better stroke -->
      <rect x="${batteryX}" y="${batteryY}" 
            width="${batteryWidth}" height="${batteryHeight}" 
            fill="none" stroke="${borderColor}" stroke-width="1.5" rx="1.5" 
            stroke-linecap="round" stroke-linejoin="round"/>
      
      <!-- Battery terminal with better proportions -->
      <rect x="${terminalX}" y="${terminalY}" 
            width="${terminalWidth}" height="${terminalHeight}" 
            fill="${borderColor}" rx="0.8" 
            stroke-linecap="round" stroke-linejoin="round"/>
      
      <!-- Battery fill with better precision -->
      ${percentage > 0 ? `
        <rect x="${fillX}" y="${fillY}" 
              width="${fillWidth}" height="${fillHeight}" 
              fill="${fillColor}" rx="0.8" 
              stroke-linecap="round" stroke-linejoin="round"/>
      ` : ''}
    </svg>
  `

  return nativeImage.createFromBuffer(Buffer.from(svg))
}

// Fallback SVG generation (original implementation)
const createStatusDotIconSVG = (options?: { size?: number; enabled?: boolean }) => {
  const size = options?.size ?? 16 // macOS menu bar standard size
  const isEnabled = options?.enabled ?? false

  // Use high contrast colors optimized for macOS menu bar
  const color = isEnabled ? '#00D900' : '#FF3B30' // Apple's system green/red

  // Create SVG with proper XML declaration and viewBox
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${size/2}" cy="${size/2}" r="${size/3}" fill="${color}"/>
</svg>`

  try {
    const image = nativeImage.createFromBuffer(Buffer.from(svg, 'utf8'))

    // For macOS, we want colored icons, not template
    image.setTemplateImage(false)

    // Verify the image was created successfully
    if (image.isEmpty()) {
      console.error('Status dot SVG creation failed - image is empty')
      return createActivityIcon({ size: 16, color: '#000000', template: true })
    }

    console.log(`Successfully created status dot icon from SVG: ${image.getSize().width}x${image.getSize().height}`)
    return image

  } catch (error) {
    console.error('Failed to create status dot from SVG:', error)
    return createActivityIcon({ size: 16, color: '#000000', template: true })
  }
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

const getUsagePercent = async () => {
  try {
    const userPlan = await getUserClaudePlan()
    const block = await getCurrentBlockInfo(userPlan)
    if (!block || !block.limit || block.limit <= 0) return { percent: null as number | null, block }
    const percent = Math.max(0, Math.min(100, Math.round((block.usage / block.limit) * 100)))
    return { percent, block }
  } catch {
    return { percent: null as number | null, block: null as any }
  }
}

const updateTrayUsage = async (blockData?: any) => {
  if (!tray) return
  
  let block, percent
  if (blockData) {
    // Use data passed from worker
    block = blockData
    percent = block && block.limit > 0 ? Math.max(0, Math.min(100, Math.round((block.usage / block.limit) * 100))) : null
  } else {
    // Use last worker-provided data to keep tray consistent with dashboard/floating
    block = lastWorkerBlock
    percent = block && block.limit > 0 ? Math.max(0, Math.min(100, Math.round((block.usage / block.limit) * 100))) : null
  }

  // Use battery icon to show REMAINING tokens (100 - used percentage)
  try {
    const usedPercentage = percent || 0
    const remainingPercentage = Math.max(0, 100 - usedPercentage) // Invert to show remaining

    const batteryIcon = createBatteryIcon({
      size: 16,
      percentage: remainingPercentage
    })
    tray.setImage(batteryIcon)
    if (process.env.SENTINEL_DEBUG === '1') {
      console.log(`Updated tray battery icon: ${remainingPercentage}% remaining (${usedPercentage}% used)`)
    }
  } catch (error) {
    console.warn('Failed to update tray battery icon:', error)
    // Fallback to text if icon fails
    try {
      tray.setImage(nativeImage.createEmpty())
      const displayText = percent === null ? '—' : `${100 - percent}%`
      tray.setTitle(displayText)
    } catch {}
  }

  // Clear title since we're using icon
  if (process.platform === 'darwin') {
    try {
      tray.setTitle('')
    } catch {}
  }

  // Tooltip with details including next renewal time
  const timeLeft = block?.timeRemaining ?? null
  const usageText = block ? `${formatTokens(block.usage)} / ${formatTokens(block.limit || 0)} tokens` : 'Usage unavailable'
  
  // Get next renewal time from the renewal service
  let renewalInfo = ''
  let renewalStatus: RenewalStatusResult | null = null
  try {
    renewalStatus = await getRenewalStatus()
    if (renewalStatus.enabled) {
      renewalInfo = '\nAuto-renewal: ON'

      if (renewalStatus.nextRenewal) {
        const nextRenewalTime = new Date(renewalStatus.nextRenewal)
        const timeOptions: Intl.DateTimeFormatOptions = {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }

        const dateOptions: Intl.DateTimeFormatOptions = {
          month: 'short',
          day: 'numeric'
        }

        const now = new Date()
        const isToday = nextRenewalTime.toDateString() === now.toDateString()
        const isTomorrow = nextRenewalTime.toDateString() === new Date(now.getTime() + 24 * 60 * 60 * 1000).toDateString()

        let timeStr
        if (isToday) {
          timeStr = `Today at ${nextRenewalTime.toLocaleTimeString('en-US', timeOptions)}`
        } else if (isTomorrow) {
          timeStr = `Tomorrow at ${nextRenewalTime.toLocaleTimeString('en-US', timeOptions)}`
        } else {
          timeStr = `${nextRenewalTime.toLocaleDateString('en-US', dateOptions)} at ${nextRenewalTime.toLocaleTimeString('en-US', timeOptions)}`
        }

        renewalInfo += `\nNext session: ${timeStr}`
      } else if (renewalStatus.timeRemaining) {
        renewalInfo += `\nTime remaining: ${renewalStatus.timeRemaining}`
      } else {
        renewalInfo += '\nNext session: TBD'
      }
    } else {
      renewalInfo = '\nAuto-renewal: OFF'
    }
  } catch (configError) {
    renewalInfo = '\nAuto-renewal: Status unknown'
  }
  
  // Create modern glass-style tooltip content
  const tooltipData = {
    title: 'Claude Sentinel',
    usage: percent !== null ? `${percent}%` : null,
    tokens: usageText,
    timeRemaining: timeLeft !== null ? formatMinutes(timeLeft) : null,
    renewalStatus: renewalInfo.replace('\n', '').replace('Auto-renewal: ', ''),
    nextSession: renewalInfo.includes('Next session:') ? renewalInfo.split('Next session: ')[1] : null
  }

  // Set comprehensive tooltip with usage data
  const tooltipLines = []
  tooltipLines.push('Claude Sentinel')

  if (percent !== null) {
    tooltipLines.push(`Usage: ${percent}% used`)
    tooltipLines.push(`Remaining: ${100 - percent}%`)
  } else {
    tooltipLines.push('Usage: Unknown')
  }

  tooltipLines.push(usageText)

  if (timeLeft !== null) {
    tooltipLines.push(`Time left: ${formatMinutes(timeLeft)}`)
  }

  // Add renewal status info
  if (renewalStatus) {
    if (renewalStatus.enabled) {
      tooltipLines.push('')
      tooltipLines.push('Auto-renewal: ON')

      if (renewalStatus.nextRenewal) {
        const nextRenewalTime = new Date(renewalStatus.nextRenewal)
        const now = new Date()
        const isToday = nextRenewalTime.toDateString() === now.toDateString()
        const isTomorrow = nextRenewalTime.toDateString() === new Date(now.getTime() + 24 * 60 * 60 * 1000).toDateString()

        const timeOptions: Intl.DateTimeFormatOptions = {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }

        const dateOptions: Intl.DateTimeFormatOptions = {
          month: 'short',
          day: 'numeric'
        }

        let timeStr
        if (isToday) {
          timeStr = `Today at ${nextRenewalTime.toLocaleTimeString('en-US', timeOptions)}`
        } else if (isTomorrow) {
          timeStr = `Tomorrow at ${nextRenewalTime.toLocaleTimeString('en-US', timeOptions)}`
        } else {
          timeStr = `${nextRenewalTime.toLocaleDateString('en-US', dateOptions)} at ${nextRenewalTime.toLocaleTimeString('en-US', timeOptions)}`
        }

        tooltipLines.push(`Next session: ${timeStr}`)
      } else if (renewalStatus.timeRemaining) {
        tooltipLines.push(`Time remaining: ${renewalStatus.timeRemaining}`)
      } else {
        tooltipLines.push('Next session: TBD')
      }
    } else {
      tooltipLines.push('')
      tooltipLines.push('Auto-renewal: OFF')
    }
  } else {
    tooltipLines.push('')
    tooltipLines.push('Auto-renewal: Status unknown')
  }

  // Set the tooltip
  tray.setToolTip(tooltipLines.join('\n'))

  // Refresh tray context menu to reflect latest usage
  // Avoid rebuilding the menu while it is open to prevent UI freeze
  if (!isTrayMenuOpen) {
    try {
      await updateTrayMenu()
    } catch (menuError) {
      console.error(menuError)
    }
  }
}

const startTrayUsageUpdates = () => {
  // Kick off a worker refresh so tray receives consistent data
  scheduleBackgroundRefresh().catch(() => {})
  // Refresh via worker every minute
  if (trayUsageInterval) { clearInterval(trayUsageInterval); trayUsageInterval = null }
  trayUsageInterval = setInterval(() => {
    scheduleBackgroundRefresh().catch(() => {})
  }, 60 * 1000)
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
    // Show window immediately for faster perceived startup
    show: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Enable background throttling for better performance
      backgroundThrottling: false,
    },
  })

  // Load the app
  if (isDev) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Open DevTools for debugging
  if (isDev && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.openDevTools()
  }

  // Add keyboard shortcut for DevTools (Cmd+Option+I on macOS, F12 on Windows/Linux)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' ||
        (input.key === 'i' && input.meta && input.alt)) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.toggleDevTools()
      }
    }
  })

  // Handle window close button - hide to menu bar instead of closing
  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin') {
      // On macOS, hide window and dock icon instead of closing
      event.preventDefault()
      mainWindow?.hide()

      // Hide dock icon when window is hidden to menu bar
      try { if (app.dock) app.dock.hide() } catch {}
    } else {
      // On Windows/Linux, hide to system tray
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  // Handle window closed (for cleanup when app actually quits)
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
  if (process.env.SENTINEL_DEBUG === '1') console.log('=== Creating macOS menu bar tray ===')

  // Create initial battery icon at 100% remaining (full battery)
  let trayIcon
  try {
    trayIcon = createBatteryIcon({
      size: 16,
      percentage: 100 // Start with full battery (100% tokens remaining)
    })
  if (process.env.SENTINEL_DEBUG === '1') console.log('Created initial full battery icon (100% tokens remaining)')
  } catch (error) {
    console.error('Failed to create initial battery icon:', error)
    trayIcon = nativeImage.createEmpty()
  }

  if (process.env.SENTINEL_DEBUG === '1') console.log('Creating tray...')
  tray = new Tray(trayIcon)
  
  // Verify tray was created successfully
  if (!tray || tray.isDestroyed()) {
    console.error('Failed to create tray')
    return
  }
  
  if (process.env.SENTINEL_DEBUG === '1') console.log('Tray created successfully')
  
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

  // Set initial basic tooltip and context menu
  tray.setToolTip('Claude Sentinel - Loading...')
  // Track open/close to throttle updates while visible
  contextMenu.on('menu-will-show', () => { isTrayMenuOpen = true })
  contextMenu.on('menu-will-close', () => { isTrayMenuOpen = false })
  tray.setContextMenu(contextMenu)

  // Handle tray click - keep it light; defer any heavy refresh until after menu closes
  tray.on('click', () => {
    // Defer just a bit, but always refresh in background (hard) when clicked
    setTimeout(() => {
      try {
        pendingMenuRefreshFromClick = true
        scheduleBackgroundRefresh(true)
      } catch {}
    }, 300)
  })

  // Start periodic usage updates for tray title/tooltip only after worker is ready
  const startWhenReady = () => {
    if (usageWorkerReady) {
      startTrayUsageUpdates()
    } else {
      setTimeout(startWhenReady, 250)
    }
  }
  startWhenReady()
}

// App event handlers
app.whenReady().then(async () => {
  // Create window first for fast UI display
  createWindow()
  
  // Defer heavy operations to avoid blocking main thread
  setImmediate(() => {
    createTray()
  })
  
  
  // Defer dock icon setup (macOS)
  if (process.platform === 'darwin' && app.dock) {
    setTimeout(() => {
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
    }, 50)
  }
  
  // Defer renewal monitoring startup
  setTimeout(() => {
    try {
      const cfg = loadConfig()
      if (cfg.enabled) startRenewalMonitoring()
    } catch {}
  }, 200)
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
  // On macOS, keep app running in system tray unless explicitly quit
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // Clean up worker
  if (usageWorker) {
    usageWorker.terminate()
    usageWorker = null
  }
  
  // Clean up tray
  if (tray) {
    tray.destroy()
  }
  if (trayUsageInterval) {
    clearInterval(trayUsageInterval)
    trayUsageInterval = null
  }

  // Stop renewal timers and kill any renewal child processes
  try { stopRenewalMonitoring() } catch {}
  try {
    const { killAllRenewalChildren } = require('./services/renewal-service')
    if (killAllRenewalChildren) killAllRenewalChildren()
  } catch {}
})


// Timer-based renewal scheduling
let renewalTimer: NodeJS.Timeout | null = null
let scheduledRenewalTimer: NodeJS.Timeout | null = null

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
const scheduleNextRenewal = async (): Promise<void> => {
  // Clear block-based renewal timer
  if (renewalTimer) {
    clearTimeout(renewalTimer)
    renewalTimer = null
  }

  // Only clear scheduled timer if we're about to set a new one
  // This preserves running scheduled timers when just doing block-based scheduling
  let status: RenewalStatusResult
  try {
    status = await getRenewalStatus()
  } catch (error) {
    renewalLogger.error(`Failed to load renewal status for scheduling: ${error instanceof Error ? error.message : String(error)}`, 'schedule')
    setTimeout(() => {
      scheduleNextRenewal().catch(err => {
        renewalLogger.error(`Error scheduling next renewal: ${err instanceof Error ? err.message : String(err)}`, 'schedule')
      })
    }, 60000)
    return
  }

  const hasScheduledTime = !!status.scheduledStartTime

  if (hasScheduledTime && scheduledRenewalTimer) {
    // There's already a scheduled timer running - clear it to set new one
    clearTimeout(scheduledRenewalTimer)
    scheduledRenewalTimer = null
  }

  const reschedule = (delay: number) => {
    setTimeout(() => {
      scheduleNextRenewal().catch(err => {
        renewalLogger.error(`Error scheduling next renewal: ${err instanceof Error ? err.message : String(err)}`, 'schedule')
      })
    }, delay)
  }

  try {
    const now = new Date()

    // Priority 1: Always check for user scheduled time FIRST (regardless of auto-renewal state)
    if (status.scheduledStartTime) {
      const scheduledTime = new Date(status.scheduledStartTime)

      const runScheduledRenewalImmediately = (type: 'late' | 'overdue') => {
        setTimeout(async () => {
          try {
            const actionLabel = type === 'overdue'
              ? '🚀 EXECUTING OVERDUE SCHEDULED RENEWAL'
              : '🚀 EXECUTING LATE SCHEDULED RENEWAL'
            renewalLogger.info(actionLabel, 'schedule')
            const result = await performRenewalCheck()

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('renewal-status-update', await getRenewalStatus())
            }
            if (result.success && result.action && tray) {
              try { await updateTrayMenu() } catch (trayError) { console.error(trayError) }
              try { await updateTrayUsage() } catch (trayError) { console.error(trayError) }
            }

            reschedule(2000)
          } catch (error) {
            const errorLabel = type === 'overdue'
              ? '❌ Error in overdue scheduled renewal'
              : '❌ Error in late scheduled renewal'
            renewalLogger.error(`${errorLabel}: ${error instanceof Error ? error.message : String(error)}`, 'schedule')
          }
        }, 1000)
      }

      if (scheduledTime > now) {
        const totalDelay = scheduledTime.getTime() - now.getTime()
        const actualTriggerTime = new Date(now.getTime() + totalDelay)

        renewalLogger.info(`🕐 SCHEDULED RENEWAL SET: Will trigger at ${actualTriggerTime.toISOString()} (exact scheduled time ${scheduledTime.toISOString()})`, 'schedule')

        scheduledRenewalTimer = setTimeout(async () => {
          try {
            renewalLogger.info(`🚀 EXECUTING SCHEDULED RENEWAL at ${new Date().toISOString()}`, 'schedule')
            const result = await performRenewalCheck()

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('renewal-status-update', await getRenewalStatus())
            }
            if (result.success && result.action && tray) {
              try { await updateTrayMenu() } catch (trayError) { console.error(trayError) }
              try { await updateTrayUsage() } catch (trayError) { console.error(trayError) }
            }

            reschedule(2000)
          } catch (error) {
            renewalLogger.error(`❌ Error in scheduled renewal: ${error instanceof Error ? error.message : String(error)}`, 'schedule')
            reschedule(60000)
          }
        }, totalDelay)

        return // Exit early - scheduled time takes absolute priority
      } else {
        // Scheduled time has just passed (within last 5 minutes) - trigger immediate renewal
        const timeSinceScheduled = now.getTime() - scheduledTime.getTime()
        const fiveMinutesInMs = 5 * 60 * 1000

        if (timeSinceScheduled <= fiveMinutesInMs) {
          renewalLogger.info(`⚡ Scheduled time recently passed (${Math.round(timeSinceScheduled / 1000)}s ago), triggering immediate renewal`, 'schedule')
          runScheduledRenewalImmediately('late')
          return // Exit early after scheduling immediate renewal
        }

        // If we miss by more than 5 minutes, fall back to an immediate catch-up renewal
        const minutesLate = (timeSinceScheduled / 60000).toFixed(1)
        renewalLogger.warn(`⚠️ Scheduled renewal missed by ${minutesLate} minutes, running immediately`, 'schedule')
        runScheduledRenewalImmediately('overdue')
        return
      }
    }

    // Only proceed with block-based renewals if auto-renewal is enabled AND no scheduled time
    if (!status.enabled || !status.running) {
      renewalLogger.info('🔄 Auto-renewal disabled, not scheduling block-based renewals', 'service')
      return
    }

    // If there's a scheduled time, skip all intermediate block-based renewals
    if (status.scheduledStartTime) {
      renewalLogger.info('📅 Scheduled renewal set - SKIPPING all intermediate block-based renewals', 'service')
      return
    }

    let targetTime: Date | null = null
    let reason = ''

    // Priority 2: Block expiration (only if auto-renewal enabled and no scheduled time)
    if (status.currentBlock?.endTime && new Date(status.currentBlock.endTime) > now) {
      targetTime = new Date(status.currentBlock.endTime)
      reason = 'block expiration'
    }
    // Priority 3: Next renewal time (fallback calculation)
    else if (status.nextRenewal && status.nextRenewal > now) {
      targetTime = status.nextRenewal
      reason = 'calculated renewal'
    }

    if (targetTime && targetTime > now) {
      const delay = targetTime.getTime() - now.getTime()

      if (delay > 0) {
        renewalTimer = setTimeout(async () => {
          try {
            renewalLogger.info(`Executing scheduled renewal (${reason})`, 'renewal')
            const result = await performRenewalCheck()
            
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('renewal-status-update', await getRenewalStatus())
            }
            if (result.success && result.action && tray) {
              try { await updateTrayMenu() } catch (trayError) { console.error(trayError) }
              try { await updateTrayUsage() } catch (trayError) { console.error(trayError) }
            }

            reschedule(2000)
          } catch (error) {
            renewalLogger.error(`Error in scheduled renewal: ${error instanceof Error ? error.message : String(error)}`, 'renewal')
            reschedule(60000)
          }
        }, delay)

        renewalLogger.info(`Next ${reason} at ${targetTime.toISOString()}, renewal scheduled exactly at target time`, 'schedule')
      } else {
        renewalLogger.warn(`Target time ${targetTime.toISOString()} is in the past, checking immediately`, 'schedule')
        // Schedule immediate check
        renewalTimer = setTimeout(async () => {
          await performRenewalCheck()
          await scheduleNextRenewal()
        }, 1000)
      }
    } else {
      // No valid target time - only use emergency fallback if system is in unknown state
      const currentStatus = await getRenewalStatus()
      if (!currentStatus.currentBlock && currentStatus.enabled && currentStatus.running) {
        renewalLogger.warn(`No current block detected and no renewal time available, using emergency fallback check in ${RENEWAL_CONFIG.fallbackCheckInterval / 60000} minutes`, 'schedule')
        renewalTimer = setTimeout(async () => {
          try {
            await performRenewalCheck()
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('renewal-status-update', await getRenewalStatus())
            }
            await scheduleNextRenewal() // Reschedule once to see if we now have valid timing
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
    reschedule(60000)
  }
}

// Start renewal monitoring when app starts
const startRenewalMonitoring = () => {
  if (renewalTimer) {
    renewalLogger.info('Renewal monitoring already active', 'service')
    return
  }

  renewalLogger.info('Starting timer-based renewal monitoring', 'service')
  scheduleNextRenewal().catch(error => {
    renewalLogger.error(`Error starting renewal monitoring: ${error instanceof Error ? error.message : String(error)}`, 'schedule')
  })
}

const stopRenewalMonitoring = () => {
  // Kill ALL timers immediately when auto-renewal is turned off
  if (renewalTimer) {
    clearTimeout(renewalTimer)
    renewalTimer = null
  }
  if (scheduledRenewalTimer) {
    clearTimeout(scheduledRenewalTimer)
    scheduledRenewalTimer = null
  }
  renewalLogger.info('🛑 Renewal monitoring stopped - ALL timers cleared (including scheduled)', 'service')
}

// Force stop all timers (used when clearing scheduled time)
const forceStopAllTimers = () => {
  if (renewalTimer) {
    clearTimeout(renewalTimer)
    renewalTimer = null
  }
  if (scheduledRenewalTimer) {
    clearTimeout(scheduledRenewalTimer)
    scheduledRenewalTimer = null
  }
  renewalLogger.info('🛑 ALL timers force-stopped', 'service')
}

const updateTrayMenu = async () => {
  if (!tray) return

  console.log('Updating tray menu...')
  const status = await getRenewalStatus()
  console.log('Renewal status for tray menu:', status)
  const userPlan = await getUserClaudePlan()
  const block = await getCurrentBlockInfo(userPlan)
  const percent = block && block.limit > 0 ? Math.max(0, Math.min(100, Math.round((block.usage / block.limit) * 100))) : null
  const usageLine = percent === null ? 'Usage: unknown' : `Usage: ${percent}% (${formatTokens(block.usage)} / ${formatTokens(block.limit)})`
  const timeLine = `Time remaining: ${formatMinutes(block?.timeRemaining ?? null)}`

  // Get next session time
  let nextSessionLine = null
  if (process.env.SENTINEL_DEBUG === '1') {
    console.log(`Tray menu update: status.enabled=${status.enabled}, status.nextRenewal=${status.nextRenewal}`)
  }
  
  if (status.enabled && status.nextRenewal) {
    const nextRenewalTime = new Date(status.nextRenewal)
    const now = new Date()
    const isToday = nextRenewalTime.toDateString() === now.toDateString()
    const isTomorrow = nextRenewalTime.toDateString() === new Date(now.getTime() + 24*60*60*1000).toDateString()

    if (process.env.SENTINEL_DEBUG === '1') {
      console.log(`Next renewal time: ${nextRenewalTime.toISOString()}, isToday: ${isToday}, isTomorrow: ${isTomorrow}`)
    }

    const timeOptions: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }

    if (isToday) {
      nextSessionLine = `Next session: Today at ${nextRenewalTime.toLocaleTimeString('en-US', timeOptions)}`
    } else if (isTomorrow) {
      nextSessionLine = `Next session: Tomorrow at ${nextRenewalTime.toLocaleTimeString('en-US', timeOptions)}`
    } else {
      const dateOptions: Intl.DateTimeFormatOptions = {
        month: 'short',
        day: 'numeric'
      }
      nextSessionLine = `Next session: ${nextRenewalTime.toLocaleDateString('en-US', dateOptions)} at ${nextRenewalTime.toLocaleTimeString('en-US', timeOptions)}`
    }
    if (process.env.SENTINEL_DEBUG === '1') console.log(`Generated next session line: ${nextSessionLine}`)
  } else {
    if (process.env.SENTINEL_DEBUG === '1') {
      console.log(`Next session line not generated: enabled=${status.enabled}, nextRenewal=${status.nextRenewal}`)
    }
  }

  const menuItems = [
    {
      label: usageLine,
      enabled: false
    },
    {
      label: timeLine,
      enabled: false
    }
  ]

  // Add next session line if available
  if (nextSessionLine) {
    menuItems.push({
      label: nextSessionLine,
      enabled: false
    })
  }

  const contextMenu = Menu.buildFromTemplate([
    ...menuItems,
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
          console.log(`Tray auto-renewal toggle clicked: checked=${menuItem.checked}`)
          
          if (menuItem.checked) {
            console.log('Starting renewal service from tray...')
            await startRenewalService()
            startRenewalMonitoring()
            console.log('Renewal service started from tray')
          } else {
            console.log('Stopping renewal service from tray...')
            await stopRenewalService()
            stopRenewalMonitoring()
            console.log('Renewal service stopped from tray')
          }
          
          // Notify renderer
          if (mainWindow && !mainWindow.isDestroyed()) {
            try {
              const latestStatus = await getRenewalStatus()
              console.log('Sending renewal status update to renderer:', latestStatus)
              mainWindow.webContents.send('renewal-status-update', latestStatus)
            } catch (statusError) {
              console.error(statusError)
            }
          }
          
          // Update tray menu
          try {
            await updateTrayMenu()
          } catch (menuError) {
            console.error(menuError)
          }
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
  
  // Track menu open/close to prevent rebuild stalls
  contextMenu.on('menu-will-show', () => { isTrayMenuOpen = true })
  contextMenu.on('menu-will-close', () => { isTrayMenuOpen = false })
  tray.setContextMenu(contextMenu)
}

// IPC handlers
ipcMain.handle('app-version', () => {
  return app.getVersion()
})

ipcMain.handle('get-usage-data', async () => {
  try {
    const userPlan = await getUserClaudePlan()
    const recentData = await getRecentUsage(30, userPlan) // Last 30 days
    const blockInfo = await getCurrentBlockInfo(userPlan)
    
    return {
      daily: recentData.daily.map(day => ({
        date: day.date,
        inputTokens: day.inputTokens,
        outputTokens: day.outputTokens,
        totalTokens: day.totalTokens,
        cost: day.cost,
        model: 'mixed', // Could be enhanced to show model breakdown
        // Expose session count for per-day summaries on the dashboard
        sessionsCount: Array.from(day.blocks || new Set()).length
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
    return await getRenewalStatus()
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
        setTimeout(async () => {
          try {
            const renewalResult = await performRenewalCheck()
            if (renewalResult.success && renewalResult.action) {
              renewalLogger.info(`✅ Initial renewal check completed: ${renewalResult.action}`, 'service')
            }
            
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('renewal-status-update', await getRenewalStatus())
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
    try {
      await updateTrayMenu()
    } catch (menuError) {
      console.error(menuError)
    }
    
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
      const status = await getRenewalStatus()
      if (status.enabled && status.running) {
        renewalLogger.info('Scheduled time changed, rescheduling renewal', 'schedule')
        scheduleNextRenewal().catch(error => {
          renewalLogger.error(`Error rescheduling renewal: ${error instanceof Error ? error.message : String(error)}`, 'schedule')
        })
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
    const result = await requestUsageRefresh(false)
    if (result?.ok && result.data) return result.data
    throw new Error(result?.error || 'Worker refresh failed')
  } catch (error) {
    console.error('Error refreshing usage data (worker):', error)
    throw error
  }
})

// Force reset usage cache and perform a fresh usage read (hard refresh)
ipcMain.handle('hard-refresh-usage-data', async () => {
  try {
    const result = await requestUsageRefresh(true)
    if (result?.ok && result.data) return result.data
    return { success: false, error: result?.error || 'Worker hard-refresh failed' }
  } catch (error) {
    console.error('Error performing hard refresh (worker):', error)
    return { success: false }
  }
})

ipcMain.handle('perform-renewal-check', async () => {
  try {
    // Return immediately to avoid blocking the UI
    setImmediate(async () => {
      try {
        const result = await performRenewalCheck()
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('renewal-status-update', await getRenewalStatus())
        }
        
        if (result.success && result.action && tray) {
          try { await updateTrayMenu() } catch (trayError) { console.error(trayError) }
          try { await updateTrayUsage() } catch (trayError) { console.error(trayError) }
        }
        
        const status = await getRenewalStatus()
        if (status.enabled && status.running) {
          setTimeout(() => {
            scheduleNextRenewal().catch(err => {
              renewalLogger.error(`Error scheduling next renewal: ${err instanceof Error ? err.message : String(err)}`, 'schedule')
            })
          }, 2000)
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
          .filter((name: string) => name.startsWith('-Users-'))
          .map((name: string) => {
            const match = name.match(/^(-Users-[^-]+-)/)
            return (match ? match[1] : null) as string | null
          })
          .filter((pattern: string | null): pattern is string => Boolean(pattern))
        
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
      const { resetUsageCache } = require('./services/ccusage-integration')
      resetUsageCache()
      setTimeout(async () => {
        try {
          const userPlan = await getUserClaudePlan()
          const data = await getRecentUsage(30, userPlan)
          const usageUpdateData = {
            daily: data.daily.map(day => ({
              date: day.date,
              inputTokens: day.inputTokens,
              outputTokens: day.outputTokens,
              totalTokens: day.totalTokens,
              cost: day.cost,
              model: 'mixed',
              sessionsCount: Array.from(day.blocks || new Set()).length
            })),
            summary: {
              totalCost: data.totalCost,
              totalTokens: data.totalTokens,
              totalSessions: data.totalSessions,
              averageTokensPerSession: data.totalSessions > 0 ? data.totalTokens / data.totalSessions : 0
            },
            currentBlock: await getCurrentBlockInfo(userPlan)
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
const getSettingsFilePath = () => path.join(app.getPath('userData'), 'settings.json')

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

// Helper function to get user's Claude plan from settings
async function getUserClaudePlan(): Promise<string> {
  try {
    const settingsFile = getSettingsFilePath()
    
    if (fs.existsSync(settingsFile)) {
      const fileContent = fs.readFileSync(settingsFile, 'utf8')
      const savedSettings = JSON.parse(fileContent)
      return normalizeClaudePlan(savedSettings.claudePlan)
    }

    return 'auto'
  } catch (error) {
    console.warn('Failed to get Claude plan from settings:', error)
    return 'auto'
  }
}

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
    // Load existing settings to compare Claude plan
    let oldSettings: any = {}
    const settingsFile = getSettingsFilePath()
    
    try {
      console.log(`Loading existing settings from: ${settingsFile}`)
      if (fs.existsSync(settingsFile)) {
        oldSettings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
        console.log(`Loaded existing settings:`, oldSettings)
      } else {
        console.log(`Settings file does not exist yet: ${settingsFile}`)
      }
    } catch (error) {
      console.warn('Could not load existing settings for comparison:', error)
    }
    
    // Check if Claude plan changed
    const claudePlanChanged = oldSettings.claudePlan !== settings.claudePlan
    console.log(`Plan change detection: oldPlan='${oldSettings.claudePlan}', newPlan='${settings.claudePlan}', changed=${claudePlanChanged}`)
    
    // Save all settings to the main settings file
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
    
    // If Claude plan changed, trigger hard refresh to apply new limits immediately
    if (claudePlanChanged) {
      console.log(`Claude plan changed from '${oldSettings.claudePlan || 'auto'}' to '${settings.claudePlan}' - triggering hard refresh`)
      
      try {
        // Reset cache and trigger hard refresh
        resetUsageCache()
        
        // Trigger hard refresh with new plan
        setTimeout(async () => {
          try {
            const result = await requestUsageRefresh(true)
            
            // Send updated usage data to renderer
            if (result?.ok && result.data && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('usage-update', result.data)
            }
            
            // Update tray with new limits after refresh completes
            // Add small delay to ensure new data is processed
            setTimeout(() => {
              updateTrayUsage()
              updateTrayMenu()
            }, 200)
            
          } catch (error) {
            console.error('Error during automatic hard refresh after plan change:', error)
          }
        }, 100) // Small delay to ensure settings are fully saved
        
      } catch (error) {
        console.error('Error triggering hard refresh after plan change:', error)
      }
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
    const { getSessionStatus } = await import('./services/auto-renewal-integration')
    return getSessionStatus()
  } catch (error) {
    console.error('Error getting session status:', error)
    return { error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('force-start-new-session', async () => {
  try {
    const { forceStartNewSession } = await import('./services/auto-renewal-integration')
    const result = forceStartNewSession()
    
    // Send status update to renderer after forcing new session
    if (mainWindow && !mainWindow.isDestroyed()) {
      const { getSessionStatus } = await import('./services/auto-renewal-integration')
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
    const { getRecentBlockEvents } = await import('./services/block-tracker')
    return getRecentBlockEvents(hours)
  } catch (error) {
    console.error('Error getting block events:', error)
    return []
  }
})

ipcMain.handle('get-block-snapshot', async () => {
  try {
    const { loadBlockSnapshot } = await import('./services/block-tracker')
    return loadBlockSnapshot()
  } catch (error) {
    console.error('Error getting block snapshot:', error)
    return null
  }
})

ipcMain.handle('get-daily-blocks', async (_, date?: string) => {
  try {
    const { getCurrentBlockInfo } = await import('./services/ccusage-service')
    const userPlan = await getUserClaudePlan()
    const blockInfo = await getCurrentBlockInfo(userPlan)
    
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
      const { resetUsageCache } = require('./services/ccusage-integration')
      resetUsageCache()
      
      setTimeout(async () => {
        try {
          const userPlan = await getUserClaudePlan()
          const data = await getRecentUsage(30, userPlan)
          const usageUpdateData = {
            daily: data.daily.map(day => ({
              date: day.date,
              inputTokens: day.inputTokens,
              outputTokens: day.outputTokens,
              totalTokens: day.totalTokens,
              cost: day.cost,
              model: 'mixed',
              sessionsCount: Array.from(day.blocks || new Set()).length
            })),
            summary: {
              totalCost: data.totalCost,
              totalTokens: data.totalTokens,
              totalSessions: data.totalSessions,
              averageTokensPerSession: data.totalSessions > 0 ? data.totalTokens / data.totalSessions : 0
            },
            currentBlock: await getCurrentBlockInfo(userPlan)
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

// AI Specification Development IPC Handlers
ipcMain.handle('spec-create-project', async (_, projectData) => {
  try {
    return await specService.createProject(projectData)
  } catch (error) {
    console.error('Error creating project:', error)
    throw error
  }
})

// Create user project from selected folder
ipcMain.handle('spec-create-user-project', async (_, selectedPath, projectName, description) => {
  try {
    console.log('🏗️ Creating user project:', { selectedPath, projectName, description })
    const result = await specService.createUserProject(selectedPath, projectName, description)
    console.log('✅ User project created successfully:', result)
    return result
  } catch (error) {
    console.error('❌ Error creating user project:', error)
    throw error
  }
})

// Create new project with spec-kit initialization
ipcMain.handle('spec-create-new-project', async (_, parentPath, projectName, description) => {
  try {
    console.log('🆕 Creating new spec-kit project:', { parentPath, projectName, description })
    const result = await specService.createNewProject(parentPath, projectName, description)
    console.log('✅ New spec-kit project created successfully:', result)
    return result
  } catch (error) {
    console.error('❌ Error creating new project:', error)
    throw error
  }
})

// Show folder selection dialog
ipcMain.handle('show-open-dialog', async (_, options) => {
  try {
    console.log('🔍 show-open-dialog called with options:', options)
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    console.log('🔍 Dialog result:', result)
    return result
  } catch (error) {
    console.error('❌ Error showing open dialog:', error)
    throw error
  }
})

// Show input dialog for text input
ipcMain.handle('show-input-dialog', async (_, options) => {
  try {
    console.log('💬 show-input-dialog called with options:', options)
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, {
          type: 'question',
          title: options.title || 'Input',
          message: options.message || 'Enter value:',
          detail: options.placeholder,
          buttons: ['OK', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
          noLink: true
        })
      : await dialog.showMessageBox({
          type: 'question',
          title: options.title || 'Input',
          message: options.message || 'Enter value:',
          detail: options.placeholder,
          buttons: ['OK', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
        })

    // For now, return the default value if OK is clicked, null if canceled
    // This is a simple implementation - in production you'd want a proper input dialog
    if (result.response === 0) {
      return options.defaultValue || 'New Project'
    }
    return null
  } catch (error) {
    console.error('❌ Error showing input dialog:', error)
    throw error
  }
})


ipcMain.handle('spec-get-projects', async () => {
  try {
    console.log('📂 Loading projects from backend...')
    const projects = await specService.getProjects()
    console.log('📂 Loaded projects:', projects)
    return projects
  } catch (error) {
    console.error('❌ Error getting projects:', error)
    return []
  }
})

ipcMain.handle('spec-save-specification', async (_, projectId, spec) => {
  try {
    await specService.saveSpecification(projectId, spec)
    return { success: true }
  } catch (error) {
    console.error('Error saving specification:', error)
    throw error
  }
})

ipcMain.handle('spec-load-specifications', async (_, projectId) => {
  try {
    return await specService.loadSpecifications(projectId)
  } catch (error) {
    console.error('Error loading specifications:', error)
    return []
  }
})

ipcMain.handle('spec-delete-specification', async (_, projectId, specId) => {
  try {
    await specService.deleteSpecification(projectId, specId)
    return { success: true }
  } catch (error) {
    console.error('Error deleting specification:', error)
    throw error
  }
})

// Execute AI specification command with streaming support
ipcMain.handle('spec-execute-command', async (_, command, content, projectPath) => {
  try {
    return await specService.executeClaudeCodeCommand(command, content, projectPath, mainWindow || undefined)
  } catch (error) {
    console.error('Error executing AI specification command:', error)
    throw error
  }
})

// Execute command with streaming (for real-time updates)
ipcMain.handle('spec-execute-command-stream', async (_, command, content, projectPath) => {
  try {
    return new Promise((resolve, reject) => {
      specService.executeClaudeCodeCommand(
        command,
        content,
        projectPath,
        mainWindow || undefined,
        // Stream callback - send updates to renderer
        (chunk: string) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('spec-command-stream', chunk)
          }
        }
      ).then(resolve).catch(reject)
    })
  } catch (error) {
    console.error('Error executing streaming command:', error)
    throw error
  }
})

// Get AI tools status
ipcMain.handle('spec-get-ai-status', async () => {
  try {
    return await specService.getAIToolsStatus()
  } catch (error) {
    console.error('Error getting AI tools status:', error)
    return { available: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// Open path in OS file manager
ipcMain.handle('open-path', async (_, targetPath) => {
  try {
    await shell.openPath(targetPath)
    return { success: true }
  } catch (error) {
    console.error('Error opening path:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('spec-export-specification', async (_, specId, projectId, format) => {
  try {
    return await specService.exportSpecification(specId, projectId, format)
  } catch (error) {
    console.error('Error exporting specification:', error)
    throw error
  }
})

ipcMain.handle('spec-get-stats', async () => {
  try {
    return await specService.getStats()
  } catch (error) {
    console.error('Error getting spec stats:', error)
    return { projects: 0, specs: 0, totalSize: 0 }
  }
})

ipcMain.handle('spec-get-directory', async () => {
  try {
    return await specService.getSpecDirectory()
  } catch (error) {
    console.error('Error getting spec directory:', error)
    throw error
  }
})
