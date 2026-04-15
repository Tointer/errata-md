import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('errataDesktop', {
  platform: process.platform,
  apiOrigin: process.env.ERRATA_API_ORIGIN ?? 'http://127.0.0.1:7739',
  getRuntimeInfo: () => ipcRenderer.invoke('desktop:get-runtime-info'),
  chooseVault: (options) => ipcRenderer.invoke('desktop:choose-vault', options),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  showOpenDialog: (options) => ipcRenderer.invoke('desktop:show-open-dialog', options),
  saveFile: (options) => ipcRenderer.invoke('desktop:save-file', options),
})
