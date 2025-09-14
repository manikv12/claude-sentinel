import { contextBridge, ipcRenderer } from 'electron'

// Define the API that will be exposed to the renderer process
const electronAPI = {
  // App info
  getVersion: () => ipcRenderer.invoke('app-version'),
  getPlatform: () => process.platform,
  
  // Usage data
  getUsageData: () => ipcRenderer.invoke('get-usage-data'),
  hardRefreshUsageData: () => ipcRenderer.invoke('hard-refresh-usage-data'),
  
  // Auto-renewal
  getRenewalStatus: () => ipcRenderer.invoke('get-renewal-status'),
  toggleAutoRenewal: (enabled: boolean, scheduledTime?: string) => ipcRenderer.invoke('toggle-auto-renewal', enabled, scheduledTime),
  setScheduledStartTime: (isoTime: string | null) => ipcRenderer.invoke('set-scheduled-start-time', isoTime),
  performRenewalCheck: () => ipcRenderer.invoke('perform-renewal-check'),
  
  // Session management
  getSessionStatus: () => ipcRenderer.invoke('get-session-status'),
  resetSessionTracking: () => ipcRenderer.invoke('reset-session-tracking'),
  forceStartNewSession: () => ipcRenderer.invoke('force-start-new-session'),
  
  // Block tracking
  getBlockEvents: (hours?: number) => ipcRenderer.invoke('get-block-events', hours),
  getBlockSnapshot: () => ipcRenderer.invoke('get-block-snapshot'),
  getDailyBlocks: (date?: string) => ipcRenderer.invoke('get-daily-blocks', date),
  
  // Session files management
  getSessionFiles: () => ipcRenderer.invoke('get-session-files'),
  deleteSessionFile: (filePath: string) => ipcRenderer.invoke('delete-session-file', filePath),
  
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

  // AI Specification Development
  specCreateProject: (projectData: any) => ipcRenderer.invoke('spec-create-project', projectData),
  specCreateUserProject: (selectedPath: string, projectName: string, description: string) => ipcRenderer.invoke('spec-create-user-project', selectedPath, projectName, description),
  specCreateNewProject: (parentPath: string, projectName: string, description: string) => ipcRenderer.invoke('spec-create-new-project', parentPath, projectName, description),
  specGetProjects: () => ipcRenderer.invoke('spec-get-projects'),
  specSaveSpecification: (projectId: string, spec: any) => ipcRenderer.invoke('spec-save-specification', projectId, spec),
  specLoadSpecifications: (projectId: string) => ipcRenderer.invoke('spec-load-specifications', projectId),
  specDeleteSpecification: (projectId: string, specId: string) => ipcRenderer.invoke('spec-delete-specification', projectId, specId),
  specExecuteCommand: (command: string, content: string, projectPath: string) => ipcRenderer.invoke('spec-execute-command', command, content, projectPath),
  specExecuteCommandStream: (command: string, content: string, projectPath: string) => ipcRenderer.invoke('spec-execute-command-stream', command, content, projectPath),
  specExportSpecification: (specId: string, projectId: string, format?: string) => ipcRenderer.invoke('spec-export-specification', specId, projectId, format),
  specGetStats: () => ipcRenderer.invoke('spec-get-stats'),
  specGetDirectory: () => ipcRenderer.invoke('spec-get-directory'),
  specGetAIStatus: () => ipcRenderer.invoke('spec-get-ai-status'),

  // Folder selection
  showOpenDialog: (options: any) => ipcRenderer.invoke('show-open-dialog', options),
  showInputDialog: (options: any) => ipcRenderer.invoke('show-input-dialog', options),
  openPath: (targetPath: string) => ipcRenderer.invoke('open-path', targetPath),

  // Stream events
  onSpecCommandStream: (callback: (chunk: string) => void) => {
    ipcRenderer.on('spec-command-stream', (_, chunk) => callback(chunk))
  },

  removeSpecCommandStreamListeners: () => {
    ipcRenderer.removeAllListeners('spec-command-stream')
  },

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
