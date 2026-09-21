import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_SUBDIR,
  getFilenameDerivedFragmentId,
  getFragmentFileName,
  getFragmentFolder,
  getProseFragmentIdFromFileName,
  getTypeForVisibleFolder,
  getVisibleFragmentBaseName,
  INTERNAL_MARKDOWN_DIRS,
  isVisibleFilenameDerivedType,
  MARKDOWN_FRAGMENT_DIRS,
  STORY_DIRS,
} from '@/server/md-files/fragment-layout'

describe('md fragment layout', () => {
  it('maps fragment types to visible and internal folders', () => {
    expect(ARCHIVE_SUBDIR).toBe('Archive')
    expect(STORY_DIRS).toEqual(['Guidelines', 'Characters', 'Lorebook', 'Prose'])
    expect(INTERNAL_MARKDOWN_DIRS).toEqual([
      join('.errata', 'Markers'),
      join('.errata', 'Images'),
      join('.errata', 'Icons'),
      join('.errata', 'Fragments'),
    ])
    expect(MARKDOWN_FRAGMENT_DIRS).toEqual([...STORY_DIRS, ...INTERNAL_MARKDOWN_DIRS])

    expect(getFragmentFolder('character')).toBe('Characters')
    expect(getFragmentFolder('guideline')).toBe('Guidelines')
    expect(getFragmentFolder('marker')).toBe(join('.errata', 'Markers'))
    expect(getFragmentFolder('custom')).toBe(join('.errata', 'Fragments'))
    expect(getTypeForVisibleFolder('Lorebook')).toBe('knowledge')
    expect(getTypeForVisibleFolder(join('.errata', 'Markers'))).toBeNull()
  })

  it('encodes and decodes visible and prose filenames consistently', () => {
    expect(isVisibleFilenameDerivedType('character')).toBe(true)
    expect(isVisibleFilenameDerivedType('marker')).toBe(false)

    expect(getVisibleFragmentBaseName({ name: 'Io:Dren/<>', type: 'character' } as never)).toBe('Io Dren')
    expect(getFilenameDerivedFragmentId('character', 'Io Dren.md')).toBe('ch-io-dren')
    expect(getFilenameDerivedFragmentId('guideline', 'Scene Discipline.md')).toBe('gl-scene-discipline')
    expect(getProseFragmentIdFromFileName('0007-pr-opening.md')).toBe('pr-opening')

    expect(getFragmentFileName({
      id: 'pr-opening',
      type: 'prose',
      order: 7,
    } as never)).toBe('0007-pr-opening.md')

    expect(getFragmentFileName({
      id: 'ch-io-dren',
      type: 'character',
      name: 'Io Dren',
    } as never)).toBe('Io Dren.md')

    expect(getFragmentFileName({
      id: 'mk-note',
      type: 'marker',
      order: 2,
    } as never, 5)).toBe('0005-mk-note.md')

    expect(getFragmentFileName({
      id: 'custom-id',
      type: 'custom',
      name: 'Ignored',
    } as never)).toBe('custom-id.md')
  })
})