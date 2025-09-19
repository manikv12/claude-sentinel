import { useEffect, useState } from 'react'
import { Button } from './components/ui/button'
import { PanelLeft, PanelLeftClose, Settings as SettingsIcon } from 'lucide-react'
import { Dashboard } from './components/Dashboard'
import { ReportsAndLogs } from './components/ReportsAndLogs'
import { Settings } from './components/Settings'
import { AutoRenewal } from './components/AutoRenewal'
import { FloatingUsage } from './components/FloatingUsage'
import { SpecDevelopment } from './components/spec-development/SpecDevelopment'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { useUsageStore } from './stores/usageStore'
import { useRenewalStore } from './stores/renewalStore'
import './globals.css'

declare global {
  interface Window {
    electronAPI: import('../electron/preload').ElectronAPI
  }
}

function App() {
  const [activeView, setActiveView] = useState<'dashboard' | 'reports' | 'settings' | 'auto-renewal' | 'spec-development'>('dashboard')
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const { setUsageData, setPartialUsageData } = useUsageStore()
  const { setRenewalStatus, status: renewalStatus } = useRenewalStore()

  // Check if we're in floating mode
  const isFloatingMode = window.location.hash === '#/floating'

  useEffect(() => {
    // Set up event listeners only - data will be loaded when needed by each component
    const handleUsageUpdate = (data: any) => {
      setUsageData(data)
    }

    const handlePartialUsageUpdate = (data: any) => {
      setPartialUsageData(data)
    }

    const handleRenewalStatusUpdate = (status: any) => {
      setRenewalStatus(status)
    }

    window.electronAPI.onUsageUpdate(handleUsageUpdate)
    window.electronAPI.onPartialUsageUpdate?.(handlePartialUsageUpdate)
    window.electronAPI.onRenewalStatusUpdate(handleRenewalStatusUpdate)

    // Cleanup listeners on unmount
    return () => {
      window.electronAPI.removeAllListeners('usage-update')
      window.electronAPI.removeAllListeners('usage-partial-update')
      window.electronAPI.removeAllListeners('renewal-status-update')
    }
  }, [setUsageData, setPartialUsageData, setRenewalStatus])

  // Render floating view if in floating mode
  if (isFloatingMode) {
    return (
      <div className="h-screen w-screen overflow-hidden">
        <FloatingUsage />
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col">
      {/* App-wide header spanning full width (VS Code style) */}
      <div className="relative">
        <Header />

        {/* Top-right controls - anchored to header */}
        <div className="absolute top-2.5 right-4 z-40 flex items-center gap-2 no-drag">
          {/* Auto-Renewal Status Indicator */}
          <div className="flex items-center space-x-1 px-2 py-1 bg-black/20 backdrop-blur-sm rounded text-xs text-white/80 border border-white/10">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${
              renewalStatus.enabled ? 'bg-green-400' : 'bg-red-400'
            }`} />
            <span className="text-[10px] font-medium">AUTO</span>
          </div>

          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarVisible(!sidebarVisible)}
              className="h-7 w-7 p-0 hover:bg-white/10 transition-colors opacity-60 hover:opacity-100"
            >
              {sidebarVisible ? (
                <PanelLeftClose className="h-3.5 w-3.5" />
              ) : (
                <PanelLeft className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveView('settings')}
              className={`h-7 w-7 p-0 hover:bg-white/10 transition-colors opacity-60 hover:opacity-100 ${
                activeView === 'settings' ? 'bg-white/10 opacity-100' : ''
              }`}
            >
              <SettingsIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main area with sidebar and content under the header */}
      <div className="flex-1 flex overflow-hidden">
        {sidebarVisible && (
          <Sidebar
            activeView={activeView}
            onViewChange={setActiveView}
          />
        )}

        <div className="flex-1 flex flex-col relative">
          <main className={`flex-1 overflow-auto ${activeView === 'spec-development' ? 'p-0' : 'p-6'}`}>
            {activeView === 'dashboard' && <Dashboard />}
            {activeView === 'auto-renewal' && <AutoRenewal />}
            {activeView === 'spec-development' && <SpecDevelopment />}
            {activeView === 'reports' && <ReportsAndLogs />}
            {activeView === 'settings' && <Settings />}
          </main>
        </div>
      </div>
    </div>
  )
}

export default App
