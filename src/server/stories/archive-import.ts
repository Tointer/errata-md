import { dirname, join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { generateFragmentId } from '@/lib/fragment-ids'
import type { Associations, BranchesIndex, Fragment, ProseChain } from '../fragments/schema'
import { createFragment } from '../fragments/storage'
import { saveProseChain } from '../fragments/prose-chain'
import { saveAssociations } from '../fragments/associations'
import * as storyLayout from '../storage/story-layout'
import * as archiveFormat from './archive-format'

async function writeBytes(path: string, content: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

export async function importMarkdownArchiveIntoStory(
  dataDir: string,
  storyId: string,
  extracted: Record<string, Uint8Array>,
): Promise<void> {
  const root = storyLayout.getStoryDir(dataDir, storyId)

  for (const { relativePath, content } of archiveFormat.getMarkdownArchiveEntries(extracted)) {
    await writeBytes(join(root, relativePath), content)
  }
}

export async function importBranchedArchiveIntoStory(
  dataDir: string,
  storyId: string,
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
  branchesKey: string,
): Promise<void> {
  const branchesIndex = JSON.parse(decoder.decode(extracted[branchesKey])) as BranchesIndex
  const idMap = buildBranchFragmentIdMap(extracted, decoder)
  const branchId = branchesIndex.activeBranchId || branchesIndex.branches[0]?.id || 'main'
  const branchPrefix = archiveFormat.findBranchArchivePrefix(Object.keys(extracted), branchId)
  if (!branchPrefix) throw new Error(`Invalid archive: active branch ${branchId} is missing`)

  const fragmentPrefix = `${branchPrefix}/fragments/`
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.startsWith(fragmentPrefix) || !path.endsWith('.json')) continue
    const fragment = JSON.parse(decoder.decode(content)) as Fragment
    const remapped: Fragment = {
      ...fragment,
      id: idMap.get(fragment.id) ?? fragment.id,
      refs: fragment.refs.map((ref) => idMap.get(ref) ?? ref),
      meta: remapMeta(fragment.meta, idMap),
    }
    await createFragment(dataDir, storyId, remapped, { overwrite: true })
  }

  const chainBytes = extracted[`${branchPrefix}/prose-chain.json`]
  if (chainBytes) {
    const chain = JSON.parse(decoder.decode(chainBytes)) as ProseChain
    await saveProseChain(dataDir, storyId, {
      entries: chain.entries.map((entry) => ({
        proseFragments: entry.proseFragments.map((id) => idMap.get(id) ?? id),
        active: idMap.get(entry.active) ?? entry.active,
      })),
    })
  }

  const associationsBytes = extracted[`${branchPrefix}/associations.json`]
  if (associationsBytes) {
    const associations = JSON.parse(decoder.decode(associationsBytes)) as Associations
    await saveAssociations(dataDir, storyId, remapAssociations(associations, idMap))
  }

  // Keep branch-scoped app data (agent configuration, librarian state, logs,
  // and future upstream files) in the Markdown vault's hidden internal area.
  const internalRoot = storyLayout.getStoryInternalDir(dataDir, storyId)
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.startsWith(`${branchPrefix}/`)) continue
    const relativePath = path.slice(branchPrefix.length + 1)
    if (relativePath.startsWith('fragments/')
      || relativePath === 'prose-chain.json'
      || relativePath === 'associations.json') continue

    if (relativePath.startsWith('generation-logs/') && relativePath.endsWith('.json')) {
      const logData = JSON.parse(decoder.decode(content)) as { fragmentId?: string }
      if (logData.fragmentId) logData.fragmentId = idMap.get(logData.fragmentId) ?? logData.fragmentId
      await writeBytes(join(internalRoot, relativePath), new TextEncoder().encode(JSON.stringify(logData, null, 2)))
    } else {
      await writeBytes(join(internalRoot, relativePath), content)
    }
  }
}

function buildBranchFragmentIdMap(
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
): Map<string, string> {
  const idMap = new Map<string, string>()

  for (const [path, content] of Object.entries(extracted)) {
    if (!path.includes('/branches/') || !path.includes('/fragments/') || !path.endsWith('.json')) continue

    const fragment = JSON.parse(decoder.decode(content)) as Fragment
    if (!idMap.has(fragment.id)) {
      idMap.set(fragment.id, generateFragmentId(fragment.type, fragment.name))
    }
  }

  return idMap
}

function remapMeta(
  meta: Record<string, unknown>,
  idMap: Map<string, string>,
): Record<string, unknown> {
  const result = { ...meta }

  if (Array.isArray(result.visualRefs)) {
    result.visualRefs = (result.visualRefs as Array<Record<string, unknown>>).map((ref) => ({
      ...ref,
      fragmentId: idMap.get(ref.fragmentId as string) ?? ref.fragmentId,
    }))
  }

  if (typeof result.previousFragmentId === 'string' && idMap.has(result.previousFragmentId)) {
    result.previousFragmentId = idMap.get(result.previousFragmentId)
  }

  if (typeof result.variationOf === 'string' && idMap.has(result.variationOf)) {
    result.variationOf = idMap.get(result.variationOf)
  }

  return result
}

function remapAssociations(
  associations: Associations,
  idMap: Map<string, string>,
): Associations {
  const newTagIndex: Record<string, string[]> = {}
  for (const [tag, ids] of Object.entries(associations.tagIndex)) {
    newTagIndex[tag] = ids.map((id) => idMap.get(id) ?? id)
  }

  const newRefIndex: Record<string, string[]> = {}
  for (const [key, ids] of Object.entries(associations.refIndex)) {
    let newKey = key
    if (key.startsWith('__backref:')) {
      const oldId = key.slice('__backref:'.length)
      const newId = idMap.get(oldId) ?? oldId
      newKey = `__backref:${newId}`
    } else if (idMap.has(key)) {
      newKey = idMap.get(key) ?? key
    }

    newRefIndex[newKey] = ids.map((id) => idMap.get(id) ?? id)
  }

  return { tagIndex: newTagIndex, refIndex: newRefIndex }
}
