import React from 'react'
import { Button } from './ui/button'
import { Minimize2, X, Activity } from 'lucide-react'

export function Header() {

  const handleMinimize = () => {
    window.electronAPI.minimizeToTray()
  }

  const handleClose = () => {
    window.close()
  }

  const isMac = navigator.userAgent.indexOf('Mac') !== -1

  return (
    <header
      className={`relative z-30 flex items-center justify-between h-12 px-4 py-2 glass-header border-b border-white/10 drag-region ${isMac ? 'pl-20' : ''}`}
    >
      {/* Left spacer for window controls on macOS */}
      <div className="flex items-center">
        {isMac && <div className="w-16" />}
      </div>

      {/* Centered app branding - absolutely positioned for perfect centering */}
      <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center space-x-2 no-drag">
        <Activity className="h-4 w-4 text-primary" />
        <h1 className="text-sm font-medium">Claude Sentinel</h1>
      </div>

      {/* Right-side window controls */}
      <div className="flex items-center justify-end no-drag">
        {!isMac && (
          <div className="flex items-center space-x-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMinimize}
              className="h-7 w-7 p-0 hover:bg-white/10 border-0 opacity-60 hover:opacity-100"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="h-7 w-7 p-0 hover:bg-destructive/20 hover:text-destructive border-0 opacity-60 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}
