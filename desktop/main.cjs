const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

let serverProcess = null;
let mainWindow = null;

function findFreePort(preferred = 38450) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(preferred, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', () => {
      const fallback = net.createServer();
      fallback.listen(0, '127.0.0.1', () => {
        const { port } = fallback.address();
        fallback.close(() => resolve(port));
      });
    });
  });
}

function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('Embedded ProfileGrid server timed out'));
        } else {
          setTimeout(attempt, 200);
        }
      });
    }
    attempt();
  });
}

async function startBackend(port) {
  const appPath = app.getAppPath();
  const serverEntry = path.join(appPath, 'dist-server', 'server.cjs');
  const distDir = path.join(appPath, 'dist');
  const dataDir = path.join(app.getPath('userData'), 'data');

  serverProcess = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      PROFILEGRID_DIST_DIR: distDir,
      PROFILEGRID_DATA_DIR: dataDir,
    },
    stdio: 'pipe',
  });

  serverProcess.stdout.on('data', (d) => process.stdout.write(d));
  serverProcess.stderr.on('data', (d) => process.stderr.write(d));

  await waitForServer(`http://127.0.0.1:${port}/api/state`);
}

async function createWindow() {
  const port = await findFreePort(38450);
  await startBackend(port);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    title: 'ProfileGrid',
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
