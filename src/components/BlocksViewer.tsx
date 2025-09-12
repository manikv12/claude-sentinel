import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from './ui/dialog'
import { 
  Clock, 
  Calendar, 
  Activity, 
  BarChart3, 
  RefreshCw, 
  Eye,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Zap,
  Settings,
  Trash2,
  FileText
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface BlockEvent {
  timestamp: string
  eventType: 'block_detected' | 'block_started' | 'block_ended' | 'block_updated'
  blockId: string
  blockStart: string
  blockEnd: string
  usage: number
  isActive: boolean
  entryCount: number
  source: 'ccusage_analysis' | 'session_tracking' | 'auto_renewal'
  details?: string
}

interface DailyBlock {
  blockId: string
  blockStart: string
  blockEnd: string
  usage: number
  isActive: boolean
  entryCount: number
  source: string
  timestamp: string
}

interface SessionFile {
  name: string
  path: string
  size: number
  modified: string
  content?: string
}

export function BlocksViewer({ trigger }: { trigger?: React.ReactNode }) {
  const [blocks, setBlocks] = useState<DailyBlock[]>([])
  const [events, setEvents] = useState<BlockEvent[]>([])
  const [sessionFiles, setSessionFiles] = useState<SessionFile[]>([])
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [isLoading, setIsLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'blocks' | 'files'>('blocks')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewFile, setPreviewFile] = useState<SessionFile | null>(null)

  const loadBlockData = async (date: string) => {
    setIsLoading(true)
    try {
      const [dailyBlocks, blockEvents] = await Promise.all([
        window.electronAPI.getDailyBlocks(date),
        window.electronAPI.getBlockEvents(24) // Last 24 hours of events
      ])
      
      setBlocks(dailyBlocks || [])
      setEvents(blockEvents || [])
    } catch (error) {
      console.error('Failed to load block data:', error)
      setBlocks([])
      setEvents([])
    } finally {
      setIsLoading(false)
    }
  }

  const loadSessionFiles = async () => {
    setIsLoading(true)
    try {
      const files = await window.electronAPI.getSessionFiles()
      setSessionFiles(files || [])
    } catch (error) {
      console.error('Failed to load session files:', error)
      setSessionFiles([])
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteFile = async (filePath: string) => {
    try {
  if (!confirm('Delete this session file? This cannot be undone.')) return
      const result = await window.electronAPI.deleteSessionFile(filePath)
      if (result.success) {
        await loadSessionFiles() // Reload files
        window.electronAPI.showNotification(`File deleted successfully`)
      } else {
        window.electronAPI.showNotification(`Failed to delete file: ${result.error}`)
      }
    } catch (error) {
      console.error('Error deleting file:', error)
      window.electronAPI.showNotification('Error deleting file')
    }
  }

  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'blocks') {
        loadBlockData(selectedDate)
      } else {
        loadSessionFiles()
      }
    }
  }, [selectedDate, isOpen, activeTab])

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    })
  }

  const formatDuration = (startTime: string, endTime: string) => {
    const start = new Date(startTime)
    const end = new Date(endTime)
    const hours = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60))
    return `${hours}h`
  }

  const formatTokens = (count: number) => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`
    }
    return count.toString()
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
  }

  const getFileTypeIcon = (fileName: string) => {
    if (fileName.includes('activity')) return <Activity className="h-4 w-4 text-green-500" />
    if (fileName.includes('config')) return <Settings className="h-4 w-4 text-blue-500" />  
    if (fileName.includes('log')) return <BarChart3 className="h-4 w-4 text-purple-500" />
    if (fileName.includes('lock')) return <AlertCircle className="h-4 w-4 text-orange-500" />
    return <Clock className="h-4 w-4 text-gray-400" />
  }

  const getBlockStatusIcon = (block: DailyBlock) => {
    if (block.isActive) {
      return <Activity className="h-4 w-4 text-green-500" />
    } else {
      return <CheckCircle className="h-4 w-4 text-gray-400" />
    }
  }

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'ccusage_analysis':
        return <BarChart3 className="h-3 w-3 text-blue-500" />
      case 'auto_renewal':
        return <Zap className="h-3 w-3 text-orange-500" />
      case 'session_tracking':
        return <Clock className="h-3 w-3 text-purple-500" />
      default:
        return <AlertCircle className="h-3 w-3 text-gray-400" />
    }
  }

  const changeDate = (direction: 'prev' | 'next') => {
    const currentDate = new Date(selectedDate)
    if (direction === 'prev') {
      currentDate.setDate(currentDate.getDate() - 1)
    } else {
      currentDate.setDate(currentDate.getDate() + 1)
    }
    setSelectedDate(currentDate.toISOString().split('T')[0])
  }

  const isToday = selectedDate === new Date().toISOString().split('T')[0]

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Eye className="h-4 w-4 mr-2" />
            View Blocks
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Calendar className="h-5 w-5" />
            <span>Session Manager</span>
          </DialogTitle>
          <DialogDescription>
            View usage blocks and manage session tracking files
          </DialogDescription>
        </DialogHeader>

        {/* Tab Navigation */}
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('blocks')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'blocks'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Calendar className="h-4 w-4 inline mr-2" />
            Usage Blocks
          </button>
          <button
            onClick={() => setActiveTab('files')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'files'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileText className="h-4 w-4 inline mr-2" />
            Session Files ({sessionFiles.length})
          </button>
        </div>

        {/* Blocks Tab Content */}
        {activeTab === 'blocks' && (
          <>
            {/* Date Navigation */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => changeDate('prev')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="text-center min-w-[120px]">
                  <div className="font-medium">
                    {new Date(selectedDate).toLocaleDateString('en-US', { 
                      weekday: 'short',
                      month: 'short', 
                      day: 'numeric' 
                    })}
                  </div>
                  {isToday && <div className="text-xs text-green-600">Today</div>}
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => changeDate('next')}
                  disabled={isToday}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => loadBlockData(selectedDate)}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </>
        )}

        {/* Session Files Tab Content */}
        {activeTab === 'files' && (
          <div className="flex items-end justify-end mb-4">
            <Button 
              variant="outline" 
              size="sm"
              onClick={loadSessionFiles}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        )}

        {/* Blocks Tab */}
        {activeTab === 'blocks' && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Blocks for {new Date(selectedDate).toLocaleDateString()}
                </CardTitle>
                <CardDescription>
                  {blocks.length} block{blocks.length !== 1 ? 's' : ''} detected
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                    <span>Loading blocks...</span>
                  </div>
                ) : blocks.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No blocks found for this date</p>
                    <p className="text-sm">Try selecting a different date or check if you used Claude on this day</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {blocks.map((block, index) => (
                      <div 
                        key={block.blockId}
                        className="p-4 border rounded-lg hover:bg-secondary/50 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            {getBlockStatusIcon(block)}
                            <span className="font-medium">
                              Block #{index + 1}
                            </span>
                            <div className="flex items-center space-x-1">
                              {getSourceIcon(block.source)}
                              <span className="text-xs text-muted-foreground capitalize">
                                {block.source.replace('_', ' ')}
                              </span>
                            </div>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {formatDistanceToNow(new Date(block.timestamp))} ago
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <div className="text-muted-foreground">Start Time</div>
                            <div className="font-medium">{formatTime(block.blockStart)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Duration</div>
                            <div className="font-medium">{formatDuration(block.blockStart, block.blockEnd)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Usage</div>
                            <div className="font-medium">{formatTokens(block.usage)} tokens</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Entries</div>
                            <div className="font-medium">{block.entryCount} messages</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {events.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Recent Block Events</CardTitle>
                  <CardDescription>
                    Last 24 hours of block detection events
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {events.slice(0, 10).map((event, index) => (
                      <div 
                        key={`${event.blockId}-${index}`}
                        className="flex items-center justify-between py-2 px-3 bg-secondary/30 rounded-lg text-sm"
                      >
                        <div className="flex items-center space-x-2">
                          {getSourceIcon(event.source)}
                          <span className="capitalize">{event.eventType.replace('_', ' ')}</span>
                          <span className="text-muted-foreground">•</span>
                          <span>{formatTokens(event.usage)} tokens</span>
                        </div>
                        <div className="text-muted-foreground">
                          {formatTime(event.timestamp)}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Files Tab */}
        {activeTab === 'files' && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Session Files</CardTitle>
                <CardDescription>
                  {sessionFiles.length} file{sessionFiles.length !== 1 ? 's' : ''} found
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                    <span>Loading files...</span>
                  </div>
                ) : sessionFiles.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No session files found</p>
                    <p className="text-sm">Files are created as you use and track sessions</p>
                  </div>
                ) : (
                  <div className="divide-y border rounded-lg">
                    {sessionFiles.map((file) => (
                      <div key={file.path} className="flex items-center justify-between p-3">
                        <div className="flex items-center gap-3">
                          {getFileTypeIcon(file.name)}
                          <div>
                            <div className="font-medium break-all">{file.name}</div>
                            <div className="text-xs text-muted-foreground break-all">{file.path}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-muted-foreground">{formatFileSize(file.size)}</span>
                          <span className="text-muted-foreground">{new Date(file.modified).toLocaleString()}</span>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => { setPreviewFile(file); setPreviewOpen(true) }}
                            >
                              <Eye className="h-4 w-4 mr-2" /> View
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="hover:bg-destructive/20 hover:text-destructive"
                              onClick={() => handleDeleteFile(file.path)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" /> Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* File Preview Dialog */}
            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    {previewFile?.name}
                  </DialogTitle>
                  <DialogDescription className="break-all">
                    {previewFile?.path}
                  </DialogDescription>
                </DialogHeader>
                <div className="text-sm text-muted-foreground flex gap-4">
                  <span>Size: {previewFile ? formatFileSize(previewFile.size) : '-'}</span>
                  <span>Modified: {previewFile ? new Date(previewFile.modified).toLocaleString() : '-'}</span>
                </div>
                <div className="mt-3 border rounded bg-secondary/40 max-h-[50vh] overflow-auto p-3 text-xs font-mono whitespace-pre-wrap">
                  {previewFile?.content ?? 'Preview unavailable'}
                </div>
              </DialogContent>
            </Dialog>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}