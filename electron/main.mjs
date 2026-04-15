import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appRoot = join(__dirname, '..')

const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? null
const isDev = Boolean(rendererUrl)
const backendOrigin = process.env.ERRATA_API_ORIGIN ?? 'http://127.0.0.1:7739'
const backendUrl = new URL(backendOrigin)
const preloadPath = join(__dirname, 'preload.mjs')
const DESKTOP_STATE_FILE = 'desktop-state.json'
const VAULT_META_DIR = '.errata'
const STORIES_DIR_NAME = 'stories'
const MAX_RECENT_VAULTS = 8

let backendProcess = null
let mainWindow = null
let mainWindowPromise = null
let isSwitchingVault = false

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
}

function getGlobalDataDir() {
  return process.env.GLOBAL_DATA_DIR?.trim() || join(app.getPath('userData'), 'data')
}

function getDesktopStatePath() {
  return join(getGlobalDataDir(), DESKTOP_STATE_FILE)
}

function normalizeVaultPath(vaultPath) {
  return resolve(vaultPath)
}

function getVaultName(vaultPath) {
  const name = basename(vaultPath)
  return name || vaultPath
}

function normalizeRecentVaultPaths(recentVaultPaths, activeVaultPath = null) {
  const normalizedPaths = []
  const seen = new Set()

  for (const candidate of [activeVaultPath, ...(Array.isArray(recentVaultPaths) ? recentVaultPaths : [])]) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      continue
    }

    const normalizedPath = normalizeVaultPath(candidate)
    if (seen.has(normalizedPath)) {
      continue
    }

    seen.add(normalizedPath)
    normalizedPaths.push(normalizedPath)

    if (normalizedPaths.length >= MAX_RECENT_VAULTS) {
      break
    }
  }

  return normalizedPaths
}

function getVaultSummaries(activeVaultPath, recentVaultPaths) {
  return normalizeRecentVaultPaths(recentVaultPaths, activeVaultPath).map((vaultPath) => ({
    path: vaultPath,
    name: getVaultName(vaultPath),
    isActive: vaultPath === activeVaultPath,
  }))
}

async function readDesktopState() {
  try {
    const raw = await readFile(getDesktopStatePath(), 'utf-8')
    const parsed = JSON.parse(raw)
    const activeVaultPath = typeof parsed.activeVaultPath === 'string' ? normalizeVaultPath(parsed.activeVaultPath) : null
    return {
      activeVaultPath,
      recentVaultPaths: normalizeRecentVaultPaths(parsed.recentVaultPaths, activeVaultPath),
    }
  } catch {
    return { activeVaultPath: null, recentVaultPaths: [] }
  }
}

async function writeDesktopState(state) {
  const activeVaultPath = typeof state.activeVaultPath === 'string' ? normalizeVaultPath(state.activeVaultPath) : null
  const recentVaultPaths = normalizeRecentVaultPaths(state.recentVaultPaths, activeVaultPath)

  await mkdir(getGlobalDataDir(), { recursive: true })
  await writeFile(getDesktopStatePath(), JSON.stringify({ activeVaultPath, recentVaultPaths }, null, 2), 'utf-8')
}

async function ensureVaultDirectories(vaultPath) {
  await mkdir(vaultPath, { recursive: true })
  await mkdir(join(vaultPath, VAULT_META_DIR), { recursive: true })
  await mkdir(join(vaultPath, STORIES_DIR_NAME), { recursive: true })
}

async function resolveActiveVaultPath() {
  const configuredVaultPath = process.env.ERRATA_ACTIVE_VAULT?.trim() || process.env.DATA_DIR?.trim()
  if (configuredVaultPath) {
    return normalizeVaultPath(configuredVaultPath)
  }

  const state = await readDesktopState()
  if (state.activeVaultPath) {
    return normalizeVaultPath(state.activeVaultPath)
  }

  return normalizeVaultPath(getGlobalDataDir())
}

async function persistActiveVaultPath(vaultPath) {
  const desktopState = await readDesktopState()
  const normalizedVaultPath = normalizeVaultPath(vaultPath)
  await ensureVaultDirectories(normalizedVaultPath)
  await writeDesktopState({
    activeVaultPath: normalizedVaultPath,
    recentVaultPaths: normalizeRecentVaultPaths(desktopState.recentVaultPaths, normalizedVaultPath),
  })
  return normalizedVaultPath
}

