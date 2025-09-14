import React from 'react'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { BarChart3, FileText, Power, ScrollText, Code2, ChevronLeft } from 'lucide-react'

interface SidebarProps {
  activeView: 'dashboard' | 'reports' | 'settings' | 'auto-renewal' | 'spec-development'
  onViewChange: (view: 'dashboard' | 'reports' | 'settings' | 'auto-renewal' | 'spec-development') => void
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
      id: 'spec-development' as const,
      label: 'Spec Development',
      icon: Code2,
      description: 'AI-powered specification generation'
    },
    {
      id: 'reports' as const,
      label: 'Reports',
      icon: FileText,
      description: 'Detailed usage reports & logs'
    }
  ]

  return (
    // Header now spans full width; align sidebar directly beneath it
    <aside className={`w-64 glass-sidebar border-r border-white/10 p-4 flex flex-col pt-3`}>

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
