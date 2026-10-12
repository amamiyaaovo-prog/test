const { app, BrowserWindow, ipcMain, screen, Menu } = require('electron');
const path = require('path');

const W = 220, H = 200;
let win;

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: W, height: H,
    x: workArea.x + workArea.width - W - 80,
    y: workArea.y + workArea.height - H,
    transparent: true, frame: false, resizable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile('index.html');
}

// 窗口位置/屏幕信息
ipcMain.handle('get-bounds', () => ({ ...win.getBounds(), work: screen.getDisplayMatching(win.getBounds()).workArea }));
ipcMain.on('set-pos', (_e, x, y) => win.setPosition(Math.round(x), Math.round(y)));
ipcMain.on('menu', (e) => {
  const send = (cmd) => () => e.sender.send('command', cmd);
  Menu.buildFromTemplate([
    { label: '陪我玩 (开心)', click: send('happy') },
    { label: '睡觉 / 醒来', click: send('toggle-sleep') },
    { label: '开始 / 停止散步', click: send('toggle-walk') },
    { type: 'separator' },
    { label: '退出 Clawd', click: () => app.quit() },
  ]).popup({ window: win });
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
