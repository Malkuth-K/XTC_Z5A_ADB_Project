// 雷霆Link PC 端 - 主进程
// 职责：HTTP 文件服务（三端统一协议）+ UDP 局域网发现 + IPC 桥
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const http = require('http')
const dgram = require('dgram')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

const PROTOCOL = {
  HTTP_PORT: 9786,
  UDP_PORT: 9787,
  UDP_BROADCAST: '255.255.255.255',
  PEER_TTL: 30000,
  HEARTBEAT_MS: 5000,
  DIRS: ['lttp', 'ltsp', 'ERCYtp', 'ERCYSP', 'files'],
  MEDIA_DIRS: ['lttp', 'ltsp', 'ERCYtp', 'ERCYSP'],
  FILES_DIR: 'files'
}
const DEVICE_TYPE = 'pc'
const VERSION = '1.0.0'

// 媒体根目录：filetransfer/project/img（与 Android 端目录结构一致）
const MEDIA_ROOT = path.join(__dirname, '..', 'project', 'img')

// ==================== 配置 ====================
let config = { deviceName: '', httpPort: PROTOCOL.HTTP_PORT, seekStepSec: 30 }

function configPath() {
  return path.join(app.getPath('userData'), 'thunderlink_config.json')
}

function loadConfig() {
  try {
    if (fs.existsSync(configPath())) {
      config = Object.assign(config, JSON.parse(fs.readFileSync(configPath(), 'utf-8')))
    }
  } catch (e) { console.error('[ThunderLink] 读取配置失败', e) }
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true })
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2))
  } catch (e) { console.error('[ThunderLink] 保存配置失败', e) }
}

let deviceId = ''
function loadDeviceId() {
  const idPath = path.join(app.getPath('userData'), 'thunderlink_device_id')
  try {
    deviceId = fs.readFileSync(idPath, 'utf-8').trim()
  } catch (e) { /* ignore */ }
  if (!deviceId) {
    deviceId = 'tl-pc-' + crypto.randomBytes(4).toString('hex')
    try { fs.writeFileSync(idPath, deviceId) } catch (e) {}
  }
}

function deviceName() {
  return config.deviceName || '雷霆电脑-' + os.hostname()
}

// ==================== 本机 IP ====================
function localIp() {
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return '127.0.0.1'
}

// ==================== HTTP 文件服务 ====================
function dirRoot(dir) {
  // 任意文件目录：filetransfer/project/files（与 img 平级）
  if (dir === PROTOCOL.FILES_DIR) {
    return path.join(__dirname, '..', 'project', PROTOCOL.FILES_DIR)
  }
  return path.join(MEDIA_ROOT, dir)
}

