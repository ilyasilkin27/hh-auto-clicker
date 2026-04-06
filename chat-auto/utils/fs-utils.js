import fs from 'node:fs/promises'
import path from 'node:path'

export const ensureDir = async filePath => {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
}

export const readJsonFile = async (filePath, fallbackValue) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallbackValue
  }
}

export const writeJsonFileAtomic = async (filePath, value) => {
  await ensureDir(filePath)
  const tempFile = `${filePath}.tmp`
  await fs.writeFile(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await fs.rename(tempFile, filePath)
}

export const appendLine = async (filePath, line) => {
  await ensureDir(filePath)
  await fs.appendFile(filePath, `${line}\n`, 'utf8')
}
