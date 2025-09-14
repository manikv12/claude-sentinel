import React, { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { cn } from '@/lib/utils'
import { useSpecStore } from '@/stores/specStore'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs'
import {
  FileText,
  Download,
  Edit3,
  Eye,
  Copy,
  Save,
  X,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Sparkles,
  RefreshCw
} from 'lucide-react'

export function MarkdownViewer() {
  const [isEditing, setIsEditing] = useState(false)
  const [activeTab, setActiveTab] = useState<'preview' | 'edit'>('preview')
  const [editContent, setEditContent] = useState('')
  const [streamingContent, setStreamingContent] = useState('')

  const {
    currentSpec,
    specifications,
    updateSpec,
    setShowApprovalDialog,
    setSelectedSpecId,
    isStreaming,
    isGenerating,
    appendToCurrentSpec
  } = useSpecStore()

  // Set up streaming listener
  useEffect(() => {
    const handleStreamChunk = (chunk: string) => {
      setStreamingContent(prev => prev + chunk)
      // Also update the current spec if one exists
      if (currentSpec) {
        appendToCurrentSpec(chunk)
      }
    }

    // Listen for streaming updates
    if (window.electronAPI?.onSpecCommandStream) {
      window.electronAPI.onSpecCommandStream(handleStreamChunk)
    }

    return () => {
      // Cleanup listener
      if (window.electronAPI?.removeSpecCommandStreamListeners) {
        window.electronAPI.removeSpecCommandStreamListeners()
      }
    }
  }, [currentSpec, appendToCurrentSpec])

  // Reset streaming content when not generating
  useEffect(() => {
    if (!isGenerating && !isStreaming) {
      setStreamingContent('')
    }
  }, [isGenerating, isStreaming])

  const handleEdit = () => {
    if (currentSpec) {
      setEditContent(currentSpec.content)
      setIsEditing(true)
      setActiveTab('edit')
    }
  }

  const handleSave = () => {
    if (currentSpec) {
      updateSpec(currentSpec.id, { content: editContent })
      setIsEditing(false)
      setActiveTab('preview')
    }
  }

  const handleCancel = () => {
    setIsEditing(false)
    setActiveTab('preview')
    setEditContent('')
  }

  const handleApproval = () => {
    if (currentSpec) {
      setSelectedSpecId(currentSpec.id)
      setShowApprovalDialog(true)
    }
  }

  const handleExport = () => {
    if (!currentSpec) return

    const content = currentSpec.content
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentSpec.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const copyToClipboard = () => {
    if (currentSpec) {
      navigator.clipboard.writeText(currentSpec.content)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'rejected':
        return <AlertTriangle className="h-4 w-4 text-red-500" />
      case 'in_review':
        return <Clock className="h-4 w-4 text-yellow-500" />
      default:
        return <FileText className="h-4 w-4 text-muted-foreground" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'text-green-500 bg-green-500/10 border-green-500/20'
      case 'rejected':
        return 'text-red-500 bg-red-500/10 border-red-500/20'
      case 'in_review':
        return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20'
      default:
        return 'text-muted-foreground bg-white/5 border-white/20'
    }
  }

  if (!currentSpec) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-white/10 bg-white/5">
          <div className="flex items-center space-x-2">
            <Eye className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium text-muted-foreground">Preview</span>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center text-center">
          <div className="space-y-4">
            <FileText className="h-16 w-16 mx-auto text-muted-foreground opacity-50" />
            <div>
              <h3 className="text-lg font-medium text-muted-foreground">
                No Specification Selected
              </h3>
              <p className="text-sm text-muted-foreground mt-2">
                Create a new spec using the chat or select an existing one to preview
              </p>
            </div>

            {specifications.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Recent specifications:</p>
                <div className="space-y-1">
                  {specifications.slice(0, 3).map((spec) => (
                    <Button
                      key={spec.id}
                      variant="outline"
                      size="sm"
                      onClick={() => useSpecStore.getState().setCurrentSpec(spec)}
                      className="glass-button text-xs"
                    >
                      {spec.title}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10">
        <div className="flex items-center justify-between">
          <h3 className="font-medium truncate max-w-[50%]">{currentSpec.title}</h3>

          <div className="flex items-center space-x-2">
            {isEditing ? (
              <div className="flex space-x-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSave}
                  className="text-green-600 hover:text-green-500"
                >
                  <Save className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleEdit}
                className="text-muted-foreground hover:text-foreground"
              >
                <Edit3 className="h-4 w-4" />
              </Button>
            )}

            {/* Local viewer tabs, VS Code style */}
            <Tabs
              value={activeTab}
              onValueChange={(v) => {
                setActiveTab(v as any)
                if (v === 'edit') {
                  setEditContent(currentSpec.content)
                  setIsEditing(true)
                } else {
                  setIsEditing(false)
                }
              }}
              className="ml-2"
            >
              <TabsList className="bg-white/5 border border-white/10 rounded-md h-8 p-0">
                <TabsTrigger value="preview" className="px-3 h-8 data-[state=active]:bg-white/10">Preview</TabsTrigger>
                <TabsTrigger value="edit" className="px-3 h-8 data-[state=active]:bg-white/10">Edit</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'edit' ? (
          <div className="h-full p-4">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full h-full p-4 bg-white/5 border border-white/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 text-sm font-mono resize-none"
              placeholder="Write your specification in Markdown..."
            />
          </div>
        ) : (
          <div className="p-6 markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              className="max-w-none"
              components={{
                code({ node, inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || '')
                  return !inline && match ? (
                    <SyntaxHighlighter
                      style={vscDarkPlus}
                      language={match[1]}
                      PreTag="div"
                      customStyle={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '8px',
                        fontSize: '0.875rem'
                      }}
                      {...props}
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  ) : (
                    <code
                      className="bg-white/10 px-1.5 py-0.5 rounded text-sm border border-white/20"
                      {...props}
                    >
                      {children}
                    </code>
                  )
                },
                table({ children, ...props }: any) {
                  return (
                    <div className="overflow-x-auto">
                      <table
                        className="min-w-full border border-white/20 rounded-lg"
                        {...props}
                      >
                        {children}
                      </table>
                    </div>
                  )
                },
                th({ children, ...props }: any) {
                  return (
                    <th
                      className="px-4 py-2 bg-white/10 border-b border-white/20 text-left font-medium"
                      {...props}
                    >
                      {children}
                    </th>
                  )
                },
                td({ children, ...props }: any) {
                  return (
                    <td
                      className="px-4 py-2 border-b border-white/10"
                      {...props}
                    >
                      {children}
                    </td>
                  )
                }
              }}
            >
              {currentSpec.content}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      {currentSpec.status === 'draft' && !isEditing && (
        <div className="p-4 border-t border-white/10 bg-white/5">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              Last updated: {new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              }).format(currentSpec.updatedAt)}
            </div>

            <Button
              onClick={handleApproval}
              className="glass-button"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Review & Approve
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