function listDir(dir) {
  const root = dirRoot(dir)
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isFile())
    .map(d => {
      const st = fs.statSync(path.join(root, d.name))
      return { name: d.name, size: st.size, modified: Math.floor(st.mtimeMs) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function infoResponse() {
  const counts = {}
  for (const dir of PROTOCOL.MEDIA_DIRS) {
    counts[dir] = listDir(dir).length
  }
  return JSON.stringify({
    name: deviceName(), type: DEVICE_TYPE, version: VERSION, counts
  })
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function sendText(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

function startHttpServer() {
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost')
      const q = u.searchParams
      const method = req.method.toUpperCase()

      if (method === 'GET' && u.pathname === '/api/info') {
        sendJson(res, 200, JSON.parse(infoResponse()))
        return
      }
      if (method === 'GET' && u.pathname === '/api/files') {
        const dir = q.get('dir')
        if (!PROTOCOL.DIRS.includes(dir)) return sendJson(res, 400, { ok: false, msg: '非法目录' })
        sendJson(res, 200, { dir, files: listDir(dir) })
        return
      }
      if ((method === 'GET') && (u.pathname === '/api/file' || u.pathname === '/api/media')) {
        const dir = q.get('dir'), name = q.get('name')
        if (!PROTOCOL.DIRS.includes(dir)) return sendJson(res, 400, { ok: false, msg: '非法目录' })
        const file = path.join(dirRoot(dir), path.basename(name))
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
          return sendJson(res, 404, { ok: false, msg: '文件不存在' })
        }
        const stat = fs.statSync(file)
        const total = stat.size
        const range = req.headers.range
        let start = 0, end = total - 1
        let partial = false
        if (range && range.startsWith('bytes=')) {
          const r = range.slice(6)
          const dash = r.indexOf('-')
          if (dash >= 0) {
            const s = r.slice(0, dash).trim()
            const e = r.slice(dash + 1).trim()
            if (s === '') {
              start = Math.max(0, total - (parseInt(e) || 0))
            } else {
              start = parseInt(s) || 0
              end = e ? Math.min(parseInt(e), total - 1) : total - 1
            }
          }
          if (start >= total) return sendText(res, 416, 'Range Not Satisfiable')
          if (end < start) end = start
          partial = true
        }
        const length = end - start + 1
        const contentType = (() => {
          const ext = path.extname(name).toLowerCase()
          if (['.mp4', '.mkv', '.avi', '.webm'].includes(ext)) return 'video/mp4'
          if (['.jpg', '.jpeg'].includes(ext)) return 'image/jpeg'
          if (ext === '.png') return 'image/png'
          if (ext === '.gif') return 'image/gif'
          if (ext === '.webp') return 'image/webp'
          return 'application/octet-stream'
        })()
        res.writeHead(partial ? 206 : 200, {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Content-Length': length,
          ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}),
          ...(u.pathname === '/api/file' ? { 'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"` } : {})
        })
        const stream = fs.createReadStream(file, { start, end })
        stream.pipe(res)
        return
      }
      if (method === 'POST' && u.pathname === '/api/upload') {
        const dir = q.get('dir'), name = q.get('name')
        if (!PROTOCOL.DIRS.includes(dir)) return sendJson(res, 400, { ok: false, msg: '非法目录' })
        if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
          return sendJson(res, 400, { ok: false, msg: '非法文件名' })
        }
        const len = parseInt(req.headers['content-length'] || '0')
        if (isNaN(len) || len < 0) return sendJson(res, 400, { ok: false, msg: '缺少 Content-Length' })
        fs.mkdirSync(dirRoot(dir), { recursive: true })
        const target = path.join(dirRoot(dir), name)
        const out = fs.createWriteStream(target)
        let received = 0
        req.on('data', chunk => { received += chunk.length })
        req.on('end', () => { out.end(); sendJson(res, 200, { ok: true, msg: 'ok' }) })
        req.on('error', () => { out.destroy(); try { fs.unlinkSync(target) } catch (e) {} sendJson(res, 500, { ok: false, msg: '上传失败' }) })
        req.pipe(out)
        return
      }
      if (method === 'POST' && u.pathname === '/api/delete') {
        const dir = q.get('dir'), name = q.get('name')
        if (!PROTOCOL.DIRS.includes(dir)) return sendJson(res, 400, { ok: false, msg: '非法目录' })
        const target = path.join(dirRoot(dir), path.basename(name))
        try {
          fs.unlinkSync(target)
          sendJson(res, 200, { ok: true, msg: 'ok' })
        } catch (e) {
          sendJson(res, 200, { ok: false, msg: '删除失败' })
        }
        return
      }
      sendText(res, 404, 'Not Found')
    } catch (e) {
      console.error('[ThunderLink] HTTP 异常', e)
      try { sendText(res, 500, 'Server Error') } catch (e2) {}
    }
  })

  server.listen(config.httpPort, () => {
    console.log(`[ThunderLink] HTTP 服务已启动 端口 ${config.httpPort}`)
  })
  return server
}

// ==================== UDP 设备发现 ====================
let peers = new Map()
let udpSocket = null

function peerInfo() {
  return {
    id: deviceId,
    name: deviceName(),
    type: DEVICE_TYPE,
    ip: localIp(),
    port: config.httpPort,
    version: VERSION,
    ts: Date.now()
  }
}

