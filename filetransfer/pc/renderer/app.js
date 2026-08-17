/* ================= 雷霆Link PC 端 渲染逻辑 ================= */
'use strict'

const TL = window.thunderlink

const MEDIA_DEFS = {
  'media-lttp': { dir: 'lttp', title: '雷霆图片', isVideo: false },
  'media-ltsp': { dir: 'ltsp', title: '雷霆视频', isVideo: true },
  'media-ERCYSP': { dir: 'ERCYSP', title: 'ERCY视频', isVideo: true },
  'media-ERCYtp': { dir: 'ERCYtp', title: 'ERCY图片', isVideo: false }
}

let self = null
let seekStep = 30
let currentMediaKey = 'media-lttp'
let mediaFiles = []
let peers = []
let selectedPeer = null
let selectedPeerDir = 'lttp'
let selfPort = 9786

const $ = id => document.getElementById(id)

// ==================== 页面切换 ====================
function switchPage(key) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'))
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))
  $('nav-' + key).classList.add('active')
  if (MEDIA_DEFS[key]) {
    currentMediaKey = key
    $('page-media').classList.remove('hidden')
    renderMediaPage()
  } else {
    $('page-' + key).classList.remove('hidden')
    if (key === 'settings') renderSettings()
    if (key === 'transfer') renderTransfer()
  }
}

document.querySelectorAll('.nav-item').forEach(n => {
  n.addEventListener('click', () => switchPage(n.dataset.page))
})
$('btn-pc-settings').addEventListener('click', () => switchPage('settings'))

// ==================== 自身信息 ====================
async function loadSelf() {
  self = await TL.getSelf()
  selfPort = self.port
  $('self-info').textContent = `${self.name} · ${self.ip}:${self.port}`
}

// ==================== 设置页 ====================
async function renderSettings() {
  self = await TL.getSelf()
  $('set-name').value = self.name
  $('set-port').value = self.port
  $('set-seek').value = seekStep
  $('settings-info').textContent = `设备类型: 电脑 · IP: ${self.ip} · 版本: ${self.version}`
}

$('btn-save-settings').addEventListener('click', async () => {
  const name = $('set-name').value.trim()
  const port = parseInt($('set-port').value)
  const step = parseInt($('set-seek').value) || 30
  if (!port || port < 1024 || port > 65535) { alert('端口需为 1024-65535'); return }
  await TL.setDeviceName(name)
  await TL.setPort(port)
  await TL.setSeekStep(step)
  seekStep = step
  const r = await TL.restartServices()
  await loadSelf()
  $('settings-info').textContent = `设置已保存 · 服务已重启 · IP ${r.ip}:${r.port}`
})

// ==================== 媒体页 ====================
function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

