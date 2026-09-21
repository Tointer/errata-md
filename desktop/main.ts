/**
 * Electron main process. Boots the Errata server (Bun binary sidecar), opens a window
 * pointed at it, and wires auto-updates. In development, set ERRATA_DEV_URL (e.g.
 * http://localhost:7739) to skip the sidecar and load a running `bun run dev` server.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { startSidecar, type SidecarHandle } from './sidecar'
import { setupUpdater } from './updater'
import {
  forgetVault,
  globalDataDir,
  normalizeVaultPath,
  readVaultState,
  saveActiveVault,
  summarizeVaults,
} from './vault-state'

// Warm parchment so the first paint is not a white flash. Matches the bookish palette.
const BACKGROUND_COLOR = '#efe7d6'

let mainWindow: BrowserWindow | null = null
let sidecar: SidecarHandle | null = null
let quitting = false
let switchingVault = false

function unexpectedSidecarExit(code: number | null) {
  if (quitting || switchingVault) return
  dialog.showErrorBox(
    'Errata server stopped',
    `The Errata background server exited unexpectedly (code ${code ?? 'unknown'}). The app will now close.`,
  )
  app.quit()
}

async function launchSidecar(dataDir: string): Promise<string> {
  sidecar = await startSidecar({
    dataDir,
    globalDataDir: globalDataDir(),
    onUnexpectedExit: unexpectedSidecarExit,
  })
  return `http://127.0.0.1:${sidecar.port}`
}

function resolvePreloadPath(): string {
  const candidates = [
    join(app.getAppPath(), 'preload.cjs'),
    join(process.cwd(), 'dist-electron', 'preload.cjs'),
  ]
  return candidates.find((path) => existsSync(path)) ?? candidates[0]
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: BACKGROUND_COLOR,
    title: 'Errata',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Open external links in the user's browser; keep navigation inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    if (current && new URL(url).origin !== new URL(current).origin) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  return win
}

async function boot() {
  const devUrl = process.env.ERRATA_DEV_URL
  let url: string

  if (devUrl) {
    url = devUrl
  } else {
    const vault = await readVaultState()
    await saveActiveVault(vault.activeVaultPath)
    url = await launchSidecar(vault.activeVaultPath)
  }

  mainWindow = createWindow()
  setupUpdater(mainWindow)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  await mainWindow.loadURL(url)
}

function registerVaultHandlers() {
  ipcMain.handle('errata:vault:get-state', async () => {
    const state = await readVaultState()
    return {
      activeVaultPath: state.activeVaultPath,
      globalDataDir: globalDataDir(),
      recentVaults: summarizeVaults(state.activeVaultPath, state.recentVaultPaths),
    }
  })

  ipcMain.handle('errata:vault:choose', async (_event, requestedPath?: string) => {
    if (process.env.ERRATA_DEV_URL) {
      throw new Error('Vault switching is available in packaged desktop builds. Set DATA_DIR before starting development.')
    }

    let nextPath = requestedPath ? normalizeVaultPath(requestedPath) : null
    if (!nextPath) {
      const options: Electron.OpenDialogOptions = {
        title: 'Choose your Errata vault',
        buttonLabel: 'Use this folder',
        properties: ['openDirectory', 'createDirectory'],
      }
      const selected = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      if (selected.canceled || !selected.filePaths[0]) return { canceled: true }
      nextPath = normalizeVaultPath(selected.filePaths[0])
    }

    const previous = await readVaultState()
    if (nextPath === previous.activeVaultPath) return { canceled: false }

    switchingVault = true
    try {
      await sidecar?.stop()
      const url = await launchSidecar(nextPath)
      await saveActiveVault(nextPath)
      await mainWindow?.loadURL(url)
      return { canceled: false }
    } catch (error) {
      const fallbackUrl = await launchSidecar(previous.activeVaultPath)
      await mainWindow?.loadURL(fallbackUrl)
      throw error
    } finally {
      switchingVault = false
    }
  })

  ipcMain.handle('errata:vault:forget', async (_event, path: string) => {
    await forgetVault(path)
  })

  ipcMain.handle('errata:vault:open', async (_event, path: string) => {
    const error = await shell.openPath(normalizeVaultPath(path))
    if (error) throw new Error(error)
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    registerVaultHandlers()
    return boot()
  }).catch((err) => {
    dialog.showErrorBox('Errata failed to start', err instanceof Error ? err.message : String(err))
    app.quit()
  })

  app.on('activate', () => {
    // macOS: re-create a window when the dock icon is clicked and none are open.
    if (mainWindow === null && app.isReady()) boot().catch(() => {})
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    void sidecar?.stop()
    sidecar = null
  })
}
