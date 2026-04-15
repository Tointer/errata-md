import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const rendererPort = process.env.ELECTRON_RENDERER_PORT ?? '3000'
const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? `http://127.0.0.1:${rendererPort}`
const apiOrigin = process.env.ERRATA_API_ORIGIN ?? 'http://127.0.0.1:7739'
const electronCli = resolve(appRoot, 'node_modules', 'electron', 'cli.js')

const child = spawn(process.execPath, [electronCli, 'electron/main.mjs'], {
  cwd: appRoot,
  env: {
    ...process.env,
    ELECTRON_RENDERER_URL: rendererUrl,
    ERRATA_API_ORIGIN: apiOrigin,
    ERRATA_APP_ROOT: appRoot,
    ERRATA_NODE_BINARY: process.execPath,
  },
  stdio: ['ignore', 'inherit', 'inherit'],
  windowsHide: false,
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill()
    }
  })
}

child.once('exit', (code) => {
  process.exit(code ?? 0)
})