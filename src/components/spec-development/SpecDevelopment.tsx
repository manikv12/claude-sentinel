import React, { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useSpecStore } from '@/stores/specStore'
import { SpecChat } from './SpecChat'
import { MarkdownViewer } from './MarkdownViewer'
import { SpecApproval } from './SpecApproval'
import { Card } from '../ui/card'
import { Button } from '../ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import {
  MessageSquare,
  Eye,
  Split,
  Folder,
  FolderOpen
} from 'lucide-react'

export function SpecDevelopment() {
  const {
    viewMode,
    setViewMode,
    activeProject,
    currentSpec,
    specifications,
    showApprovalDialog,
    createProject,
    createUserProject,
    projects,
    loadProjectsFromBackend,
    loadSpecsFromBackend,
    setActiveProject
  } = useSpecStore()

  // Load projects from backend on mount
  useEffect(() => {
    const initializeData = async () => {
      await loadProjectsFromBackend()
      // Only load user projects (folders), no default project creation
    }

    initializeData()
  }, [loadProjectsFromBackend])

  // Load specs when active project changes
  useEffect(() => {
    if (activeProject) {
      loadSpecsFromBackend(activeProject.id)
    }
  }, [activeProject?.id, loadSpecsFromBackend])


  const handleSelectProjectFolder = async () => {
    try {
      const result = await window.electronAPI?.showOpenDialog({
        title: 'Select Project Folder',
        buttonLabel: 'Select Folder',
        properties: ['openDirectory'],
        message: 'Choose your project folder for AI-powered specifications'
      })

      if (result && !result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0]
        const folderName = selectedPath.split('/').pop() || 'My Project'

        // Use Electron's native input dialog instead of browser prompt()
        const projectName = await window.electronAPI?.showInputDialog?.({
          title: 'Project Name',
          message: `Enter a name for this project:`,
          defaultValue: folderName,
          placeholder: 'Project name'
        })

        if (projectName && projectName.trim()) {
          const newProj = await createUserProject(selectedPath, projectName.trim(), `AI specifications for ${folderName}`)

          // Open the selected folder in the OS file manager for clarity
          try {
            await window.electronAPI.openPath(selectedPath)
          } catch (openError) {
            console.error('Failed to open path:', openError)
          }

          // Load specs for the new project
          if (newProj?.id) {
            await loadSpecsFromBackend(newProj.id)
          }
        }
      }
    } catch (error) {
      console.error('Failed to select project folder:', error)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Minimal Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">AI Specifications</h1>
          {/* Current project */}
          <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground bg-white/5 border border-white/10 rounded px-2 py-1">
            <Folder className="h-3.5 w-3.5" />
            <span>{activeProject ? activeProject.name : 'No folder selected'}</span>
          </div>
          {/* Switch project - only show user projects (folders) */}
          {projects.filter(p => p.isUserProject).length > 0 && (
            <select
              value={activeProject?.id || ''}
              onChange={(e) => {
                const p = projects.find(pr => pr.id === e.target.value)
                setActiveProject(p || null)
                if (p) loadSpecsFromBackend(p.id)
              }}
              className="text-xs bg-white/5 border border-white/10 rounded px-2 py-1 outline-none"
            >
              <option value="">Select folder…</option>
              {projects
                .filter(p => p.isUserProject)
                .map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
            </select>
          )}
          {/* Select Folder */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSelectProjectFolder}
            className="h-8 px-2 text-xs bg-white/5 border border-white/10"
            title="Select project folder"
          >
            <FolderOpen className="h-3.5 w-3.5 mr-1" /> Folder
          </Button>
        </div>

        {/* Compact view switcher */}
        <div className="flex bg-white/5 rounded-md p-0.5 border border-white/10">
          <Button
            variant={viewMode === 'chat' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('chat')}
            className={cn("px-3 h-8", viewMode === 'chat' && "bg-white/10")}
            title="Chat"
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'split' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('split')}
            className={cn("px-3 h-8", viewMode === 'split' && "bg-white/10")}
            title="Split"
          >
            <Split className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'preview' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('preview')}
            className={cn("px-3 h-8", viewMode === 'preview' && "bg-white/10")}
            title="Preview"
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {viewMode === 'chat' && (
          <div className="flex-1">
            <SpecChat />
          </div>
        )}

        {viewMode === 'preview' && (
          <div className="flex-1">
            <MarkdownViewer />
          </div>
        )}

        {viewMode === 'split' && (
          <>
            <div className="flex-1 border-r border-white/10">
              <SpecChat />
            </div>
            <div className="flex-1">
              <MarkdownViewer />
            </div>
          </>
        )}
      </div>

      {/* Approval Dialog */}
      {showApprovalDialog && <SpecApproval />}
    </div>
  )
}
