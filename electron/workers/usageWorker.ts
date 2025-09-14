import { parentPort } from 'node:worker_threads'
import { getRecentUsage, getCurrentBlockInfo, resetUsageCache } from '../../src/lib/ccusage-integration'

type RefreshMessage =
  | { type: 'refresh' }
  | { type: 'hard-refresh' }

if (!parentPort) {
  // Should never happen in a worker, but guard just in case
  throw new Error('usageWorker started without parentPort')
}

parentPort.on('message', async (msg: RefreshMessage) => {
  try {
    if (msg?.type === 'hard-refresh') {
      // Clear caches to force a fresh read
      resetUsageCache()
      // Small delay to allow file writes to settle
      await new Promise((r) => setTimeout(r, 200))
    } else if (msg?.type !== 'refresh') {
      return
    }
    const recentData = await getRecentUsage(30)
    const blockInfo = await getCurrentBlockInfo()

    const data = {
      daily: recentData.daily.map((day: any) => ({
        date: day.date,
        inputTokens: day.inputTokens,
        outputTokens: day.outputTokens,
        totalTokens: day.totalTokens,
        cost: day.cost,
        model: 'mixed',
        sessionsCount: Array.from(day.blocks || new Set()).length
      })),
      summary: {
        totalCost: recentData.totalCost,
        totalTokens: recentData.totalTokens,
        totalSessions: recentData.totalSessions,
        averageTokensPerSession: recentData.totalSessions > 0
          ? recentData.totalTokens / recentData.totalSessions
          : 0
      },
      currentBlock: blockInfo
    }

    parentPort!.postMessage({ ok: true, data })
  } catch (error) {
    parentPort!.postMessage({ ok: false, error: (error as Error)?.message || String(error) })
  }
})
