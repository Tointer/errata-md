export function serializeFrontmatter(attributes: Record<string, unknown>, body: string): string {
  const normalizedBody = body.replace(/\r\n/g, '\n')
  const lines = Object.entries(attributes)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)

  if (lines.length === 0) return normalizedBody
  return `---\n${lines.join('\n')}\n---\n${normalizedBody}`
}

export function parseFrontmatter(raw: string): { attributes: Record<string, unknown>; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return { attributes: {}, body: normalized }
  }

  const closingIndex = normalized.indexOf('\n---\n', 4)
  if (closingIndex === -1) {
    return { attributes: {}, body: normalized }
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