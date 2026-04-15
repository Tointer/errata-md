import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appRoot = join(__dirname, '..')

const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? null
const isDev = Boolean(rendererUrl)
const backendOrigin = process.env.ERRATA_API_ORIGIN ?? 'http://127.0.0.1:7739'
const backendUrl = new URL(backendOrigin)
const preloadPath = join(__dirname, 'preload.mjs')

let backendProcess = null
let bundledBackendStarted = false
let mainWindow = null
let mainWindowPromise = null

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
}

function getDataDir() {
  return process.env.DATA_DIR?.trim() || join(app.getPath('userData'), 'data')
}

function getLogsDir() {
  return join(getDataDir(), 'logs')
}

function getConfigPath() {
  return join(getDataDir(), 'config.json')
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
  ipcMain.handle('desktop:get-runtime-info', () => ({
    platform: process.platform,
    apiOrigin: backendOrigin,
    isDev,
    appVersion: app.getVersion(),
    dataDir: getDataDir(),
    logsDir: getLogsDir(),
    configPath: getConfigPath(),
  }))

  ipcMain.handle('desktop:open-external', async (_event, urlString) => {
    await openExternalUrl(urlString)
    return { ok: true }
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

function configureRuntimePaths() {
  if (process.env.DATA_DIR?.trim()) {
    app.setPath('sessionData', join(app.getPath('userData'), 'session'))
    return
  }

  process.env.DATA_DIR = join(app.getPath('userData'), 'data')
  app.setPath('sessionData', join(app.getPath('userData'), 'session'))
}

function spawnBackend() {
  if (backendProcess) {
    return backendProcess
  }

  const backendEnv = {
    ...process.env,
    ERRATA_APP_ROOT: appRoot,
    HOST: backendUrl.hostname,
    PORT: backendUrl.port || '7739',
    CORS_ORIGINS: rendererUrl,
  }

  const backend = spawn(process.env.ERRATA_NODE_BINARY || 'node', ['--import', 'tsx', 'src/server/standalone.ts'], {
    cwd: appRoot,
    env: backendEnv,
    stdio: 'inherit',
  })

  backend.once('exit', (code, signal) => {
    backendProcess = null
    const expectedExit = app.isQuitting || code === 0 || signal === 'SIGTERM'
    if (!expectedExit) {
      console.error(`[electron] Backend exited unexpectedly (code=${code}, signal=${signal})`)
      app.quit()
    }
  })

  backendProcess = backend
  return backend
}

async function startBundledBackend() {
  if (bundledBackendStarted) {
    return
  }

  const bundledAppRoot = app.isPackaged ? app.getAppPath() : appRoot
  process.env.ERRATA_APP_ROOT = app.isPackaged ? process.resourcesPath : appRoot
  process.env.HOST = backendUrl.hostname
  process.env.PORT = backendUrl.port || '7739'

  const serverEntry = join(bundledAppRoot, '.output', 'server', 'index.mjs')
  await import(pathToFileURL(serverEntry).href)
  bundledBackendStarted = true
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
    configureRuntimePaths()

    if (isDev) {
      spawnBackend()
    } else {
      await startBundledBackend()
    }

    await waitForUrl(`${backendOrigin}/api/health`, 'Backend')

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

function stopBackend() {
  if (!backendProcess || backendProcess.killed) {
    return
  }

  backendProcess.kill('SIGTERM')
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
  stopBackend()
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
