import { app, BrowserWindow, globalShortcut, session, ipcMain } from 'electron';
import path from 'path';
import Store from 'electron-store';

// Define the shape of the stored data.
interface AppStore {
  windowBounds: { width: number; height: number; x?: number; y?: number };
  isMaximized?: boolean;
}

const store = new Store<AppStore>({
  defaults: {
    windowBounds: { width: 800, height: 600 },
    isMaximized: false,
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

app.on('ready', () => {
  // Set a robust Content Security Policy for all responses. This is the recommended
  // approach for Electron apps, as it's more secure than a meta tag.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' ws:",
        ],
      },
    });
  });

  createWindow();

  // Install React DevTools in development
  if (process.env.VITE_DEV_SERVER_URL) {
    import('electron-devtools-installer')
      .then(({ default: installExtension, REACT_DEVELOPER_TOOLS }) => {
        installExtension(REACT_DEVELOPER_TOOLS)
          .then((name) => console.log(`Added Extension:  ${name}`))
          .catch((err) => console.log('An error occurred installing extension: ', err));
      })
      .catch((err) => console.log('Failed to import electron-devtools-installer:', err));
  }

  // Re-register the shortcut for DevTools since setting menu to null disables it.
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.webContents.toggleDevTools();
    }
  });
});

app.on('will-quit', () => {
  // Unregister all shortcuts before quitting.
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