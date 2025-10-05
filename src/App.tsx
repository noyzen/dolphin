import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { OpenDialogOptions } from 'electron';

declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}

// Type definitions
interface DriverInfo {
  publishedName: string;
  originalName: string;
  provider: string;
  className: string;
}

type LogType = 'START' | 'OUTPUT' | 'END_SUCCESS' | 'END_ERROR' | 'INFO' | 'WARN';
interface LogEntry {
  id: number;
  timestamp: string;
  type: LogType;
  message: string;
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

let logIdCounter = 0;

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
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [activeTab, setActiveTab] = useState('full-backup');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('به Driver Dolphin خوش آمدید! آماده برای شروع...');
  const [logFilter, setLogFilter] = useState('');

  // Paths
  const [backupPath, setBackupPath] = useState('');
  const [restorePath, setRestorePath] = useState('');
  const [selectiveBackupPath, setSelectiveBackupPath] = useState('');
  
  // System state
  const [isSystemRestoreEnabled, setIsSystemRestoreEnabled] = useState<boolean | null>(null);

  // Selective Backup
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [selectedDrivers, setSelectedDrivers] = useState<Set<string>>(new Set());
  const [windowsPath, setWindowsPath] = useState('');
  
  // Selective Restore
  const [selectiveRestoreFiles, setSelectiveRestoreFiles] = useState<string[]>([]);
  
  const statusTimerRef = useRef<number | null>(null);

  const addLog = (type: LogType, message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs(prev => [...prev, { id: logIdCounter++, timestamp, type, message }]);
  };

