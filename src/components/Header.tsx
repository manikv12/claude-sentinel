import React from 'react'
import { Button } from './ui/button'
import { Minimize2, X, Activity } from 'lucide-react'
import { useRenewalStore } from '@/stores/renewalStore'

export function Header() {
  const { status } = useRenewalStore()

  const handleMinimize = () => {
    window.electronAPI.minimizeToTray()
  }

  const handleClose = () => {
    window.close()
  }

  const isMac = navigator.userAgent.indexOf('Mac') !== -1

  return (
    <header
      className={`grid grid-cols-3 items-center p-4 glass-header border-b-0 drag-region ${isMac ? 'pl-20 pt-6' : ''}`}
    >
      {/* Left spacer to balance right controls for true centering */}
      <div />

      {/* Centered app branding */}
      <div className="flex items-center justify-center space-x-2 no-drag">
        <Activity className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">Claude Sentinel</h1>
      </div>

      {/* Right-side status + window controls */}
      <div className="flex items-center justify-end space-x-3 no-drag">
        <div className="flex items-center space-x-2 text-xs text-muted-foreground">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${status.enabled ? 'bg-green-500' : 'bg-red-500'}`} />
          <span>Auto-Renewal</span>
        </div>
        {!isMac && (
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleMinimize}
              className="h-8 w-8 glass-button border-0"
            >
              <Minimize2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="h-8 w-8 glass-button border-0 hover:bg-destructive/20 hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}
