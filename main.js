const electron = require('electron');
const { app, BrowserWindow, Menu, ipcMain, dialog, screen, Tray, shell } = electron
const path = require('path');
const fs = require('fs')
const os = require('os')
const createShortcut = require('windows-shortcuts')
const startupFolderPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const prompt = require('electron-prompt');
const Store = require('electron-store');
const { DisableMinimize } = require('electron-disable-minimize');
const store = new Store();
let tray;
let form;
let win;
let template = []
// 统一资源路径解析，兼容 asar
const asset = (...p) => path.join(__dirname, ...p)

function doNothing(_) { /* 一些 dialog 会返回一个 promise 但并不需要处理 */ }

// 使用函数动态获取协议与服务器，避免缓存导致不一致
function getProtocols() {
    const secure = store.get('isSecureConnection', true)
    return { agreement: secure ? 'https' : 'http', agreementWs: secure ? 'wss' : 'ws' }
}
function getServer() {
    return String(store.get('server', 'class.khbit.cn'))
}
let classId = String(store.get("class", "39/2023/1"))
console.log('Class:', classId, 'Server:', getServer(), 'Secure:', store.get("isSecureConnection", true));

const WebSocket = require('ws');
let ws;
let heartbeatTimer = null;
let reconnectTimer = null;

function clearHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
    }
}
function scheduleReconnect(delayMs = 5000) {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
    }
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
    }, delayMs)
}
function connect(rejectUnauthorized = true) {
    let errorFlag = false;
    const { agreementWs } = getProtocols()
    const server = getServer()
    const url = `${agreementWs}://${server}/ws/${classId}`

    try {
        // 关闭旧连接与心跳
        try { ws?.removeAllListeners() } catch {}
        try { ws?.close() } catch {}
        clearHeartbeat()

        ws = new WebSocket(url, [], { rejectUnauthorized })
    } catch (err) {
        console.error('WebSocket create error:', err)
        scheduleReconnect()
        return
    }

    ws.on('open', () => {
        console.log('Connected to server')
        clearHeartbeat()
        heartbeatTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try { ws.ping() } catch (e) { console.log('Heartbeat ping failed:', e?.message || e) }
                console.log('Heartbeat sent')
            } else {
                console.log('Disconnected from server, No heartbeat sent')
            }
        }, 25000)
    })

    // 处理接收到的消息
    ws.on('message', (message) => {
        const text = message?.toString?.() ?? ''
        console.log('Received from server:', text)
        if (text === 'SyncConfig') {
            console.log('SyncConfig')
            getScheduleFromCloud()
        }
    })

    // 处理连接关闭
    ws.on('close', () => {
        console.log('Disconnected from server')
        clearHeartbeat()
        // 与原逻辑一致：若非 error 触发，或当前为不验证证书的连接，均进行重连
        if (!errorFlag || !rejectUnauthorized) {
            scheduleReconnect()
        }
    })

    // 处理错误
    ws.on('error', (error) => {
        errorFlag = true;
        console.error('WebSocket error:', error, ', try to connect without verifying the certificate')
        clearHeartbeat()
        if (rejectUnauthorized) {
            // 尝试连接不验证证书
            scheduleReconnect(0)
            connect(false)
        }
    })
}
connect();

// 防止多开
const gotTheLock = app.requestSingleInstanceLock({ key: 'classSchedule' })
if (!gotTheLock) {
    app.quit();
}
app.on('second-instance', () => {
    if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
    }
})

// 正确禁用缓存的开关名
app.commandLine.appendSwitch('disable-http-cache');

