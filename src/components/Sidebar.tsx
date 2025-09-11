import React from 'react'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { BarChart3, FileText, Settings, Power, ScrollText } from 'lucide-react'

interface SidebarProps {
  activeView: 'dashboard' | 'reports' | 'settings' | 'auto-renewal' | 'logs'
  onViewChange: (view: 'dashboard' | 'reports' | 'settings' | 'auto-renewal' | 'logs') => void
}

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const isMac = navigator.userAgent.indexOf('Mac') !== -1

  const menuItems = [
    {
      id: 'dashboard' as const,
      label: 'Dashboard',
      icon: BarChart3,
      description: 'Usage overview and stats'
    },
    {
      id: 'auto-renewal' as const,
      label: 'Auto-Renewal',
      icon: Power,
      description: 'Manage session renewals'
    },
    {
      id: 'reports' as const,
      label: 'Reports',
      icon: FileText,
      description: 'Detailed usage reports'
    },
    {
      id: 'logs' as const,
      label: 'Logs',
      icon: ScrollText,
      description: 'Auto-renewal activity logs'
    },
    {
      id: 'settings' as const,
      label: 'Settings',
      icon: Settings,
      description: 'App configuration'
    }
  ]

  return (
    // Add consistent top padding so first item aligns with content under the header
    <aside className={`w-64 glass-sidebar border-r-0 p-4 flex flex-col pt-16`}>

      <nav className="flex-1 space-y-2">
        {menuItems.map((item) => {
          const Icon = item.icon
          const isActive = activeView === item.id
          
          return (
            <Button
              key={item.id}
              variant={isActive ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start h-auto p-3 flex-col items-start transition-all duration-200 border-0",
                isActive 
                  ? "glass-button bg-white/10 border border-white/20" 
                  : "hover:glass-button hover:bg-white/5"
              )}
              onClick={() => onViewChange(item.id)}
            >
              <div className="flex items-center space-x-2 w-full">
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </div>
              <span className="text-xs text-muted-foreground mt-1">
                {item.description}
              </span>
            </Button>
          )
        })}
      </nav>

      <div className="mt-auto pt-4 border-t border-white/10">
        <div className="text-xs text-muted-foreground text-center">
          Monitoring Claude usage and renewals
        </div>
      </div>
    </aside>
  )
}
