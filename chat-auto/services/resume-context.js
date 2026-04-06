import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { config } from '../core/config.js'

const execFileAsync = promisify(execFile)
let cached = null

const normalize = text =>
  String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const readTextLikeFile = async filePath => {
  const raw = await fs.readFile(filePath, 'utf8')
  return normalize(raw)
}

const readPdfViaPdftotext = async filePath => {
  try {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', '-nopgbrk', filePath, '-'])
    return normalize(stdout)
  } catch {
    return ''
  }
}

const readResumeRaw = async filePath => {
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.txt' || ext === '.md') {
    return readTextLikeFile(filePath)
  }

  if (ext === '.pdf') {
    return readPdfViaPdftotext(filePath)
  }

  return readTextLikeFile(filePath).catch(() => '')
}

const compactResume = text => {
  const normalized = normalize(text)
  if (!normalized) {
    return ''
  }

  return normalized.slice(0, 6000)
}

export const loadResumeContext = async () => {
  if (cached !== null) {
    return cached
  }

  if (!config.resumeFile) {
    cached = ''
    return cached
  }

  const raw = await readResumeRaw(config.resumeFile).catch(() => '')
  cached = compactResume(raw)
  return cached
}
