#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../core/config.js'
import { writeJsonFileAtomic } from '../utils/fs-utils.js'
import { sendAlert } from '../services/alerts.js'

const parseDate = value => {
  if (!value) return new Date()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

const formatDay = date => date.toISOString().slice(0, 10)

const loadLogs = async () => {
  const filePath = config.logFile

  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return raw
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line))
  } catch {
    return []
  }
}

const buildReport = ({ rows, targetDay }) => {
  const dayRows = rows.filter(row => String(row.timestamp || '').startsWith(targetDay))

  const sent = dayRows.filter(row => row.eventType === 'sent').length
  const drafts = dayRows.filter(row => row.eventType === 'draft_created').length
  const escalations = dayRows.filter(
    row => row.eventType === 'risk_blocked' || row.eventType === 'low_confidence',
  ).length
  const failed = dayRows.filter(row => row.eventType === 'send_fail').length
  const polled = dayRows
    .filter(row => row.eventType === 'poll')
    .reduce((acc, row) => acc + Number(row.count || 0), 0)

  return {
    day: targetDay,
    newChats: polled,
    autoReplies: sent,
    escalations,
    errors: failed,
    drafts,
  }
}

const main = async () => {
  const dayArg = process.argv[2]
  const targetDay = formatDay(parseDate(dayArg))
  const rows = await loadLogs()
  const report = buildReport({ rows, targetDay })

  const outPath = path.join(config.reportDir, `report-${targetDay}.json`)
  await writeJsonFileAtomic(outPath, report)

  if (report.errors > 0 || report.escalations > 0) {
    await sendAlert({
      level: 'INFO',
      message: `Daily report ${targetDay}`,
      details: report,
    })
  }

  console.log(JSON.stringify({ outPath, report }, null, 2))
}

main().catch(error => {
  console.error(`daily-report failed: ${error.message}`)
  process.exitCode = 1
})
