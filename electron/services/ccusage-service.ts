/**
 * Claude usage service for Electron main process
 */

import { loadUsageData as loadUsageDataLib, getRecentUsage as getRecentUsageLib, getCurrentBlockInfo as getCurrentBlockInfoLib } from '../../src/lib/ccusage-integration'

// Re-export the functions for use in the main process
export const loadUsageData = loadUsageDataLib
export const getRecentUsage = getRecentUsageLib
export const getCurrentBlockInfo = getCurrentBlockInfoLib