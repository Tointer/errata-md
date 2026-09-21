import { join } from 'node:path'
import { deriveFragmentIdFromName, usesNameDerivedFragmentId } from '@/lib/fragment-ids'
import type { Fragment } from '@/server/fragments/schema'
import { INTERNAL_DIR } from '../storage/story-layout'

export const ARCHIVE_SUBDIR = 'Archive'

const VISIBLE_FOLDER_BY_TYPE: Record<string, string> = {
  prose: 'Prose',
  character: 'Characters',
  guideline: 'Guidelines',
  knowledge: 'Lorebook',
}

const TYPE_BY_VISIBLE_FOLDER: Record<string, string> = Object.fromEntries(
  Object.entries(VISIBLE_FOLDER_BY_TYPE).map(([type, folder]) => [folder, type]),
)

const INTERNAL_FOLDER_BY_TYPE: Record<string, string> = {
  marker: 'Markers',
  image: 'Images',
  icon: 'Icons',
}

export const STORY_DIRS = [
  'Guidelines',
  'Characters',
  'Lorebook',
  'Prose',
] as const

export const INTERNAL_MARKDOWN_DIRS = [
  join(INTERNAL_DIR, 'Markers'),
  join(INTERNAL_DIR, 'Images'),
  join(INTERNAL_DIR, 'Icons'),
  join(INTERNAL_DIR, 'Fragments'),
]

export const MARKDOWN_FRAGMENT_DIRS = [...STORY_DIRS, ...INTERNAL_MARKDOWN_DIRS]

export function getFragmentFolder(type: string): string {
  const visibleFolder = VISIBLE_FOLDER_BY_TYPE[type]
  if (visibleFolder) return visibleFolder

  const internalFolder = INTERNAL_FOLDER_BY_TYPE[type] ?? 'Fragments'
  return join(INTERNAL_DIR, internalFolder)
}

export function getTypeForVisibleFolder(folder: string): string | null {
  return TYPE_BY_VISIBLE_FOLDER[folder] ?? null
}

export const isVisibleFilenameDerivedType = usesNameDerivedFragmentId

function sanitizeVisibleFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || 'Untitled'
}

export function getVisibleFragmentBaseName(fragment: Fragment): string {
  return sanitizeVisibleFileName(fragment.name)
}

function slugifyVisibleBaseName(baseName: string): string {
  const cleaned = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return cleaned || 'untitled'
}

export function getFilenameDerivedFragmentId(type: string, fileName: string): string {
  const baseName = fileName.replace(/\.md$/i, '')
  return deriveFragmentIdFromName(type, slugifyVisibleBaseName(baseName))
}

function getNumericPrefix(index: number): string {
  return `${String(Math.max(0, index)).padStart(4, '0')}-`
}

export function getFragmentFileName(fragment: Fragment, sectionIndex?: number): string {
  if (fragment.type === 'prose' || fragment.type === 'marker') {
    return `${getNumericPrefix(sectionIndex ?? fragment.order ?? 0)}${fragment.id}.md`
  }

  if (isVisibleFilenameDerivedType(fragment.type)) {
    return `${getVisibleFragmentBaseName(fragment)}.md`
  }

  return `${fragment.id}.md`
}

export function getProseFragmentIdFromFileName(fileName: string): string {
  return fileName.replace(/\.md$/i, '').replace(/^\d{4}-/, '')
}