import { app, BrowserWindow, globalShortcut, session, ipcMain, dialog, MessageBoxOptions } from 'electron';
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
    exec(command, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
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

// Helper function to recursively find all .inf files in a directory
async function findInfFiles(dir: string): Promise<string[]> {
    let files: string[] = [];
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                files = files.concat(await findInfFiles(fullPath));
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.inf')) {
                files.push(fullPath);
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${dir}:`, error);
    }
    return files;
}


// Scan backup folder for drivers
ipcMain.handle('scan-backup-folder', async (_, folderPath: string): Promise<{ drivers: any[], errors: string[] }> => {
  const errors: string[] = [];
  const logError = (msg: string) => {
      console.error(msg); // Keep console logging for dev
      errors.push(msg);
  };
  
  try {
    const infFiles = await findInfFiles(folderPath);
    if (infFiles.length === 0) {
      const msg = `Scan complete: No .inf files found in the directory: ${folderPath}`;
      return { drivers: [], errors: [msg] };
    }
    
    errors.push(`Found ${infFiles.length} .inf files to process.`);

    const sanitizedInfPaths = infFiles.map(f => `'${f.replace(/'/g, "''")}'`).join(',');
    
    // PowerShell script to parse INF files.
    // It now attempts to auto-detect encoding and reports errors for individual files.
    const command = `
        $infPaths = @(${sanitizedInfPaths});
        $allDrivers = @();
        foreach ($infPath in $infPaths) {
            try {
                # Attempt to read with auto-detection; this is more robust than forcing an encoding.
                $infContent = Get-Content -Path $infPath -ErrorAction Stop -Raw;
                $strings = @{};
                
                if ($infContent -match '(?msi)\\[Strings\\]\\s*\\r?\\n(.*?)(?:\\r?\\n\\[|$)') {
                    $stringSection = $Matches[1];
                    $stringSection.Split([System.Environment]::NewLine) | ForEach-Object {
                        if ($_ -match '^\\s*([^;=\\s]+)\\s*=\\s*(.*)$') {
                            $key = $Matches[1].Trim()
                            $value = $Matches[2].Trim().Trim('"')
                            if ($key) {
                                $strings[$key] = $value
                            }
                        }
                    };
                }
                
                if ($infContent -match '(?msi)\\[Version\\]\\s*\\r?\\n(.*?)(?:\\r?\\n\\[|$)') {
                    $versionSection = $Matches[1];
                    $props = @{
                        provider = '';
                        className = '';
                        version = '';
                        originalName = (Split-Path $infPath -Leaf);
                        fullInfPath = $infPath;
                    };

                    $versionSection.Split([System.Environment]::NewLine) | ForEach-Object {
                        if ($_ -match '^\\s*Provider\\s*=\\s*(.*)$') {
                            $val = $Matches[1].Trim().Trim('"');
                            if ($val.StartsWith('%') -and $val.EndsWith('%')) {
                                $key = $val.Substring(1, $val.Length - 2);
                                if ($strings.ContainsKey($key)) {
                                    $props.provider = $strings[$key];
                                } else {
                                    $props.provider = $key;
                                }
                            } else {
                                $props.provider = $val;
                            }
                        }
                        elseif ($_ -match '^\\s*Class\\s*=\\s*(.*)$') {
                            $props.className = $Matches[1].Trim().Trim('"');
                        }
                        elseif ($_ -match '^\\s*DriverVer\\s*=\\s*.*?\\,\\s*([\\d\\.]+)$') {
                            $props.version = $Matches[1].Trim();
                        }
                    };

                    if ($props.provider -and $props.version) {
                         $allDrivers += New-Object psobject -Property $props;
                    }
                }

            } catch {
                # Report errors as a special object instead of silently failing.
                $errorRecord = @{
                    isError = $true;
                    infPath = $infPath;
                    message = $_.Exception.Message;
                }
                $allDrivers += New-Object psobject -Property $errorRecord;
            }
        }
        $allDrivers | ConvertTo-Json -Compress
    `;

    // Encode the command to prevent shell interpretation issues with quotes and newlines.
    const encodedCommand = Buffer.from(command, 'utf16le').toString('base64');

    return new Promise((resolve) => {
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedCommand}`, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
          if (error) {
              logError(`PowerShell execution failed: ${error.message}. Stderr: ${stderr}`);
              resolve({ drivers: [], errors });
              return;
          }
          if (stderr) {
              // stderr is not always a fatal error, but worth logging for diagnostics.
              logError(`PowerShell process wrote to stderr: ${stderr}`);
          }

          try {
              if (!stdout.trim()) {
                  logError('PowerShell command returned empty output. No drivers or errors were processed.');
                  resolve({ drivers: [], errors });
                  return;
              }
              const results = JSON.parse(stdout);
              const resultsArray = Array.isArray(results) ? results : (results ? [results] : []);
              
              const successfulDrivers: any[] = [];
              resultsArray.forEach(item => {
                if (item.isError) {
                  logError(`Failed to parse INF '${path.basename(item.infPath)}': ${item.message.split('\n')[0]}`);
                } else {
                  successfulDrivers.push(item);
                }
              });
              
              const formattedDrivers = successfulDrivers.map((d, index) => ({
                  ...d,
                  id: `${d.fullInfPath}-${d.originalName}-${index}`,
                  displayName: `${d.provider || 'Unknown'} - ${d.className || d.originalName}`,
                  infName: d.originalName,
              }));

              resolve({ drivers: formattedDrivers, errors });
          } catch (e: any) {
              logError(`Error parsing driver info JSON from PowerShell. Raw Output: ${stdout}. Error: ${e.message}`);
              resolve({ drivers: [], errors });
          }
      });
    });

  } catch (error: any) {
    logError(`An unexpected error occurred in scan-backup-folder: ${error.message}`);
    return { drivers: [], errors };
  }
});


// Check if a folder is empty
ipcMain.handle('is-folder-empty', async (_, folderPath: string) => {
  try {
    await fs.access(folderPath); // Check if it exists
    const files = await fs.readdir(folderPath);
    return files.length === 0;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return true; // Doesn't exist, so it's "empty" for our purpose
    }
    console.error(`Error checking if folder is empty (${folderPath}):`, error);
    return false; // On other errors, assume not empty to be safe
  }
});

// Show a confirmation dialog
ipcMain.handle('show-confirmation-dialog', async (event, options: MessageBoxOptions) => {
  if (!mainWindow) return options.cancelId ?? 1; // Default to cancel if no window
  const { response } = await dialog.showMessageBox(mainWindow, options);
  return response;
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