import { app, BrowserWindow, globalShortcut, session, ipcMain, dialog, MessageBoxOptions } from 'electron';
import path from 'path';
import Store from 'electron-store';
import { exec, spawn } from 'child_process';
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

// Simple command runner for single-line operations
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

// Scan backup folder for drivers
ipcMain.handle('scan-backup-folder', async (_, folderPath: string): Promise<{ drivers: any[], errors: string[] }> => {
    const errors: string[] = [];
    const logError = (msg: string) => {
        console.error(msg); // Keep console logging for dev
        errors.push(msg);
    };

    try {
        // Escape single quotes for PowerShell and embed the path directly in the script.
        const escapedFolderPath = folderPath.replace(/'/g, "''");

        const scriptContent = `
            $RootPath = '${escapedFolderPath}'
            
            try {
                $infFiles = Get-ChildItem -Path $RootPath -Recurse -Filter *.inf -ErrorAction Stop | Where-Object { -not $_.PSIsContainer };
            } catch {
                Write-Output "[]"
                Write-Error "Failed to read directory '$RootPath': $_.Exception.Message"
                exit 1
            }
            
            $allDrivers = @();
            foreach ($infFile in $infFiles) {
                $infPath = $infFile.FullName
                try {
                    $infContent = Get-Content -Path $infPath -ErrorAction Stop -Raw;
                    $strings = @{};
                    
                    if ($infContent -match '(?msi)\\[Strings\\]\\s*\\r?\\n(.*?)(?:\\r?\\n\\[|$)') {
                        $stringSection = $Matches[1];
                        $stringSection -split '\\r?\\n' | ForEach-Object {
                            if ($_ -match '^\\s*([^;=\\s]+)\\s*=\\s*(.*)$') {
                                $key = $Matches[1].Trim()
                                $value = $Matches[2].Trim().Trim('"')
                                if ($key) { $strings[$key] = $value }
                            }
                        };
                    }

                    # Read driver_details.txt
                    $detailsPath = Join-Path -Path $infFile.DirectoryName -ChildPath 'driver_details.txt'
                    $details = @{ backupOS = ''; backupDate = ''; backupOSBuild = '' }
                    if (Test-Path $detailsPath) {
                        try {
                            $detailsContent = Get-Content $detailsPath -Raw
                            if ($detailsContent -match 'BackupOS:\\s*(.*)') { $details.backupOS = $Matches[1].Trim() }
                            if ($detailsContent -match 'BackupDate:\\s*(.*)') { $details.backupDate = $Matches[1].Trim() }
                            if ($detailsContent -match 'BackupOSBuild:\\s*(.*)') { $details.backupOSBuild = $Matches[1].Trim() }
                        } catch {} # Silently ignore if details file is unreadable
                    }
                    
                    if ($infContent -match '(?msi)\\[Version\\]\\s*\\r?\\n(.*?)(?:\\r?\\n\\[|$)') {
                        $versionSection = $Matches[1];
                        $props = @{
                            provider = '';
                            className = '';
                            version = '';
                            originalName = (Split-Path $infPath -Leaf);
                            fullInfPath = $infPath;
                            backupOS = $details.backupOS;
                            backupDate = $details.backupDate;
                            backupOSBuild = $details.backupOSBuild;
                        };

                        $versionSection -split '\\r?\\n' | ForEach-Object {
                            if ($_ -imatch '^\\s*Provider\\s*=\\s*(.*)$') {
                                $val = $Matches[1].Trim().Trim('"');
                                if ($val.StartsWith('%') -and $val.EndsWith('%')) {
                                    $key = $val.Substring(1, $val.Length - 2);
                                    if ($strings.ContainsKey($key)) { $props.provider = $strings[$key] } else { $props.provider = $key }
                                } else { $props.provider = $val }
                            }
                            elseif ($_ -imatch '^\\s*Class\\s*=\\s*(.*)$') { $props.className = $Matches[1].Trim().Trim('"') }
                            elseif ($_ -imatch '^\\s*DriverVer\\s*=\\s*(.*)$') {
                                $fullVerLine = $Matches[1].Trim().Trim('"');
                                if ($fullVerLine -match '([0-9]+\\.[0-9]+(\\.[0-9]+)*)$') { $props.version = $Matches[1].Trim() }
                                elseif ($fullVerLine.Contains(',')) { $props.version = $fullVerLine.Split(',')[-1].Trim() }
                                else { $props.version = $fullVerLine }
                            }
                        };
                        $allDrivers += New-Object psobject -Property $props;
                    } else {
                         $errorRecord = @{ isError = $true; infPath = $infPath; message = "Could not find [Version] section." }
                         $allDrivers += New-Object psobject -Property $errorRecord
                    }
                } catch {
                    $errorRecord = @{ isError = $true; infPath = $infPath; message = $_.Exception.Message }
                    $allDrivers += New-Object psobject -Property $errorRecord;
                }
            }
            $allDrivers | ConvertTo-Json -Compress
        `;

        const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-']);

        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            ps.stdout.on('data', (data) => { stdout += data.toString(); });
            ps.stderr.on('data', (data) => { stderr += data.toString(); });
            ps.on('close', (code) => {
                if (code !== 0) {
                    logError(`PowerShell execution failed. Stderr: ${stderr}`);
                    resolve({ drivers: [], errors }); return;
                }
                if (stderr) { logError(`PowerShell process wrote to stderr: ${stderr}`); }
                try {
                    if (!stdout.trim() || stdout.trim() === '[]') {
                        errors.push(`Scan complete: No .inf files found in directory: ${folderPath}`);
                        resolve({ drivers: [], errors }); return;
                    }
                    const results = JSON.parse(stdout);
                    const resultsArray = Array.isArray(results) ? results : (results ? [results] : []);
                    const allDrivers = resultsArray.map((item, index) => {
                        if (item.isError) {
                            const infName = path.basename(item.infPath);
                            logError(`Failed to parse INF '${infName}': ${item.message.split('\n')[0]}`);
                            return { id: `${item.infPath}-${index}`, displayName: infName, infName, fullInfPath: item.infPath, provider: 'N/A', className: 'N/A', version: 'N/A', parsingError: item.message };
                        } else {
                            const displayName = [item.provider, item.className].filter(Boolean).join(' - ') || item.originalName;
                            return { ...item, id: `${item.fullInfPath}-${item.originalName}-${index}`, displayName, infName: item.originalName, parsingError: undefined };
                        }
                    });
                    resolve({ drivers: allDrivers, errors });
                } catch (e: any) {
                    logError(`Error parsing driver info JSON. Raw Output: ${stdout}. Error: ${e.message}`);
                    resolve({ drivers: [], errors });
                }
            });
            ps.stdin.write(scriptContent);
            ps.stdin.end();
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

ipcMain.handle('get-os-info', async () => {
  return new Promise((resolve) => {
    const command = 'powershell -command "(Get-ComputerInfo | Select-Object OsProductName, OsBuildNumber) | ConvertTo-Json -Compress"';
    exec(command, (error, stdout) => {
      if (error || !stdout) {
        resolve({ OsProductName: os.type(), OsBuildNumber: os.release() });
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ OsProductName: os.type(), OsBuildNumber: os.release() });
      }
    });
  });
});

ipcMain.on('do-full-backup', async (event, backupPath: string) => {
  const webContents = event.sender;
  const dismCommand = `dism /online /export-driver /destination:"${backupPath}"`;
  webContents.send('command-start', "در حال پشتیبان‌گیری از تمام درایورهای نصب شده");

  const dismProcess = exec(dismCommand, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 5 });
  dismProcess.stdout?.on('data', (data) => webContents.send('command-output', data.toString()));
  dismProcess.stderr?.on('data', (data) => webContents.send('command-output', `ERROR: ${data.toString()}`));
  
  dismProcess.on('close', async (code) => {
    if (code !== 0) {
      webContents.send('command-end', code);
      return;
    }
    try {
      webContents.send('command-output', '\nDISM backup successful. Adding metadata files...');
      const osInfoCmd = 'powershell -command "(Get-ComputerInfo | Select-Object OsProductName, OsBuildNumber) | ConvertTo-Json -Compress"';
      const osInfo = await new Promise<{ OsProductName: string; OsBuildNumber: string }>((resolve, reject) => {
          exec(osInfoCmd, (err, stdout) => err ? reject(err) : resolve(JSON.parse(stdout)));
      });

      const backupDate = new Date().toISOString();
      const subDirs = await fs.readdir(backupPath, { withFileTypes: true });

      for (const dirent of subDirs) {
        if (dirent.isDirectory()) {
          const driverFolderPath = path.join(backupPath, dirent.name);
          const filesInFolder = await fs.readdir(driverFolderPath);
          const infFile = filesInFolder.find(f => f.toLowerCase().endsWith('.inf'));

          if (infFile) {
            const details = [
              `[DriverDolphin Backup Details]`,
              `BackupDate: ${backupDate}`,
              `BackupOS: ${osInfo.OsProductName}`,
              `BackupOSBuild: ${osInfo.OsBuildNumber}`,
              `INFFile: ${infFile}`,
              `ManualRestoreGuide:`,
              `1. Open Command Prompt or PowerShell as Administrator.`,
              `2. Navigate to this driver's folder.`,
              `3. Run the following command:`,
              `pnputil /add-driver .\\${infFile} /install`
            ].join('\r\n');
            await fs.writeFile(path.join(driverFolderPath, 'driver_details.txt'), details);
          }
        }
      }
      webContents.send('command-output', 'Metadata files added successfully.');
      webContents.send('command-end', 0);
    } catch (error: any) {
      webContents.send('command-output', `ERROR adding metadata: ${error.message}`);
      webContents.send('command-end', 1);
    }
  });
});

ipcMain.on('do-selective-backup', async (event, { selectedDrivers, destinationPath }: { selectedDrivers: any[], destinationPath: string }) => {
    const webContents = event.sender;
    if (selectedDrivers.length === 0) {
        webContents.send('command-end', 1);
        return;
    }

    try {
        const windowsPath = os.homedir().split(path.sep)[0] + path.sep + 'Windows';
        const fileRepoPath = `${windowsPath}\\System32\\DriverStore\\FileRepository`;
        
        const getBaseName = (filePath: string) => filePath ? filePath.substring(filePath.lastIndexOf('\\') + 1) : '';
        const infNames = selectedDrivers.map(d => getBaseName(d.originalName).replace('.inf', ''));
        const whereClauses = infNames.map(n => `($_.Name -like '${n}.inf_*')`).join(' -or ');

        const osInfoCmd = 'powershell -command "(Get-ComputerInfo | Select-Object OsProductName, OsBuildNumber) | ConvertTo-Json -Compress"';
        const osInfo = await new Promise<{ OsProductName: string; OsBuildNumber: string }>((resolve, reject) => {
            exec(osInfoCmd, (err, stdout) => err ? reject(err) : resolve(JSON.parse(stdout)));
        });
        const backupDate = new Date().toISOString();

        const escapedDest = destinationPath.replace(/'/g, "''");
        const escapedRepoPath = fileRepoPath.replace(/'/g, "''");

        const psCommand = `
            $dest = '${escapedDest}';
            $sourcePath = '${escapedRepoPath}';
            $driverFolders = Get-ChildItem -Path $sourcePath -Directory | Where-Object { ${whereClauses} };
            if ($null -ne $driverFolders) {
                $driverFolders | ForEach-Object { 
                    Write-Host "Copying driver package: $($_.Name)";
                    $targetDir = Join-Path -Path $dest -ChildPath $_.Name;
                    Copy-Item -Path $_.FullName -Destination $dest -Recurse -Container -Force -Confirm:$false;
                    
                    $infFile = (Get-ChildItem -Path $targetDir -Filter *.inf | Select-Object -First 1).Name;
                    if ($infFile) {
                        $detailsContent = @"
[DriverDolphin Backup Details]
BackupDate: ${backupDate}
BackupOS: ${osInfo.OsProductName}
BackupOSBuild: ${osInfo.OsBuildNumber}
INFFile: $infFile
ManualRestoreGuide:
1. Open Command Prompt or PowerShell as Administrator.
2. Navigate to this driver's folder ($($_.Name)).
3. Run the following command:
pnputil /add-driver .\\$infFile /install
"@
                        Set-Content -Path (Join-Path -Path $targetDir -ChildPath 'driver_details.txt') -Value $detailsContent -Encoding UTF8
                    }
                }
            } else {
                Write-Host "No matching driver packages found in FileRepository to copy."
            }
        `;
        const command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand.replace(/\s\s+/g, ' ').trim()}"`;
        
        const description = `در حال پشتیبان‌گیری از ${selectedDrivers.length} درایور انتخاب شده`;
        webContents.send('command-start', description);
        const child = exec(command, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 5 });
        child.stdout?.on('data', (data) => webContents.send('command-output', data.toString()));
        child.stderr?.on('data', (data) => webContents.send('command-output', `ERROR: ${data.toString()}`));
        child.on('close', (code) => webContents.send('command-end', code));
    } catch (error: any) {
        webContents.send('command-output', `ERROR preparing selective backup: ${error.message}`);
        webContents.send('command-end', 1);
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