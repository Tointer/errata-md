import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:3000'
const backendOrigin = process.env.ERRATA_API_ORIGIN ?? 'http://127.0.0.1:7739'
const backendUrl = new URL(backendOrigin)
const preloadPath = join(__dirname, 'preload.mjs')

let backendProcess = null

function spawnBackend() {
  if (backendProcess) {
    return backendProcess
  }

  const nodeBinary = process.env.ERRATA_NODE_BINARY || 'node'
  const backendEnv = {
    ...process.env,
    HOST: backendUrl.hostname,
    PORT: backendUrl.port || '7739',
    CORS_ORIGINS: rendererUrl,
  }

  const backend = spawn(nodeBinary, ['--import', 'tsx', 'src/server/standalone.ts'], {
    cwd: join(__dirname, '..'),
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
  spawnBackend()
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

  await window.loadURL(rendererUrl)
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
