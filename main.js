const { app, BrowserWindow, Menu, ipcMain, dialog, screen, Tray, shell, net} = require('electron')
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
let basePath = app.isPackaged ? './resources/app/' : './'
let agreement = "https";
let agreementWs = "wss";
if (!store.get("isSecureConnection", true)) {
    agreement = "http";
    agreementWs = "ws";
}
let server = store.get("server", "class.khbit.cn")
let classId = store.get("class", "39/2023/1")
const WebSocket = require('ws');
let ws;
function connect(rejectUnauthorized = true) {
    let errorFlag = false;
    ws = new WebSocket.WebSocket(
        `${agreementWs}://${server}/ws/${classId}`,
        [], {
            rejectUnauthorized: rejectUnauthorized
        }
    );
    ws.on('open', () => {
        console.log('Connected to server');
        setInterval(() => {
            ws.ping(); // 发送心跳消息
            console.log('Heartbeat sent');
        }, 25000); // 每 25 秒发送一次心跳
    });

    // 处理接收到的消息
    ws.on('message', (message) => {
        console.log('Received from server:', message.toString());
        if (message.toString() === "SyncConfig") {
            console.log('SyncConfig');
            getScheduleFromCloud();
        }
    });

    // 处理连接关闭
    ws.on('close', () => {
        console.log('Disconnected from server');
        if (!errorFlag || !rejectUnauthorized)
            setTimeout(connect, 5000); // 重连
    });

    // 处理错误
    ws.on('error', (error) => {
        errorFlag = true;
        console.error('WebSocket error:', error, ", try to connect without verifying the certificate");
        if (rejectUnauthorized)
            connect(false); // 尝试连接不验证证书
    });
}
connect();
if (!app.requestSingleInstanceLock({ key: 'classSchedule' })) {
    app.quit();
}
app.commandLine.appendSwitch("--disable-http-cache");
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
function getScheduleFromCloud() {
    const { net } = require('electron')
    const url = `${agreement}://${server}/${classId}`
    // noinspection JSCheckFunctionSignatures
    const request = net.request(url)
    let scheduleConfigSync;
    request.on('response', (response) => {
        response.on('data', (chunk) => {
            scheduleConfigSync = JSON.parse(chunk.toString())
            console.log(scheduleConfigSync)
        })
        response.on('end', () => {
            console.log('No more data in response.')
            win.webContents.send("newConfig", scheduleConfigSync)
        })
    })
    request.end()
}
app.whenReady().then(() => {
    createWindow()
    Menu.setApplicationMenu(null)
    win.webContents.on('did-finish-load', () => {
        win.webContents.send('getWeekIndex');
        if (store.get("isFromCloud", false)) {
            setTimeout(getScheduleFromCloud, 5000)
        }
    })
    const handle = win.getNativeWindowHandle();
    DisableMinimize(handle); // Thank to peter's project https://github.com/tbvjaos510/electron-disable-minimize
    setAutoLaunch()
})

