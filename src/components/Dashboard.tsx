import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { DatePicker } from './ui/date-picker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { useUsageStore, UsagePrediction } from '@/stores/usageStore'
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
  PauseCircle,
  Info,
  MessageCircle,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  Calendar
} from 'lucide-react'
import { Skeleton } from './ui/skeleton'
import { UsageChart } from './UsageChart'

// Individual component skeletons for granular loading
function StatCardSkeleton() {
  return (
    <div className="p-4 border rounded-lg">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-4" />
      </div>
      <Skeleton className="h-7 w-24 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  )
}

function CurrentBlockSkeleton() {
  return (
    <div className="p-4 border rounded-lg">
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
  )
}

function ChartSkeleton() {
  return (
    <div className="p-4 border rounded-lg">
      <div className="mb-2">
        <Skeleton className="h-5 w-24" />
      </div>
      <Skeleton className="h-5 w-32 mb-4" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export function Dashboard() {
  const { summary, currentBlock, usageData, loadingStates, loadDataInBackground, refreshData } = useUsageStore()
  const {
    status,
    isLoading: renewalLoading,
    toggleAutoRenewal,
    refreshStatus
  } = useRenewalStore()

  const [autoRefresh, setAutoRefresh] = useState(false)
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(60) // Align with cache window
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showUsageDetails, setShowUsageDetails] = useState(false)
  const [isWindowFocused, setIsWindowFocused] = useState(true)
  const [userPlan, setUserPlan] = useState<'pro' | 'max-5x' | 'max-20x' | 'auto'>('auto')
  const [chartType, setChartType] = useState<'area' | 'bar'>('area')
  const [chartMetric, setChartMetric] = useState<'tokens' | 'cost'>('tokens')
  const [chartView, setChartView] = useState<'daily' | 'sessions'>('daily')

  // Auto-renewal modal state
  const [showModeSelection, setShowModeSelection] = useState(false)
  const [selectedMode, setSelectedMode] = useState<'immediate' | 'scheduled'>('immediate')
  const [scheduledTime, setScheduledTime] = useState('')

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

  // Start background data loading and user plan loading - both deferred to not block UI
  useEffect(() => {
    // Defer all async operations to ensure UI renders immediately
    const timeoutId = setTimeout(() => {
      // Load user plan setting in background
      const loadUserPlan = async () => {
        try {
          if (!window.electronAPI?.getSettings) {
            console.warn('Running in development mode - Electron API not available')
            return
          }
          const settings = await window.electronAPI.getSettings()
          if (settings?.claudePlan) {
            setUserPlan(settings.claudePlan)
          }
        } catch (error) {
          console.error('Failed to load user plan setting:', error)
        }
      }
      
      // Start both operations in parallel
      loadDataInBackground()
      refreshStatus()
      loadUserPlan()
    }, 50) // Minimal delay to ensure DOM rendering
    
    return () => clearTimeout(timeoutId)
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
      // Always use hard refresh to ensure tray icon updates
      await window.electronAPI.hardRefreshUsageData?.()
      await refreshStatus()
    } finally {
      setIsRefreshing(false)
    }
  }

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

  // Estimate number of prompts based on user's Claude plan and usage patterns (2024 data)
  const getEstimatedPromptCount = (usage: number) => {
    // Plan-specific usage patterns from Anthropic's official data:
    const planPatterns = {
      'pro': {
        tokensPerWindow: 44000,
        promptsPerWindow: [10, 40], // 10-40 prompts
        avgTokensPerPrompt: 1100 // Conservative estimate: 44K / 40 prompts
      },
      'max-5x': {
        tokensPerWindow: 88000,
        promptsPerWindow: [50, 225], // Based on 5x usage
        avgTokensPerPrompt: 900 // 88K / ~100 average prompts
      },
      'max-20x': {
        tokensPerWindow: 220000,
        promptsPerWindow: [200, 900], // Based on 20x usage
        avgTokensPerPrompt: 400 // 220K / ~550 average prompts
      }
    }

    let avgTokensPerPrompt = 2000 // Default fallback

    if (userPlan !== 'auto' && planPatterns[userPlan]) {
      avgTokensPerPrompt = planPatterns[userPlan].avgTokensPerPrompt
    } else {
      // Auto-detect mode: use current block limit to infer plan
      if (currentBlock?.limit) {
        if (currentBlock.limit >= 200000000) avgTokensPerPrompt = planPatterns['max-20x'].avgTokensPerPrompt
        else if (currentBlock.limit >= 80000000) avgTokensPerPrompt = planPatterns['max-5x'].avgTokensPerPrompt
        else avgTokensPerPrompt = planPatterns['pro'].avgTokensPerPrompt
      }
    }

    return Math.max(1, Math.round(usage / avgTokensPerPrompt))
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
      {/* Never show full skeleton - always show UI immediately */}
      {(
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
                disabled={isRefreshing || renewalLoading}
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
          <div className="grid gap-4 md:grid-cols-3">
            {/* Total Cost Card */}
            {loadingStates.summary ? (
              <StatCardSkeleton />
            ) : (
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
            )}

            {/* Total Tokens Card */}
            {loadingStates.summary ? (
              <StatCardSkeleton />
            ) : (
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
            )}

            {/* Time Remaining / Next Session Card */}
            {loadingStates.summary ? (
              <StatCardSkeleton />
            ) : (
              <Card className="glass-card">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {currentBlock && currentBlock.isActive ? 'Time Remaining' : 'Next Session'}
                  </CardTitle>
                  {currentBlock && currentBlock.isActive ? (
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                  )}
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {currentBlock && currentBlock.isActive ? (
                      formatTimeRemaining(status.timeRemaining)
                    ) : status.nextRenewal ? (
                      (() => {
                        const now = new Date()
                        const nextRenewal = new Date(status.nextRenewal)
                        const diffMs = nextRenewal.getTime() - now.getTime()
                        const diffMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)))
                        
                        if (diffMinutes < 60) {
                          return diffMinutes <= 1 ? 'Soon' : `${diffMinutes}m`
                        } else if (diffMinutes < 24 * 60) {
                          const hours = Math.floor(diffMinutes / 60)
                          const mins = diffMinutes % 60
                          return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`
                        } else {
                          const isToday = nextRenewal.toDateString() === now.toDateString()
                          const isTomorrow = nextRenewal.toDateString() === new Date(now.getTime() + 24 * 60 * 60 * 1000).toDateString()
                          
                          if (isToday) {
                            return nextRenewal.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          } else if (isTomorrow) {
                            return `Tomorrow`
                          } else {
                            return nextRenewal.toLocaleDateString([], { month: 'short', day: 'numeric' })
                          }
                        }
                      })()
                    ) : (
                      'Unknown'
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {currentBlock && currentBlock.isActive 
                      ? 'Until next reset' 
                      : status.nextRenewal 
                        ? (() => {
                            const nextRenewal = new Date(status.nextRenewal)
                            const now = new Date()
                            const isToday = nextRenewal.toDateString() === now.toDateString()
                            const isTomorrow = nextRenewal.toDateString() === new Date(now.getTime() + 24 * 60 * 60 * 1000).toDateString()
                            
                            if (isToday) {
                              return `Today at ${nextRenewal.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                            } else if (isTomorrow) {
                              return `Tomorrow at ${nextRenewal.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                            } else {
                              return nextRenewal.toLocaleDateString([], { 
                                weekday: 'short', 
                                month: 'short', 
                                day: 'numeric',
                                hour: '2-digit', 
                                minute: '2-digit' 
                              })
                            }
                          })()
                        : status.enabled 
                          ? 'Auto-renewal will start soon'
                          : 'Enable auto-renewal to schedule'
                    }
                  </p>
                </CardContent>
              </Card>
            )}
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
                className={`w-full border-0 ${status.enabled ? 'glass-button-enabled' : 'glass-button-disabled'}`}
              >
                {status.enabled ? (
                  <><PauseCircle className="h-4 w-4 mr-2" />Disable</>
                ) : (
                  <><PlayCircle className="h-4 w-4 mr-2" />Enable</>
                )}
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

        {/* Usage Block Card */}
        {loadingStates.currentBlock ? (
          <CurrentBlockSkeleton />
        ) : (
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
                
                {/* Collapsible Usage Details */}
                <div className="space-y-2">
                  <button
                    onClick={() => setShowUsageDetails(!showUsageDetails)}
                    className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors p-2 rounded-md hover:bg-muted/20"
                  >
                    <div className="flex items-center space-x-2">
                      <Info className="h-3 w-3" />
                      <span>Block Usage Summary</span>
                    </div>
                    {showUsageDetails ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                  {showUsageDetails && (
                    <div className="px-2 pb-2 text-xs text-muted-foreground space-y-1">
                      <div>• ~{getEstimatedPromptCount(currentBlock.usage)} prompts estimated</div>
                      <div>• ~{Math.round(currentBlock.usage / getEstimatedPromptCount(currentBlock.usage)).toLocaleString()} tokens/prompt average</div>
                      {currentBlock.startTime && <div>• Since {new Date(currentBlock.startTime).toLocaleTimeString()}</div>}
                    </div>
                  )}
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
        )}
      </div>

      {/* Usage Chart */}
      {loadingStates.chart ? (
        <ChartSkeleton />
      ) : (
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center space-x-2">
                  <TrendingUp className="h-5 w-5" />
                  <span>Usage Trends</span>
                </CardTitle>
                <CardDescription>Last 7 days activity</CardDescription>
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant={chartType === 'area' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setChartType('area')}
                >
                  Area
                </Button>
                <Button
                  variant={chartType === 'bar' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setChartType('bar')}
                >
                  Bar
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <Button
                    variant={chartView === 'daily' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setChartView('daily')}
                  >
                    <Calendar className="h-4 w-4 mr-2" />
                    Daily
                  </Button>
                  <Button
                    variant={chartView === 'sessions' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      // Debug: sessions series; disabled for performance
                      setChartView('sessions')
                    }}
                  >
                    <MessageCircle className="h-4 w-4 mr-2" />
                    Sessions ({usageData.sessions?.length || 0})
                  </Button>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant={chartMetric === 'tokens' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setChartMetric('tokens')}
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    Tokens
                  </Button>
                  <Button
                    variant={chartMetric === 'cost' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setChartMetric('cost')}
                  >
                    <DollarSign className="h-4 w-4 mr-2" />
                    Cost
                  </Button>
                </div>
              </div>
              <UsageChart
                data={chartView === 'daily' ? usageData.daily : (usageData.sessions || [])}
                height={250}
                type={chartType}
                showCost={chartMetric === 'cost'}
                viewType={chartView}
              />
            </div>
          </CardContent>
        </Card>
      )}

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
              <div className="border-t-2 border-primary/20 pt-4 mt-4">
                <div className="flex flex-col lg:flex-row lg:items-start space-y-3 lg:space-y-0 lg:space-x-4">
                  <div className="flex-1">
                    <label className="text-sm font-medium">Select start date and time:</label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Choose when to begin auto-renewal monitoring
                    </p>
                  </div>
                  <div className="relative overflow-visible w-full lg:w-72 lg:flex-shrink-0">
                    <DatePicker
                      value={scheduledTime}
                      onChange={setScheduledTime}
                      minDate={new Date()}
                      className="w-full"
                    />
                  </div>
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
              disabled={renewalLoading}
              className="flex-1"
            >
              {renewalLoading ? (
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
      </>
      )}
    </div>
  )
}