const createWindow = () => {
    // noinspection JSCheckFunctionSignatures
    win = new BrowserWindow({
        x: 0,
        y: 0,
        width: screen.getPrimaryDisplay().workAreaSize.width,
        height: 200,
        frame: false,
        transparent: true,
        alwaysOnTop: store.get('isWindowAlwaysOnTop', true),
        minimizable: false,
        maximizable: false,
        autoHideMenuBar: true,
        resizable: false,
        type: 'toolbar',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
    })
    // win.webContents.openDevTools()
    // noinspection JSIgnoredPromiseFromCall
    win.loadFile('index.html')
    if (store.get('isWindowAlwaysOnTop', true))
        win.setAlwaysOnTop(true, 'screen-saver', 9999999999999)
}
function setAutoLaunch() {
    const shortcutName = '电子课表(请勿重命名).lnk'
    app.setLoginItemSettings({ // backward compatible
        openAtLogin: false,
        openAsHidden: false
    })
    if (store.get('isAutoLaunch', true)) {
        createShortcut.create(startupFolderPath + '/' + shortcutName,
            {
                target: app.getPath('exe'),
                workingDir: app.getPath('exe').split('\\').slice(0, -1).join('\\'),
            }, (e) => { e && console.log(e); })
    } else {
        fs.unlink(startupFolderPath + '/' + shortcutName, () => { })
    }

}

// 简单 semver 校验（x.y.z，可带 -/+ 后缀）
function isSemver(v) {
    return /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(String(v || ''))
}

// 自动更新设置（仅打包且版本为 semver 时生效）
let updaterInitialized = false
function setupAutoUpdater() {
    try {
        if (!app.isPackaged) return;
        const v = app.getVersion();
        if (!isSemver(v)) {
            console.warn('[Updater] disabled due to non-semver version:', v)
            return;
        }
        if (updaterInitialized) return
        const { autoUpdater } = require('electron-updater')
        // 默认镜像地址（latest.yml 与安装包所在目录）- 适配 GitHub 最新发布路径
        const defaultMirror = 'https://hubproxy.khbit.cn/https://github.com/daizihan233/ElectronClassSchedule/releases/latest/download'
        let updateBaseUrl = store.get('updateBaseUrl')
        if (!updateBaseUrl || typeof updateBaseUrl !== 'string' || updateBaseUrl.trim().length === 0) {
            updateBaseUrl = defaultMirror
            store.set('updateBaseUrl', updateBaseUrl)
        }
        autoUpdater.setFeedURL({ provider: 'generic', url: updateBaseUrl.trim() })
        autoUpdater.autoDownload = true
        autoUpdater.autoInstallOnAppQuit = true
        autoUpdater.allowPrerelease = true
        autoUpdater.on('checking-for-update', () => console.log('[Updater] checking-for-update'))
        autoUpdater.on('update-available', (info) => {
            console.log('[Updater] update-available', info?.version)
            tray?.setToolTip(`电子课表 - 正在下载更新 ${info?.version || ''}`)
        })
        autoUpdater.on('update-not-available', () => console.log('[Updater] update-not-available'))
        autoUpdater.on('error', (err) => console.error('[Updater] error', err))
        autoUpdater.on('download-progress', (p) => {
            const percent = Math.floor(p.percent || 0)
            tray?.setToolTip(`电子课表 - 更新下载中 ${percent}%`)
        })
        autoUpdater.on('update-downloaded', () => {
            // 静默安装：无需提示，立即重启安装
            try { console.log('[Updater] update-downloaded -> quitAndInstall') } catch {}
            autoUpdater.quitAndInstall()
        })
        // 仅启动时检查一次
        const check = () => autoUpdater.checkForUpdates().catch(() => {})
        setTimeout(check, 3000)
        updaterInitialized = true
    } catch (e) {
        console.error('[Updater] setup failed', e)
    }
}