async function removeVaultFromRecents(vaultPath) {
  const desktopState = await readDesktopState()
  const normalizedVaultPath = normalizeVaultPath(vaultPath)

  await writeDesktopState({
    activeVaultPath: desktopState.activeVaultPath,
    recentVaultPaths: desktopState.recentVaultPaths.filter((candidate) => candidate !== normalizedVaultPath),
  })

  return normalizedVaultPath
}

function getDataDir() {
  return process.env.DATA_DIR?.trim() || getGlobalDataDir()
}

function getLogsDir() {
  return join(getGlobalDataDir(), 'logs')
}

function getConfigPath() {
  return join(getGlobalDataDir(), 'config.json')
}

function getMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null
  }

  return mainWindow
}

function focusMainWindow() {
  const window = getMainWindow()
  if (!window) {
    return
  }

  if (window.isMinimized()) {
    window.restore()
  }

  window.focus()
}

function isAppUrl(urlString) {
  try {
    const candidate = new URL(urlString)
    return [rendererUrl, backendOrigin]
      .filter(Boolean)
      .some((value) => new URL(value).origin === candidate.origin)
  } catch {
    return false
  }
}

function isSafeExternalUrl(urlString) {
  try {
    const candidate = new URL(urlString)
    return ['http:', 'https:', 'mailto:'].includes(candidate.protocol)
  } catch {
    return false
  }
}

function openExternalUrl(urlString) {
  if (!isSafeExternalUrl(urlString)) {
    throw new Error(`Blocked external URL: ${urlString}`)
  }

  return shell.openExternal(urlString)
}

function sanitizeDialogFilters(filters) {
  if (!Array.isArray(filters)) {
    return undefined
  }

  return filters
    .filter((filter) => filter && typeof filter.name === 'string' && Array.isArray(filter.extensions))
    .map((filter) => ({
      name: filter.name,
      extensions: filter.extensions.filter((extension) => typeof extension === 'string' && extension.trim().length > 0),
    }))
    .filter((filter) => filter.extensions.length > 0)
}

function sanitizeOpenDialogOptions(options = {}) {
  const allowedProperties = new Set([
    'openFile',
    'openDirectory',
    'multiSelections',
    'showHiddenFiles',
    'createDirectory',
    'promptToCreate',
    'dontAddToRecent',
    'noResolveAliases',
    'treatPackageAsDirectory',
  ])

  return {
    title: typeof options.title === 'string' ? options.title : undefined,
    defaultPath: typeof options.defaultPath === 'string' ? options.defaultPath : undefined,
    buttonLabel: typeof options.buttonLabel === 'string' ? options.buttonLabel : undefined,
    message: typeof options.message === 'string' ? options.message : undefined,
    filters: sanitizeDialogFilters(options.filters),
    properties: Array.isArray(options.properties)
      ? options.properties.filter((property) => allowedProperties.has(property))
      : undefined,
  }
}

function sanitizeSaveDialogOptions(options = {}) {
  return {
    title: typeof options.title === 'string' ? options.title : undefined,
    defaultPath: typeof options.defaultPath === 'string' ? options.defaultPath : undefined,
    buttonLabel: typeof options.buttonLabel === 'string' ? options.buttonLabel : undefined,
    message: typeof options.message === 'string' ? options.message : undefined,
    filters: sanitizeDialogFilters(options.filters),
  }
}

function normalizeFileContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (content instanceof Uint8Array) {
    return Buffer.from(content)
  }

  if (content instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(content))
  }

  if (ArrayBuffer.isView(content)) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength)
  }

  throw new Error('Unsupported file content payload.')
}

function attachNavigationGuards(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url) && !isAppUrl(url)) {
      void openExternalUrl(url)
    }

    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) {
      return
    }

    event.preventDefault()
    if (isSafeExternalUrl(url)) {
      void openExternalUrl(url)
    }
  })
}

