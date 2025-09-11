import { contextBridge, ipcRenderer } from 'electron'

// Define the API that will be exposed to the renderer process
const electronAPI = {
  // App info
  getVersion: () => ipcRenderer.invoke('app-version'),
  getPlatform: () => process.platform,
  
  // Usage data
  getUsageData: () => ipcRenderer.invoke('get-usage-data'),
  
  // Auto-renewal
  getRenewalStatus: () => ipcRenderer.invoke('get-renewal-status'),
  toggleAutoRenewal: (enabled: boolean, scheduledTime?: string) => ipcRenderer.invoke('toggle-auto-renewal', enabled, scheduledTime),
  setScheduledStartTime: (isoTime: string | null) => ipcRenderer.invoke('set-scheduled-start-time', isoTime),
  performRenewalCheck: () => ipcRenderer.invoke('perform-renewal-check'),
  
  // Settings management
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  
  // Window management
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  hideFloatingWindow: () => ipcRenderer.invoke('hide-floating-window'),
  showMainWindow: () => ipcRenderer.invoke('show-main-window'),
  
  // Notifications
  showNotification: (message: string) => ipcRenderer.invoke('show-notification', message),
  
  // Renewal logs
  getRenewalLogs: (days?: number) => ipcRenderer.invoke('get-renewal-logs', days),
  exportRenewalLogs: (content: string) => ipcRenderer.invoke('export-renewal-logs', content),
  clearRenewalLogs: (beforeDate: string) => ipcRenderer.invoke('clear-renewal-logs', beforeDate),
  getLogsPath: () => ipcRenderer.invoke('get-logs-path'),
  exportClaudeUsageLogs: (fromDate?: string, toDate?: string) => ipcRenderer.invoke('export-claude-usage-logs', fromDate, toDate),
  importClaudeUsageLogs: (options?: { mergeMode?: boolean, skipDuplicates?: boolean }) => ipcRenderer.invoke('import-claude-usage-logs', options),
  clearClaudeUsageData: (daysToKeep?: number) => ipcRenderer.invoke('clear-claude-usage-data', daysToKeep),
  
  // Event listeners
  onToggleAutoRenewal: (callback: (enabled: boolean) => void) => {
    ipcRenderer.on('toggle-auto-renewal', (_, enabled) => callback(enabled))
  },
  
  onUsageUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('usage-update', (_, data) => callback(data))
  },

  onRenewalStatusUpdate: (callback: (status: any) => void) => {
    ipcRenderer.on('renewal-status-update', (_, status) => callback(status))
  },

  onRenewalCheckComplete: (callback: (result: any) => void) => {
    ipcRenderer.on('renewal-check-complete', (_, result) => callback(result))
  },

  // Remove listeners
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  },

  // Expose ipcRenderer for custom event handling
  ipcRenderer: {
    on: (channel: string, listener: (...args: any[]) => void) => ipcRenderer.on(channel, listener),
    removeListener: (channel: string, listener: (...args: any[]) => void) => ipcRenderer.removeListener(channel, listener)
  }
}

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type definitions for the renderer process
export type ElectronAPI = typeof electronAPI