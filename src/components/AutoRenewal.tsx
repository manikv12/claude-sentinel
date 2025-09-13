import { useState, useEffect } from 'react'
import React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { DatePicker } from './ui/date-picker'
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from './ui/dialog'
import { useRenewalStore } from '@/stores/renewalStore'
import { formatTimeRemaining, getTimeAgo } from '@/lib/utils'
import { 
  Power,
  PowerOff,
  Timer,
  Clock,
  Activity,
  CheckCircle,
  AlertCircle,
  PlayCircle,
  PauseCircle,
  RefreshCw,
  Settings as SettingsIcon,
  Calendar,
  Zap,
  Info,
  Trash2,
  RotateCcw,
  UserCheck,
  AlertTriangle,
  Eye,
  X
} from 'lucide-react'
// Use lucide-react icons (already in project) instead of MUI
import { Calendar as LucideCalendar, Clock as LucideClock } from 'lucide-react'
import { Skeleton } from './ui/skeleton'


export function AutoRenewal() {
  // Add error handling for the store hook
  let storeData
  try {
    storeData = useRenewalStore()
  } catch (error) {
    console.error('Error accessing renewal store:', error)
    return (
      <div className="p-4 text-center">
        <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          Error loading Auto-Renewal. Please refresh the page.
        </p>
      </div>
    )
  }

  const { 
    status, 
    isLoading, 
    settings,
    toggleAutoRenewal,
    updateSettings,
    setScheduledStartTime,
    refreshStatus 
  } = storeData
  
  const [scheduledTime, setScheduledTime] = useState('')
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [sessionStatus, setSessionStatus] = useState<any>(null)
  const [isSessionLoading, setIsSessionLoading] = useState(false)
  const [blocksData, setBlocksData] = useState<any>(null)
  const [isBlocksLoading, setIsBlocksLoading] = useState(false)

  // Load data when AutoRenewal component mounts
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        await refreshStatus()
        await loadSessionStatus()
      } catch (error) {
        console.error('Error loading initial data:', error)
      } finally {
        setIsInitialLoad(false)
      }
    }
    loadInitialData()
  }, [refreshStatus])

  // Load session status
  const loadSessionStatus = async () => {
    try {
      const status = await window.electronAPI.getSessionStatus()
      setSessionStatus(status)
    } catch (error) {
      console.error('Failed to load session status:', error)
      setSessionStatus(null) // Set to null to show loading state instead of crashing
    }
  }

  // Load blocks data
  const loadBlocksData = async () => {
    setIsBlocksLoading(true)
    try {
      const data = await window.electronAPI.getBlockHistory()
      setBlocksData(data)
    } catch (error) {
      console.error('Failed to load blocks data:', error)
      setBlocksData(null)
    } finally {
      setIsBlocksLoading(false)
    }
  }

  // Reset session tracking
  const handleResetSessionTracking = async () => {
    setIsSessionLoading(true)
    try {
      const result = await window.electronAPI.resetSessionTracking()
      if (result.success) {
        await loadSessionStatus()
        await refreshStatus()
        window.electronAPI.showNotification('Session tracking files reset successfully')
      } else {
        window.electronAPI.showNotification(`Failed to reset session tracking: ${result.error}`)
      }
    } catch (error) {
      console.error('Error resetting session tracking:', error)
      window.electronAPI.showNotification('Error resetting session tracking')
    } finally {
      setIsSessionLoading(false)
    }
  }

  // Force start new session
  const handleForceNewSession = async () => {
    setIsSessionLoading(true)
    try {
      const result = await window.electronAPI.forceStartNewSession()
      if (result.success) {
        await loadSessionStatus()
        await refreshStatus()
        window.electronAPI.showNotification('New Claude session started successfully')
      } else {
        window.electronAPI.showNotification(`Failed to start new session: ${result.error}`)
      }
    } catch (error) {
      console.error('Error starting new session:', error)
      window.electronAPI.showNotification('Error starting new session')
    } finally {
      setIsSessionLoading(false)
    }
  }

  useEffect(() => {
    // Sync scheduled time from store
    if (status.scheduledStartTime) {
      const d = new Date(status.scheduledStartTime)
      const pad = (n: number) => n.toString().padStart(2, '0')
      const localTime = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
      setScheduledTime(localTime)
    } else {
      setScheduledTime('')
    }
  }, [status.scheduledStartTime])

  // Auto-refresh functionality
  useEffect(() => {
    if (!settings.autoRefresh) return

    const interval = setInterval(() => {
      refreshStatus()
    }, settings.autoRefreshInterval * 1000)

    return () => clearInterval(interval)
  }, [settings.autoRefresh, settings.autoRefreshInterval, refreshStatus])

  const [showModeSelection, setShowModeSelection] = useState(false)
  const [selectedMode, setSelectedMode] = useState<'immediate' | 'scheduled'>('immediate')

  const handleToggleRenewal = async () => {
    try {
      if (!status.enabled) {
        // If turning ON, show mode selection first
        setShowModeSelection(true)
        return
      }

      // If turning OFF, just disable
      await toggleAutoRenewal(false)
    } catch (error) {
      console.error('Failed to toggle auto-renewal:', error)
    }
  }

  const handleConfirmModeSelection = async () => {
    try {
      let scheduledStartTime: string | undefined = undefined

      if (selectedMode === 'scheduled') {
        if (scheduledTime && scheduledTime.trim() !== '') {
          const date = new Date(scheduledTime)
          if (!isNaN(date.getTime())) {
            scheduledStartTime = date.toISOString()
          }
        } else {
          // Set default time to 1 hour from now if no time is set
          const defaultTime = new Date()
          defaultTime.setHours(defaultTime.getHours() + 1, 0, 0, 0)
          const timeString = defaultTime.toISOString().slice(0, 16)
          setScheduledTime(timeString)
          scheduledStartTime = defaultTime.toISOString()
        }
      }

      await toggleAutoRenewal(true, scheduledStartTime)
      setShowModeSelection(false)
    } catch (error) {
      console.error('Failed to enable auto-renewal:', error)
    }
  }

  const handleScheduleChange = async (value: string) => {
    try {
      setScheduledTime(value)
      let isoTime: string | null = null
      
      if (value && value.trim() !== '') {
        const date = new Date(value)
        if (!isNaN(date.getTime())) {
          isoTime = date.toISOString()
        }
      }
      
      await setScheduledStartTime(isoTime)
    } catch (error) {
      console.error('Failed to update scheduled time:', error)
    }
  }

  const clearSchedule = async () => {
    try {
      setScheduledTime('')
      await setScheduledStartTime(null)
    } catch (error) {
      console.error('Failed to clear schedule:', error)
    }
  }

  const [isCheckingManually, setIsCheckingManually] = useState(false)
  
  const performManualCheck = async () => {
    if (isCheckingManually) return
    
    setIsCheckingManually(true)
    try {
      const result = await window.electronAPI.performRenewalCheck?.()
      
      // Show user feedback via notification
      if (result?.success) {
        await window.electronAPI.showNotification?.('Renewal check completed successfully')
        console.log('Manual renewal check completed successfully')
      } else {
        await window.electronAPI.showNotification?.('Renewal check completed with warnings')
        console.warn('Manual renewal check completed with warnings')
      }
      
      // The status will be updated via the 'renewal-status-update' event
    } catch (error) {
      console.error('Manual check failed:', error)
      await window.electronAPI.showNotification?.('Renewal check failed - see console for details')
    } finally {
      // Add a small delay to show the loading state
      setTimeout(() => {
        setIsCheckingManually(false)
      }, 1000)
    }
  }

  const getStatusColor = () => {
    if (status.enabled) return 'text-green-600 dark:text-green-400'
    return 'text-gray-500 dark:text-gray-400'
  }

  const getStatusIcon = () => {
    if (status.enabled) {
      return <Power className="h-6 w-6 text-green-500" />
    }
    return <PowerOff className="h-6 w-6 text-gray-500" />
  }

  // Show loading skeleton during initial load
  if (isInitialLoad && isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-96 mt-2" />
          </div>
          <Skeleton className="h-9 w-9" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <div className="grid gap-6 md:grid-cols-2">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </div>
    )
  }

  // Add safety check for status
  if (!status) {
    return (
      <div className="space-y-6">
        <div className="p-8 text-center">
          <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Auto-Renewal Status Unavailable</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Unable to load auto-renewal status. Please try refreshing the page.
          </p>
          <Button onClick={() => window.location.reload()} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Page
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Mode Selection Dialog */}
      <Dialog open={showModeSelection} onOpenChange={setShowModeSelection}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Power className="h-5 w-5 text-green-500" />
              <span>Enable Auto-Renewal</span>
            </DialogTitle>
            <DialogDescription>
              Choose when you want auto-renewal to start monitoring and renewing your Claude sessions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Immediate Option */}
            <div
              className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                selectedMode === 'immediate'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-secondary/50'
              }`}
              onClick={() => setSelectedMode('immediate')}
            >
              <div className="flex items-center space-x-3">
                <input
                  type="radio"
                  name="renewalMode"
                  checked={selectedMode === 'immediate'}
                  onChange={() => setSelectedMode('immediate')}
                  className="w-4 h-4 text-primary"
                />
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    <Zap className="h-4 w-4 text-green-500" />
                    <span className="font-medium">Start Immediately</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Begin monitoring and auto-renewal right away
                  </p>
                </div>
              </div>
            </div>

            {/* Scheduled Option */}
            <div
              className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                selectedMode === 'scheduled'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-secondary/50'
              }`}
              onClick={() => setSelectedMode('scheduled')}
            >
              <div className="flex items-center space-x-3">
                <input
                  type="radio"
                  name="renewalMode"
                  checked={selectedMode === 'scheduled'}
                  onChange={() => setSelectedMode('scheduled')}
                  className="w-4 h-4 text-primary"
                />
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    <Timer className="h-4 w-4 text-blue-500" />
                    <span className="font-medium">Schedule for Later</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Choose a specific date and time to begin auto-renewal
                  </p>
                </div>
              </div>
            </div>

            {/* Date/Time Picker for Scheduled Mode */}
            {selectedMode === 'scheduled' && (
              <div className="space-y-3 border-l-2 border-primary/20 pl-4 ml-4">
                <label className="text-sm font-medium">Select start date and time:</label>
                <div className="relative overflow-visible">
                  <DatePicker
                    value={scheduledTime}
                    onChange={setScheduledTime}
                    minDate={new Date()}
                    className="w-full"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex space-x-3 pt-4">
            <Button
              variant="outline"
              onClick={() => setShowModeSelection(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmModeSelection}
              disabled={isLoading}
              className="flex-1"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Enabling...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Enable Auto-Renewal
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Auto-Renewal</h2>
          <p className="text-muted-foreground">
            Manage automatic Claude session renewal to maintain usage blocks
          </p>
        </div>
        <Button 
          onClick={refreshStatus} 
          disabled={isLoading}
          variant="outline"
          size="icon"
          title="Refresh Status"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Main Control Panel */}
      <Card className="border-2">
        <CardHeader>
          <CardTitle className="flex items-center space-x-3">
            {getStatusIcon()}
            <div>
              <div className="flex items-center space-x-2">
                <span>Auto-Renewal Control</span>
                {status.enabled && (
                  <div className="flex items-center space-x-1">
                    <div className="animate-pulse h-2 w-2 bg-green-500 rounded-full"></div>
                    <span className="text-sm text-green-600 dark:text-green-400">Live</span>
                  </div>
                )}
              </div>
              <div className="text-sm font-normal text-muted-foreground mt-1">
                Current status: <span className={getStatusColor()}>{status.enabled ? 'Active' : 'Inactive'}</span>
              </div>
            </div>
          </CardTitle>
          <CardDescription>
            Toggle auto-renewal on/off and configure when it should start
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Main Toggle */}
          <div className="flex items-center justify-between p-4 bg-secondary/20 rounded-lg border">
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-full ${status.enabled ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-gray-800'}`}>
                {status.enabled ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-gray-500" />
                )}
              </div>
              <div>
                <h3 className="font-semibold">Enable Auto-Renewal</h3>
                <p className="text-sm text-muted-foreground">
                  Automatically start new Claude sessions to maintain usage blocks
                </p>
              </div>
            </div>
            <div className="relative">
              <Switch
                checked={status.enabled}
                onCheckedChange={handleToggleRenewal}
                disabled={isLoading}
              />
              {isLoading && (
                <div className="absolute -right-8 top-1/2 -translate-y-1/2">
                  <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </div>

          {/* Scheduling Options - Show when enabled */}
          {status.enabled && (
            <div className="space-y-4 p-4 border rounded-lg bg-secondary/10">
              <div className="flex items-center space-x-2 mb-3">
                <Calendar className="h-5 w-5 text-primary" />
                <h4 className="font-semibold">When to Start</h4>
              </div>

              <div className="grid gap-4">
                {/* Start Now Option */}
                <div className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-secondary/20 transition-colors">
                  <input
                    type="radio"
                    id="start-now"
                    name="startOption"
                    checked={!status.scheduledStartTime}
                    onChange={clearSchedule}
                    className="w-4 h-4 text-primary"
                  />
                  <div className="flex-1">
                    <label htmlFor="start-now" className="font-medium cursor-pointer flex items-center space-x-2">
                      <Zap className="h-4 w-4 text-green-500" />
                      <span>Start Immediately</span>
                    </label>
                    <p className="text-sm text-muted-foreground">
                      Begin monitoring and auto-renewal right away
                    </p>
                  </div>
                </div>

                {/* Schedule Later Option */}
                <div className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-secondary/20 transition-colors">
                  <input
                    type="radio"
                    id="start-scheduled"
                    name="startOption"
                    checked={!!status.scheduledStartTime}
                    onChange={async () => {
                      if (!status.scheduledStartTime) {
                        const defaultTime = new Date()
                        defaultTime.setHours(defaultTime.getHours() + 1, 0, 0, 0)
                        const timeString = defaultTime.toISOString().slice(0, 16)
                        setScheduledTime(timeString)
                        await setScheduledStartTime(defaultTime.toISOString())
                      }
                    }}
                    className="w-4 h-4 text-primary"
                  />
                  <div className="flex-1">
                    <label htmlFor="start-scheduled" className="font-medium cursor-pointer flex items-center space-x-2">
                      <Timer className="h-4 w-4 text-blue-500" />
                      <span>Schedule for Later</span>
                    </label>
                    <p className="text-sm text-muted-foreground">
                      Choose a specific date and time to begin auto-renewal
                    </p>
                  </div>
                </div>

                {/* DateTime Picker - Only show when "Schedule for Later" is selected */}
                {!!status.scheduledStartTime && (
                  <div className="ml-7 space-y-3">
                    <label className="text-sm font-medium">Select start date and time:</label>
                    <div className="flex space-x-2">
                      <DatePicker
                        value={scheduledTime}
                        onChange={handleScheduleChange}
                        minDate={new Date()}
                        className="flex-1"
                      />
                      {scheduledTime && (
                        <Button
                          onClick={clearSchedule}
                          variant="outline"
                          size="sm"
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                    
                    {status.scheduledStartTime && (
                      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
                        <div className="flex items-center space-x-2 mb-1">
                          <Clock className="h-4 w-4 text-blue-600" />
                          <span className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                            Scheduled Start
                          </span>
                        </div>
                        <p className="text-sm text-blue-800 dark:text-blue-200 flex items-center space-x-2">
                          <LucideCalendar className="h-4 w-4" />
                          <span>{new Date(status.scheduledStartTime).toLocaleDateString()}</span>
                        </p>
                        <p className="text-sm text-blue-800 dark:text-blue-200 flex items-center space-x-2">
                          <LucideClock className="h-4 w-4" />
                          <span>{new Date(status.scheduledStartTime).toLocaleTimeString()}</span>
                        </p>
                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
                          Auto-renewal will activate at this time. Until then, Claude Sentinel will monitor usage blocks passively.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex space-x-3 pt-4">
            <Button 
              onClick={handleToggleRenewal}
              disabled={isLoading}
              variant="default"
              className={`flex-1 ${status.enabled ? 'glass-button-enabled' : 'glass-button-disabled'}`}
              size="lg"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
                  {status.enabled ? 'Disabling...' : 'Enabling...'}
                </>
              ) : status.enabled ? (
                <>
                  <PauseCircle className="h-5 w-5 mr-2" />
                  Disable Auto-Renewal
                </>
              ) : (
                <>
                  <PlayCircle className="h-5 w-5 mr-2" />
                  Enable Auto-Renewal
                </>
              )}
            </Button>
            
            <Button 
              onClick={performManualCheck}
              variant="outline"
              disabled={isLoading || isCheckingManually}
              size="lg"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isCheckingManually ? 'animate-spin' : ''}`} />
              {isCheckingManually ? 'Checking...' : 'Check Now'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Status Information */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Current Status */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Activity className="h-5 w-5" />
              <span>Current Status</span>
            </CardTitle>
            <CardDescription>
              Live information about auto-renewal activity
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 border rounded-lg">
                <div className="text-2xl font-bold mb-1 text-primary">
                  {status.enabled ? 'ON' : 'OFF'}
                </div>
                <div className="text-xs text-muted-foreground">Service Status</div>
              </div>
              
              {status.timeRemaining && status.timeRemaining > 0 && (
                <div className="text-center p-3 border rounded-lg">
                  <div className="text-2xl font-bold mb-1 text-green-600">
                    {formatTimeRemaining(status.timeRemaining)}
                  </div>
                  <div className="text-xs text-muted-foreground">Session Active</div>
                </div>
              )}
            </div>

            {status.lastActivity && (
              <div className="p-3 bg-secondary/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Last Activity</span>
                  <span className="text-xs text-muted-foreground">
                    {getTimeAgo(status.lastActivity)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {status.lastActivity.toLocaleString()}
                </div>
              </div>
            )}

            {status.nextRenewal && (
              <div className="p-3 bg-secondary/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {status.scheduledStartTime ? 'Scheduled Renewal' : 'Next Renewal'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {status.nextRenewal.toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {status.nextRenewal.toLocaleDateString()}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Configuration Settings */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <SettingsIcon className="h-5 w-5" />
              <span>Quick Settings</span>
            </CardTitle>
            <CardDescription>
              Adjust auto-renewal behavior
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Smart Checking</label>
                <p className="text-xs text-muted-foreground">
                  Only check when session is close to expiring
                </p>
              </div>
              <select
                value={settings.checkInterval}
                onChange={(e) => updateSettings({
                  checkInterval: parseInt(e.target.value)
                })}
                className="px-3 py-1 border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value={5}>Smart Mode</option>
                <option value={1}>Every 1 min</option>
                <option value={2}>Every 2 min</option>
                <option value={10}>Every 10 min</option>
              </select>
            </div>


            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Notifications</label>
                <p className="text-xs text-muted-foreground">
                  System notifications on renewal
                </p>
              </div>
              <Switch
                checked={settings.notifyOnRenewal}
                onCheckedChange={(v) => updateSettings({ notifyOnRenewal: v })}
              />
            </div>
          </CardContent>
        </Card>
      </div>


    </div>
  )
}