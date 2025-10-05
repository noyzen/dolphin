import React, { useState, useEffect, useRef } from 'react';
import type { OpenDialogOptions } from 'electron';

declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}

// Type definitions for parsed driver information
interface DriverInfo {
  publishedName: string;
  originalName: string;
  provider: string;
  className: string;
}

declare global {
  interface Window {
    electronAPI: {
      minimizeWindow: () => void;
      toggleMaximizeWindow: () => void;
      closeWindow: () => void;
      onWindowStateChange: (callback: (isMaximized: boolean) => void) => () => void;
      checkAdmin: () => Promise<boolean>;
      selectDialog: (options: OpenDialogOptions) => Promise<string[]>;
      runCommand: (command: string, description: string) => void;
      checkSystemRestore: () => Promise<boolean>;
      getWindowsPath: () => Promise<string>;
      onCommandStart: (callback: (description: string) => void) => () => void;
      onCommandOutput: (callback: (output: string) => void) => () => void;
      onCommandEnd: (callback: (code: number | null) => void) => () => void;
    };
  }
}

const TitleBar: React.FC<{ isMaximized: boolean }> = ({ isMaximized }) => {
  return (
    <div
      style={{ WebkitAppRegion: 'drag' }}
      className="h-8 bg-gray-900/70 backdrop-blur-sm flex items-center justify-between fixed top-0 left-0 right-0 z-50 ring-1 ring-white/10"
    >
      <div className="px-4 flex items-center gap-3 h-full text-gray-300 text-sm font-medium">
        <i className="fas fa-water text-green-400"></i>
        <span>Driver Dolphin</span>
      </div>
      <div className="flex items-center h-full">
        <button
          onClick={() => window.electronAPI.minimizeWindow()}
          style={{ WebkitAppRegion: 'no-drag' }}
          className="w-10 h-full flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          aria-label="Minimize"
        >
          <i className="fas fa-window-minimize text-xs"></i>
        </button>
        <button
          onClick={() => window.electronAPI.toggleMaximizeWindow()}
          style={{ WebkitAppRegion: 'no-drag' }}
          className="w-10 h-full flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          aria-label={isMaximized ? "Restore" : "Maximize"}
        >
          <i className={`fas ${isMaximized ? 'fa-window-restore' : 'fa-window-maximize'} text-xs`}></i>
        </button>
        <button
          onClick={() => window.electronAPI.closeWindow()}
          style={{ WebkitAppRegion: 'no-drag' }}
          className="w-10 h-full flex items-center justify-center text-gray-400 hover:bg-red-500 hover:text-white transition-colors"
          aria-label="Close"
        >
          <i className="fas fa-times text-sm"></i>
        </button>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isAdmin, setIsAdmin] = useState(true);
  const [activeTab, setActiveTab] = useState('full-backup');
  const [log, setLog] = useState<string>('Welcome to Driver Dolphin!\nReady to start...');
  const [isBusy, setIsBusy] = useState(false);
  
  // Paths
  const [backupPath, setBackupPath] = useState('');
  const [restorePath, setRestorePath] = useState('');
  const [selectiveBackupPath, setSelectiveBackupPath] = useState('');
  
  // System state
  const [isSystemRestoreEnabled, setIsSystemRestoreEnabled] = useState(false);

  // Selective Backup
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [selectedDrivers, setSelectedDrivers] = useState<Set<string>>(new Set());
  const [windowsPath, setWindowsPath] = useState('');
  
  // Selective Restore
  const [selectiveRestoreFiles, setSelectiveRestoreFiles] = useState<string[]>([]);

  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scroll log to bottom
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  useEffect(() => {
    // One-time checks on startup
    window.electronAPI.checkAdmin().then(setIsAdmin);
    window.electronAPI.onWindowStateChange(setIsMaximized);
    window.electronAPI.getWindowsPath().then(setWindowsPath);
    
    const cleanupStart = window.electronAPI.onCommandStart((description) => {
        setIsBusy(true);
        setLog(prev => `${prev}\n\n[STARTING] ${description}...\n`);
    });
    const cleanupOutput = window.electronAPI.onCommandOutput((output) => {
        setLog(prev => prev + output);
    });
    const cleanupEnd = window.electronAPI.onCommandEnd((code) => {
        setLog(prev => `${prev}\n[FINISHED] Process exited with code: ${code}. ${code === 0 ? 'Success!' : 'Check logs for errors.'}\n`);
        setIsBusy(false);
    });
    
    return () => {
      cleanupStart();
      cleanupOutput();
      cleanupEnd();
    };
  }, []);
  
  const handleSelectFolder = async (setter: React.Dispatch<React.SetStateAction<string>>) => {
    const paths = await window.electronAPI.selectDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (paths && paths.length > 0) {
      setter(paths[0]);
    }
  };

  const handleFullBackup = () => {
    if (!backupPath || isBusy) return;
    const command = `dism /online /export-driver /destination:"${backupPath}"`;
    window.electronAPI.runCommand(command, "Exporting all third-party drivers");
  };

  const handleCreateRestorePoint = () => {
    if(isBusy) return;
    const command = `powershell.exe -Command "Checkpoint-Computer -Description 'DriverDolphin Pre-Restore Point' -RestorePointType 'MODIFY_SETTINGS'"`;
    window.electronAPI.runCommand(command, "Creating a new System Restore Point");
  };

  const checkRestoreStatus = () => {
    window.electronAPI.checkSystemRestore().then(status => {
      setIsSystemRestoreEnabled(status);
      setLog(prev => `${prev}\n[INFO] System Restore is ${status ? 'ENABLED' : 'DISABLED'}.`);
    });
  };
  
  const handleFullRestore = () => {
    if (!restorePath || isBusy) return;
    const command = `pnputil /add-driver "${restorePath}\\*.inf" /subdirs /install`;
    window.electronAPI.runCommand(command, `Installing all drivers from "${restorePath}"`);
  };

  const handleScanDrivers = () => {
    if (isBusy) return;
    const command = `pnputil /enum-drivers`;
    setDrivers([]);
    window.electronAPI.runCommand(command, "Scanning for all third-party drivers");
    
    // The output will be appended to the log. We need to parse it after the command finishes.
    const cleanup = window.electronAPI.onCommandEnd(() => {
        setLog(prev => {
            const parsedDrivers = parsePnpUtilOutput(prev);
            setDrivers(parsedDrivers);
            return `${prev}\n[INFO] Found and parsed ${parsedDrivers.length} drivers.`;
        });
        cleanup(); // Self-destruct listener
    });
  };

  const parsePnpUtilOutput = (output: string): DriverInfo[] => {
    const drivers: DriverInfo[] = [];
    const entries = output.split('Published Name :').slice(1);
    entries.forEach(entry => {
        const lines = entry.trim().split('\n');
        const driver: Partial<DriverInfo> = { publishedName: lines[0].trim() };
        lines.slice(1).forEach(line => {
            const [key, ...valueParts] = line.split(':');
            const value = valueParts.join(':').trim();
            if (key.includes('Original Name')) driver.originalName = value;
            else if (key.includes('Provider Name')) driver.provider = value;
            else if (key.includes('Class Name')) driver.className = value;
        });
        if(driver.originalName && driver.provider && driver.className) {
            drivers.push(driver as DriverInfo);
        }
    });
    return drivers;
  };
  
  const toggleDriverSelection = (publishedName: string) => {
    setSelectedDrivers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(publishedName)) {
        newSet.delete(publishedName);
      } else {
        newSet.add(publishedName);
      }
      return newSet;
    });
  };
  
  const handleSelectiveBackup = () => {
      if(selectedDrivers.size === 0 || !selectiveBackupPath || isBusy) return;
      const selectedDriverInfo = drivers.filter(d => selectedDrivers.has(d.publishedName));
      const fileRepoPath = `${windowsPath}\\System32\\DriverStore\\FileRepository`;
      const infNames = selectedDriverInfo.map(d => d.originalName.replace('.inf', ''));
      const command = `powershell -Command "Get-ChildItem -Path '${fileRepoPath}' -Recurse -Directory | Where-Object { $name = $_.Name; ${infNames.map(n => `$name -like '${n}*'`).join(' -or ')} } | Copy-Item -Destination '${selectiveBackupPath}' -Recurse -Container -Force"`;
      window.electronAPI.runCommand(command, `Backing up ${selectedDrivers.size} selected driver(s)`);
  };
  
  const handleSelectRestoreFiles = async () => {
      const paths = await window.electronAPI.selectDialog({ 
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'Driver INF Files', extensions: ['inf'] }]
      });
      if (paths && paths.length > 0) {
          setSelectiveRestoreFiles(paths);
      }
  };

  const handleSelectiveRestore = () => {
      if (selectiveRestoreFiles.length === 0 || isBusy) return;
      const command = selectiveRestoreFiles.map(path => `pnputil /add-driver "${path}" /install`).join(' && ');
      window.electronAPI.runCommand(command, `Installing ${selectiveRestoreFiles.length} selected driver(s)`);
  };

  const tabs = [
    { id: 'full-backup', icon: 'fa-hdd', label: 'پشتیبان‌گیری کامل' },
    { id: 'full-restore', icon: 'fa-history', label: 'بازیابی کامل' },
    { id: 'selective-backup', icon: 'fa-tasks', label: 'پشتیبان‌گیری انتخابی' },
    { id: 'selective-restore', icon: 'fa-mouse-pointer', label: 'بازیابی انتخابی' },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'full-backup':
        return (
          <>
            <h2 className="text-2xl font-bold mb-4 text-gray-200">پشتیبان‌گیری از تمام درایورها</h2>
            <p className="text-gray-400 mb-6">تمام درایورهای شخص ثالث (third-party) را در یک پوشه ذخیره کنید.</p>
            <div className="flex items-center space-x-reverse space-x-2 mb-6">
                <input type="text" readOnly value={backupPath} placeholder="پوشه مقصد را انتخاب کنید..." className="flex-grow bg-gray-900/50 ring-1 ring-white/10 rounded-md p-2 text-gray-300 focus:outline-none focus:ring-green-500" />
                <button onClick={() => handleSelectFolder(setBackupPath)} disabled={isBusy} className="px-4 py-2 bg-gray-600 rounded-md hover:bg-gray-500 transition-colors disabled:opacity-50"><i className="fas fa-folder-open"></i></button>
            </div>
            <button onClick={handleFullBackup} disabled={!backupPath || isBusy} className="w-full bg-green-600 text-white font-bold py-3 px-8 rounded-md hover:bg-green-500 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100">
                <i className="fas fa-play mr-2"></i> شروع پشتیبان‌گیری
            </button>
          </>
        );
      case 'full-restore':
         return (
          <>
            <h2 className="text-2xl font-bold mb-4 text-gray-200">بازیابی تمام درایورها</h2>
            <p className="text-gray-400 mb-6">درایورها را از یک پوشه پشتیبان نصب کنید. توصیه می‌شود ابتدا یک نقطه بازیابی سیستم (Restore Point) ایجاد کنید.</p>
            <div className="bg-yellow-900/30 text-yellow-300 p-3 rounded-md mb-4 text-sm ring-1 ring-yellow-500/30 flex items-start gap-3">
                <i className="fas fa-exclamation-triangle mt-1"></i>
                <div>
                    <button onClick={checkRestoreStatus} className="font-bold underline hover:text-yellow-200" disabled={isBusy}>بررسی وضعیت System Restore</button>
                    {!isSystemRestoreEnabled && <p className="mt-1">System Restore غیرفعال است. برای فعال‌سازی به کنترل پنل مراجعه کنید.</p>}
                </div>
            </div>
            <button onClick={handleCreateRestorePoint} disabled={isBusy} className="w-full mb-6 bg-blue-600 text-white font-bold py-3 px-8 rounded-md hover:bg-blue-500 active:scale-95 transition-all disabled:opacity-50">
                <i className="fas fa-shield-alt mr-2"></i> ایجاد نقطه بازیابی سیستم
            </button>
            <div className="flex items-center space-x-reverse space-x-2 mb-6">
                <input type="text" readOnly value={restorePath} placeholder="پوشه پشتیبان را انتخاب کنید..." className="flex-grow bg-gray-900/50 ring-1 ring-white/10 rounded-md p-2 text-gray-300 focus:outline-none focus:ring-green-500" />
                <button onClick={() => handleSelectFolder(setRestorePath)} disabled={isBusy} className="px-4 py-2 bg-gray-600 rounded-md hover:bg-gray-500 transition-colors disabled:opacity-50"><i className="fas fa-folder"></i></button>
            </div>
            <button onClick={handleFullRestore} disabled={!restorePath || isBusy} className="w-full bg-green-600 text-white font-bold py-3 px-8 rounded-md hover:bg-green-500 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100">
                <i className="fas fa-play mr-2"></i> شروع بازیابی
            </button>
          </>
        );
      case 'selective-backup':
        return (
          <>
            <h2 className="text-2xl font-bold mb-4 text-gray-200">پشتیبان‌گیری انتخابی</h2>
            <p className="text-gray-400 mb-2">درایورهای مورد نظر خود را برای پشتیبان‌گیری انتخاب کنید.</p>
            <button onClick={handleScanDrivers} disabled={isBusy} className="w-full mb-4 bg-gray-600 text-white font-bold py-3 px-8 rounded-md hover:bg-gray-500 active:scale-95 transition-all disabled:opacity-50">
                <i className="fas fa-search mr-2"></i> اسکن درایورهای سیستم
            </button>
            <div className="h-48 overflow-y-auto bg-gray-900/50 ring-1 ring-white/10 rounded-md mb-4 p-2">
                {drivers.length === 0 && <p className="text-gray-500 text-center p-4">برای مشاهده لیست، سیستم را اسکن کنید.</p>}
                {drivers.map(driver => (
                    <div key={driver.publishedName} className="flex items-center p-2 rounded hover:bg-white/5">
                        <input type="checkbox" id={driver.publishedName} checked={selectedDrivers.has(driver.publishedName)} onChange={() => toggleDriverSelection(driver.publishedName)} className="ml-3 accent-green-500 w-4 h-4" />
                        <label htmlFor={driver.publishedName} className="flex-grow cursor-pointer text-sm">
                            <span className="font-bold text-gray-200">{driver.provider}</span> - <span className="text-gray-400">{driver.className} ({driver.originalName})</span>
                        </label>
                    </div>
                ))}
            </div>
             <div className="flex items-center space-x-reverse space-x-2 mb-4">
                <input type="text" readOnly value={selectiveBackupPath} placeholder="پوشه مقصد را انتخاب کنید..." className="flex-grow bg-gray-900/50 ring-1 ring-white/10 rounded-md p-2 text-gray-300 focus:outline-none focus:ring-green-500" />
                <button onClick={() => handleSelectFolder(setSelectiveBackupPath)} disabled={isBusy} className="px-4 py-2 bg-gray-600 rounded-md hover:bg-gray-500 transition-colors disabled:opacity-50"><i className="fas fa-folder-open"></i></button>
            </div>
            <button onClick={handleSelectiveBackup} disabled={selectedDrivers.size === 0 || !selectiveBackupPath || isBusy} className="w-full bg-green-600 text-white font-bold py-3 px-8 rounded-md hover:bg-green-500 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100">
                <i className="fas fa-download mr-2"></i> پشتیبان‌گیری از {selectedDrivers.size} درایور
            </button>
          </>
        );
      case 'selective-restore':
         return (
          <>
            <h2 className="text-2xl font-bold mb-4 text-gray-200">بازیابی انتخابی</h2>
            <p className="text-gray-400 mb-6">فایل‌های .inf درایورهای مورد نظر برای نصب را انتخاب کنید.</p>
             <div className="bg-yellow-900/30 text-yellow-300 p-3 rounded-md mb-4 text-sm ring-1 ring-yellow-500/30 flex items-start gap-3">
                <i className="fas fa-exclamation-triangle mt-1"></i>
                <p>توصیه می‌شود قبل از ادامه، یک نقطه بازیابی سیستم ایجاد کنید.</p>
            </div>
            <button onClick={handleCreateRestorePoint} disabled={isBusy} className="w-full mb-6 bg-blue-600 text-white font-bold py-3 px-8 rounded-md hover:bg-blue-500 active:scale-95 transition-all disabled:opacity-50">
                <i className="fas fa-shield-alt mr-2"></i> ایجاد نقطه بازیابی سیستم
            </button>

            <div className="flex items-center space-x-reverse space-x-2 mb-6">
                <div className="flex-grow bg-gray-900/50 ring-1 ring-white/10 rounded-md p-2 text-gray-400 text-sm h-12 overflow-y-auto">
                    {selectiveRestoreFiles.length > 0 ? `${selectiveRestoreFiles.length} فایل انتخاب شد.` : 'فایل‌های .inf را انتخاب کنید...'}
                </div>
                <button onClick={handleSelectRestoreFiles} disabled={isBusy} className="px-4 py-2 bg-gray-600 rounded-md hover:bg-gray-500 transition-colors disabled:opacity-50"><i className="fas fa-file-import"></i></button>
            </div>
            <button onClick={handleSelectiveRestore} disabled={selectiveRestoreFiles.length === 0 || isBusy} className="w-full bg-green-600 text-white font-bold py-3 px-8 rounded-md hover:bg-green-500 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100">
                <i className="fas fa-play mr-2"></i> شروع بازیابی انتخابی
            </button>
          </>
        );
      default: return null;
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-black flex flex-col">
      <TitleBar isMaximized={isMaximized} />
      <div className="pt-8 flex-grow flex">
        {/* Main Content */}
        <main className="flex-grow p-6 flex flex-col">
          {!isAdmin && (
            <div className="bg-red-900/50 text-red-300 p-3 rounded-md mb-4 ring-1 ring-red-500/30 flex items-center gap-3">
              <i className="fas fa-exclamation-triangle"></i>
              <span>برنامه با دسترسی ادمین اجرا نشده است. بسیاری از عملکردها کار نخواهند کرد.</span>
            </div>
          )}
          <div className="flex-grow bg-gray-800/50 backdrop-blur-sm rounded-lg shadow-2xl shadow-black/30 ring-1 ring-white/10 p-6">
            {renderContent()}
          </div>
          <div ref={logRef} className="h-48 mt-4 bg-gray-900/80 rounded-lg ring-1 ring-white/10 p-4 font-mono text-xs text-gray-400 overflow-y-auto whitespace-pre-wrap selection:bg-green-600 selection:text-white">
            {log}
          </div>
        </main>
        {/* Sidebar */}
        <aside className="w-48 bg-gray-900/50 ring-1 ring-white/10 flex-shrink-0 flex flex-col items-center p-4">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              disabled={isBusy}
              className={`w-full text-right p-3 my-1 rounded-md transition-colors duration-200 flex items-center disabled:opacity-50 ${activeTab === tab.id ? 'bg-green-600/20 text-green-300' : 'text-gray-400 hover:bg-white/5'}`}
            >
              <i className={`fas ${tab.icon} w-8 text-center text-lg`}></i>
              <span className="font-medium">{tab.label}</span>
            </button>
          ))}
        </aside>
      </div>
    </div>
  );
};

export default App;