ipcMain.on('getWeekIndex', (e, arg) => {
    tray = new Tray(basePath + 'image/icon.png')
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
            icon: basePath + 'image/toggle.png',
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
            icon: basePath + 'image/toggle.png',
            label: '所在班级',
            click: () => {
                win.webContents.send('setClass')
            }
        },
        {
            icon: basePath + 'image/toggle.png',
            label: '刷新天气',
            click: () => {
                win.webContents.send('updateWeather')
            }
        },
        {
            icon: basePath + 'image/toggle.png',
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
                    icon: basePath + 'image/toggle.png',
                }).then((r) => {
                    if (r === null) {
                        console.log('[Local] User cancelled');
                    } else {
                        store.set("local", r.toString())
                        console.log('[Local] ', r.toString());
                    }
                })
            }
        },
        {
            icon: basePath + 'image/toggle.png',
            label: '下发级部',
            click: () => {
                win.webContents.send('broadcastSyncConfig')
            }
        },
        {
            type: 'separator'
        },
        {
            icon: basePath + 'image/setting.png',
            label: '配置课表',
            click: () => {
                win.webContents.send('openSettingDialog')
            }
        },
        {
            icon: basePath + 'image/clock.png',
            label: '矫正计时',
            click: () => {
                win.webContents.send('getTimeOffset')
            }
        },
        {
            icon: basePath + 'image/toggle.png',
            label: '切换日程',
            click: () => {
                win.webContents.send('setDayOffset')
            }
        },
        {
            icon: basePath + 'image/github.png',
            label: '源码仓库',
            click: () => {
                // noinspection JSIgnoredPromiseFromCall
                shell.openExternal('https://github.com/daizihan233/ElectronClassSchedule');
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
            icon: basePath + 'image/quit.png',
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
    template[arg].checked = true
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

ipcMain.on('getTimeOffset', (e, arg) => {
    prompt({
        title: '计时矫正',
        label: '请设置课表计时与系统时间的偏移秒数:',
        value: arg.toString(),
        inputAttrs: {
            type: 'number'
        },
        type: 'input',
        height: 180,
        width: 400,
        icon: basePath + 'image/clock.png',
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
        value: arg.toString(),
        inputAttrs: {
            type: 'string'
        },
        type: 'input',
        height: 180,
        width: 400,
        icon: basePath + 'image/toggle.png',
    }).then((r) => {
        if (r === null) {
            console.log('[Cloud] User cancelled');
        } else {
            win.webContents.send('setCloudUrl', r.toString())
            store.set("server", r.toString())
            console.log('[Cloud] ', r.toString());
        }
    })
})


ipcMain.on('setClass', (e, arg) => {
    prompt({
        title: '所在班级',
        label: '请设置所在班级：',
        value: arg.toString(),
        inputAttrs: {
            type: 'string'
        },
        type: 'input',
        height: 180,
        width: 400,
        icon: basePath + 'image/toggle.png',
    }).then((r) => {
        if (r === null) {
            console.log('[Cloud] User cancelled');
        } else {
            win.webContents.send('setCloudClass', r.toString())
            store.set("class", r.toString())
            console.log('[Cloud] ', r.toString());
        }
    })
})


ipcMain.on('getWeather', () => {
    const { net } = require('electron')
    const request = net.request(
        `${agreement}://${server}/api/weather/${store.get('local', "Nanjing/Gulou")}`
    )
    let weatherData;
    try {
        request.on('response', (response) => {
            response.on('data', (chunk) => {
                weatherData = JSON.parse(chunk.toString())
            })
            response.on('end', () => {
                win.webContents.send('setWeather', weatherData)
            })
        })
    } catch (e) {
        console.log(e)
    }
    request.end()
})

ipcMain.on('RequestSyncConfig', () => {
    prompt({
        title: '云端密码',
        label: '请输入密码：',
        value: "",
        inputAttrs: {
            type: 'password'
        },
        type: 'input',
        height: 180,
        width: 400,
        icon: basePath + 'image/toggle.png',
    }).then((r) => {
        const { net } = require('electron')
        const request = net.request(
            {
                method: 'POST',
                url: `${agreement}://${server}/api/broadcast/${classId}`,
                headers: {
                    "Authorization": `Basic ${Buffer.from(
                        `ElectronClassSchedule:${r.toString()}`
                    ).toString('base64')}`,
                }
            }
        )
        try {
            request.on('response', (response) => {
                response.on('data', (chunk) => {
                    console.log(chunk.toString())
                })
                response.on('end', () => {
                    console.log(response.statusCode)
                    const { dialog } = require('electron');
                    if (response.statusCode === 200) {
                        dialog.showMessageBox({
                            type: 'info',
                            title: '提示',
                            message: '已下发成功',
                            buttons: ['已阅'],
                        }).then(r => {});
                    } else if (response.statusCode === 401) {
                        dialog.showMessageBox({
                            type: 'error',
                            title: '错误',
                            message: '服务端返回错误代码 401，这可能由于密码错误',
                            buttons: ['已阅'],
                        }).then(r => {});
                    } else {
                        dialog.showMessageBox({
                            type: 'error',
                            title: '错误',
                            message: `服务端返回错误代码 ${response.statusCode}，这可能是因为服务端错误或正在被攻击`,
                            buttons: ['已阅'],
                        }).then(r => {});
                    }
                })
            })
        } catch (e) {
            console.log(e)
        }
        request.end()
    })
})

