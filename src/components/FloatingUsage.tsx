import React, { useEffect, useState } from 'react'
import { Card, CardContent } from './ui/card'
import { useUsageStore } from '@/stores/usageStore'
import { formatTokens, formatTimeRemaining } from '@/lib/utils'
import { X, Move, Clock, Zap, Activity, RefreshCw, ArrowLeft } from 'lucide-react'

export function FloatingUsage() {
  const { currentBlock, isLoading, refreshData } = useUsageStore()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [platform, setPlatform] = useState<string>('win32')

  // Toggle between showing remaining %/values and used values when user clicks
  // Use same storage key as Dashboard for consistency
  const STORAGE_KEY = 'sentinel.usageView'
  const [showRemainingValue, setShowRemainingValue] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY)
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

  // Get platform on component mount
  useEffect(() => {
    const detectPlatform = async () => {
      try {
        const platformInfo = window.electronAPI.getPlatform()
        setPlatform(platformInfo)
      } catch (error) {
        console.error('Failed to get platform:', error)
      }
    }
    detectPlatform()
  }, [])

  const handleRefresh = async () => {
    if (isRefreshing) return
    
    setIsRefreshing(true)
    try {
      await refreshData()
    } finally {
      setIsRefreshing(false)
    }
  }

  // Load data on mount and auto-refresh every 60 seconds
  useEffect(() => {
    // Load data immediately when component mounts
    handleRefresh()
    
    // Set up auto-refresh interval
    const interval = setInterval(() => {
      handleRefresh()
    }, 60000)

    return () => clearInterval(interval)
  }, [])

  const handleClose = () => {
    window.electronAPI.hideFloatingWindow()
  }

  const handleBackToApp = async () => {
    try {
      await window.electronAPI.showMainWindow()
    } catch (error) {
      console.error('Failed to show main window:', error)
    }
  }

  // Usage percentage and color
  const remainingPercent = currentBlock && currentBlock.limit
    ? Math.max(0, ((currentBlock.limit - currentBlock.usage) / currentBlock.limit) * 100)
    : 0
  const usagePercent = currentBlock && currentBlock.limit
    ? Math.min(100, (currentBlock.usage / currentBlock.limit) * 100)
    : 0
    
  const usageColorClass = remainingPercent >= 40
    ? 'text-green-500'
    : remainingPercent >= 15
      ? 'text-yellow-500'
      : 'text-red-500'

  const progressBarColorClass = remainingPercent >= 40
    ? 'bg-green-500'
    : remainingPercent >= 15
      ? 'bg-yellow-500'
      : 'bg-red-500'

  if (isLoading) {
    return (
      <div className="w-full h-full bg-black/20 backdrop-blur-md rounded-lg border border-white/20 shadow-lg">
        <div className="glass-card h-full">
          <CardContent className="p-3 h-full flex items-center justify-center">
            <div className="flex items-center space-x-2 text-white/70">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading...</span>
            </div>
          </CardContent>
        </div>
      </div>
    )
  }

  return (
    <div 
      className="w-full h-full rounded-xl" 
      style={{ 
        background: 'rgba(220, 235, 255, 0.1)',
        backdropFilter: 'blur(25px) saturate(180%) hue-rotate(-5deg)',
        WebkitBackdropFilter: 'blur(25px) saturate(180%) hue-rotate(-5deg)',
        border: '1px solid rgba(200, 220, 255, 0.2)',
        borderRadius: '12px'
      }}
    >
      <div className="h-full relative overflow-hidden rounded-xl">
        {/* Top bar with title and controls - integrated with traffic lights */}
        <div
          className="cursor-move relative w-full"
          style={{
            WebkitAppRegion: 'drag',
            position: 'absolute',
            top: platform === 'darwin' ? '10px' : '8px',
            left: '0px',
            right: '0px',
            height: '25px',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          } as React.CSSProperties}
        >
          {/* Centered title area - use pointerEvents none so controls remain clickable */}
          <div
            className="flex items-center justify-center space-x-2 w-full"
            style={{ pointerEvents: 'none' }}
          >
            <Activity className="h-3 w-3 text-white/90" />
            <span className="text-xs font-medium text-white/95">Usage Block</span>
          </div>
          
          {/* Control buttons - positioned absolutely on the right */}
          <div 
            className="flex items-center space-x-1 absolute right-0 top-0 h-full" 
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <button
              onClick={handleBackToApp}
              className="p-1 hover:bg-white/15 hover:backdrop-blur-sm rounded text-white/80 hover:text-white transition-all duration-200"
              title="Back to App"
            >
              <ArrowLeft className="h-3 w-3" />
            </button>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1 hover:bg-white/15 hover:backdrop-blur-sm rounded text-white/80 hover:text-white transition-all duration-200"
              title="Refresh"
            >
              <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            {/* Only show close button on non-macOS since macOS has traffic lights */}
            {platform !== 'darwin' && (
              <button
                onClick={handleClose}
                className="p-1 hover:bg-white/15 hover:backdrop-blur-sm rounded text-white/80 hover:text-white transition-all duration-200"
                title="Close"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        
        <div className="h-full" style={{ paddingTop: platform === 'darwin' ? '50px' : '45px', paddingLeft: '12px', paddingRight: '12px', paddingBottom: '12px' }}>
          {currentBlock && currentBlock.isActive ? (
            <>
              {/* Usage Progress */}
              <div className="space-y-2 mb-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/70">Usage</span>
                  <span
                    className="text-xs text-white/70 cursor-pointer select-none hover:text-white/90 transition-colors"
                    role="button"
                    tabIndex={0}
                    onClick={toggleShowRemaining}
                    onKeyDown={handleKeyToggle}
                    title={showRemainingValue ? 'Click to show used' : 'Click to show remaining'}
                    aria-pressed={!showRemainingValue}
                  >
                    {showRemainingValue
                      ? `${formatTokens(Math.max(0, currentBlock.limit - currentBlock.usage))} / ${formatTokens(currentBlock.limit)}`
                      : `${formatTokens(currentBlock.usage)} / ${formatTokens(currentBlock.limit)}`}
                  </span>
                </div>
                
                <div 
                  className="w-full rounded-full h-2.5 overflow-hidden cursor-pointer relative"
                  style={{ 
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)'
                  }}
                  onClick={toggleShowRemaining}
                  title={showRemainingValue ? 'Click to show used values' : 'Click to show remaining values'}
                >
                  <div
                    className={`rounded-full h-full transition-all duration-500 ease-in-out ${showRemainingValue ? 'absolute top-0' : ''}`}
                    style={{ 
                      width: `${showRemainingValue ? Math.max(0, remainingPercent) : Math.max(0, usagePercent)}%`,
                      background: remainingPercent >= 40
                        ? 'rgba(34, 197, 94, 0.7)'
                        : remainingPercent >= 15
                          ? 'rgba(234, 179, 8, 0.7)'
                          : 'rgba(239, 68, 68, 0.7)',
                      ...(showRemainingValue ? { right: 0 } : { left: 0 })
                    }}
                  />
                </div>
                
                <div className="text-xs">
                  <span 
                    className={`${usageColorClass} cursor-pointer select-none hover:opacity-80 transition-opacity`}
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

              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-2 text-xs items-start">
                {currentBlock.timeRemaining && (
                  <div>
                    <div className="text-white/50">Time Left</div>
                    <div className={`font-medium ${usageColorClass}`}>
                      {formatTimeRemaining(currentBlock.timeRemaining)}
                    </div>
                  </div>
                )}
                
                {currentBlock.startTime && (
                  <div>
                    <div className="text-white/50">Started</div>
                    <div className="text-white font-medium">
                      {new Date(currentBlock.startTime).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                )}

                {/* Reset time (next block reset) */}
                {(currentBlock.endTime || currentBlock.timeRemaining) && (
                  <div>
                    <div className="text-white/50">Reset</div>
                    <div className="text-white font-medium">
                      {currentBlock.endTime
                        ? new Date(currentBlock.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : new Date(Date.now() + (currentBlock.timeRemaining || 0) * 60 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <div className="flex flex-col items-center space-y-2">
                <div className="h-8 w-8 bg-white/10 rounded-full flex items-center justify-center">
                  <Clock className="h-4 w-4 text-white/50" />
                </div>
                <p className="text-xs text-white/70">No Active Block</p>
                <p className="text-xs text-white/50">Start using Claude to begin</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}