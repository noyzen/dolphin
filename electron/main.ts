import { app, BrowserWindow, globalShortcut, session, ipcMain, dialog } from 'electron';
import path from 'path';
import Store from 'electron-store';
import { exec } from 'child_process';
import os from 'os';
import fs from 'fs/promises';


// Define the shape of the stored data.
interface AppStore {
  windowBounds: { width: number; height: number; x?: number; y?: number };
  isMaximized?: boolean;
  backupPath?: string;
  restorePath?: string;
  selectiveBackupPath?: string;
  selectiveRestoreFolder?: string;
}

const store = new Store<AppStore>({
  defaults: {
    windowBounds: { width: 1024, height: 768 },
    isMaximized: false,
    backupPath: '',
    restorePath: '',
    selectiveBackupPath: '',
    selectiveRestoreFolder: '',
  },
});

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  const { width, height, x, y } = store.get('windowBounds');
  const isMaximized = store.get('isMaximized');

  mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: false, // Remove default window frame
    icon: path.join(__dirname, '../../appicon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.setMenu(null);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    if (isMaximized) {
      mainWindow?.maximize();
    }
    mainWindow?.show();
    mainWindow?.webContents.send('window-state-changed', !!isMaximized);
    // Also open DevTools in development
    if (process.env.VITE_DEV_SERVER_URL) {
      mainWindow?.webContents.openDevTools();
    }
  });

  mainWindow.on('maximize', () => {
    store.set('isMaximized', true);
    mainWindow?.webContents.send('window-state-changed', true);
  });

  mainWindow.on('unmaximize', () => {
    store.set('isMaximized', false);
    mainWindow?.webContents.send('window-state-changed', false);
  });

  mainWindow.on('resize', () => {
    // Only save window bounds when not maximized.
    if (!mainWindow?.isMaximized()) {
      const { width, height } = mainWindow!.getBounds();
      store.set('windowBounds', { ...store.get('windowBounds'), width, height });
    }
  });

  mainWindow.on('move', () => {
    // The 'move' event is not triggered when the window is maximized, so this is safe.
    if (!mainWindow?.isMaximized()) {
      const { x, y } = mainWindow!.getBounds();
      store.set('windowBounds', { ...store.get('windowBounds'), x, y });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

// IPC handlers for custom window controls
ipcMain.on('minimize-window', () => {
  mainWindow?.minimize();
});

ipcMain.on('toggle-maximize-window', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('close-window', () => {
  mainWindow?.close();
});

// IPC handlers for Driver Dolphin functionality
ipcMain.handle('check-admin', async () => {
  return new Promise<boolean>((resolve) => {
    // The 'net session' command requires admin privileges and will fail if not elevated.
    exec('net session', (error) => {
      resolve(!error);
    });
  });
});

ipcMain.handle('select-dialog', async (event, options: Electron.OpenDialogOptions) => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result.filePaths;
});


ipcMain.on('run-command', (event, command: string, description: string) => {
  const webContents = event.sender;
  webContents.send('command-start', description);
  
  const child = exec(command, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 5 }); // 5MB buffer

  child.stdout?.on('data', (data) => {
    webContents.send('command-output', data.toString());
  });

  child.stderr?.on('data', (data) => {
    webContents.send('command-output', `ERROR: ${data.toString()}`);
  });

  child.on('close', (code) => {
    webContents.send('command-end', code);
  });
});

ipcMain.handle('run-command-and-get-output', async (event, command: string) => {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
    // Using a larger buffer for potentially large driver lists
    exec(command, { shell: 'powershell.exe', encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      resolve({
        stdout,
        stderr,
        code: error ? error.code ?? 1 : 0,
      });
    });
  });
});

ipcMain.handle('check-system-restore', async () => {
  return new Promise<boolean>((resolve) => {
    // This command will error if the System Restore service is disabled.
    exec('powershell -command "Get-ComputerRestorePoint"', (error) => {
      resolve(!error);
    });
  });
});

ipcMain.handle('get-windows-path', () => os.homedir().split(path.sep)[0] + path.sep + 'Windows');

// Settings Persistence
ipcMain.handle('get-setting', async (_, key: keyof AppStore) => {
  return store.get(key);
});

ipcMain.on('set-setting', (_, { key, value }: { key: keyof AppStore, value: any }) => {
  store.set(key, value);
});

// Path validation
ipcMain.handle('validate-path', async (_, path: string) => {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
});


// Scan backup folder for drivers
ipcMain.handle('scan-backup-folder', async (_, folderPath: string) => {
  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const driverDirs = entries.filter(entry => entry.isDirectory());
    const drivers = [];
    for (const dir of driverDirs) {
      try {
        const driverPath = path.join(folderPath, dir.name);
        const files = await fs.readdir(driverPath);
        const infFile = files.find(f => f.toLowerCase().endsWith('.inf'));
        if (infFile) {
          drivers.push({
            id: dir.name,
            displayName: dir.name.split('.')[0] || dir.name, // try to get a cleaner name
            infName: infFile,
            fullInfPath: path.join(driverPath, infFile)
          });
        }
      } catch (e) {
        console.warn(`Could not process directory ${dir.name}:`, e);
      }
    }
    return drivers;
  } catch (error) {
    console.error('Failed to scan backup folder:', error);
    return []; // Return empty array on error
  }
});


app.on('ready', () => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' 'unsafe-eval'; font-src 'self' data:; connect-src 'self' ws:",
        ],
      },
    });
  });

  createWindow();

  if (process.env.VITE_DEV_SERVER_URL) {
    import('electron-devtools-installer')
      .then(({ default: installExtension, REACT_DEVELOPER_TOOLS }) => {
        installExtension(REACT_DEVELOPER_TOOLS)
          .then((name) => console.log(`Added Extension:  ${name}`))
          .catch((err) => console.log('An error occurred installing extension: ', err));
      })
      .catch((err) => console.log('Failed to import electron-devtools-installer:', err));
  }

  globalShortcut.register('CommandOrControl+Shift+I', () => {
    BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});