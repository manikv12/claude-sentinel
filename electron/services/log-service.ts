/**
 * Auto-Renewal focused logging service for Claude Sentinel
 * Stores logs in app data folder with daily rotation
 */

import { existsSync, writeFileSync, appendFileSync, readFileSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

const LOG_DIR = join(app.getPath('userData'), 'logs')
const MAX_LOG_DAYS = 30

export interface RenewalLogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  category: 'schedule' | 'service' | 'renewal' | 'session'
}

class RenewalLogService {
  private logsDir: string

  constructor() {
    this.logsDir = LOG_DIR
    this.ensureLogDirectory()
    this.cleanOldLogs()
  }

  private ensureLogDirectory() {
    try {
      if (!existsSync(this.logsDir)) {
        require('fs').mkdirSync(this.logsDir, { recursive: true })
      }
    } catch (error) {
      console.error('Failed to create logs directory:', error)
    }
  }

  private getTodayLogFile(): string {
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
    return join(this.logsDir, `${today}.log`)
  }

  private formatLogEntry(level: RenewalLogEntry['level'], message: string, category: RenewalLogEntry['category']): string {
    const timestamp = new Date().toISOString().replace('T', ' ').replace(/\..+/, '')
    return `[${timestamp}] [${level.toUpperCase()}] [${category.toUpperCase()}] ${message}\n`
  }

  log(level: RenewalLogEntry['level'], message: string, category: RenewalLogEntry['category'] = 'service') {
    try {
      const logFile = this.getTodayLogFile()
      const logEntry = this.formatLogEntry(level, message, category)
      
      appendFileSync(logFile, logEntry)
      
      // Also log to console in development
      if (process.env.NODE_ENV === 'development') {
        console.log(`[RENEWAL LOG] ${logEntry.trim()}`)
      }
    } catch (error) {
      console.error('Failed to write to renewal log:', error)
    }
  }

  info(message: string, category: RenewalLogEntry['category'] = 'service') {
    this.log('info', message, category)
  }

  warn(message: string, category: RenewalLogEntry['category'] = 'service') {
    this.log('warn', message, category)
  }

  error(message: string, category: RenewalLogEntry['category'] = 'service') {
    this.log('error', message, category)
  }

  // Get all log entries from recent days
  getAllLogs(days: number = 7): RenewalLogEntry[] {
    const logs: RenewalLogEntry[] = []
    const endDate = new Date()
    
    try {
      for (let i = 0; i < days; i++) {
        const date = new Date(endDate)
        date.setDate(date.getDate() - i)
        const dateStr = date.toISOString().split('T')[0]
        const logFile = join(this.logsDir, `${dateStr}.log`)
        
        if (existsSync(logFile)) {
          const content = readFileSync(logFile, 'utf-8')
          const lines = content.trim().split('\n').filter(line => line.trim())
          
          for (const line of lines) {
            const parsed = this.parseLogLine(line)
            if (parsed) {
              logs.push(parsed)
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to read logs:', error)
    }
    
    // Sort by timestamp (newest first)
    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }

  private parseLogLine(line: string): RenewalLogEntry | null {
    try {
      // Parse format: [2025-01-10 14:30:00] [INFO] [RENEWAL] Message
      const match = line.match(/^\[(.+?)\] \[(.+?)\] \[(.+?)\] (.+)$/)
      if (!match) return null
      
      const [, timestamp, level, category, message] = match
      
      return {
        timestamp: timestamp.replace(' ', 'T') + 'Z', // Convert to ISO format
        level: level.toLowerCase() as RenewalLogEntry['level'],
        message: message.trim(),
        category: category.toLowerCase() as RenewalLogEntry['category']
      }
    } catch (error) {
      return null
    }
  }

  // Export logs as formatted text
  exportLogs(logs: RenewalLogEntry[]): string {
    return logs.map(log => {
      const timestamp = new Date(log.timestamp).toLocaleString()
      return `${timestamp} [${log.level.toUpperCase()}] [${log.category.toUpperCase()}] ${log.message}`
    }).join('\n')
  }

  // Clean up logs older than MAX_LOG_DAYS
  private cleanOldLogs() {
    try {
      if (!existsSync(this.logsDir)) return
      
      const files = readdirSync(this.logsDir)
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - MAX_LOG_DAYS)
      
      for (const file of files) {
        if (file.endsWith('.log')) {
          const dateStr = file.replace('.log', '')
          const fileDate = new Date(dateStr)
          
          if (fileDate < cutoffDate) {
            const filePath = join(this.logsDir, file)
            unlinkSync(filePath)
          }
        }
      }
    } catch (error) {
      console.error('Failed to clean old logs:', error)
    }
  }

  // Clear logs before a specific date
  clearLogsBefore(beforeDate: Date): void {
    try {
      if (!existsSync(this.logsDir)) return
      
      const files = readdirSync(this.logsDir)
      
      for (const file of files) {
        if (file.endsWith('.log')) {
          const dateStr = file.replace('.log', '')
          const fileDate = new Date(dateStr)
          
          if (fileDate < beforeDate) {
            const filePath = join(this.logsDir, file)
            unlinkSync(filePath)
          }
        }
      }
    } catch (error) {
      console.error('Failed to clear logs:', error)
    }
  }

  // Get logs directory path for display
  getLogsPath(): string {
    return this.logsDir
  }
}

// Export singleton instance
export const renewalLogger = new RenewalLogService()