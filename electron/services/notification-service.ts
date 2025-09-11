/**
 * Notification service for Claude Sentinel
 */

import { Notification } from 'electron'

let notificationsEnabled = true

export function setNotificationsEnabled(enabled: boolean) {
  notificationsEnabled = enabled
}

export function showNotification(title: string, body: string, icon?: string) {
  if (!notificationsEnabled) return
  
  try {
    const notification = new Notification({
      title,
      body,
      icon,
      silent: false
    })
    
    notification.show()
    return notification
  } catch (error) {
    console.error('Failed to show notification:', error)
    return null
  }
}

export function showRenewalNotification(action: string) {
  return showNotification(
    'Claude Auto-Renewal',
    `Auto-renewal action: ${action}`,
    undefined // We'll add an icon later
  )
}

export function showUsageWarning(message: string) {
  return showNotification(
    'Claude Usage Alert',
    message,
    undefined
  )
}