function registerDesktopHandlers() {
  ipcMain.handle('desktop:get-runtime-info', async () => {
    const desktopState = await readDesktopState()
    const activeVaultPath = getDataDir()

    return {
      platform: process.platform,
      apiOrigin: backendOrigin,
      isDev,
      appVersion: app.getVersion(),
      globalDataDir: getGlobalDataDir(),
      dataDir: activeVaultPath,
      logsDir: getLogsDir(),
      configPath: getConfigPath(),
      vaultPath: activeVaultPath,
      vaultName: getVaultName(activeVaultPath),
      recentVaults: getVaultSummaries(activeVaultPath, desktopState.recentVaultPaths),
    }
  })

  ipcMain.handle('desktop:open-external', async (_event, urlString) => {
    await openExternalUrl(urlString)
    return { ok: true }
  })
  ipcMain.handle('desktop:open-path', async (_event, targetPath) => {
    if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
      throw new Error('A target path is required.')
    }

    const openResult = await shell.openPath(normalizeVaultPath(targetPath))
    if (openResult) {
      throw new Error(openResult)
    }

    return { ok: true }
  })
  ipcMain.handle('desktop:remove-vault-from-recents', async (_event, targetPath) => {
    if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
      throw new Error('A vault path is required.')
    }

    await removeVaultFromRecents(targetPath)
    return { ok: true }
  })
  ipcMain.handle('desktop:choose-vault', async (event, options = {}) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow() ?? undefined
    let nextVaultPath = typeof options?.vaultPath === 'string' && options.vaultPath.trim().length > 0
      ? normalizeVaultPath(options.vaultPath)
      : null

    if (!nextVaultPath) {
      const result = await dialog.showOpenDialog(owner, {
        title: 'Choose your Errata vault',
        buttonLabel: 'Use this folder',
        properties: ['openDirectory', 'createDirectory'],
      })

      if (result.canceled || !result.filePaths[0]) {
        return { canceled: true, switched: false, vaultPath: null, vaultName: null }
      }

      nextVaultPath = normalizeVaultPath(result.filePaths[0])
    }

    if (nextVaultPath === getDataDir()) {
      return { canceled: false, switched: false, vaultPath: nextVaultPath, vaultName: getVaultName(nextVaultPath) }
    }

    await switchBackendToVault(nextVaultPath)

    return { canceled: false, switched: true, vaultPath: nextVaultPath, vaultName: getVaultName(nextVaultPath) }
  })
  ipcMain.handle('desktop:show-open-dialog', async (event, options) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow() ?? undefined
    return dialog.showOpenDialog(owner, sanitizeOpenDialogOptions(options))
  })
  ipcMain.handle('desktop:save-file', async (event, options = {}) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow() ?? undefined
    const { content, ...dialogOptions } = options
    const saveResult = await dialog.showSaveDialog(owner, sanitizeSaveDialogOptions(dialogOptions))

    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true, filePath: null }
    }

    await writeFile(saveResult.filePath, normalizeFileContent(content))
    return { canceled: false, filePath: saveResult.filePath }
  })
}

async function configureRuntimePaths() {
  const globalDataDir = getGlobalDataDir()
  const activeVaultPath = await resolveActiveVaultPath()

  applyRuntimePaths(activeVaultPath, globalDataDir)
  await mkdir(globalDataDir, { recursive: true })
  await ensureVaultDirectories(activeVaultPath)
  app.setPath('sessionData', join(app.getPath('userData'), 'session'))
}

function applyRuntimePaths(activeVaultPath, globalDataDir = getGlobalDataDir()) {
  process.env.GLOBAL_DATA_DIR = globalDataDir
  process.env.DATA_DIR = normalizeVaultPath(activeVaultPath)
}

function getBundledServerEntry() {
  const bundledAppRoot = app.isPackaged ? app.getAppPath() : appRoot
  return join(bundledAppRoot, '.output', 'server', 'index.mjs')
}

function createBackendSpawnConfig() {
  const backendEnv = {
    ...process.env,
    HOST: backendUrl.hostname,
    PORT: backendUrl.port || '7739',
  }

  if (isDev) {
    return {
      command: process.env.ERRATA_NODE_BINARY || 'node',
      args: ['--import', 'tsx', 'src/server/standalone.ts'],
      cwd: appRoot,
      env: {
        ...backendEnv,
        ERRATA_APP_ROOT: appRoot,
        CORS_ORIGINS: rendererUrl,
      },
    }
  }

  return {
    command: process.execPath,
    args: [getBundledServerEntry()],
    cwd: process.resourcesPath,
    env: {
      ...backendEnv,
      ERRATA_APP_ROOT: process.resourcesPath,
      ELECTRON_RUN_AS_NODE: '1',
    },
  }
}

function waitForProcessExit(child) {
  return new Promise((resolveExit) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolveExit()
      return
    }

    child.once('exit', () => resolveExit())
  })
}

function forwardBackendStream(stream, target) {
  if (!stream) {
    return
  }

  stream.on('data', (chunk) => {
    target.write(chunk)
  })
}