  useEffect(() => {
    window.electronAPI.checkAdmin().then(setIsAdmin);

    addLog('INFO', 'برنامه راه‌اندازی شد.');
    window.electronAPI.onWindowStateChange(setIsMaximized);
    window.electronAPI.getWindowsPath().then(setWindowsPath);
    
    const cleanupStart = window.electronAPI.onCommandStart((description) => {
        setIsBusy(true);
        setStatusMessage(description + '...');
        addLog('START', description);
    });

    const cleanupOutput = window.electronAPI.onCommandOutput((output) => {
        const cleanedOutput = output.trim();
        if (cleanedOutput) {
           addLog('OUTPUT', cleanedOutput);
        }
    });

    const cleanupEnd = window.electronAPI.onCommandEnd((code) => {
        const success = code === 0;
        const message = `عملیات پایان یافت. ${success ? 'موفقیت‌آمیز بود.' : 'با خطا خاتمه یافت.'}`;
        addLog(success ? 'END_SUCCESS' : 'END_ERROR', `فرآیند با کد خروجی ${code} پایان یافت.`);
        setStatusMessage(message);
        setIsBusy(false);

        if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
        statusTimerRef.current = window.setTimeout(() => setStatusMessage('آماده.'), 4000);
    });
    
    return () => {
      cleanupStart();
      cleanupOutput();
      cleanupEnd();
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
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
    window.electronAPI.runCommand(command, "در حال خروجی گرفتن از تمام درایورهای شخص ثالث");
  };

  const handleCreateRestorePoint = () => {
    if(isBusy) return;
    const command = `powershell.exe -Command "Checkpoint-Computer -Description 'DriverDolphin Pre-Restore Point' -RestorePointType 'MODIFY_SETTINGS'"`;
    window.electronAPI.runCommand(command, "در حال ایجاد یک نقطه بازیابی سیستم جدید");
  };

  const checkRestoreStatus = () => {
    addLog('INFO', 'در حال بررسی وضعیت System Restore...');
    window.electronAPI.checkSystemRestore().then(status => {
      setIsSystemRestoreEnabled(status);
      addLog('INFO', `وضعیت System Restore: ${status ? 'فعال' : 'غیرفعال'}.`);
    });
  };
  
  const handleFullRestore = () => {
    if (!restorePath || isBusy) return;
    const command = `pnputil /add-driver "${restorePath}\\*.inf" /subdirs /install`;
    window.electronAPI.runCommand(command, `در حال نصب تمام درایورها از "${restorePath}"`);
  };

  const handleScanDrivers = () => {
    if (isBusy) return;
    const command = `pnputil /enum-drivers`;
    setDrivers([]);
    const fullOutput: string[] = [];
    
    const tempOutputListener = window.electronAPI.onCommandOutput(output => fullOutput.push(output));
    
    const cleanupEnd = window.electronAPI.onCommandEnd(() => {
        const parsedDrivers = parsePnpUtilOutput(fullOutput.join('\n'));
        setDrivers(parsedDrivers);
        addLog('INFO', `تعداد ${parsedDrivers.length} درایور پیدا و پردازش شد.`);
        tempOutputListener(); // Remove temporary listener
        cleanupEnd(); // Self-destruct
    });
    
    window.electronAPI.runCommand(command, "در حال اسکن برای یافتن تمام درایورهای شخص ثالث");
  };

  const parsePnpUtilOutput = (output: string): DriverInfo[] => {
    const driversMap: Map<string, Partial<DriverInfo>> = new Map();
    const entries = output.split('Published Name :').slice(1);
    entries.forEach(entry => {
        const lines = entry.trim().split('\n');
        const publishedName = lines[0].trim();
        if (!publishedName) return;

        const driver: Partial<DriverInfo> = { publishedName };
        lines.slice(1).forEach(line => {
            const [key, ...valueParts] = line.split(':');
            const value = valueParts.join(':').trim();
            if (key.includes('Original Name')) driver.originalName = value;
            else if (key.includes('Provider Name')) driver.provider = value;
            else if (key.includes('Class Name')) driver.className = value;
        });
        if(driver.originalName && driver.provider && driver.className) {
            driversMap.set(publishedName, driver);
        }
    });
    return Array.from(driversMap.values()) as DriverInfo[];
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
      window.electronAPI.runCommand(command, `در حال پشتیبان‌گیری از ${selectedDrivers.size} درایور انتخاب شده`);
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
      window.electronAPI.runCommand(command, `در حال نصب ${selectiveRestoreFiles.length} درایور انتخاب شده`);
  };

  const tabs = [
    { id: 'full-backup', icon: 'fa-hdd', label: 'پشتیبان‌گیری کامل' },
    { id: 'full-restore', icon: 'fa-history', label: 'بازیابی کامل' },
    { id: 'selective-backup', icon: 'fa-tasks', label: 'پشتیبان‌گیری انتخابی' },
    { id: 'selective-restore', icon: 'fa-mouse-pointer', label: 'بازیابی انتخابی' },
    { id: 'logs', icon: 'fa-file-alt', label: 'لاگ‌ها' },
  ];

  const logTypeStyles: Record<LogType, string> = {
    INFO: "text-gray-400",
    START: "text-blue-400",
    OUTPUT: "text-gray-300",
    WARN: "text-yellow-400",
    END_SUCCESS: "text-green-400",
    END_ERROR: "text-red-400",
  };

  const filteredLogs = useMemo(() => 
    logs.filter(log => log.message.toLowerCase().includes(logFilter.toLowerCase())),
    [logs, logFilter]
  );
  const logContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [filteredLogs]);


  const renderContent = () => {
    switch (activeTab) {
      case 'full-backup':
        return (
          <>
            <h2 className="text-2xl font-bold mb-4 text-gray-200">پشتیبان‌گیری از تمام درایورها</h2>
            <p className="text-gray-400 mb-6">تمام درایورهای شخص ثالث (third-party) را در یک پوشه ذخیره کنید.</p>
            <div className="flex items-center space-x-reverse space-x-2 mb-6">
                <input type="text" readOnly value={backupPath} placeholder="پوشه مقصد را انتخاب کنید..." className="form-input-custom" />
                <button onClick={() => handleSelectFolder(setBackupPath)} disabled={isBusy} className="btn-secondary"><i className="fas fa-folder-open"></i></button>
            </div>
            <button onClick={handleFullBackup} disabled={!backupPath || isBusy} className="btn-primary">
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
                  {isSystemRestoreEnabled === false && <p className="mt-1">System Restore غیرفعال است. برای فعال‌سازی به کنترل پنل مراجعه کنید.</p>}
                  {isSystemRestoreEnabled === true && <p className="mt-1 text-green-300">System Restore فعال است.</p>}
                </div>
            </div>
            <button onClick={handleCreateRestorePoint} disabled={isBusy} className="btn-info mb-6">
                <i className="fas fa-shield-alt mr-2"></i> ایجاد نقطه بازیابی سیستم
            </button>
            <div className="flex items-center space-x-reverse space-x-2 mb-6">
                <input type="text" readOnly value={restorePath} placeholder="پوشه پشتیبان را انتخاب کنید..." className="form-input-custom" />
                <button onClick={() => handleSelectFolder(setRestorePath)} disabled={isBusy} className="btn-secondary"><i className="fas fa-folder"></i></button>
            </div>
            <button onClick={handleFullRestore} disabled={!restorePath || isBusy} className="btn-primary">
                <i className="fas fa-play mr-2"></i> شروع بازیابی
            </button>
          </>
        );
      case 'selective-backup':
        return (
          <>
            <h2 className="text-2xl font-bold mb-4 text-gray-200">پشتیبان‌گیری انتخابی</h2>
            <p className="text-gray-400 mb-2">درایورهای مورد نظر خود را برای پشتیبان‌گیری انتخاب کنید.</p>
            <button onClick={handleScanDrivers} disabled={isBusy} className="btn-secondary mb-4 w-full">
                <i className="fas fa-search mr-2"></i> اسکن درایورهای سیستم
            </button>
            <div className="h-56 overflow-y-auto bg-gray-900/50 ring-1 ring-white/10 rounded-md mb-4 p-2">
                {drivers.length === 0 && <p className="text-gray-500 text-center p-4">برای مشاهده لیست، سیستم را اسکن کنید.</p>}
                {drivers.map(driver => (
                    <div key={driver.publishedName} className="flex items-center p-2 rounded hover:bg-white/5 transition-colors">
                        <input type="checkbox" id={driver.publishedName} checked={selectedDrivers.has(driver.publishedName)} onChange={() => toggleDriverSelection(driver.publishedName)} />
                        <label htmlFor={driver.publishedName} className="flex-grow cursor-pointer text-sm pr-3">
                            <span className="font-bold text-gray-200">{driver.provider}</span> - <span className="text-gray-400">{driver.className} ({driver.originalName})</span>
                        </label>
                    </div>
                ))}
            </div>
             <div className="flex items-center space-x-reverse space-x-2 mb-4">
                <input type="text" readOnly value={selectiveBackupPath} placeholder="پوشه مقصد را انتخاب کنید..." className="form-input-custom" />
                <button onClick={() => handleSelectFolder(setSelectiveBackupPath)} disabled={isBusy} className="btn-secondary"><i className="fas fa-folder-open"></i></button>
            </div>
            <button onClick={handleSelectiveBackup} disabled={selectedDrivers.size === 0 || !selectiveBackupPath || isBusy} className="btn-primary">
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
            <button onClick={handleCreateRestorePoint} disabled={isBusy} className="btn-info mb-6">
                <i className="fas fa-shield-alt mr-2"></i> ایجاد نقطه بازیابی سیستم
            </button>

            <div className="flex items-center space-x-reverse space-x-2 mb-6">
                <div className="form-input-custom h-12 overflow-y-auto text-gray-400 text-sm">
                    {selectiveRestoreFiles.length > 0 ? `${selectiveRestoreFiles.length} فایل انتخاب شد.` : 'فایل‌های .inf را انتخاب کنید...'}
                </div>
                <button onClick={handleSelectRestoreFiles} disabled={isBusy} className="btn-secondary"><i className="fas fa-file-import"></i></button>
            </div>
            <button onClick={handleSelectiveRestore} disabled={selectiveRestoreFiles.length === 0 || isBusy} className="btn-primary">
                <i className="fas fa-play mr-2"></i> شروع بازیابی انتخابی
            </button>
          </>
        );
      case 'logs':
        return (
           <div className="h-full flex flex-col">
            <h2 className="text-2xl font-bold mb-4 text-gray-200">لاگ‌های برنامه</h2>
             <div className="flex items-center gap-2 mb-4">
                <input type="text" value={logFilter} onChange={e => setLogFilter(e.target.value)} placeholder="فیلتر لاگ‌ها..." className="form-input-custom flex-grow" />
                <button onClick={() => navigator.clipboard.writeText(logs.map(l => `[${l.timestamp}] [${l.type}] ${l.message}`).join('\n'))} className="btn-secondary" aria-label="Copy Logs"><i className="fas fa-copy"></i></button>
                <button onClick={() => setLogs([])} className="btn-secondary" aria-label="Clear Logs"><i className="fas fa-trash"></i></button>
            </div>
            <div ref={logContainerRef} className="flex-grow bg-gray-900/80 rounded-lg ring-1 ring-white/10 p-4 font-mono text-xs overflow-y-auto whitespace-pre-wrap">
                {filteredLogs.map(log => (
                    <div key={log.id} className="flex">
                        <span className="text-gray-500 mr-4">{log.timestamp}</span>
                        <span className={`w-24 font-bold ${logTypeStyles[log.type]}`}>[{log.type}]</span>
                        <span className={`flex-1 ${logTypeStyles[log.type]}`}>{log.message}</span>
                    </div>
                ))}
            </div>
           </div>
        )
      default: return null;
    }
  };
  
  const renderAdminGate = () => (
    <div className="flex-grow flex items-center justify-center p-8 text-center">
        <div className="bg-gray-800/50 ring-1 ring-red-500/30 rounded-lg p-10 max-w-lg">
            <i className="fas fa-user-shield text-5xl text-red-400 mb-6"></i>
            <h1 className="text-3xl font-bold text-red-300 mb-4">نیاز به دسترسی مدیر</h1>
            <p className="text-gray-300 mb-8">برنامه Driver Dolphin برای مدیریت درایورهای سیستمی نیاز به اجرا با دسترسی مدیر (Administrator) دارد. لطفاً برنامه را با دسترسی مناسب مجدداً اجرا کنید.</p>
            <div className="text-right bg-gray-900/70 p-6 rounded-md ring-1 ring-white/10">
                <h2 className="font-bold text-lg text-gray-100 mb-4">چگونه به عنوان مدیر اجرا کنیم:</h2>
                <ol className="list-decimal list-inside space-y-3 text-gray-300">
                    <li>این پنجره را ببندید.</li>
                    <li>فایل اجرایی یا میان‌بر برنامه <strong className="text-green-400">Driver Dolphin</strong> را پیدا کنید.</li>
                    <li>روی آیکن برنامه <strong className="text-green-400">راست‌کلیک</strong> کنید.</li>
                    <li>از منوی باز شده گزینه <strong className="text-green-400">"Run as administrator"</strong> را انتخاب کنید.</li>
                </ol>
            </div>
        </div>
    </div>
  );

  const renderAppContent = () => (
     <>
        <nav className="flex-shrink-0 px-6 border-b border-white/10">
            <div className="flex items-center space-x-reverse space-x-4">
                {tabs.map(tab => (
                     <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        disabled={isBusy}
                        className={`py-3 px-2 text-sm font-medium transition-colors duration-200 border-b-2 disabled:opacity-50 ${activeTab === tab.id ? 'border-green-400 text-green-300' : 'border-transparent text-gray-400 hover:text-white'}`}
                    >
                        <i className={`fas ${tab.icon} ml-2`}></i>
                        {tab.label}
                    </button>
                ))}
            </div>
        </nav>

        <main className="flex-grow p-6 overflow-y-auto">
           <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg shadow-2xl shadow-black/30 ring-1 ring-white/10 p-6 h-full">
            {renderContent()}
          </div>
        </main>
        
        <footer className="flex-shrink-0 h-8 px-4 bg-gray-900/70 ring-1 ring-white/10 flex items-center justify-between text-sm text-gray-400">
            <span>{statusMessage}</span>
            {isBusy && (
                 <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-green-500 to-teal-400 animated-gradient"></div>
                </div>
            )}
        </footer>
     </>
  );

  return (
    <div className="h-screen w-screen overflow-hidden bg-black flex flex-col">
      <TitleBar isMaximized={isMaximized} />
      <div className="pt-8 flex-grow flex flex-col">
        {isAdmin === null && (
            <div className="flex-grow flex items-center justify-center">
                <p className="text-gray-400">در حال بررسی دسترسی‌ها...</p>
            </div>
        )}
        {isAdmin === false && renderAdminGate()}
        {isAdmin === true && renderAppContent()}
      </div>
    </div>
  );
};

export default App;