function getScheduleFromCloud() {
    const { net } = require('electron')
    const { agreement } = getProtocols()
    const url = `${agreement}://${getServer()}/${classId}`
    // noinspection JSCheckFunctionSignatures
    const request = net.request(url)
    let raw = ''
    request.on('response', (response) => {
        response.on('data', (chunk) => {
            raw += chunk.toString()
        })
        response.on('end', () => {
            try {
                const scheduleConfigSync = JSON.parse(raw)
                console.log(scheduleConfigSync)
                if (win && !win.isDestroyed()) win.webContents.send('newConfig', scheduleConfigSync)
            } catch (err) {
                console.error('getScheduleFromCloud JSON parse error:', err)
            }
            console.log('No more data in response.')
        })
    })
    request.on('error', (err) => {
        console.error('getScheduleFromCloud request error:', err)
    })
    request.end()
}
app.whenReady().then(() => {
    createWindow()
    Menu.setApplicationMenu(null)
    setupAutoUpdater()
    win.webContents.on('did-finish-load', () => {
        win.webContents.send('getWeekIndex');
        if (store.get("isFromCloud", false)) {
            setTimeout(getScheduleFromCloud, 5000)
        }
    })
    // powerMonitor 事件无 preventDefault
    electron.powerMonitor.on('suspend', () => {
        app.quit()
    })
    electron.powerMonitor.on('shutdown', () => {
        app.quit()
    })
    const handle = win.getNativeWindowHandle();
    try { DisableMinimize(handle) } catch (e) { console.warn('DisableMinimize failed:', e?.message || e) }
    setAutoLaunch()
})

ipcMain.on('getWeekIndex', (e, arg) => {
    tray = new Tray(asset('image', 'icon.png'))
    template = [
        {
            label: '连接云端',
            type: 'checkbox',
            checked: store.get('isFromCloud', false),
            click: (e) => {
                store.set('isFromCloud', e.checked)
            }
        },
        {
            icon: asset('image', 'toggle.png'),
            label: '更新源(可选)',
            click: () => {
                const current = store.get('updateBaseUrl', '') || ''
                prompt({
                    title: '更新源(可选)',
                    label: '请输入更新源基础地址(需包含 latest.yml 的目录，如 https://your.cdn.com/app)：',
                    value: current,
                    inputAttrs: { type: 'string' },
                    type: 'input',
                    height: 220,
                    width: 520,
                    icon: asset('image', 'toggle.png'),
                }).then((r) => {
                    if (r === null) {
                        console.log('[Updater] Mirror cancelled')
                    } else {
                        store.set('updateBaseUrl', r.toString())
                        dialog.showMessageBox(win, {message: '更新源已保存，重启应用后生效。'}).then(doNothing)
                    }
                })
            }
        },
        {
            label: '检查更新',
            click: () => {
                if (!app.isPackaged) {
                    dialog.showMessageBox(win, { message: '开发模式下不检查更新。' }).then(doNothing)
                    return
                }
                if (!isSemver(app.getVersion())) {
                    dialog.showMessageBox(win, { message: '当前版本号非语义化版本，已禁用自动更新。' }).then(doNothing)
                    return
                }
                setupAutoUpdater()
                // 按需加载再调用
                const { autoUpdater } = require('electron-updater')
                autoUpdater.checkForUpdates().catch((err) => {
                    console.error('[Updater] manual check failed', err)
                    dialog.showMessageBox(win, { type: 'error', message: '检查更新失败，请稍后再试。' }).then(doNothing)
                })
            }
        },
        {
            icon: asset('image', 'toggle.png'),
            label: '云端服务',
            click: () => {
                win.webContents.send('fromCloud')
            }
        },
        {
            label: '安全连接',
            type: 'checkbox',
            checked: store.get('isSecureConnection', true),
            click: (e) => {
                store.set('isSecureConnection', e.checked)
                win.webContents.send('setCloudSec', e.checked)
            }
        },
        {
            icon: asset('image', 'toggle.png'),
            label: '所在班级',
            click: () => {
                win.webContents.send('setClass')
            }
        },
        {
            icon: asset('image', 'toggle.png'),
            label: '刷新天气',
            click: () => {
                win.webContents.send('updateWeather')
            }
        },
        {
            icon: asset('image', 'toggle.png'),
            label: '当前地区',
            click: () => {
                prompt({
                    title: '地理位置',
                    label: '请设置当前所在地区:',
                    value: store.get('local', "Nanjing/Gulou"),
                    inputAttrs: {
                        type: 'string'
                    },
                    type: 'input',
                    height: 180,
                    width: 400,
                    icon: asset('image', 'toggle.png'),
                }).then((r) => {
                    if (r === null) {
                        console.log('[Local] User cancelled');
                    } else {
                        store.set('local', r.toString())
                        console.log('[Local] ', r.toString());
                    }
                })
            }
        },
        {
            icon: asset('image', 'toggle.png'),
            label: '更新课表',
            click: () => {
                win.webContents.send('broadcastSyncConfig')
            }
        },
        {
            type: 'separator'
        },
        {
            icon: asset('image', 'setting.png'),
            label: '配置课表',
            click: () => {
                win.webContents.send('openSettingDialog')
            }
        },
        {
            icon: asset('image', 'clock.png'),
            label: '矫正计时',
            click: () => {
                win.webContents.send('getTimeOffset')
            }
        },
        {
            icon: asset('image', 'toggle.png'),
            label: '切换日程',
            click: () => {
                win.webContents.send('setDayOffset')
            }
        },
        {
            icon: asset('image', 'github.png'),
            label: '源码仓库',
            click: () => {
                shell.openExternal('https://github.com/daizihan233/ElectronClassSchedule').then(doNothing);
            }
        },
        {
            type: 'separator'
        },
        {
            id: 'countdown',
            label: '课上计时',
            type: 'checkbox',
            checked: store.get('isDuringClassCountdown', true),
            click: (e) => {
                store.set('isDuringClassCountdown', e.checked)
                win.webContents.send('ClassCountdown', e.checked)
            }
        },
        {
            label: '窗口置顶',
            type: 'checkbox',
            checked: store.get('isWindowAlwaysOnTop', true),
            click: (e) => {
                store.set('isWindowAlwaysOnTop', e.checked)
                if (store.get('isWindowAlwaysOnTop', true))
                    win.setAlwaysOnTop(true, 'screen-saver', 9999999999999)
                else
                    win.setAlwaysOnTop(false)
            }
        },
        {
            label: '上课隐藏',
            type: 'checkbox',
            checked: store.get('isDuringClassHidden', true),
            click: (e) => {
                store.set('isDuringClassHidden', e.checked)
                win.webContents.send('ClassHidden', e.checked)
            }
        },
        {
            label: '开机启动',
            type: 'checkbox',
            checked: store.get('isAutoLaunch', true),
            click: (e) => {
                store.set('isAutoLaunch', e.checked)
                setAutoLaunch()
            }
        },
        {
            type: 'separator'
        },
        {
            icon: asset('image', 'quit.png'),
            label: '退出程序',
            click: () => {
                dialog.showMessageBox(win, {
                    title: '请确认',
                    message: '你确定要退出程序吗?',
                    buttons: ['取消', '确定']
                }).then((data) => {
                    if (data.response) app.quit()
                })
            }
        }
    ]
    template[arg]?.checked !== undefined && (template[arg].checked = true)
    form = Menu.buildFromTemplate(template)
    tray.setToolTip('电子课表 - by KuoHu')
    function trayClicked() {
        tray.popUpContextMenu(form)
    }
    tray.on('click', trayClicked)
    tray.on('right-click', trayClicked)
    tray.setContextMenu(form)
    win.webContents.send('ClassCountdown', store.get('isDuringClassCountdown', true))
    win.webContents.send('ClassHidden', store.get('isDuringClassHidden', true))
})

