import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { useUsageStore } from '@/stores/usageStore'
import { useRenewalStore } from '@/stores/renewalStore'
import { formatCurrency, formatTokens, formatTimeRemaining, getTimeAgo } from '@/lib/utils'
import { 
  RefreshCw, 
  DollarSign, 
  Zap, 
  Clock, 
  Activity,
  Power,
  PowerOff,
  Timer,
  AlertCircle,
  CheckCircle,
  PlayCircle,
  PauseCircle
} from 'lucide-react'
import { Skeleton } from './ui/skeleton'

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="h-8 w-40"><Skeleton className="h-8 w-40" /></div>
        <div className="flex items-center space-x-4">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-9 w-9" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="p-4 border rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </div>
            <Skeleton className="h-7 w-24 mb-2" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="p-4 border rounded-lg">
            <div className="flex items-center space-x-2 mb-4">
              <Skeleton className="h-5 w-5" />
              <Skeleton className="h-5 w-40" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border rounded-lg">
        <div className="mb-2">
          <Skeleton className="h-5 w-24" />
        </div>
        <Skeleton className="h-5 w-32 mb-4" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}

export function Dashboard() {
  const { summary, currentBlock, isLoading: usageLoading, refreshData } = useUsageStore()
  const { 
    status, 
    isLoading: renewalLoading, 
    toggleAutoRenewal,
    refreshStatus 
  } = useRenewalStore()

  const [autoRefresh, setAutoRefresh] = useState(false)
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(60) // Align with cache window
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isWindowFocused, setIsWindowFocused] = useState(true)

  // Track window focus to pause auto-refresh when not visible
  useEffect(() => {
    const handleFocus = () => setIsWindowFocused(true)
    const handleBlur = () => setIsWindowFocused(false)
    
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    
    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  // Load data when Dashboard component mounts
  useEffect(() => {
    const loadInitialData = async () => {
      await Promise.all([refreshData(), refreshStatus()])
      setIsInitialLoad(false)
    }
    loadInitialData()
  }, [])

  // Auto-refresh functionality - respects cache window and window focus
  useEffect(() => {
    if (!autoRefresh || isRefreshing || !isWindowFocused) return

    // Ensure minimum 60s interval to align with cache window
    const effectiveInterval = Math.max(autoRefreshInterval, 60)
    
    const interval = setInterval(() => {
      // Double-check focus state before refreshing
      if (document.hasFocus()) {
        handleRefresh()
      }
    }, effectiveInterval * 1000)

    return () => clearInterval(interval)
  }, [autoRefresh, autoRefreshInterval, isRefreshing, isWindowFocused])

  const handleRefresh = async () => {
    if (isRefreshing) return // Prevent concurrent refreshes
    
    setIsRefreshing(true)
    try {
      await Promise.all([refreshData(), refreshStatus()])
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleToggleRenewal = async () => {
    try {
      await toggleAutoRenewal(!status.enabled)
    } catch (error) {
      console.error('Failed to toggle auto-renewal:', error)
    }
  }


  // Billing block remaining percentage (to match ccusage behavior)
  const remainingPercent = currentBlock && currentBlock.limit
    ? Math.max(0, ((currentBlock.limit - currentBlock.usage) / currentBlock.limit) * 100)
    : 0
  const usagePercent = currentBlock && currentBlock.limit
    ? Math.min(100, (currentBlock.usage / currentBlock.limit) * 100)
    : 0
    
  // Color based on remaining percentage (high remaining = green, low = red)
  // (usageBarClass removed; styles are applied inline below based on remainingPercent)
  const usageTextClass = remainingPercent >= 40
    ? 'text-green-500'
    : remainingPercent >= 15
      ? 'text-yellow-500'
      : 'text-red-500'

  // Toggle between showing remaining %/values and used values when user clicks the number
  // Persist choice in localStorage so it survives page changes; default to 'used' view
  const STORAGE_KEY = 'sentinel.usageView'
  const [showRemainingValue, setShowRemainingValue] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY)
      // stored value is 'remaining' or 'used'
      if (v === 'remaining') return true
      if (v === 'used') return false
    } catch (e) {
      // ignore and fall through
    }
    // default to 'used' (false)
    return false
  })

  const toggleShowRemaining = () => {
    setShowRemainingValue((s) => {
      const next = !s
      try {
        localStorage.setItem(STORAGE_KEY, next ? 'remaining' : 'used')
      } catch (e) {
        // ignore storage errors
      }
      return next
    })
  }

  const handleKeyToggle = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleShowRemaining()
    }
  }

  return (
    <div className="space-y-6">
      {isInitialLoad && (usageLoading || renewalLoading) && <DashboardSkeleton />}
      {!(isInitialLoad && (usageLoading || renewalLoading)) && (
        <>
          {/* Header with auto-refresh controls */}
          <div className="flex items-center justify-between">
            <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <span className="text-sm text-muted-foreground">Auto-refresh</span>
                <Switch
                  checked={autoRefresh}
                  onCheckedChange={setAutoRefresh}
                />
                {autoRefresh && (
                  <select
                    value={autoRefreshInterval}
                    onChange={(e) => setAutoRefreshInterval(parseInt(e.target.value))}
                    className="px-2 py-1 border rounded text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value={60}>1m</option>
                    <option value={120}>2m</option>
                    <option value={300}>5m</option>
                  </select>
                )}
              </div>
              <Button
                onClick={handleRefresh}
                disabled={isRefreshing || usageLoading || renewalLoading}
                variant="outline"
                size="icon"
                title="Refresh"
                className="glass-button border-0"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(summary.totalCost)}
            </div>
            <p className="text-xs text-muted-foreground">Today</p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatTokens(summary.totalTokens)}
            </div>
            <p className="text-xs text-muted-foreground">Today</p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sessions</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalSessions}</div>
            <p className="text-xs text-muted-foreground">{formatTokens(Math.round(summary.averageTokensPerSession))} avg/session (today)</p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Time Remaining</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatTimeRemaining(status.timeRemaining)}
            </div>
            <p className="text-xs text-muted-foreground">
              Until next reset
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Auto-Renewal Management */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              {status.enabled ? (
                <Power className="h-5 w-5 text-primary/70" />
              ) : (
                <PowerOff className="h-5 w-5 text-muted-foreground" />
              )}
              <span>Auto-Renewal</span>
              <div className="flex items-center space-x-2 ml-auto">
                {status.enabled && (
                  <div className="animate-pulse h-2 w-2 bg-primary/70 rounded-full"></div>
                )}
              </div>
            </CardTitle>
            <CardDescription>Intelligent session management to maintain usage blocks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Compact status row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center space-x-2">
                <CheckCircle className={`h-4 w-4 ${status.enabled ? 'text-primary/70' : 'text-muted-foreground'}`} />
                <div>
                  <div className="text-xs text-muted-foreground">Status</div>
                  <div className={`text-sm font-medium ${status.enabled ? 'text-primary/80' : 'text-muted-foreground'}`}>
                    {status.enabled ? 'Active' : 'Inactive'}
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-xs text-muted-foreground">Last</div>
                  <div className="text-sm font-medium text-muted-foreground">
                    {status.lastActivity ? getTimeAgo(status.lastActivity) : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Show scheduled start time if auto-renewal is not active yet */}
            {!status.enabled && (
              <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg">
                <div className="flex items-center space-x-2">
                  <Timer className="h-4 w-4 text-primary/70" />
                  <span className="text-sm font-medium text-foreground">Disabled</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Enable auto-renewal in Settings to maintain usage blocks automatically</p>
              </div>
            )}
            
            {/* Control Buttons */}
            <div className="flex space-x-2 pt-2">
              <Button 
                onClick={handleToggleRenewal}
                disabled={renewalLoading}
                variant="default"
                className={`flex-1 border-0 ${status.enabled ? 'glass-button-enabled' : 'glass-button-disabled'}`}
              >
                {status.enabled ? (
                  <><PauseCircle className="h-4 w-4 mr-2" />Disable</>
                ) : (
                  <><PlayCircle className="h-4 w-4 mr-2" />Enable</>
                )}
              </Button>
              <Button
                onClick={() => window.electronAPI.performRenewalCheck?.()}
                variant="outline"
                size="icon"
                disabled={!status.enabled}
                title="Check now"
                className="glass-button border-0"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            
            {/* Performance Indicator */}
            {status.enabled && (
              <div className="flex items-center justify-center pt-2 text-xs text-muted-foreground">
                <div className="flex items-center space-x-1">
                  <div className="h-1 w-1 bg-primary/70 rounded-full animate-pulse"></div>
                  <span>Monitoring active</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Zap className="h-5 w-5" />
              <span>Usage Block</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentBlock && currentBlock.isActive ? (
              <>
                {/* Usage Progress */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Usage</span>
                    <span
                      className="text-sm text-muted-foreground cursor-pointer select-none"
                      role="button"
                      tabIndex={0}
                      onClick={toggleShowRemaining}
                      onKeyDown={handleKeyToggle}
                      title={showRemainingValue ? 'Click to show used' : 'Click to show remaining'}
                      aria-pressed={!showRemainingValue}
                      aria-label={showRemainingValue ? 'Showing remaining — activate to show used' : 'Showing used — activate to show remaining'}
                    >
                      {showRemainingValue
                        ? `${formatTokens(Math.max(0, currentBlock.limit - currentBlock.usage))} / ${formatTokens(currentBlock.limit)}`
                        : `${formatTokens(currentBlock.usage)} / ${formatTokens(currentBlock.limit)}`}
                    </span>
                  </div>
                  
                  <div
                    className="w-full glass-progress-track rounded-full h-3 relative overflow-hidden cursor-pointer"
                    role="progressbar"
                    aria-valuenow={usagePercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    tabIndex={0}
                    onClick={toggleShowRemaining}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleShowRemaining() } }}
                    title={showRemainingValue ? 'Click to show used values' : 'Click to show remaining values'}
                  >
                    <div
                      className={`${
                        remainingPercent >= 40
                          ? 'glass-progress-bar-green'
                          : remainingPercent >= 15
                            ? 'glass-progress-bar-yellow'
                            : 'glass-progress-bar-red'
                      } rounded-full h-3 transition-[width] duration-500 ease-in-out absolute top-0`}
                      style={{ width: `${showRemainingValue ? Math.max(0, remainingPercent) : Math.max(0, usagePercent)}%`, [showRemainingValue ? 'right' : 'left']: 0 } as React.CSSProperties}
                      aria-hidden={!showRemainingValue}
                    />
                    {/* Threshold marker (sleek glass dot) */}
                    <div className="absolute right-1/4 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-white/30 border border-white/50 backdrop-blur-sm"></div>
                  </div>
                  
                  <div className="text-xs text-muted-foreground">
                    <span
                      className={`${usageTextClass} cursor-pointer select-none`}
                      role="button"
                      tabIndex={0}
                      onClick={toggleShowRemaining}
                      onKeyDown={handleKeyToggle}
                      title={showRemainingValue ? 'Click to show used' : 'Click to show remaining'}
                    >
                      {showRemainingValue ? `${Math.round(remainingPercent)}% remaining` : `${Math.round(usagePercent)}% used`}
                    </span>
                  </div>
                </div>
                
                {/* Block Information Grid */}
                <div className="grid grid-cols-2 gap-4 pt-2">
                  {currentBlock.startTime && (
                    <div>
                      <div className="text-xs text-muted-foreground">Started</div>
                      <div className="text-sm font-medium">
                        {new Date(currentBlock.startTime).toLocaleTimeString()}
                      </div>
                    </div>
                  )}
                  
                  {currentBlock.timeRemaining && (
                    <div>
                      <div className="text-xs text-muted-foreground">Time Left</div>
                      <div className={`text-sm font-medium ${usageTextClass}`}>
                        {formatTimeRemaining(currentBlock.timeRemaining)}
                      </div>
                    </div>
                  )}

                  {/* Next Session (estimated) */}
                  {(currentBlock.endTime || currentBlock.timeRemaining) && (
                    <div>
                      <div className="text-xs text-muted-foreground">Next Session</div>
                      <div className="text-sm font-medium">
                        {currentBlock.endTime
                          ? new Date(currentBlock.endTime).toLocaleTimeString()
                          : new Date(Date.now() + (currentBlock.timeRemaining || 0) * 60 * 1000).toLocaleTimeString()}
                      </div>
                    </div>
                  )}
                  
                  {currentBlock.cost && (
                    <div>
                      <div className="text-xs text-muted-foreground">Cost</div>
                      <div className="text-sm font-medium text-primary/80">
                        {formatCurrency(currentBlock.cost)}
                      </div>
                    </div>
                  )}
                  
                  <div>
                    <div className="text-xs text-muted-foreground">Auto-Renewal</div>
                    <div className="text-sm font-medium">
                      {currentBlock.timeRemaining && currentBlock.timeRemaining <= 5 ? (
                        <span className="flex items-center space-x-1 text-primary/80">
                          <Timer className="h-3 w-3" />
                          <span>Preparing</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Monitoring</span>
                      )}
                    </div>
                  </div>
                </div>
                
                {/* Renewal Alert */}
                {status.enabled && currentBlock.timeRemaining && currentBlock.timeRemaining <= 10 && (
                  <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <AlertCircle className="h-4 w-4 text-primary/70" />
                      <span className="text-sm font-medium text-foreground">
                        Auto-renewal will trigger soon
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      A new session will automatically start when this usage block expires
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8">
                <div className="flex flex-col items-center space-y-2">
                  <div className="h-12 w-12 bg-secondary rounded-full flex items-center justify-center">
                    <Clock className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">No Active Block</p>
                  <p className="text-xs text-muted-foreground">Start using Claude to begin a new usage block</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Usage Chart Placeholder */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Usage</CardTitle>
          <CardDescription>Last 7 days</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64 border-2 border-dashed border-white/10 rounded-lg">
            <div className="text-center">
              <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium">Usage Chart</p>
              <p className="text-sm text-muted-foreground">Coming soon</p>
            </div>
          </div>
        </CardContent>
      </Card>
      </>
      )}
    </div>
  )
}
