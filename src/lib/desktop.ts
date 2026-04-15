export type DesktopRuntimeInfo = ErrataDesktopRuntimeInfo
export type DesktopDialogFilter = ErrataDesktopDialogFilter
export type DesktopOpenDialogOptions = ErrataDesktopOpenDialogOptions
export type DesktopSaveFileOptions = ErrataDesktopSaveFileOptions

export function getDesktopApi(): ErrataDesktopApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.errataDesktop ?? null
}

export function isDesktopApp(): boolean {
  return getDesktopApi() !== null
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