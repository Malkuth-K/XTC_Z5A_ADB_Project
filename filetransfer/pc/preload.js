// 雷霆Link PC 端 - 预加载脚本（上下文隔离桥）
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('thunderlink', {
  getSelf: () => ipcRenderer.invoke('get-self'),
  getPeers: () => ipcRenderer.invoke('get-peers'),
  listLocal: (dir) => ipcRenderer.invoke('list-local', dir),
  deleteLocal: (dir, name) => ipcRenderer.invoke('delete-local', dir, name),
  addLocalFile: (dir, filePath) => ipcRenderer.invoke('add-local-file', dir, filePath),
  setDeviceName: (name) => ipcRenderer.invoke('set-device-name', name),
  setPort: (port) => ipcRenderer.invoke('set-port', port),
  setSeekStep: (sec) => ipcRenderer.invoke('set-seek-step', sec),
  restartServices: () => ipcRenderer.invoke('restart-services'),
  remoteList: (peer, dir) => ipcRenderer.invoke('remote-list', peer, dir),
  remoteDelete: (peer, dir, name) => ipcRenderer.invoke('remote-delete', peer, dir, name),
  remoteDownload: (peer, dir, name) => ipcRenderer.invoke('remote-download', peer, dir, name),
  remoteUpload: (peer, dir, filePath) => ipcRenderer.invoke('remote-upload', peer, dir, filePath),
  mediaUrl: (dir, name) => ipcRenderer.invoke('media-url', dir, name),
  mediaRoot: () => ipcRenderer.invoke('media-root'),
  openInExplorer: (dir) => ipcRenderer.invoke('open-in-explorer', dir),
  onPeersChanged: (cb) => ipcRenderer.on('peers-changed', (e, list) => cb(list))
})
