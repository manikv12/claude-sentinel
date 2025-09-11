import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { DatePicker } from './ui/date-picker'
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
  Info
} from 'lucide-react'
// Use lucide-react icons (already in project) instead of MUI
import { Calendar as LucideCalendar, Clock as LucideClock } from 'lucide-react'
import { Skeleton } from './ui/skeleton'

export function AutoRenewal() {
  const { 
    status, 
    isLoading, 
    settings,
    toggleAutoRenewal,
    updateSettings,
    setScheduledStartTime,
    refreshStatus 
  } = useRenewalStore()
  
  const [scheduledTime, setScheduledTime] = useState('')
  const [isInitialLoad, setIsInitialLoad] = useState(true)

  // Load data when AutoRenewal component mounts
  useEffect(() => {
    const loadInitialData = async () => {
      await refreshStatus()
      setIsInitialLoad(false)
    }
    loadInitialData()
  }, [])

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

  const handleToggleRenewal = async () => {
    try {
      let scheduledStartTime: string | undefined = undefined
      
      if (scheduledTime && scheduledTime.trim() !== '') {
        const date = new Date(scheduledTime)
        if (!isNaN(date.getTime())) {
          scheduledStartTime = date.toISOString()
        }
      }
      
      await toggleAutoRenewal(!status.enabled, scheduledStartTime)
    } catch (error) {
      console.error('Failed to toggle auto-renewal:', error)
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

  const performManualCheck = async () => {
    try {
      await window.electronAPI.performRenewalCheck?.()
    } catch (error) {
      console.error('Manual check failed:', error)
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

  return (
    <div className="space-y-6">
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
              disabled={!status.enabled || isLoading}
              size="lg"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Check Now
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
              
              {status.timeRemaining && (
                <div className="text-center p-3 border rounded-lg">
                  <div className="text-2xl font-bold mb-1 text-orange-600">
                    {formatTimeRemaining(status.timeRemaining)}
                  </div>
                  <div className="text-xs text-muted-foreground">Until Reset</div>
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
                  <span className="text-sm font-medium">Next Check</span>
                  <span className="text-xs text-muted-foreground">
                    {status.nextRenewal.toLocaleTimeString()}
                  </span>
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
                <label className="text-sm font-medium">Check Interval</label>
                <p className="text-xs text-muted-foreground">
                  How often to check for renewal (minutes)
                </p>
              </div>
              <select
                value={settings.checkInterval}
                onChange={(e) => updateSettings({
                  checkInterval: parseInt(e.target.value)
                })}
                className="px-3 py-1 border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value={1}>1 min</option>
                <option value={2}>2 min</option>
                <option value={5}>5 min</option>
                <option value={10}>10 min</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Session Delay</label>
                <p className="text-xs text-muted-foreground">
                  Wait time before starting new session
                </p>
              </div>
              <select
                value={settings.waitTimeBeforeSession}
                onChange={(e) => updateSettings({
                  waitTimeBeforeSession: parseInt(e.target.value)
                })}
                className="px-3 py-1 border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value={30}>30s</option>
                <option value={60}>1m</option>
                <option value={120}>2m</option>
                <option value={300}>5m</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Enable Logging</label>
                <p className="text-xs text-muted-foreground">
                  Detailed activity logs
                </p>
              </div>
              <Switch
                checked={settings.enableLogging}
                onCheckedChange={(v) => updateSettings({ enableLogging: v })}
              />
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

            <div className="border-t pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">Auto-Refresh</label>
                  <p className="text-xs text-muted-foreground">
                    Automatically update status
                  </p>
                </div>
                <Switch
                  checked={settings.autoRefresh}
                  onCheckedChange={(v) => updateSettings({ autoRefresh: v })}
                />
              </div>

              {settings.autoRefresh && (
                <div className="flex items-center justify-between mt-3">
                  <div>
                    <label className="text-sm font-medium">Refresh Interval</label>
                    <p className="text-xs text-muted-foreground">
                      How often to update (seconds)
                    </p>
                  </div>
                  <select
                    value={settings.autoRefreshInterval}
                    onChange={(e) => updateSettings({
                      autoRefreshInterval: parseInt(e.target.value)
                    })}
                    className="px-3 py-1 border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value={10}>10s</option>
                    <option value={30}>30s</option>
                    <option value={60}>1m</option>
                    <option value={120}>2m</option>
                    <option value={300}>5m</option>
                  </select>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Help Section */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Info className="h-5 w-5" />
            <span>How Auto-Renewal Works</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 border rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                  <span className="text-blue-600 font-semibold">1</span>
                </div>
                <h4 className="font-semibold">Monitor</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Claude Sentinel continuously monitors your usage block status and time remaining.
              </p>
            </div>

            <div className="p-4 border rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <div className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                  <span className="text-green-600 font-semibold">2</span>
                </div>
                <h4 className="font-semibold">Detect</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                When your current usage block is about to expire (usually within 2-5 minutes), auto-renewal triggers.
              </p>
            </div>

            <div className="p-4 border rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center">
                  <span className="text-purple-600 font-semibold">3</span>
                </div>
                <h4 className="font-semibold">Renew</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                A new Claude session is automatically started, maintaining your usage block without interruption.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}