async function terminateBackendProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return
  }

  if (process.platform === 'win32') {
    await new Promise((resolveKill) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      })

      killer.once('exit', () => resolveKill())
      killer.once('error', () => resolveKill())
    })
    await waitForProcessExit(child)
    return
  }

  child.kill('SIGTERM')
  await Promise.race([
    waitForProcessExit(child),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
  ])

  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await waitForProcessExit(child)
  }
}

function spawnBackend() {
  if (backendProcess) {
    return backendProcess
  }

  const spawnConfig = createBackendSpawnConfig()
  const backend = spawn(spawnConfig.command, spawnConfig.args, {
    cwd: spawnConfig.cwd,
    env: spawnConfig.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  forwardBackendStream(backend.stdout, process.stdout)
  forwardBackendStream(backend.stderr, process.stderr)

  backend.once('exit', (code, signal) => {
    backendProcess = null
    const expectedExit = app.isQuitting || isSwitchingVault || code === 0 || signal === 'SIGTERM'
    if (!expectedExit) {
      console.error(`[electron] Backend exited unexpectedly (code=${code}, signal=${signal})`)
      app.quit()
    }
  })

  backendProcess = backend
  return backend
}

async function ensureBackendRunning() {
  spawnBackend()
  await waitForUrl(`${backendOrigin}/api/health`, 'Backend')
}

async function stopBackend() {
  const runningBackend = backendProcess
  if (!runningBackend) {
    return
  }

  await terminateBackendProcess(runningBackend)
}

async function switchBackendToVault(nextVaultPath) {
  const previousVaultPath = getDataDir()
  const globalDataDir = getGlobalDataDir()
  const normalizedNextVaultPath = normalizeVaultPath(nextVaultPath)

  if (normalizedNextVaultPath === previousVaultPath) {
    return normalizedNextVaultPath
  }

  isSwitchingVault = true

  try {
    await ensureVaultDirectories(normalizedNextVaultPath)
    await stopBackend()
    applyRuntimePaths(normalizedNextVaultPath, globalDataDir)
    await ensureBackendRunning()
    await persistActiveVaultPath(normalizedNextVaultPath)
    return normalizedNextVaultPath
  } catch (error) {
    try {
      await stopBackend()
      applyRuntimePaths(previousVaultPath, globalDataDir)
      await ensureBackendRunning()
    } catch (rollbackError) {
      console.error('[electron] Failed to restore previous backend after vault switch failure', rollbackError)
    }

    throw error
  } finally {
    isSwitchingVault = false
  }
}

async function waitForUrl(url, label) {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // Service is not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(`${label} did not become ready: ${url}`)
}

async function createMainWindow() {
  const existingWindow = getMainWindow()
  if (existingWindow) {
    focusMainWindow()
    return existingWindow
  }

  if (mainWindowPromise) {
    return mainWindowPromise
  }

  mainWindowPromise = (async () => {
    await configureRuntimePaths()
    await ensureBackendRunning()

    const window = new BrowserWindow({
      width: 1560,
      height: 960,
      minWidth: 1200,
      minHeight: 760,
      backgroundColor: '#0f1412',
      show: false,
      autoHideMenuBar: true,
      menuBarVisibility: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: preloadPath,
      },
    })

    mainWindow = window
    window.removeMenu()
    attachNavigationGuards(window)

    window.once('ready-to-show', () => {
      window.show()
    })

    window.on('closed', () => {
      if (mainWindow === window) {
        mainWindow = null
      }
    })

    window.webContents.on('render-process-gone', (_event, details) => {
      console.error('[electron] Renderer process exited', details)
      if (!app.isQuitting) {
        dialog.showErrorBox('Errata renderer exited', `The renderer process exited (${details.reason}). Errata will close.`)
        app.quit()
      }
    })

    await window.loadURL(isDev ? rendererUrl : backendOrigin)
    return window
  })()

  try {
    return await mainWindowPromise
  } finally {
    mainWindowPromise = null
  }
}

function handleLaunchError(error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[electron] Failed to launch window', error)

  if (app.isReady()) {
    dialog.showErrorBox('Errata failed to start', message)
  }

  app.quit()
}

app.on('second-instance', () => {
  focusMainWindow()
})

app.on('before-quit', () => {
  app.isQuitting = true
  void stopBackend()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow()
    return
  }

  focusMainWindow()
})

app.whenReady()
  .then(() => {
    Menu.setApplicationMenu(null)
    registerDesktopHandlers()
    return createMainWindow()
  })
  .catch(handleLaunchError)

process.once('SIGINT', () => {
  stopBackend()
  app.quit()
})

process.once('SIGTERM', () => {
  stopBackend()
  app.quit()
})
