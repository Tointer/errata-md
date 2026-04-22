import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { instructionRegistry } from '../../src/server/instructions/registry'
import { createTempDir } from '../setup'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

describe('InstructionRegistry', () => {
  beforeEach(() => {
    instructionRegistry.clear()
  })

  describe('registerDefault + resolve', () => {
    it('returns default text for a registered key', () => {
      instructionRegistry.registerDefault('test.key', 'Hello world')
      expect(instructionRegistry.resolve('test.key')).toBe('Hello world')
    })

    it('throws for an unregistered key', () => {
      expect(() => instructionRegistry.resolve('nonexistent')).toThrow(
        'Instruction key "nonexistent" not registered',
      )
    })

    it('resolve with no modelId returns default', () => {
      instructionRegistry.registerDefault('test.key', 'default text')
      expect(instructionRegistry.resolve('test.key')).toBe('default text')
      expect(instructionRegistry.resolve('test.key', undefined)).toBe('default text')
    })

    it('resolve with unmatched modelId returns default', () => {
      instructionRegistry.registerDefault('test.key', 'default text')
      expect(instructionRegistry.resolve('test.key', 'some-model')).toBe('default text')
    })
  })

  describe('getDefault', () => {
    it('returns the default text', () => {
      instructionRegistry.registerDefault('test.key', 'text')
      expect(instructionRegistry.getDefault('test.key')).toBe('text')
    })

    it('returns undefined for unregistered key', () => {
      expect(instructionRegistry.getDefault('nonexistent')).toBeUndefined()
    })
  })

  describe('listKeys', () => {
    it('returns all registered keys', () => {
      instructionRegistry.registerDefault('a', 'text-a')
      instructionRegistry.registerDefault('b', 'text-b')
      expect(instructionRegistry.listKeys()).toEqual(expect.arrayContaining(['a', 'b']))
      expect(instructionRegistry.listKeys()).toHaveLength(2)
    })
  })

  describe('overrides', () => {
    let tempDir: { path: string; cleanup: () => Promise<void> }

    beforeEach(async () => {
      tempDir = await createTempDir()
    })

    afterEach(async () => {
      await tempDir.cleanup()
    })

    async function writeOverride(filename: string, data: unknown) {
      const dir = join(tempDir.path, 'instruction-sets')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, filename), JSON.stringify(data))
    }

    it('exact-match override returns override text', async () => {
      instructionRegistry.registerDefault('test.key', 'default')
      await writeOverride('exact.json', {
        name: 'Exact Match',
        modelMatch: 'deepseek-chat',
        priority: 100,
        instructions: { 'test.key': 'overridden' },
      })
      await instructionRegistry.loadOverrides(tempDir.path)

      expect(instructionRegistry.resolve('test.key', 'deepseek-chat')).toBe('overridden')
      expect(instructionRegistry.resolve('test.key', 'other-model')).toBe('default')
    })

    it('regex-match override returns override text (case insensitive)', async () => {
      instructionRegistry.registerDefault('test.key', 'default')
      await writeOverride('regex.json', {
        name: 'Regex Match',
        modelMatch: '/deepseek-.*/i',
        priority: 100,
        instructions: { 'test.key': 'regex-overridden' },
      })
      await instructionRegistry.loadOverrides(tempDir.path)

      expect(instructionRegistry.resolve('test.key', 'deepseek-chat')).toBe('regex-overridden')
      expect(instructionRegistry.resolve('test.key', 'DeepSeek-V2')).toBe('regex-overridden')
      expect(instructionRegistry.resolve('test.key', 'gpt-4')).toBe('default')
    })

    it('priority ordering: lower priority number wins', async () => {
      instructionRegistry.registerDefault('test.key', 'default')
      await writeOverride('high-priority.json', {
        name: 'High Priority',
        modelMatch: '/deepseek-.*/i',
        priority: 10,
        instructions: { 'test.key': 'high-priority' },
      })
      await writeOverride('low-priority.json', {
        name: 'Low Priority',
        modelMatch: '/deepseek-.*/i',
        priority: 200,
        instructions: { 'test.key': 'low-priority' },
      })
      await instructionRegistry.loadOverrides(tempDir.path)

      expect(instructionRegistry.resolve('test.key', 'deepseek-chat')).toBe('high-priority')
    })

    it('override only applies to its keys, others fall through to default', async () => {
      instructionRegistry.registerDefault('test.a', 'default-a')
      instructionRegistry.registerDefault('test.b', 'default-b')
      await writeOverride('partial.json', {
        name: 'Partial',
        modelMatch: 'deepseek-chat',
        priority: 100,
        instructions: { 'test.a': 'overridden-a' },
      })
      await instructionRegistry.loadOverrides(tempDir.path)

      expect(instructionRegistry.resolve('test.a', 'deepseek-chat')).toBe('overridden-a')
      expect(instructionRegistry.resolve('test.b', 'deepseek-chat')).toBe('default-b')
    })

    it('loadOverrides reads JSON files from disk', async () => {
      instructionRegistry.registerDefault('k1', 'default')
      await writeOverride('set1.json', {
        name: 'Set 1',
        modelMatch: 'model-a',
        priority: 100,
        instructions: { k1: 'from-set-1' },
      })
      await writeOverride('set2.json', {
        name: 'Set 2',
        modelMatch: 'model-b',
        priority: 100,
        instructions: { k1: 'from-set-2' },
      })
      await instructionRegistry.loadOverrides(tempDir.path)

      expect(instructionRegistry.resolve('k1', 'model-a')).toBe('from-set-1')
      expect(instructionRegistry.resolve('k1', 'model-b')).toBe('from-set-2')
    })

    it('malformed JSON files are skipped gracefully', async () => {
      instructionRegistry.registerDefault('test.key', 'default')
      const dir = join(tempDir.path, 'instruction-sets')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'bad.json'), '{ invalid json }')
      await writeOverride('good.json', {
        name: 'Good',
        modelMatch: 'model-a',
        priority: 100,
        instructions: { 'test.key': 'good' },
      })
      await instructionRegistry.loadOverrides(tempDir.path)

      expect(instructionRegistry.resolve('test.key', 'model-a')).toBe('good')
    })

    it('missing instruction-sets directory is handled gracefully', async () => {
      instructionRegistry.registerDefault('test.key', 'default')
      // No instruction-sets dir exists — should not throw
      await instructionRegistry.loadOverrides(tempDir.path)
      expect(instructionRegistry.resolve('test.key')).toBe('default')
    })

    it('files with invalid schema are skipped', async () => {
      instructionRegistry.registerDefault('test.key', 'default')
      await writeOverride('invalid-schema.json', {
        name: '',  // min(1) violation
        modelMatch: 'x',
        instructions: {},
      })
      await instructionRegistry.loadOverrides(tempDir.path)
      expect(instructionRegistry.resolve('test.key')).toBe('default')
    })

    it('non-json files are ignored', async () => {
      instructionRegistry.registerDefault('test.key', 'default')
      const dir = join(tempDir.path, 'instruction-sets')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'readme.txt'), 'not json')
      await instructionRegistry.loadOverrides(tempDir.path)
      expect(instructionRegistry.resolve('test.key')).toBe('default')
    })
  })

  describe('clear', () => {
    it('resets all state', async () => {
      instructionRegistry.registerDefault('test.key', 'text')
      expect(instructionRegistry.listKeys()).toHaveLength(1)
      instructionRegistry.clear()
      expect(instructionRegistry.listKeys()).toHaveLength(0)
      expect(instructionRegistry.getDefault('test.key')).toBeUndefined()
    })
  })
})