async function renderMediaPage() {
  const def = MEDIA_DEFS[currentMediaKey]
  $('media-title').textContent = def.title
  mediaFiles = await TL.listLocal(def.dir)
  const grid = $('media-grid')
  grid.innerHTML = ''
  $('media-empty').classList.toggle('hidden', mediaFiles.length > 0)

  for (const f of mediaFiles) {
    const card = document.createElement('div')
    card.className = 'media-card'
    const url = await TL.mediaUrl(def.dir, f.name)
    const thumb = def.isVideo
      ? `<div class="video-thumb">🎬</div>`
      : `<img src="${url}" alt="" loading="lazy">`
    card.innerHTML = `
      ${thumb}
      <div class="media-info">
        <span class="media-name">${escapeHtml(f.name)}</span>
        <span class="media-size">${fmtSize(f.size)}</span>
        <button class="media-del" title="删除">✕</button>
      </div>`
    card.addEventListener('click', e => {
      if (e.target.classList.contains('media-del')) return
      if (def.isVideo) openVideo(url, f.name)
      else openImage(url, f.name)
    })
    card.querySelector('.media-del').addEventListener('click', async e => {
      e.stopPropagation()
      if (!confirm(`确定删除 ${f.name} 吗？`)) return
      await TL.deleteLocal(def.dir, f.name)
      renderMediaPage()
    })
    grid.appendChild(card)
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

$('btn-refresh').addEventListener('click', () => renderMediaPage())

$('btn-add-file').addEventListener('click', () => $('file-input').click())
$('file-input').addEventListener('change', async e => {
  const files = Array.from(e.target.files || [])
  const def = MEDIA_DEFS[currentMediaKey]
  for (const f of files) {
    await TL.addLocalFile(def.dir, f.path)
  }
  e.target.value = ''
  renderMediaPage()
})

$('btn-open-dir').addEventListener('click', async () => {
  const root = await TL.mediaRoot()
  TL.openInExplorer(root)
})

// ==================== 图片查看器 ====================
let imgScale = 1
let imgDrag = { on: false, sx: 0, sy: 0, tx: 0, ty: 0 }

function openImage(url, name) {
  const img = $('img-view')
  img.src = url
  imgScale = 1
  imgDrag.tx = 0; imgDrag.ty = 0
  img.style.transform = 'scale(1) translate(0px,0px)'
  $('img-modal').classList.remove('hidden')
}

function applyImgTransform() {
  $('img-view').style.transform = `scale(${imgScale}) translate(${imgDrag.tx}px,${imgDrag.ty}px)`
}

$('img-close').addEventListener('click', () => $('img-modal').classList.add('hidden'))
$('img-zoom-in').addEventListener('click', () => { imgScale = Math.min(8, imgScale * 1.3); applyImgTransform() })
$('img-zoom-out').addEventListener('click', () => { imgScale = Math.max(0.2, imgScale / 1.3); applyImgTransform() })
$('img-fit').addEventListener('click', () => { imgScale = 1; imgDrag.tx = 0; imgDrag.ty = 0; applyImgTransform() })

$('img-stage').addEventListener('wheel', e => {
  e.preventDefault()
  imgScale = Math.max(0.2, Math.min(8, imgScale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
  applyImgTransform()
})

$('img-view').addEventListener('mousedown', e => {
  imgDrag.on = true
  imgDrag.sx = e.clientX - imgDrag.tx
  imgDrag.sy = e.clientY - imgDrag.ty
  e.target.classList.add('zooming')
})
window.addEventListener('mousemove', e => {
  if (!imgDrag.on) return
  imgDrag.tx = e.clientX - imgDrag.sx
  imgDrag.ty = e.clientY - imgDrag.sy
  applyImgTransform()
})
window.addEventListener('mouseup', () => {
  if (imgDrag.on) { imgDrag.on = false; $('img-view').classList.remove('zooming') }
})

// ==================== 视频播放器 ====================
let vidZoom = 1
const VID_ZOOMS = [1, 1.3, 1.6, 2]
let vidZoomIdx = 0

function openVideo(url, name) {
  const v = $('vid-view')
  v.src = url
  vidZoomIdx = 0
  applyVidZoom()
  $('vid-modal').classList.remove('hidden')
  $('vid-progress-row').classList.remove('hidden')
  $('vid-time-cur').textContent = '00:00'
  $('vid-time-total').textContent = '00:00'
  $('vid-seek').value = 0
  v.play().catch(() => {})
}

function fmtTime(sec) {
  if (!isFinite(sec)) return '00:00'
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60)
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

function applyVidZoom() {
  const v = $('vid-view')
  v.style.transform = `scale(${VID_ZOOMS[vidZoomIdx]})`
}

$('vid-close').addEventListener('click', () => {
  $('vid-modal').classList.add('hidden')
  $('vid-view').pause()
  $('vid-view').src = ''
})
$('vid-play').addEventListener('click', () => {
  const v = $('vid-view')
  if (v.paused) {
    v.play()
  } else {
    v.pause()
  }
})
$('vid-zoom').addEventListener('click', () => {
  vidZoomIdx = (vidZoomIdx + 1) % VID_ZOOMS.length
  applyVidZoom()
})
$('vid-rewind').addEventListener('click', () => {
  const v = $('vid-view')
  v.currentTime = Math.max(0, v.currentTime - seekStep)
})
$('vid-forward').addEventListener('click', () => {
  const v = $('vid-view')
  v.currentTime = Math.min(v.duration || v.currentTime, v.currentTime + seekStep)
})
$('vid-view').addEventListener('timeupdate', () => {
  $('vid-time-cur').textContent = fmtTime($('vid-view').currentTime)
  $('vid-time-total').textContent = fmtTime($('vid-view').duration)
  if (!$('vid-seek').dataset.dragging) {
    const d = $('vid-view').duration
    $('vid-seek').value = d ? ($('vid-view').currentTime / d * 100) : 0
  }
})
$('vid-seek').addEventListener('mousedown', () => $('vid-seek').dataset.dragging = '1')
$('vid-seek').addEventListener('touchstart', () => $('vid-seek').dataset.dragging = '1')
$('vid-seek').addEventListener('change', () => {
  const d = $('vid-view').duration
  if (d) $('vid-view').currentTime = d * $('vid-seek').value / 100
  delete $('vid-seek').dataset.dragging
})

// ==================== 文件传输页 ====================
async function renderTransfer() {
  peers = await TL.getPeers()
  const list = $('peer-list')
  list.innerHTML = ''
  $('peer-empty').classList.toggle('hidden', peers.length > 0)

  for (const p of peers) {
    const offline = p.online === false
    const card = document.createElement('div')
    card.className = 'peer-card' + (selectedPeer && selectedPeer.id === p.id ? ' selected' : '') + (offline ? ' offline' : '')
    card.innerHTML = `
      <div>
        <div class="peer-name">${escapeHtml(p.name)}${offline ? ' <span class="peer-offline-tag">离线</span>' : ''}</div>
        <div class="peer-detail">${escapeHtml(p.ip)}:${p.port} · ${typeName(p.type)}</div>
      </div>
      <div class="peer-detail">${p.version}</div>`
    card.addEventListener('click', () => {
      if (offline) {
        log('设备离线，正在自动重连…')
        return
      }
      selectedPeer = p
      selectedPeerDir = 'lttp'
      $('peer-title').textContent = `对端文件 · ${p.name}`
      $('peer-panel').classList.remove('hidden')
      renderTransfer()
      renderPeerPanel()
    })
    list.appendChild(card)
  }
}

function typeName(t) {
  return t === 'pc' ? '电脑' : t === 'phone' ? '手机' : '手表'
}

$('btn-close-peer').addEventListener('click', () => {
  selectedPeer = null
  $('peer-panel').classList.add('hidden')
  renderTransfer()
})

$('btn-peer-refresh').addEventListener('click', () => renderPeerPanel())

async function renderPeerPanel() {
  if (!selectedPeer) return
  const dirs = [
    { id: 'lttp', label: '雷霆图片' },
    { id: 'ltsp', label: '雷霆视频' },
    { id: 'ERCYSP', label: 'ERCY视频' },
    { id: 'ERCYtp', label: 'ERCY图片' },
    { id: 'files', label: '任意文件' }
  ]
  const tabs = $('peer-dirs')
  tabs.innerHTML = ''
  for (const d of dirs) {
    const tab = document.createElement('div')
    tab.className = 'dir-tab' + (d.id === selectedPeerDir ? ' active' : '')
    tab.textContent = d.label
    tab.addEventListener('click', () => {
      selectedPeerDir = d.id
      renderPeerPanel()
    })
    tabs.appendChild(tab)
  }

  const files = await TL.remoteList(selectedPeer, selectedPeerDir)
  const box = $('peer-files')
  box.innerHTML = ''
  for (const f of files) {
    const row = document.createElement('div')
    row.className = 'pfile'
    row.innerHTML = `
      <span class="pfile-name">${escapeHtml(f.name)}</span>
      <div class="pfile-actions">
        <span class="pfile-size">${fmtSize(f.size)}</span>
        ${selectedPeerDir === 'files' ? '' : '<button class="act-view">👁</button>'}
        <button class="act-down">↓ 下载</button>
        <button class="act-del">✕</button>
      </div>`
    const btnView = row.querySelector('.act-view')
    if (btnView) btnView.addEventListener('click', async e => {
      e.stopPropagation()
      const url = `http://${selectedPeer.ip}:${selectedPeer.port}/api/media?dir=${encodeURIComponent(selectedPeerDir)}&name=${encodeURIComponent(f.name)}`
      const isVideo = selectedPeerDir === 'ltsp' || selectedPeerDir === 'ERCYSP'
      if (isVideo) {
        openVideo(url, f.name)
      } else {
        openImage(url, f.name)
      }
    })
    row.querySelector('.act-down').addEventListener('click', async e => {
      e.stopPropagation()
      row.classList.add('downloading')
      log(`下载 ${f.name} …`)
      const r = await TL.remoteDownload(selectedPeer, selectedPeerDir, f.name)
      row.classList.remove('downloading')
      if (r && r.ok) log(`已下载到本地：${r.name}`)
      else log('下载失败')
      renderPeerPanel()
    })
    row.querySelector('.act-del').addEventListener('click', async e => {
      e.stopPropagation()
      if (!confirm(`删除对端文件 ${f.name} ？`)) return
      await TL.remoteDelete(selectedPeer, selectedPeerDir, f.name)
      renderPeerPanel()
    })
    box.appendChild(row)
  }
}

function log(msg) {
  const box = $('transfer-log')
  box.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
}

$('btn-upload-file').addEventListener('click', () => $('upload-input').click())
$('upload-input').addEventListener('change', async e => {
  const files = Array.from(e.target.files || [])
  for (const f of files) {
    log(`上传 ${f.name} …`)
    const r = await TL.remoteUpload(selectedPeer, selectedPeerDir, f.path)
    if (r && r.body && r.body.ok) log(`上传完成：${f.name}`)
    else log('上传失败')
  }
  e.target.value = ''
  renderPeerPanel()
})

// ==================== 设备发现轮询 ====================
TL.onPeersChanged(list => {
  peers = list
  // 若当前页面是传输页且无选中设备，刷新列表
  if (!$('page-transfer').classList.contains('hidden')) {
    if (!selectedPeer) renderTransfer()
    else {
      renderTransfer() // 更新设备卡片状态
      if ($('peer-panel').classList.contains('hidden')) { /* keep */ }
    }
  }
})

setInterval(async () => {
  if (!$('page-transfer').classList.contains('hidden')) {
    if (!selectedPeer) renderTransfer()
  }
}, 5000)

// ==================== 初始化 ====================
loadSelf().then(() => {
  renderSettings()
  switchPage('media-lttp')
})
