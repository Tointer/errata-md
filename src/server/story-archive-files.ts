import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export async function collectDirectoryFiles(
  dirPath: string,
  zipPrefix: string,
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {}

  async function visitDirectory(currentDir: string, currentPrefix: string): Promise<void> {
    if (!existsSync(currentDir)) return

    const entries = await readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)
      const zipPath = `${currentPrefix}/${entry.name}`
      if (entry.isDirectory()) {
        await visitDirectory(fullPath, zipPath)
      } else {
        files[zipPath] = new Uint8Array(await readFile(fullPath))
      }
    }
  }

  await visitDirectory(dirPath, zipPrefix)
  return files
}

async function ensureParentDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
}

export async function ensureArchiveDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

export async function writeArchiveBytes(path: string, content: Uint8Array): Promise<void> {
  await ensureParentDir(path)
  await writeFile(path, content)
}

export async function writeArchiveJson(path: string, value: unknown): Promise<void> {
  await ensureParentDir(path)
  await writeFile(path, JSON.stringify(value, null, 2), 'utf-8')
}