function startDiscovery() {
  udpSocket = dgram.createSocket('udp4')
  udpSocket.bind(PROTOCOL.UDP_PORT, () => {
    udpSocket.setBroadcast(true)
  })
  udpSocket.on('message', (msg, rinfo) => {
    try {
      const peer = JSON.parse(msg.toString('utf-8'))
      if (peer.id !== deviceId) {
        const old = peers.has(peer.id)
        peers.set(peer.id, { ...peer, ip: rinfo.address, ts: Date.now(), online: true })
        if (!old) console.log(`[ThunderLink] 发现设备 ${peer.name} (${rinfo.address}:${peer.port})`)
        // 回复自身
        replyTo(rinfo.address, peer.port || PROTOCOL.UDP_PORT)
        broadcastPeers()
      }
    } catch (e) { /* 非协议报文忽略 */ }
  })

  setInterval(() => {
    announce()
    // 清理过期 peer：标记离线（保留在列表），服务恢复后自动重新上线
    const now = Date.now()
    let changed = false
    for (const [id, p] of peers) {
      if (now - p.ts > PROTOCOL.PEER_TTL && p.online !== false) {
        p.online = false
        changed = true
        console.log(`[ThunderLink] 设备离线 ${p.name}`)
      }
    }
    if (changed) broadcastPeers()
  }, PROTOCOL.HEARTBEAT_MS)

  // 离线设备主动探测：一旦其服务恢复，PC 端自动重连（无需手动重启/刷新）
  setInterval(() => {
    for (const p of Array.from(peers.values())) {
      if (p.online === false) {
        httpGetJson(p, '/api/info').then(r => {
          if (r.code === 200) {
            p.online = true
            p.ts = Date.now()
            console.log(`[ThunderLink] 设备重连 ${p.name}`)
            broadcastPeers()
          }
        }).catch(() => {})
      }
    }
  }, PROTOCOL.HEARTBEAT_MS)
}

function announce() {
  const data = Buffer.from(JSON.stringify(peerInfo()), 'utf-8')
  udpSocket.send(data, 0, data.length, PROTOCOL.UDP_PORT, PROTOCOL.UDP_BROADCAST)
}

function replyTo(ip, port) {
  const data = Buffer.from(JSON.stringify(peerInfo()), 'utf-8')
  udpSocket.send(data, 0, data.length, port, ip)
}

function broadcastPeers() {
  const list = Array.from(peers.values()).sort((a, b) => a.name.localeCompare(b.name))
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('peers-changed', list)
  }
}

// ==================== HTTP 客户端（传输） ====================
function httpGetJson(peer, apiPath, params) {
  return new Promise((resolve, reject) => {
    const u = new URL(`http://${peer.ip}:${peer.port}${apiPath}`)
    for (const k in params) u.searchParams.set(k, params[k])
    const req = http.get(u, res => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => {
        try { resolve({ code: res.statusCode, body: JSON.parse(body) }) }
        catch (e) { resolve({ code: res.statusCode, body: null }) }
      })
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(new Error('请求超时')) })
  })
}

function downloadFile(peer, dir, name, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const u = new URL(`http://${peer.ip}:${peer.port}/api/file`)
    u.searchParams.set('dir', dir)
    u.searchParams.set('name', name)
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    const out = fs.createWriteStream(destPath)
    let received = 0, total = 0
    const req = http.get(u, res => {
      if (res.statusCode !== 200) {
        try { fs.unlinkSync(destPath) } catch (e) {}
        reject(new Error(`下载失败 HTTP ${res.statusCode}`))
        return
      }
      total = parseInt(res.headers['content-length'] || '0') || 0
      res.on('data', c => { received += c.length; onProgress && onProgress(received, total) })
      res.pipe(out)
      out.on('finish', () => { out.close(); resolve(true) })
    })
    req.on('error', e => { try { fs.unlinkSync(destPath) } catch (e2) {} reject(e) })
    req.setTimeout(120000, () => { req.destroy(new Error('下载超时')) })
  })
}

