import { zipSync, unzipSync } from 'fflate'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createStory, getStory } from '../fragments/storage'
import { getBranchesIndex } from '../fragments/branches'
import { StoryMetaSchema, type StoryMeta } from '../fragments/schema'
import { parseFrontmatter } from '../md-files/frontmatter'
import * as storyMeta from '../md-files/story-meta'
import * as archiveFormat from './archive-format'
import * as archiveImport from './archive-import'
import * as storyLayout from '../storage/story-layout'

async function readTree(root: string, relative = ''): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {}
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const next = relative ? join(relative, entry.name) : entry.name
    if (entry.isDirectory()) Object.assign(files, await readTree(root, next))
    else files[next.replace(/\\/g, '/')] = new Uint8Array(await readFile(join(root, next)))
  }
  return files
}

export interface ExportResult {
  buffer: Uint8Array
  filename: string
}

export async function exportStoryAsZip(
  dataDir: string,
  storyId: string,
): Promise<ExportResult> {
  const storyDir = storyLayout.getStoryDir(dataDir, storyId)
  const story = await getStory(dataDir, storyId)
  if (!story) {
    throw new Error(`Story not found: ${storyId}`)
  }

  const files = Object.fromEntries(
    Object.entries(await readTree(storyDir)).map(([relativePath, content]) => [
      archiveFormat.getStoryArchiveEntryPath(relativePath),
      content,
    ] as const),
  )

  const branchesIndex = await getBranchesIndex(dataDir, storyId)
  files[archiveFormat.getStoryArchiveEntryPath('branches.json')] = new TextEncoder().encode(
    JSON.stringify(branchesIndex, null, 2),
  )

  const buffer = zipSync(files)

  let storyName = storyId
  if (story) {
    storyName = story.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50)
  }

  return {
    buffer,
    filename: `errata-${storyName}.zip`,
  }
}

export async function importStoryFromZip(
  dataDir: string,
  zipBuffer: Uint8Array,
): Promise<StoryMeta> {
  const extracted = unzipSync(zipBuffer)

  const paths = Object.keys(extracted)
  const decoder = new TextDecoder()

  const originalMeta = readStoryMetaFromArchive(paths, extracted, decoder)

  const newStoryId = `story-${Date.now().toString(36)}`
  const now = new Date().toISOString()

  const importMode = archiveFormat.detectStoryArchiveImportMode(paths)
  if (!importMode) {
    throw new Error('Invalid archive: only current Errata story archives are supported')
  }

  const newMeta: StoryMeta = {
    ...originalMeta,
    id: newStoryId,
    name: originalMeta.name + ' (imported)',
    createdAt: now,
    updatedAt: now,
    settings: {
      ...originalMeta.settings,
      providerId: null,
      modelId: null,
    },
  }

  await createStory(dataDir, newMeta)

  if (importMode.type === 'branched') {
    await archiveImport.importBranchedArchiveIntoStory(dataDir, newStoryId, extracted, decoder, importMode.branchesKey)
  } else {
    await archiveImport.importMarkdownArchiveIntoStory(dataDir, newStoryId, extracted)
  }

  return newMeta
}

function readStoryMetaFromArchive(
  paths: string[],
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
): StoryMeta {
  const storyMetaKey = archiveFormat.getStoryMetaArchiveKey(paths)
  if (!storyMetaKey) {
    throw new Error('Invalid archive: missing story metadata')
  }

  const raw = decoder.decode(extracted[storyMetaKey])
  let story: StoryMeta | null
  if (storyMetaKey.endsWith('meta.json')) {
    const parsed = StoryMetaSchema.safeParse(JSON.parse(raw))
    story = parsed.success ? parsed.data : null
  } else {
    const parsed = parseFrontmatter(raw)
    story = storyMeta.storyMetaFromMarkdown(parsed.attributes, parsed.body)
  }
  if (!story) {
    throw new Error('Invalid archive: could not parse story metadata')
  }
  return story
}