// 提供鼠标位置与窗口边界给渲染进程（用于穿透下的悬停检测）
ipcMain.handle('getCursorAndBounds', () => {
    try {
        const pt = screen.getCursorScreenPoint()
        const bounds = win?.getBounds?.() || { x: 0, y: 0, width: 0, height: 0 }
        return { cursor: pt, bounds }
    } catch (e) {
        return { cursor: { x: 0, y: 0 }, bounds: { x: 0, y: 0, width: 0, height: 0 } }
    }
})

ipcMain.on('log', (e, arg) => {
    console.log(arg);
})

ipcMain.on('setIgnore', (e, arg) => {
    if (arg)
        win.setIgnoreMouseEvents(true, { forward: true });
    else
        win.setIgnoreMouseEvents(false);
})

ipcMain.on('dialog', (e, arg) => {
    dialog.showMessageBox(win, arg.options).then((data) => {
        e.reply(arg.reply, { 'arg': arg, 'index': data.response })
    })
})

ipcMain.on('pop', () => {
    tray.popUpContextMenu(form)
})

ipcMain.on('getWeather', () => {
    const { net } = require('electron')
    const { agreement } = getProtocols()
    const request = net.request(
        `${agreement}://${getServer()}/api/weather/${store.get('local', "Nanjing/Gulou")}`
    )
    let raw = ''
    request.on('response', (response) => {
        const status = response.statusCode || 0
        response.on('data', (chunk) => {
            raw += chunk.toString()
        })
        response.on('end', () => {
            if (status >= 200 && status < 300) {
                try {
                    const weatherData = JSON.parse(raw)
                    if (win && !win.isDestroyed()) win.webContents.send('setWeather', weatherData)
                } catch (e) {
                    console.error('Weather JSON parse error:', e)
                    setTimeout(() => win?.webContents?.send('updateWeather'), 5000)
                }
            } else {
                console.log(`Weather API non-2xx: ${status}, retry later`)
                setTimeout(() => win?.webContents?.send('updateWeather'), 5000)
            }
        })
    })
    request.on('error', (error) => {
        console.error('Weather API error:', error, 'retry later')
        setTimeout(() => win?.webContents?.send('updateWeather'), 5000)
    })
    request.end()
})