function uploadFile(peer, dir, filePath, onProgress) {
  return new Promise((resolve, reject) => {
    const u = new URL(`http://${peer.ip}:${peer.port}/api/upload`)
    u.searchParams.set('dir', dir)
    u.searchParams.set('name', path.basename(filePath))
    const stat = fs.statSync(filePath)
    const req = http.request(u, {
      method: 'POST',
      headers: { 'Content-Length': stat.size }
    }, res => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => {
        try { resolve({ code: res.statusCode, body: JSON.parse(body) }) }
        catch (e) { resolve({ code: res.statusCode, body: null }) }
      })
    })
    req.on('error', reject)
    const stream = fs.createReadStream(filePath)
    let sent = 0
    stream.on('data', c => { sent += c.length; onProgress && onProgress(sent, stat.size) })
    stream.on('error', reject)
    stream.pipe(req)
  })
}

// ==================== 窗口 ====================
function createWindow() {
  const win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    title: '雷霆Link',
    backgroundColor: '#241747',
    icon: path.join(__dirname, '..', 'test', 'c2a314e21dd1539be4fbaf42effdd5b9_1647344358360108377.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

// ==================== IPC ====================
function registerIpc() {
  ipcMain.handle('get-self', () => ({
    name: deviceName(), type: DEVICE_TYPE, ip: localIp(), port: config.httpPort,
    version: VERSION, id: deviceId
  }))
  ipcMain.handle('get-peers', () => Array.from(peers.values()).sort((a, b) => a.name.localeCompare(b.name)))
  ipcMain.handle('list-local', (e, dir) => listDir(dir))
  ipcMain.handle('delete-local', (e, dir, name) => {
    try { fs.unlinkSync(path.join(dirRoot(dir), path.basename(name))); return true } catch (err) { return false }
  })
  ipcMain.handle('add-local-file', (e, dir, filePath) => {
    try {
      fs.mkdirSync(dirRoot(dir), { recursive: true })
      const name = path.basename(filePath)
      fs.copyFileSync(filePath, path.join(dirRoot(dir), name))
      return { ok: true, name }
    } catch (err) {
      return { ok: false, msg: err.message }
    }
  })
  ipcMain.handle('set-device-name', (e, name) => {
    config.deviceName = name
    saveConfig()
    return true
  })
  ipcMain.handle('set-port', (e, port) => {
    config.httpPort = port
    saveConfig()
    return true
  })
  ipcMain.handle('set-seek-step', (e, sec) => {
    config.seekStepSec = sec
    saveConfig()
    return true
  })
  ipcMain.handle('restart-services', () => {
    // 端口变更：重启 HTTP + 发现
    try { httpServer.close() } catch (e) {}
    try { udpSocket.close() } catch (e) {}
    httpServer = startHttpServer()
    startDiscovery()
    return { ok: true, port: config.httpPort, ip: localIp() }
  })

  // 对端操作
  ipcMain.handle('remote-list', (e, peer, dir) => httpGetJson(peer, '/api/files', { dir }).then(r => r.body && r.body.files || []))
  ipcMain.handle('remote-delete', (e, peer, dir, name) => {
    return httpGetJson(peer, '/api/delete', { dir, name }).then(r => !!(r.body && r.body.ok))
  })
  ipcMain.handle('remote-download', async (e, peer, dir, name) => {
    const dest = path.join(dirRoot(dir), path.basename(name))
    await downloadFile(peer, dir, name, dest, () => {})
    return { ok: true, name }
  })
  ipcMain.handle('remote-upload', async (e, peer, dir, filePath) => {
    const r = await uploadFile(peer, dir, filePath, () => {})
    return r
  })
  // 本地媒体直链（渲染进程查看器用）
  ipcMain.handle('media-url', (e, dir, name) => {
    return `http://127.0.0.1:${config.httpPort}/api/media?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`
  })
  ipcMain.handle('media-root', () => MEDIA_ROOT)
  ipcMain.handle('open-in-explorer', (e, dir) => {
    try { require('child_process').exec(`explorer.exe "${dir.replace(/\//g, '\\')}"`) } catch (err) {}
    return true
  })
}

let httpServer = null

// ==================== 启动 ====================
app.whenReady().then(() => {
  loadConfig()
  loadDeviceId()
  registerIpc()
  httpServer = startHttpServer()
  startDiscovery()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
