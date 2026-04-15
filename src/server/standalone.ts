import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { getApp } from './init'

function resolvePort(): number {
  const raw = process.env.PORT ?? '7739'
  const port = Number(raw)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${raw}`)
  }
  return port
}

function resolveHostname(): string {
  return process.env.HOST ?? '127.0.0.1'
}

function getAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim()
  if (!raw) {
    return []
  }

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function getCorsOrigin(origin: string | undefined, allowedOrigins: string[]): string | null {
  if (!origin) {
    return null
  }

  return allowedOrigins.includes(origin) ? origin : null
}

function setCorsHeaders(
  res: import('node:http').ServerResponse,
  corsOrigin: string,
  req: import('node:http').IncomingMessage,
): void {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Type')

  const requestedHeaders = req.headers['access-control-request-headers']
  if (typeof requestedHeaders === 'string' && requestedHeaders.length > 0) {
    res.setHeader('Access-Control-Allow-Headers', requestedHeaders)
    return
  }

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function toRequest(req: import('node:http').IncomingMessage, hostname: string, port: number): Request {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item)
      }
      continue
    }
    if (value !== undefined) {
      headers.set(key, value)
    }
  }

  const url = new URL(req.url ?? '/', `http://${hostname}:${port}`)
  const body = req.method === 'GET' || req.method === 'HEAD'
    ? undefined
    : (Readable.toWeb(req) as ReadableStream<Uint8Array>)

  return new Request(url, {
    method: req.method,
    headers,
    body,
    duplex: body ? 'half' : undefined,
  })
}

const app = await getApp()
const port = resolvePort()
const hostname = resolveHostname()
const allowedOrigins = getAllowedOrigins()

const server = createServer(async (req, res) => {
  try {
    const corsOrigin = getCorsOrigin(req.headers.origin, allowedOrigins)
    if (corsOrigin) {
      setCorsHeaders(res, corsOrigin, req)
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = corsOrigin ? 204 : 403
      res.end()
      return
    }

    const response = await app.fetch(toRequest(req, hostname, port))

    res.statusCode = response.status
    res.statusMessage = response.statusText

    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie' && typeof response.headers.getSetCookie === 'function') {
        res.setHeader(key, response.headers.getSetCookie())
        return
      }
      res.setHeader(key, value)
    })

    if (!response.body) {
      res.end()
      return
    }

    Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res)
  } catch (error) {
    console.error('[server] Unhandled request error', error)
    res.statusCode = 500
    res.end('Internal Server Error')
  }
})

await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(port, hostname, () => resolve())
})

console.info(`[server] Errata backend listening on http://${hostname}:${port}`)