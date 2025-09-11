import { app } from 'electron'

export const isDev = process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true'

export const getAppDataPath = () => {
  return app.getPath('userData')
}

export const getLogsPath = () => {
  return app.getPath('logs')
}

export const getClaudeDataPaths = () => {
  const homedir = require('os').homedir()
  const path = require('path')
  
  // Support multiple Claude data directories
  const possiblePaths = [
    path.join(homedir, '.config', 'claude', 'projects'),
    path.join(homedir, '.claude', 'projects')
  ]
  
  return possiblePaths
}