import React, { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useSpecStore } from '@/stores/specStore'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import {
  Send,
  Bot,
  User,
  Terminal,
  Loader2,
  FileText,
  CheckCircle2,
  AlertCircle,
  Copy,
  Trash2
} from 'lucide-react'

const SPEC_COMMANDS = [
  {
    command: '/specify',
    description: 'Generate a new specification',
    example: '/specify Build a photo organization application'
  },
  {
    command: '/plan',
    description: 'Create a technical implementation plan',
    example: '/plan Use React with TypeScript and Vite'
  },
  {
    command: '/tasks',
    description: 'Break down into actionable tasks',
    example: '/tasks Create user authentication system'
  },
  {
    command: '/refine',
    description: 'Refine existing specification',
    example: '/refine Add mobile responsiveness requirements'
  }
]

export function SpecChat() {
  const [input, setInput] = useState('')
  const [showCommands, setShowCommands] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const {
    messages,
    isGenerating,
    addMessage,
    executeCommand,
    clearMessages,
  } = useSpecStore()

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isGenerating) return

    const trimmedInput = input.trim()

    // Check if it's a command
    if (trimmedInput.startsWith('/')) {
      const [command, ...contentParts] = trimmedInput.split(' ')
      const content = contentParts.join(' ')

      if (SPEC_COMMANDS.some(cmd => cmd.command === command)) {
        await executeCommand(command, content)
      } else {
        addMessage({
          type: 'system',
          content: `Unknown command: ${command}. Available commands: ${SPEC_COMMANDS.map(c => c.command).join(', ')}`
        })
      }
    } else {
      // Regular message
      addMessage({
        type: 'user',
        content: trimmedInput
      })

      // Simulate assistant response (replace with actual Claude API integration)
      setTimeout(() => {
        addMessage({
          type: 'assistant',
          content: `I understand you want to work on: "${trimmedInput}". Would you like me to create a specification using \`/specify ${trimmedInput}\` or help you with a specific command?`
        })
      }, 1000)
    }

    setInput('')
    setShowCommands(false)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInput(value)
    setShowCommands(value.startsWith('/') && value.length > 1)
  }

  const insertCommand = (command: string) => {
    setInput(command + ' ')
    setShowCommands(false)
    inputRef.current?.focus()
  }

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content)
  }

  const formatTimestamp = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Chat Header */}
      <div className="p-4 border-b border-white/10 bg-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Bot className="h-5 w-5 text-primary" />
            <span className="font-medium">Spec Assistant</span>
            {isGenerating && (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearMessages}
            className="text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">Welcome to Spec Development</h3>
            <p className="mb-4">
              Start by typing a command or describing what you want to build.
            </p>
            <div className="space-y-2">
              <p className="text-sm">Try these commands:</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SPEC_COMMANDS.slice(0, 3).map((cmd) => (
                  <Button
                    key={cmd.command}
                    variant="outline"
                    size="sm"
                    onClick={() => insertCommand(cmd.command)}
                    className="text-xs glass-button"
                  >
                    {cmd.command}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex items-start space-x-3",
                message.type === 'user' && "flex-row-reverse space-x-reverse"
              )}
            >
              <div className={cn(
                "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
                message.type === 'user'
                  ? "bg-primary text-primary-foreground"
                  : message.type === 'system'
                  ? "bg-orange-500 text-white"
                  : "bg-white/10 border border-white/20"
              )}>
                {message.type === 'user' ? (
                  <User className="h-4 w-4" />
                ) : message.type === 'system' ? (
                  <AlertCircle className="h-4 w-4" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
              </div>

              <Card className={cn(
                "max-w-[80%] p-3 glass-card",
                message.type === 'user' && "bg-primary/10 border-primary/20"
              )}>
                <div className="space-y-2">
                  {message.metadata?.command && (
                    <div className="flex items-center space-x-2 text-xs">
                      <Terminal className="h-3 w-3" />
                      <span className="font-mono text-primary">
                        {message.metadata.command}
                      </span>
                    </div>
                  )}

                  <div className="text-sm whitespace-pre-wrap">
                    {message.content}
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatTimestamp(message.timestamp)}</span>
                    <div className="flex items-center space-x-1">
                      {message.metadata?.tokens && (
                        <span>{message.metadata.tokens} tokens</span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyMessage(message.content)}
                        className="h-auto p-1 hover:bg-white/10"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          ))
        )}

        {isGenerating && (
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-white/10 border border-white/20">
              <Bot className="h-4 w-4" />
            </div>
            <Card className="p-3 glass-card">
              <div className="flex items-center space-x-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">
                  Generating response...
                </span>
              </div>
            </Card>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Command Suggestions */}
      {showCommands && (
        <div className="border-t border-white/10 bg-white/5 p-2">
          <div className="text-xs text-muted-foreground mb-2">Available Commands:</div>
          <div className="space-y-1">
            {SPEC_COMMANDS
              .filter(cmd => cmd.command.startsWith(input.split(' ')[0]))
              .map((cmd) => (
                <button
                  key={cmd.command}
                  onClick={() => insertCommand(cmd.command)}
                  className="w-full text-left p-2 rounded hover:bg-white/10 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-mono text-primary">
                        {cmd.command}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {cmd.description}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-white/10">
        <div className="flex space-x-2">
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={handleInputChange}
              placeholder="Type a command like /specify or describe what you want to build..."
              className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 text-sm"
              disabled={isGenerating}
            />
          </div>
          <Button
            type="submit"
            disabled={!input.trim() || isGenerating}
            className="glass-button"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="mt-2 text-xs text-muted-foreground">
          Start with <span className="font-mono">/specify</span> to create a new specification
        </div>
      </form>
    </div>
  )
}