ipcMain.on('RequestSyncConfig', () => {
    prompt({
        title: '云端密码',
        label: '请输入密码：',
        value: "",
        inputAttrs: { type: 'password' },
        type: 'input',
        height: 180,
        width: 400,
        icon: asset('image', 'toggle.png'),
    }).then((r) => {
        if (r === null) return;
        const { net } = require('electron')
        const { agreement } = getProtocols()
        // noinspection JSCheckFunctionSignatures
        const request = net.request({
            method: 'POST',
            url: `${agreement}://${getServer()}/api/broadcast/${classId}`,
            headers: {
                "Authorization": 'Basic ' + Buffer.from('ElectronClassSchedule:' + String(r)).toString('base64'),
            }
        })
        try {
            request.on('response', (response) => {
                response.on('data', () => {})
                response.on('end', () => {
                    const { dialog } = require('electron');
                    if (response.statusCode === 200) {
                        dialog.showMessageBox(
                            { type: 'info', title: '提示', message: '已下发成功', buttons: ['已阅'] }).then(doNothing)
                    } else if (response.statusCode === 401) {
                        dialog.showMessageBox({ type: 'error', title: '错误', message: '服务端返回 401，可能密码错误', buttons: ['已阅'] }).then(doNothing)
                    } else {
                        dialog.showMessageBox({ type: 'error', title: '错误', message: `服务端返回 ${response.statusCode}` , buttons: ['已阅'] }).then(doNothing)
                    }
                })
            })
        } catch (e) {
            console.log(e)
        }
        request.on('error', (err) => console.error('Broadcast request error:', err))
        request.end()
    })
})

ipcMain.on('getTimeOffset', (e, arg) => {
    prompt({
        title: '计时矫正',
        label: '请设置课表计时与系统时间的偏移秒数:',
        value: String(arg ?? 0),
        inputAttrs: {
            type: 'number'
        },
        type: 'input',
        height: 180,
        width: 400,
        icon: asset('image', 'clock.png'),
    }).then((r) => {
        if (r === null) {
            console.log('[getTimeOffset] User cancelled');
        } else {
            win.webContents.send('setTimeOffset', Number(r) % 10000000000000)
        }
    })
})

ipcMain.on('fromCloud', (e, arg) => {
    prompt({
        title: '云端服务',
        label: '请设置云端服务：',
        value: String(arg ?? store.get('server', 'class.khbit.cn')),
        inputAttrs: {
            type: 'string'
        },
        type: 'input',
        height: 180,
        width: 400,
        icon: asset('image', 'toggle.png'),
    }).then((r) => {
        if (r === null) {
            console.log('[Cloud] User cancelled');
        } else {
            win.webContents.send('setCloudUrl', r.toString())
            store.set('server', r.toString())
            console.log('[Cloud] ', r.toString());
        }
    })
})
