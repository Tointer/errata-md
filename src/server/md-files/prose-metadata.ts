import type { Fragment } from '@/server/fragments/schema'

export interface ProseMarkdownMeta {
  generatedFrom?: string
  summary?: string
}

export interface ProseFragmentInternalFields {
  name: string
  description: string
  tags: string[]
  refs: string[]
  sticky: boolean
  placement: 'system' | 'user'
  order: number
  meta: Record<string, unknown>
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

export function buildProseInternalFields(fragment: Fragment): ProseFragmentInternalFields {
  const { internalMeta } = splitProseInternalMeta(fragment.meta)
  return {
    name: fragment.name,
    description: fragment.description,
    tags: fragment.tags,
    refs: fragment.refs,
    sticky: fragment.sticky,
    placement: fragment.placement,
    order: fragment.order,
    meta: internalMeta,
  }
}

export function proseFragmentFromMarkdown(
  fragmentId: string,
  attributes: Record<string, unknown>,
  body: string,
  internalFields: ProseFragmentInternalFields | undefined,
  timestamps: { createdAt: string; updatedAt: string },
  fallback: (attributes: Record<string, unknown>, body: string) => Fragment | null,
): Fragment {
  const markdownMeta = extractProseMarkdownMeta(attributes)

  if (internalFields) {
    return {
      id: fragmentId,
      type: 'prose',
      name: internalFields.name,
      description: internalFields.description,
      content: body,
      tags: internalFields.tags,
      refs: internalFields.refs,
      sticky: internalFields.sticky,
      placement: internalFields.placement,
      createdAt: timestamps.createdAt,
      updatedAt: timestamps.updatedAt,
      order: internalFields.order,
      meta: mergeVisibleProseMeta(internalFields.meta, markdownMeta),
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
    createdAt: timestamps.createdAt ?? now,
    updatedAt: timestamps.updatedAt ?? now,
    order: 0,
    meta: mergeVisibleProseMeta({}, markdownMeta),
    version: 1,
    versions: [],
  }
}
