import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { 
  Settings as SettingsIcon, 
  Bell, 
  Palette,
  Save,
  RotateCcw,
  Share2,
  UploadCloud,
  Download,
  Calendar,
  Trash2,
  Loader2,
  Database,
  ChevronRight
} from 'lucide-react'
import { Switch } from './ui/switch'
import { DateRangePicker } from './ui/date-range-picker'
import { useThemeStore } from '@/stores/themeStore'
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from './ui/dialog'

interface AppSettings {
  autoStart: boolean
  minimizeToTray: boolean
  minimizeBehavior: 'tray' | 'floating' // New setting for minimize behavior
  notifications: boolean
  refreshInterval: number
  theme: 'light' | 'dark' | 'system'
  dataPath: string
  claudePlan: 'pro' | 'max-5x' | 'max-20x' | 'auto' // New Claude plan setting
  autoRenewal: {
    enabled: boolean
    startTime?: string // ISO string for scheduled start
    checkInterval: number // minutes between checks
    enableLogging: boolean
    notifyOnRenewal: boolean
    waitTimeBeforeSession: number // seconds to wait before starting session
  }
}

export function Settings() {
  const [settings, setSettings] = useState<AppSettings>({
    autoStart: false,
    minimizeToTray: true,
    minimizeBehavior: 'floating',
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

  const [isDirty, setIsDirty] = useState(false)
  const [exportDateRange, setExportDateRange] = useState<{from: Date | null, to: Date | null}>({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    to: new Date()
  })
  const [clearDaysToKeep, setClearDaysToKeep] = useState(7)
  const [importProgress, setImportProgress] = useState<{current: number, total: number, phase: string} | null>(null)
  const [clearProgress, setClearProgress] = useState<{current: number, total: number, phase: string, daysToKeep?: number} | null>(null)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const themePreference = useThemeStore(s => s.preference)
  const setThemePreference = useThemeStore(s => s.setPreference)

  useEffect(() => {
    // Load settings from electron store
    loadSettings()
  }, [])

  useEffect(() => {
    // Listen for import progress events
    const handleImportProgress = (_event: any, progress: {current: number, total: number, phase: string}) => {
      setImportProgress(progress)
      if (progress.phase === 'completed' || progress.phase === 'error') {
        setTimeout(() => setImportProgress(null), 3000) // Clear after 3 seconds
      }
    }

    const handleClearProgress = (_event: any, progress: {current: number, total: number, phase: string, daysToKeep?: number}) => {
      setClearProgress(progress)
      if (progress.phase === 'completed' || progress.phase === 'error') {
        setTimeout(() => setClearProgress(null), 3000) // Clear after 3 seconds
      }
    }

    // Add event listeners if electronAPI is available
    if (window.electronAPI?.ipcRenderer) {
      window.electronAPI.ipcRenderer.on('import-progress', handleImportProgress)
      window.electronAPI.ipcRenderer.on('clear-progress', handleClearProgress)
    }

    return () => {
      // Cleanup listeners
      if (window.electronAPI?.ipcRenderer) {
        window.electronAPI.ipcRenderer.removeListener('import-progress', handleImportProgress)
        window.electronAPI.ipcRenderer.removeListener('clear-progress', handleClearProgress)
      }
    }
  }, [])

  const loadSettings = async () => {
    try {
      // This would load from electron store
      const savedSettings = await window.electronAPI.getSettings?.() || {}
      const merged = { ...settings, ...savedSettings }
      setSettings(merged)
      // sync theme store if persisted setting exists
      if (merged.theme && merged.theme !== themePreference) {
        setThemePreference(merged.theme)
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }

  const saveSettings = async () => {
    try {
      await window.electronAPI.saveSettings?.(settings)
      setIsDirty(false)
      
      // Show success notification
      if (window.electronAPI.showNotification) {
        window.electronAPI.showNotification('Settings saved successfully')
      }
    } catch (error) {
      console.error('Failed to save settings:', error)
    }
  }

  const resetSettings = () => {
    setSettings({
      autoStart: false,
      minimizeToTray: true,
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
    setIsDirty(true)
  }

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
    if (key === 'theme') {
      setThemePreference(value as 'light' | 'dark' | 'system')
    }
  }


  const selectDataPath = async () => {
    try {
      const result = await window.electronAPI.selectDirectory?.()
      if (result) {
        updateSetting('dataPath', result)
      }
    } catch (error) {
      console.error('Failed to select directory:', error)
    }
  }

  const clearUsageData = async () => {
    try {
      const res = await window.electronAPI.clearClaudeUsageData?.(clearDaysToKeep)
      if (res?.success) {
        window.electronAPI.showNotification?.(res.message) 
      } else {
        window.electronAPI.showNotification?.(res?.error || 'Clear failed')
      }
    } catch (e) {
      console.error(e)
      window.electronAPI.showNotification?.('Clear failed')
    }
  }

  // Data management modal component
  const DataManagementModal = () => (
    <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center space-x-2">
          <Database className="h-5 w-5" />
          <span>Data Management</span>
        </DialogTitle>
        <DialogDescription>
          Export, import, and manage your Claude usage data
        </DialogDescription>
      </DialogHeader>
      
      <div className="space-y-6">
        {/* Data Path Configuration */}
        <div className="space-y-4">
          <h4 className="font-medium">Claude Data Directory</h4>
          <p className="text-xs text-muted-foreground">
            Override the default Claude data location
          </p>
          <div className="flex space-x-2">
            <input
              type="text"
              value={settings.dataPath}
              onChange={(e) => updateSetting('dataPath', e.target.value)}
              placeholder="Default: ~/.claude or ~/.config/claude"
              className="flex-1 px-3 py-2 border rounded-md text-sm bg-secondary text-foreground placeholder:text-muted-foreground border-border focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <Button onClick={selectDataPath} variant="outline" size="sm">
              Browse
            </Button>
          </div>
        </div>

        {/* Export Section */}
        <div className="space-y-4 pt-4 border-t">
          <div className="flex items-center space-x-2">
            <Share2 className="h-4 w-4" />
            <h4 className="font-medium">Export Usage Logs</h4>
          </div>
          <p className="text-xs text-muted-foreground">
            Creates a ZIP of raw Claude JSONL usage logs for backup or sharing across devices.
          </p>
          
          <div className="space-y-4 p-4 rounded-lg bg-secondary/10">
            <div className="flex items-center space-x-2 mb-4">
              <Calendar className="h-4 w-4" />
              <label className="text-sm font-medium">Export Date Range</label>
            </div>
            
            <DateRangePicker 
              value={exportDateRange}
              onChange={setExportDateRange}
              placeholder="Select date range for export"
            />
            
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  if (!exportDateRange.from || !exportDateRange.to) {
                    window.electronAPI.showNotification?.('Please select a complete date range')
                    return
                  }

                  const fromStart = new Date(exportDateRange.from).getTime()
                  const toEnd = new Date(exportDateRange.to).getTime()
                  const today = new Date()
                  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).getTime()

                  if (fromStart > toEnd) {
                    window.electronAPI.showNotification?.('Start date cannot be after end date')
                    return
                  }
                  if (fromStart > todayEnd) {
                    window.electronAPI.showNotification?.('Start date cannot be in the future')
                    return
                  }
                  if (toEnd > todayEnd) {
                    window.electronAPI.showNotification?.('End date cannot be in the future')
                    return
                  }

                  const fromStr = exportDateRange.from.toISOString().split('T')[0]
                  const toStr = exportDateRange.to.toISOString().split('T')[0]

                  const res = await window.electronAPI.exportClaudeUsageLogs?.(fromStr, toStr)
                  if (res?.success) {
                    const days = Math.floor((toEnd - fromStart) / (1000 * 60 * 60 * 24)) + 1
                    window.electronAPI.showNotification?.(`Exported ${res.fileCount} files (${days} day${days !== 1 ? 's' : ''})`) 
                  } else {
                    window.electronAPI.showNotification?.(res?.error || 'Export failed')
                  }
                } catch (e) {
                  console.error(e)
                  window.electronAPI.showNotification?.('Export failed')
                }
              }}
              className="w-full"
            >
              <Download className="h-4 w-4 mr-2" />
              Export Logs (ZIP)
            </Button>
          </div>
        </div>

        {/* Import Section */}
        <div className="space-y-4 pt-4 border-t">
          <div className="flex items-center space-x-2">
            <UploadCloud className="h-4 w-4" />
            <h4 className="font-medium">Import Usage Logs</h4>
          </div>
          
          <div className="space-y-4 p-4 rounded-lg bg-secondary/10">
            <div className="space-y-3">
              <label className="text-sm font-medium">Import Mode</label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    id="merge-mode"
                    name="importMode"
                    value="merge"
                    checked={importMode === 'merge'}
                    onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}
                    className="h-4 w-4 text-primary focus:ring-primary border-gray-300"
                  />
                  <label htmlFor="merge-mode" className="text-sm">
                    <span className="font-medium">Merge with existing data</span>
                    <p className="text-xs text-muted-foreground">Add new sessions to existing data (recommended)</p>
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    id="replace-mode"
                    name="importMode"
                    value="replace"
                    checked={importMode === 'replace'}
                    onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}
                    className="h-4 w-4 text-primary focus:ring-primary border-gray-300"
                  />
                  <label htmlFor="replace-mode" className="text-sm">
                    <span className="font-medium">Replace all data</span>
                    <p className="text-xs text-muted-foreground">Clear existing data and replace with imported data</p>
                  </label>
                </div>
              </div>
            </div>

            {importMode === 'merge' && (
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">Skip duplicate sessions</label>
                  <p className="text-xs text-muted-foreground">
                    Avoid importing sessions that already exist
                  </p>
                </div>
                <Switch
                  checked={skipDuplicates}
                  onCheckedChange={setSkipDuplicates}
                />
              </div>
            )}

            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const options = {
                    mergeMode: importMode === 'merge',
                    skipDuplicates: skipDuplicates
                  }
                  const res = await window.electronAPI.importClaudeUsageLogs?.(options)
                  if (res?.success) {
                    window.electronAPI.showNotification?.(`Imported ${res.importedFiles} files`) 
                  } else {
                    window.electronAPI.showNotification?.(res?.error || 'Import failed')
                  }
                } catch (e) {
                  console.error(e)
                  window.electronAPI.showNotification?.('Import failed')
                }
              }}
              disabled={!!importProgress}
              className="w-full"
            >
              {importProgress ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <UploadCloud className="h-4 w-4 mr-2" />
              )}
              Import ZIP ({importMode === 'merge' ? 'Merge' : 'Replace'})
            </Button>

            {/* Import Progress */}
            {importProgress && (
              <div className="mt-4 p-3 bg-secondary/20 border rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    {importProgress.phase === 'importing' && 'Importing files...'}
                    {importProgress.phase === 'rebuilding' && 'Rebuilding cache...'}
                    {importProgress.phase === 'completed' && '✅ Import completed!'}
                    {importProgress.phase === 'error' && '❌ Import failed'}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {importProgress.current}/{importProgress.total}
                  </span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2">
                  <div 
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ 
                      width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%` 
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Clear Data Section */}
        <div className="space-y-4 pt-4 border-t">
          <div className="flex items-center space-x-2">
            <Trash2 className="h-4 w-4" />
            <h4 className="font-medium">Clear Usage Data</h4>
          </div>
          <p className="text-xs text-muted-foreground">
            Remove old usage data to free up space or reset tracking.
          </p>
          
          <div className="space-y-4 p-4 rounded-lg bg-secondary/10">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Days to keep</label>
                <p className="text-xs text-muted-foreground">
                  Set to 0 to clear all data, or specify days to preserve
                </p>
              </div>
              <select
                value={clearDaysToKeep}
                onChange={(e) => setClearDaysToKeep(parseInt(e.target.value))}
                className="px-3 py-1 border rounded-md text-sm bg-secondary text-foreground border-border focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value={0}>Clear all data</option>
                <option value={1}>Keep last 1 day</option>
                <option value={3}>Keep last 3 days</option>
                <option value={7}>Keep last 7 days</option>
                <option value={14}>Keep last 14 days</option>
                <option value={30}>Keep last 30 days</option>
              </select>
            </div>

            <Button
              size="sm"
              variant="destructive"
              onClick={clearUsageData}
              disabled={!!clearProgress}
              className="w-full"
            >
              {clearProgress ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              {clearDaysToKeep === 0 ? 'Clear All Usage Data' : `Clear Data Older Than ${clearDaysToKeep} Days`}
            </Button>

            {/* Clear Progress */}
            {clearProgress && (
              <div className="mt-4 p-3 bg-secondary/20 border rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    {clearProgress.phase === 'clearing' && `Clearing files (keeping last ${clearProgress.daysToKeep || 0} days)...`}
                    {clearProgress.phase === 'completed' && '✅ Clear completed!'}
                    {clearProgress.phase === 'error' && '❌ Clear failed'}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {clearProgress.current}/{clearProgress.total}
                  </span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2">
                  <div 
                    className="bg-destructive h-2 rounded-full transition-all duration-300"
                    style={{ 
                      width: `${clearProgress.total > 0 ? (clearProgress.current / clearProgress.total) * 100 : 0}%` 
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DialogContent>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <div className="flex space-x-2">
          <Button 
            onClick={resetSettings} 
            variant="outline" 
            size="sm"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          <Button 
            onClick={saveSettings} 
            disabled={!isDirty}
            size="sm"
          >
            <Save className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </div>
      </div>

      {/* General Settings */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <SettingsIcon className="h-5 w-5" />
            <span>General</span>
          </CardTitle>
          <CardDescription>
            Application behavior and startup options
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">Start with system</label>
              <p className="text-xs text-muted-foreground">
                Automatically start Claude Sentinel when your computer boots
              </p>
            </div>
            <Switch
              checked={settings.autoStart}
              onCheckedChange={(v) => updateSetting('autoStart', v)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">Minimize to system tray</label>
              <p className="text-xs text-muted-foreground">
                Hide window in system tray instead of taskbar when minimized
              </p>
            </div>
            <Switch
              checked={settings.minimizeToTray}
              onCheckedChange={(v) => updateSetting('minimizeToTray', v)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">Minimize behavior</label>
              <p className="text-xs text-muted-foreground">
                Choose what happens when you minimize the main window (dock icon only shows when app is visible)
              </p>
            </div>
            <select
              value={settings.minimizeBehavior}
              onChange={(e) => updateSetting('minimizeBehavior', e.target.value as 'tray' | 'floating')}
              className="px-3 py-1 border rounded-md text-sm bg-secondary text-foreground border-border focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="floating">Show floating window</option>
              <option value="tray">Hide to tray only</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">Refresh interval</label>
              <p className="text-xs text-muted-foreground">
                How often to check for usage data updates (minutes)
              </p>
            </div>
            <select
              value={settings.refreshInterval}
              onChange={(e) => updateSetting('refreshInterval', parseInt(e.target.value))}
              className="px-3 py-1 border rounded-md text-sm bg-secondary text-foreground border-border focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value={1}>1 minute</option>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={30}>30 minutes</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Bell className="h-5 w-5" />
            <span>Notifications</span>
          </CardTitle>
          <CardDescription>
            Configure when and how you receive notifications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">Enable notifications</label>
              <p className="text-xs text-muted-foreground">
                Show system notifications for auto-renewal events
              </p>
            </div>
            <Switch
              checked={settings.notifications}
              onCheckedChange={(v) => updateSetting('notifications', v)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Palette className="h-5 w-5" />
            <span>Appearance</span>
          </CardTitle>
          <CardDescription>
            Customize the look and feel of the application
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">Theme</label>
              <p className="text-xs text-muted-foreground">
                Choose your preferred color scheme
              </p>
            </div>
            <select
              value={settings.theme}
              onChange={(e) => updateSetting('theme', e.target.value as 'light' | 'dark' | 'system')}
              className="px-3 py-1 border rounded-md text-sm bg-secondary text-foreground border-border focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">Claude Plan</label>
              <p className="text-xs text-muted-foreground">
                Select your Claude subscription plan for accurate usage limits
              </p>
            </div>
            <select
              value={settings.claudePlan}
              onChange={(e) => updateSetting('claudePlan', e.target.value as 'pro' | 'max-5x' | 'max-20x' | 'auto')}
              className="px-3 py-1 border rounded-md text-sm bg-secondary text-foreground border-border focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="auto">Auto-detect</option>
              <option value="pro">Pro ($20/month)</option>
              <option value="max-5x">Max 5x ($100/month)</option>
              <option value="max-20x">Max 20x ($200/month)</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Advanced Settings - Popup Trigger */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Database className="h-5 w-5" />
            <span>Data Management</span>
          </CardTitle>
          <CardDescription>
            Export, import, and manage your Claude usage data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                <span>Advanced Data Options</span>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DataManagementModal />
          </Dialog>
        </CardContent>
      </Card>

      {/* About */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>About Claude Sentinel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Version 1.0.0
          </p>
          <p className="text-sm text-muted-foreground">
            A desktop application for monitoring Claude usage and managing auto-renewal.
          </p>
          <p className="text-sm text-muted-foreground">
            Built with Electron, React, and TypeScript with integrated ClaudeCodeAutoRenew features.
          </p>
          <div className="flex space-x-4 mt-4">
            <Button variant="outline" size="sm">
              View Logs
            </Button>
            <Button variant="outline" size="sm">
              Report Issue
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
