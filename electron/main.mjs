import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
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

  const packagedAppRoot = app.getAppPath()
  process.env.ERRATA_APP_ROOT = process.resourcesPath
  process.env.HOST = backendUrl.hostname
  process.env.PORT = backendUrl.port || '7739'

  const serverEntry = join(packagedAppRoot, '.output', 'server', 'index.mjs')
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  await window.loadURL(isDev ? rendererUrl : backendOrigin)
}

function stopBackend() {
  if (!backendProcess || backendProcess.killed) {
    return
  }

  backendProcess.kill('SIGTERM')
}

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
  }
})

app.whenReady().then(createMainWindow).catch((error) => {
  console.error('[electron] Failed to launch window', error)
  app.quit()
})

process.once('SIGINT', () => {
  stopBackend()
  app.quit()
})

process.once('SIGTERM', () => {
  stopBackend()
  app.quit()
})
