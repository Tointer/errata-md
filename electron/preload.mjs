import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('errataDesktop', {
  platform: process.platform,
  apiOrigin: process.env.ERRATA_API_ORIGIN ?? 'http://127.0.0.1:7739',
})
