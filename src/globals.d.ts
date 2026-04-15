declare const __BUILD_VERSION__: string

interface ErrataDesktopDialogFilter {
	name: string
	extensions: string[]
}

interface ErrataDesktopRuntimeInfo {
	platform: string
	apiOrigin: string
	isDev: boolean
	appVersion: string
	dataDir: string
	logsDir: string
	configPath: string
}

interface ErrataDesktopOpenDialogOptions {
	title?: string
	defaultPath?: string
	buttonLabel?: string
	message?: string
	filters?: ErrataDesktopDialogFilter[]
	properties?: Array<
		| 'openFile'
		| 'openDirectory'
		| 'multiSelections'
		| 'showHiddenFiles'
		| 'createDirectory'
		| 'promptToCreate'
		| 'dontAddToRecent'
		| 'noResolveAliases'
		| 'treatPackageAsDirectory'
	>
}

interface ErrataDesktopSaveFileOptions {
	title?: string
	defaultPath?: string
	buttonLabel?: string
	message?: string
	filters?: ErrataDesktopDialogFilter[]
	content: string | ArrayBuffer | Uint8Array
}

interface ErrataDesktopApi {
	platform: string
	apiOrigin: string
	getRuntimeInfo: () => Promise<ErrataDesktopRuntimeInfo>
	openExternal: (url: string) => Promise<{ ok: boolean }>
	showOpenDialog: (options?: ErrataDesktopOpenDialogOptions) => Promise<{ canceled: boolean; filePaths: string[] }>
	saveFile: (options: ErrataDesktopSaveFileOptions) => Promise<{ canceled: boolean; filePath: string | null }>
}

interface Window {
	__ERRATA_API_BASE__?: string
	errataDesktop?: ErrataDesktopApi
}
