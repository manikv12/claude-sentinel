import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { 
  Settings as SettingsIcon, 
  Folder, 
  Bell, 
  Palette,
  Save,
  RotateCcw,
  Share2,
  UploadCloud,
  Download,
  Calendar,
  Trash2,
  Loader2
} from 'lucide-react'
import { Switch } from './ui/switch'
import { useThemeStore } from '@/stores/themeStore'

interface AppSettings {
  autoStart: boolean
  minimizeToTray: boolean
  notifications: boolean
  refreshInterval: number
  theme: 'light' | 'dark' | 'system'
  dataPath: string
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
  })

  const [isDirty, setIsDirty] = useState(false)
  const [exportFromDate, setExportFromDate] = useState(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
  const [exportToDate, setExportToDate] = useState(new Date().toISOString().split('T')[0])
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
    const handleImportProgress = (event: any, progress: {current: number, total: number, phase: string}) => {
      setImportProgress(progress)
      if (progress.phase === 'completed' || progress.phase === 'error') {
        setTimeout(() => setImportProgress(null), 3000) // Clear after 3 seconds
      }
    }

    const handleClearProgress = (event: any, progress: {current: number, total: number, phase: string, daysToKeep?: number}) => {
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
        </CardContent>
      </Card>

      {/* Data */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Folder className="h-5 w-5" />
            <span>Data</span>
          </CardTitle>
          <CardDescription>
            Configure data sources and storage locations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Claude data directory</label>
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
              <Button
                onClick={selectDataPath}
                variant="outline"
                size="sm"
              >
                Browse
              </Button>
            </div>
          </div>

          {/* Export Claude Usage Logs for Support / Sharing */}
          <div className="space-y-4 pt-4 border-t">
            <label className="text-sm font-medium flex items-center space-x-2">
              <Share2 className="h-4 w-4" />
              <span>Export Claude Usage Logs</span>
            </label>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Creates a ZIP of raw Claude JSONL usage logs (projects/*/*.jsonl). You can AirDrop this archive to another Mac to replicate session analysis or for troubleshooting auto-renewal.
            </p>
            
            {/* Date Range Selection */}
            <div className="space-y-4 p-4 border rounded-lg bg-secondary/10">
              <div className="flex items-center space-x-2">
                <Calendar className="h-5 w-5 text-primary" />
                <label className="text-sm font-medium">Export Date Range</label>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">From Date</label>
                  <input
                    type="date"
                    value={exportFromDate}
                    onChange={(e) => setExportFromDate(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md text-sm bg-secondary text-foreground border-border focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">To Date</label>
                  <input
                    type="date"
                    value={exportToDate}
                    onChange={(e) => setExportToDate(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md text-sm bg-secondary text-foreground border-border focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            </div>

            <div className="flex space-x-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    if (!exportFromDate || !exportToDate) {
                      window.electronAPI.showNotification?.('Please select valid from and to dates')
                      return
                    }
                    
                    if (new Date(exportFromDate) > new Date(exportToDate)) {
                      window.electronAPI.showNotification?.('From date cannot be after to date')
                      return
                    }
                    
                    const res = await window.electronAPI.exportClaudeUsageLogs?.(exportFromDate, exportToDate)
                    if (res?.success) {
                      const days = Math.ceil((new Date(exportToDate).getTime() - new Date(exportFromDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
                      window.electronAPI.showNotification?.(`Exported ${res.fileCount} files (${days} days)`) 
                    } else {
                      window.electronAPI.showNotification?.(res?.error || 'Export failed')
                    }
                  } catch (e) {
                    console.error(e)
                    window.electronAPI.showNotification?.('Export failed')
                  }
                }}
                className="flex-1"
              >
                <Download className="h-4 w-4 mr-2" />
                Export Logs (ZIP)
              </Button>
            </div>

            {/* Import Options Section */}
            <div className="space-y-4 pt-4 border-t">
              <label className="text-sm font-medium flex items-center space-x-2">
                <UploadCloud className="h-4 w-4" />
                <span>Import Options</span>
              </label>
              
              <div className="space-y-4 p-4 border rounded-lg bg-secondary/10">
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
                        Avoid importing sessions that already exist (based on session ID)
                      </p>
                    </div>
                    <Switch
                      checked={skipDuplicates}
                      onCheckedChange={setSkipDuplicates}
                    />
                  </div>
                )}
              </div>

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
            </div>

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

            {/* Clear Usage Data Section */}
            <div className="space-y-4 pt-4 border-t">
              <label className="text-sm font-medium flex items-center space-x-2">
                <Trash2 className="h-4 w-4" />
                <span>Clear Claude Usage Data</span>
              </label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Remove old usage data to free up space or reset tracking. You can keep recent data by specifying how many days to preserve.
              </p>
              
              <div className="space-y-4 p-4 border rounded-lg bg-secondary/10">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium">Days to keep</label>
                    <p className="text-xs text-muted-foreground">
                      Set to 0 to clear all data, or specify days to preserve recent data
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
            {/* Sharing instructions removed per user request */}
          </div>
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
