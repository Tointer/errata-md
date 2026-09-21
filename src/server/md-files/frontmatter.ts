export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

export function serializeFrontmatter(attributes: Record<string, unknown>, body: string): string {
  const normalizedBody = normalizeLineEndings(body)
  const lines = Object.entries(attributes)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)

  if (lines.length === 0) return normalizedBody
  return `---\n${lines.join('\n')}\n---\n${normalizedBody}`
}

export function parseFrontmatter(raw: string): { attributes: Record<string, unknown>; body: string } {
  const normalized = normalizeLineEndings(raw)
  if (!normalized.startsWith('---\n')) {
    return { attributes: {}, body: normalized }
  }

  const closingIndex = normalized.indexOf('\n---\n', 4)
  if (closingIndex === -1) {
    const lines = normalized.split('\n')
    const headerLines: string[] = []
    let bodyStartIndex = lines.length

    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index]
      if (/^[A-Za-z0-9_-]+\s*:/.test(line)) {
        headerLines.push(line)
        continue
      }

      bodyStartIndex = index
      break
    }

    const attributes: Record<string, unknown> = {}
    for (const line of headerLines) {
      const separator = line.indexOf(':')
      if (separator === -1) continue
      const key = line.slice(0, separator).trim()
      const valueText = line.slice(separator + 1).trim()
      if (!key) continue
      try {
        attributes[key] = JSON.parse(valueText)
      } catch {
        attributes[key] = valueText
      }
    }

    return {
      attributes,
      body: lines.slice(bodyStartIndex).join('\n'),
    }
  }

  const header = normalized.slice(4, closingIndex)
  const body = normalized.slice(closingIndex + 5)
  const attributes: Record<string, unknown> = {}

  for (const line of header.split('\n')) {
    if (!line.trim()) continue
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const valueText = line.slice(separator + 1).trim()
    if (!key) continue
    try {
      attributes[key] = JSON.parse(valueText)
    } catch {
      attributes[key] = valueText
    }
  }

  return { attributes, body }
}
