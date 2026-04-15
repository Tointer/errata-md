export type DesktopRuntimeInfo = ErrataDesktopRuntimeInfo
export type DesktopVaultSummary = ErrataDesktopVaultSummary
export type DesktopDialogFilter = ErrataDesktopDialogFilter
export type DesktopOpenDialogOptions = ErrataDesktopOpenDialogOptions
export type DesktopSaveFileOptions = ErrataDesktopSaveFileOptions
export type DesktopChooseVaultResult = ErrataChooseVaultResult

export function getDesktopApi(): ErrataDesktopApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.errataDesktop ?? null
}

function hasElectronUserAgent(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  return /\bElectron\//.test(navigator.userAgent)
}

export function isDesktopApp(): boolean {
  return getDesktopApi() !== null || hasElectronUserAgent()
}

export async function chooseVault(vaultPath?: string): Promise<DesktopChooseVaultResult | null> {
  const desktop = getDesktopApi()
  if (!desktop) {
    return null
  }

  return desktop.chooseVault(vaultPath ? { vaultPath } : undefined)
}

export async function getDesktopRuntimeInfo(): Promise<DesktopRuntimeInfo | null> {
  const desktop = getDesktopApi()
  if (!desktop) {
    return null
  }

  return desktop.getRuntimeInfo()
}

export async function openDesktopPath(targetPath: string): Promise<boolean> {
  const desktop = getDesktopApi()
  if (!desktop) {
    return false
  }

  await desktop.openPath(targetPath)
  return true
}

export async function removeDesktopVaultFromRecents(targetPath: string): Promise<boolean> {
  const desktop = getDesktopApi()
  if (!desktop) {
    return false
  }

  await desktop.removeVaultFromRecents(targetPath)
  return true
}

function browserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export async function saveBlob(
  blob: Blob,
  filename: string,
  filters?: DesktopDialogFilter[],
): Promise<{ canceled: boolean; filePath: string | null }> {
  const desktop = getDesktopApi()
  if (!desktop) {
    browserDownload(blob, filename)
    return { canceled: false, filePath: null }
  }

  const content = await blob.arrayBuffer()
  return desktop.saveFile({
    defaultPath: filename,
    filters,
    content,
  })
}

export async function saveText(
  text: string,
  filename: string,
  filters?: DesktopDialogFilter[],
): Promise<{ canceled: boolean; filePath: string | null }> {
  return saveBlob(new Blob([text], { type: 'text/plain' }), filename, filters)
}