import type { Fragment } from '@/server/fragments/schema'

export interface ProseMarkdownMeta {
  generatedFrom?: string
  summary?: string
}

export interface ProseFragmentInternalRecord {
  id: string
  name: string
  description: string
  tags: string[]
  refs: string[]
  sticky: boolean
  placement: 'system' | 'user'
  createdAt: string
  updatedAt: string
  order: number
  meta: Record<string, unknown>
  archived: boolean
}

function parseLegacyGeneratedFrom(attributes: Record<string, unknown>): string | undefined {
  if (typeof attributes.generatedFrom === 'string') return attributes.generatedFrom
  const meta = typeof attributes.meta === 'object' && attributes.meta !== null
    ? attributes.meta as Record<string, unknown>
    : null
  return typeof meta?.generatedFrom === 'string' ? meta.generatedFrom : undefined
}

function parseLegacySummary(attributes: Record<string, unknown>): string | undefined {
  if (typeof attributes.summary === 'string') return attributes.summary

  const meta = typeof attributes.meta === 'object' && attributes.meta !== null
    ? attributes.meta as Record<string, unknown>
    : null
  const librarian = typeof meta?._librarian === 'object' && meta._librarian !== null
    ? meta._librarian as Record<string, unknown>
    : null
  return typeof librarian?.summary === 'string' ? librarian.summary : undefined
}

export function extractProseMarkdownMeta(attributes: Record<string, unknown>): ProseMarkdownMeta {
  return {
    generatedFrom: parseLegacyGeneratedFrom(attributes),
    summary: parseLegacySummary(attributes),
  }
}

export function splitProseInternalMeta(meta: Record<string, unknown>): {
  markdownMeta: Record<string, unknown>
  internalMeta: Record<string, unknown>
} {
  const internalMeta = { ...meta }
  const generatedFrom = typeof internalMeta.generatedFrom === 'string' ? internalMeta.generatedFrom : undefined
  delete internalMeta.generatedFrom

  const librarian = typeof internalMeta._librarian === 'object' && internalMeta._librarian !== null
    ? { ...(internalMeta._librarian as Record<string, unknown>) }
    : null
  const summary = typeof librarian?.summary === 'string' ? librarian.summary : undefined

  if (librarian) {
    delete librarian.summary
    if (Object.keys(librarian).length > 0) internalMeta._librarian = librarian
    else delete internalMeta._librarian
  }

  return {
    markdownMeta: {
      ...(generatedFrom !== undefined ? { generatedFrom } : {}),
      ...(summary !== undefined ? { summary } : {}),
    },
    internalMeta,
  }
}

export function mergeVisibleProseMeta(meta: Record<string, unknown>, markdownMeta: ProseMarkdownMeta): Record<string, unknown> {
  const merged = { ...meta }

  if (markdownMeta.generatedFrom !== undefined) merged.generatedFrom = markdownMeta.generatedFrom
  else delete merged.generatedFrom

  const librarian = typeof merged._librarian === 'object' && merged._librarian !== null
    ? { ...(merged._librarian as Record<string, unknown>) }
    : {}

  if (markdownMeta.summary !== undefined) {
    librarian.summary = markdownMeta.summary
    merged._librarian = librarian
  } else if (Object.keys(librarian).length > 0) {
    merged._librarian = librarian
  } else {
    delete merged._librarian
  }

  return merged
}

export function buildProseInternalRecord(fragment: Fragment): ProseFragmentInternalRecord {
  const { internalMeta } = splitProseInternalMeta(fragment.meta)
  return {
    id: fragment.id,
    name: fragment.name,
    description: fragment.description,
    tags: fragment.tags,
    refs: fragment.refs,
    sticky: fragment.sticky,
    placement: fragment.placement,
    createdAt: fragment.createdAt,
    updatedAt: fragment.updatedAt,
    order: fragment.order,
    meta: internalMeta,
    archived: fragment.archived ?? false,
  }
}

export function proseFragmentFromMarkdown(
  fragmentId: string,
  attributes: Record<string, unknown>,
  body: string,
  internalRecord: ProseFragmentInternalRecord | undefined,
  fallback: (attributes: Record<string, unknown>, body: string) => Fragment | null,
): Fragment {
  const markdownMeta = extractProseMarkdownMeta(attributes)

  if (internalRecord) {
    return {
      id: internalRecord.id,
      type: 'prose',
      name: internalRecord.name,
      description: internalRecord.description,
      content: body,
      tags: internalRecord.tags,
      refs: internalRecord.refs,
      sticky: internalRecord.sticky,
      placement: internalRecord.placement,
      createdAt: internalRecord.createdAt,
      updatedAt: internalRecord.updatedAt,
      order: internalRecord.order,
      meta: mergeVisibleProseMeta(internalRecord.meta, markdownMeta),
      archived: internalRecord.archived,
      version: 1,
      versions: [],
    }
  }

  const legacy = fallback(attributes, body)
  if (legacy) {
    return {
      ...legacy,
      id: fragmentId,
      type: 'prose',
      meta: mergeVisibleProseMeta(legacy.meta, markdownMeta),
    }
  }

  const now = new Date().toISOString()
  return {
    id: fragmentId,
    type: 'prose',
    name: fragmentId,
    description: '',
    content: body,
    tags: [],
    refs: [],
    sticky: false,
    placement: 'user',
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: mergeVisibleProseMeta({}, markdownMeta),
    archived: false,
    version: 1,
    versions: [],
  }
}