import React, { useState } from 'react'
import { cn } from '@/lib/utils'
import { useSpecStore } from '@/stores/specStore'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import {
  CheckCircle2,
  XCircle,
  MessageSquare,
  FileText,
  Clock,
  AlertTriangle,
  Star,
  Tag,
  Calendar
} from 'lucide-react'

export function SpecApproval() {
  const [feedback, setFeedback] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const [rating, setRating] = useState(0)

  const {
    showApprovalDialog,
    selectedSpecId,
    specifications,
    setShowApprovalDialog,
    approveSpec,
    rejectSpec,
    updateSpec,
    setSelectedSpecId
  } = useSpecStore()

  const selectedSpec = specifications.find(spec => spec.id === selectedSpecId)

  const handleClose = () => {
    setShowApprovalDialog(false)
    setSelectedSpecId(null)
    setFeedback('')
    setTags([])
    setRating(0)
  }

  const handleApprove = () => {
    if (!selectedSpecId) return

    // Update spec with approval metadata
    updateSpec(selectedSpecId, {
      tags: [...(selectedSpec?.tags || []), ...tags],
    })

    approveSpec(selectedSpecId)
    handleClose()
  }

  const handleReject = () => {
    if (!selectedSpecId) return

    // Add rejection feedback as metadata
    updateSpec(selectedSpecId, {
      // You might want to add a feedback field to the Specification interface
    })

    rejectSpec(selectedSpecId)
    handleClose()
  }

  const handleAddTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()])
      setNewTag('')
    }
  }

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove))
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddTag()
    }
  }

  if (!showApprovalDialog || !selectedSpec) {
    return null
  }

  return (
    <Dialog open={showApprovalDialog} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl glass-card border border-white/20">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <FileText className="h-5 w-5" />
            <span>Review Specification</span>
          </DialogTitle>
          <DialogDescription>
            Review and approve or reject this specification before implementation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Spec Info */}
          <Card className="p-4 glass-card">
            <div className="space-y-3">
              <div>
                <h3 className="font-medium text-lg">{selectedSpec.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedSpec.description}
                </p>
              </div>

              <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                <div className="flex items-center space-x-1">
                  <Calendar className="h-4 w-4" />
                  <span>
                    Created {new Intl.DateTimeFormat('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    }).format(selectedSpec.createdAt)}
                  </span>
                </div>
                <div className="flex items-center space-x-1">
                  <FileText className="h-4 w-4" />
                  <span>v{selectedSpec.version}</span>
                </div>
              </div>

              {selectedSpec.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedSpec.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Content Preview */}
          <Card className="p-4 glass-card">
            <h4 className="font-medium mb-2">Content Preview</h4>
            <div className="bg-white/5 rounded border border-white/20 p-3 max-h-32 overflow-y-auto">
              <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-mono">
                {selectedSpec.content.substring(0, 300)}
                {selectedSpec.content.length > 300 && '...'}
              </pre>
            </div>
          </Card>

          {/* Rating */}
          <Card className="p-4 glass-card">
            <h4 className="font-medium mb-2">Quality Rating</h4>
            <div className="flex items-center space-x-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  className={cn(
                    "p-1 rounded",
                    star <= rating
                      ? "text-yellow-500"
                      : "text-muted-foreground hover:text-yellow-400"
                  )}
                >
                  <Star className="h-5 w-5" fill={star <= rating ? 'currentColor' : 'none'} />
                </button>
              ))}
              <span className="text-sm text-muted-foreground ml-2">
                {rating > 0 && `${rating} out of 5 stars`}
              </span>
            </div>
          </Card>

          {/* Tags */}
          <Card className="p-4 glass-card">
            <h4 className="font-medium mb-2">Add Tags</h4>
            <div className="space-y-2">
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Add a tag..."
                  className="flex-1 px-3 py-1 bg-white/5 border border-white/20 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <Button
                  onClick={handleAddTag}
                  disabled={!newTag.trim()}
                  size="sm"
                  variant="outline"
                  className="glass-button"
                >
                  <Tag className="h-4 w-4" />
                </Button>
              </div>

              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs px-2 py-1 rounded-full bg-secondary/50 flex items-center space-x-1 cursor-pointer hover:bg-secondary/70"
                      onClick={() => removeTag(tag)}
                    >
                      <span>{tag}</span>
                      <XCircle className="h-3 w-3" />
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Feedback */}
          <Card className="p-4 glass-card">
            <h4 className="font-medium mb-2">Feedback (Optional)</h4>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Add any comments, suggestions, or feedback..."
              className="w-full h-24 px-3 py-2 bg-white/5 border border-white/20 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
          </Card>

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-white/10">
            <div className="text-sm text-muted-foreground">
              This action cannot be undone
            </div>

            <div className="flex space-x-3">
              <Button
                onClick={handleClose}
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
              >
                Cancel
              </Button>

              <Button
                onClick={handleReject}
                variant="outline"
                className="text-red-500 border-red-500/50 hover:bg-red-500/10"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Reject
              </Button>

              <Button
                onClick={handleApprove}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Approve
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}