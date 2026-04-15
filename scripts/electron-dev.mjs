import { spawn } from 'node:child_process'

const rendererPort = process.env.ELECTRON_RENDERER_PORT ?? '3000'
const rendererUrl = `http://127.0.0.1:${rendererPort}`
const apiOrigin = process.env.ERRATA_API_ORIGIN ?? 'http://127.0.0.1:7739'

const children = new Set()

function resolveCommand(command) {
  if (process.platform === 'win32' && !command.endsWith('.cmd')) {
    return `${command}.cmd`
  }

  return command
}

function quoteArg(arg) {
  if (/^[A-Za-z0-9_./:-]+$/.test(arg)) {
    return arg
  }

  return `"${arg.replace(/"/g, '\\"')}"`
}

function spawnProcess(command, args, extraEnv = {}) {
  const env = {
    ...process.env,
    ...extraEnv,
  }

  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', [resolveCommand(command), ...args].map(quoteArg).join(' ')], {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    })
    : spawn(resolveCommand(command), args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    })

  children.add(child)
  child.once('exit', () => {
    children.delete(child)
  })
  return child
}

async function waitForUrl(url, label) {
  const deadline = Date.now() + 90_000

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

function shutdown(exitCode = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }
  process.exit(exitCode)
}

process.once('SIGINT', () => shutdown())
process.once('SIGTERM', () => shutdown())

const web = spawnProcess('npm', ['run', 'dev:web'], {
  ERRATA_DISABLE_DEVTOOLS: '1',
  VITE_ERRATA_API_BASE: `${apiOrigin}/api`,
})

web.once('exit', (code) => {
  if (code !== 0) {
    shutdown(code ?? 1)
  }
})

await waitForUrl(rendererUrl, 'Renderer')

const electron = spawnProcess('npx', ['electron', 'electron/main.mjs'], {
  ELECTRON_RENDERER_URL: rendererUrl,
  ERRATA_API_ORIGIN: apiOrigin,
  ERRATA_NODE_BINARY: process.execPath,
})

electron.once('exit', (code) => {
  shutdown(code ?? 0)
})