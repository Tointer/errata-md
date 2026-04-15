import { pluginRegistry } from './plugins/registry'
import { loadAllPlugins } from './plugins/loader'
import { clearRuntimePluginUi } from './plugins/runtime-ui'
import { createApp } from './api'
import type { WritingPlugin } from './plugins/types'
import colorPickerPlugin from '../../plugins/color-picker/entry.server'
import dicerollPlugin from '../../plugins/diceroll/entry.server'
import keybindsPlugin from '../../plugins/keybinds/entry.server'
import namesPlugin from '../../plugins/names/entry.server'
import { existsSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

type PluginModule = { default: WritingPlugin }

type ImportMetaWithGlob = ImportMeta & {
  glob?: <T>(pattern: string, options: { eager: true }) => Record<string, T>
}

const fallbackBundledPluginModules: Record<string, PluginModule> = {
  '../../plugins/color-picker/entry.server.ts': { default: colorPickerPlugin },
  '../../plugins/diceroll/entry.server.ts': { default: dicerollPlugin },
  '../../plugins/keybinds/entry.server.ts': { default: keybindsPlugin },
  '../../plugins/names/entry.server.ts': { default: namesPlugin },
}

async function ensureStartupDirectories(dataDir: string, globalDataDir: string, pluginDir?: string) {
  await mkdir(dataDir, { recursive: true })
  await mkdir(join(dataDir, '.errata'), { recursive: true })
  await mkdir(join(dataDir, 'stories'), { recursive: true })
  await mkdir(globalDataDir, { recursive: true })
  await mkdir(join(globalDataDir, 'instruction-sets'), { recursive: true })

  if (pluginDir) {
    await mkdir(pluginDir, { recursive: true })
  }
}

function resolveAppRoot(): string {
  return process.env.ERRATA_APP_ROOT?.trim() || process.cwd()
}

// Discover plugins at build time using Vite's import.meta.glob.
// Adding a new plugin only requires creating plugins/<name>/entry.server.ts — no edits here.
function getBundledPluginModules(): Record<string, PluginModule> | null {
  const viteImportMeta = import.meta as ImportMetaWithGlob
  if (typeof import.meta.glob === 'function') {
    return import.meta.glob<PluginModule>('../../plugins/*/entry.server.ts', { eager: true })
  }

  return viteImportMeta.glob?.<PluginModule>('../../plugins/*/entry.server.ts', { eager: true }) ?? null
}

const pluginModules = getBundledPluginModules()

async function loadBundledPluginsFromFilesystem(): Promise<Array<[string, PluginModule]>> {
  const pluginsDir = join(resolveAppRoot(), 'plugins')
  if (!existsSync(pluginsDir)) {
    return []
  }

  const entries = await readdir(pluginsDir, { withFileTypes: true })
  const modules: Array<[string, PluginModule]> = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const pluginPath = join(pluginsDir, entry.name, 'entry.server.ts')
    try {
      const mod = await import(/* @vite-ignore */ pathToFileURL(pluginPath).href) as PluginModule
      modules.push([pluginPath, mod])
    } catch (error) {
      if (error instanceof Error && /Cannot find module|Cannot find package|ERR_MODULE_NOT_FOUND/i.test(error.message)) {
        continue
      }
      throw error
    }
  }

  return modules
}

async function getBundledPluginEntries(): Promise<Array<[string, PluginModule]>> {
  if (pluginModules) {
    return Object.entries(pluginModules)
  }

  if (Object.keys(fallbackBundledPluginModules).length > 0) {
    return Object.entries(fallbackBundledPluginModules)
  }

  return loadBundledPluginsFromFilesystem()
}

async function registerBundledPlugins(): Promise<void> {
  const bundledEntries = await getBundledPluginEntries()

  for (const [path, mod] of bundledEntries) {
    const plugin = mod.default
    if (plugin?.manifest) {
      pluginRegistry.register(plugin)
    } else {
      console.warn(`[plugins] Skipping ${path}: no valid default export`)
    }
  }
}

export async function initializeApp() {
  const dataDir = process.env.DATA_DIR ?? './data'
  const globalDataDir = process.env.GLOBAL_DATA_DIR ?? dataDir

  // Clear previous registrations (handles Vite HMR re-evaluation)
  pluginRegistry.clear()
  clearRuntimePluginUi()

  await registerBundledPlugins()

  const externalPluginsDir = process.env.PLUGIN_DIR?.trim()
  const allowExternalOverride = process.env.PLUGIN_EXTERNAL_OVERRIDE === '1'

  await ensureStartupDirectories(dataDir, globalDataDir, externalPluginsDir)

  if (externalPluginsDir) {
    try {
      const loaded = await loadAllPlugins(externalPluginsDir)

      let registeredExternal = 0
      let skippedExternal = 0

      for (const plugin of loaded) {
        const existing = pluginRegistry.get(plugin.manifest.name)
        if (existing) {
          if (!allowExternalOverride) {
            skippedExternal++
            console.warn(
              `[plugins] Skipping external plugin "${plugin.manifest.name}" from ${externalPluginsDir}: already registered (set PLUGIN_EXTERNAL_OVERRIDE=1 to replace)`,
            )
            continue
          }

          pluginRegistry.unregister(plugin.manifest.name)
        }

        pluginRegistry.register(plugin)
        registeredExternal++
      }

      console.info(
        `[plugins] Loaded ${registeredExternal} external plugin(s) from ${externalPluginsDir}${skippedExternal ? `, skipped ${skippedExternal}` : ''}`,
      )
    } catch (error) {
      console.error(
        `[plugins] Failed to load external plugins from ${externalPluginsDir}:`,
        error,
      )
    }
  }

  console.info(
    `[plugins] Registered ${pluginRegistry.listAll().length} total plugin(s): ${pluginRegistry
      .listAll()
      .map((p) => p.manifest.name)
      .join(', ') || 'none'}`,
  )

  // Create the app after plugins are loaded, so plugin routes get mounted
  return createApp(dataDir, globalDataDir)
}

let appPromise: Promise<ReturnType<typeof createApp>> | null = null

export function getApp() {
  if (!appPromise) {
    appPromise = initializeApp()
  }
  return appPromise
}
