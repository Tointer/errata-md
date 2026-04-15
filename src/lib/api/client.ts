import type { ChatEvent } from './types'

const DEFAULT_API_BASE = '/api'

function normalizeBase(base: string): string {
  return base.endsWith('/') ? base.slice(0, -1) : base
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

export function getApiBase(): string {
  const runtimeBase = typeof window !== 'undefined'
    ? window.__ERRATA_API_BASE__?.trim()
    : undefined
  const envBase = import.meta.env.VITE_ERRATA_API_BASE?.trim()
  const base = runtimeBase || envBase || DEFAULT_API_BASE
  return normalizeBase(base)
}

export function resolveApiPath(path: string): string {
  return `${getApiBase()}${normalizePath(path)}`
}

export function resolveBackendPath(path: string): string {
  if (isAbsoluteUrl(path)) {
    return path
  }

  const normalizedPath = normalizePath(path)
  const apiBase = getApiBase()
  if (!isAbsoluteUrl(apiBase)) {
    return normalizedPath
  }

  return new URL(normalizedPath, `${new URL(apiBase).origin}/`).toString()
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(resolveApiPath(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `API error: ${res.status}`)
  }
  return res.json()
}

/**
 * Calls the generate endpoint and returns a ReadableStream of text chunks.
 */
export async function fetchStream(
  path: string,
  body: Record<string, unknown>,
): Promise<ReadableStream<string>> {
  const res = await fetch(resolveApiPath(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `API error: ${res.status}`)
  }
  if (!res.body) {
    throw new Error('No response body')
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  return new ReadableStream<string>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      controller.enqueue(decoder.decode(value, { stream: true }))
    },
  })
}

/**
 * Fetches an NDJSON event stream via GET and returns a ReadableStream of parsed ChatEvent objects.
 */
export async function fetchGetEventStream(path: string): Promise<ReadableStream<ChatEvent>> {
  const res = await fetch(resolveApiPath(path))
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `API error: ${res.status}`)
  }
  if (!res.body) {
    throw new Error('No response body')
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  return new ReadableStream<ChatEvent>({
    async pull(controller) {
      while (true) {
        const newlineIdx = buffer.indexOf('\n')
        if (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim()
          buffer = buffer.slice(newlineIdx + 1)
          if (line) {
            try {
              controller.enqueue(JSON.parse(line) as ChatEvent)
            } catch {
              // Skip malformed lines
            }
          }
          return
        }

        const { done, value } = await reader.read()
        if (done) {
          const remaining = buffer.trim()
          if (remaining) {
            try {
              controller.enqueue(JSON.parse(remaining) as ChatEvent)
            } catch {
              // Skip malformed
            }
          }
          controller.close()
          return
        }
        buffer += decoder.decode(value, { stream: true })
      }
    },
  })
}

/**
 * Fetches an NDJSON event stream and returns a ReadableStream of parsed ChatEvent objects.
 */
export async function fetchEventStream(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ReadableStream<ChatEvent>> {
  const res = await fetch(resolveApiPath(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `API error: ${res.status}`)
  }
  if (!res.body) {
    throw new Error('No response body')
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  return new ReadableStream<ChatEvent>({
    async pull(controller) {
      while (true) {
        // Try to extract a complete line from the buffer
        const newlineIdx = buffer.indexOf('\n')
        if (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim()
          buffer = buffer.slice(newlineIdx + 1)
          if (line) {
            try {
              controller.enqueue(JSON.parse(line) as ChatEvent)
            } catch {
              // Skip malformed lines
            }
          }
          return
        }

        // Read more data
        const { done, value } = await reader.read()
        if (done) {
          // Process any remaining buffer
          const remaining = buffer.trim()
          if (remaining) {
            try {
              controller.enqueue(JSON.parse(remaining) as ChatEvent)
            } catch {
              // Skip malformed
            }
          }
          controller.close()
          return
        }
        buffer += decoder.decode(value, { stream: true })
      }
    },
  })
}
