import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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

interface Notification {
  id: number;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
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
      runCommandAndGetOutput: (command: string) => Promise<{ stdout: string; stderr: string; code: number | null }>;
      checkSystemRestore: () => Promise<boolean>;
      getWindowsPath: () => Promise<string>;
      onCommandStart: (callback: (description: string) => void) => () => void;
      onCommandOutput: (callback: (output: string) => void) => () => void;
      onCommandEnd: (callback: (code: number | null) => void) => () => void;
    };
  }
}

let logIdCounter = 0;

const NotificationUI: React.FC<{ notification: Notification; onDismiss: (id: number) => void; }> = ({ notification, onDismiss }) => {
  const [show, setShow] = useState(false);

  const notificationStyles = {
    info: { icon: 'fa-info-circle', base: 'bg-blue-500/30 text-blue-200 border-blue-400' },
    success: { icon: 'fa-check-circle', base: 'bg-green-500/30 text-green-200 border-green-400' },
    warning: { icon: 'fa-exclamation-triangle', base: 'bg-yellow-500/30 text-yellow-200 border-yellow-400' },
    error: { icon: 'fa-times-circle', base: 'bg-red-500/30 text-red-200 border-red-400' },
  };

  const style = notificationStyles[notification.type];

  useEffect(() => {
    setShow(true); // Animate in
    if (notification.type !== 'error') {
      const timer = setTimeout(() => {
        handleDismiss();
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const handleDismiss = () => {
    setShow(false); // Animate out
    setTimeout(() => onDismiss(notification.id), 300); // Wait for animation to finish
  };

  return (
    <div
      className={`relative w-80 max-w-sm rounded-lg shadow-lg backdrop-blur-md ring-1 ring-white/10 overflow-hidden border-l-4 transition-all duration-300 ease-in-out transform ${style.base} ${show ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full'}`}
      role="alert"
    >
      <div className="p-4 flex items-start gap-4">
        <i className={`fas ${style.icon} text-xl mt-1`}></i>
        <div className="flex-1">
          <p className="font-bold text-white">{notification.title}</p>
          <p className="text-sm">{notification.message}</p>
        </div>
        <button
          onClick={handleDismiss}
          className="absolute top-2 right-2 text-gray-400 hover:text-white transition-colors"
          aria-label="بستن"
        >
          <i className="fas fa-times"></i>
        </button>
      </div>
    </div>
  );
};

const NotificationContainer: React.FC<{ notifications: Notification[]; onDismiss: (id: number) => void; }> = ({ notifications, onDismiss }) => {
  return (
    <div className="fixed top-10 right-4 z-[100] space-y-3" style={{ WebkitAppRegion: 'no-drag' }}>
      {notifications.map(notification => (
        <NotificationUI key={notification.id} notification={notification} onDismiss={onDismiss} />
      ))}
    </div>
  );
};


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

const BusyIndicator: React.FC<{ operation: string }> = ({ operation }) => (
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-50 transition-opacity duration-300">
        <i className="fas fa-cog fa-spin text-5xl text-green-400 mb-4"></i>
        <p className="text-white text-lg font-medium">{operation}...</p>
        <div className="w-48 h-2 bg-gray-700 rounded-full overflow-hidden mt-4">
            <div className="h-full bg-gradient-to-r from-green-500 to-teal-400 animated-gradient"></div>
        </div>
    </div>
);

const App: React.FC = () => {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [activeTab, setActiveTab] = useState('full-backup');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [logFilter, setLogFilter] = useState('');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [currentOperation, setCurrentOperation] = useState('');

  // Paths
  const [backupPath, setBackupPath] = useState('');
  const [restorePath, setRestorePath] = useState('');
  const [selectiveBackupPath, setSelectiveBackupPath] = useState('');
  
  // System state
  const [isSystemRestoreEnabled, setIsSystemRestoreEnabled] = useState<boolean | null>(null);
  const [showRestoreWarningBanner, setShowRestoreWarningBanner] = useState(true);

  // Selective Backup
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [selectedDrivers, setSelectedDrivers] = useState<Set<string>>(new Set());
  const [windowsPath, setWindowsPath] = useState('');
  
  // Selective Restore
  const [selectiveRestoreFiles, setSelectiveRestoreFiles] = useState<string[]>([]);
  
  const notificationIdCounter = useRef(0);

  const removeNotification = useCallback((id: number) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const addNotification = useCallback((type: Notification['type'], title: string, message: string) => {
    const id = notificationIdCounter.current++;
    setNotifications(prev => [...prev, { id, type, title, message }]);
  }, []);

  const addLog = (type: LogType, message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs(prev => [...prev, { id: logIdCounter++, timestamp, type, message }]);
  };

  useEffect(() => {
    window.electronAPI.checkAdmin().then(setIsAdmin);

    addLog('INFO', 'برنامه راه‌اندازی شد.');
    const cleanupWindowState = window.electronAPI.onWindowStateChange(setIsMaximized);
    window.electronAPI.getWindowsPath().then(setWindowsPath);
    
    // Automatic System Restore check on startup
    window.electronAPI.checkSystemRestore().then(status => {
      setIsSystemRestoreEnabled(status);
      if (!status) {
        addLog('WARN', 'System Restore غیرفعال است. ایجاد نقطه بازیابی با خطا مواجه خواهد شد.');
      } else {
        addLog('INFO', 'System Restore فعال است.');
      }
    });
    
    const cleanupStart = window.electronAPI.onCommandStart((description) => {
        setIsBusy(true);
        setCurrentOperation(description);
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
        addLog(success ? 'END_SUCCESS' : 'END_ERROR', `فرآیند با کد خروجی ${code} پایان یافت.`);
        setIsBusy(false);
        
        if (currentOperation) {
            if (success) {
                addNotification('success', 'عملیات موفق', `${currentOperation} با موفقیت به پایان رسید.`);
            } else {
                addNotification('error', 'عملیات ناموفق', `${currentOperation} با خطا مواجه شد. به لاگ‌ها مراجعه کنید.`);
            }
        }
        setCurrentOperation('');
    });
    
    return () => {
      cleanupWindowState();
      cleanupStart();
      cleanupOutput();
      cleanupEnd();
    };
  }, [currentOperation, addNotification]);
  
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

  const handleCreateRestorePoint = async () => {
    if (isBusy) return;
    const command = `powershell.exe -Command "Checkpoint-Computer -Description 'DriverDolphin Pre-Restore Point' -RestorePointType 'MODIFY_SETTINGS'"`;
    
    setIsBusy(true);
    setCurrentOperation("در حال ایجاد یک نقطه بازیابی سیستم جدید");
    addLog('START', "شروع ایجاد نقطه بازیابی سیستم");

    const { stdout, stderr, code } = await window.electronAPI.runCommandAndGetOutput(command);

    if (stderr) addLog('OUTPUT', `ERROR: ${stderr}`);
    if (stdout) addLog('OUTPUT', stdout);
    
    const success = code === 0;
    
    const warningMessage = "one has already been created within the past 1440 minutes";
    if (success && (stdout.includes(warningMessage) || stderr.includes(warningMessage))) {
        const message = "یک نقطه بازیابی به تازگی ایجاد شده است. ویندوز اجازه ایجاد نقطه جدید را نمی‌دهد.";
        addLog('WARN', message);
        addNotification('warning', 'نقطه بازیابی', message);
    } else if (success) {
       addLog('END_SUCCESS', `فرآیند نقطه بازیابی با کد خروجی ${code} پایان یافت.`);
       addNotification('success', 'موفقیت', 'نقطه بازیابی سیستم با موفقیت ایجاد شد.');
    } else {
       addLog('END_ERROR', `فرآیند نقطه بازیابی با کد خروجی ${code} پایان یافت.`);
       addNotification('error', 'خطا', 'ایجاد نقطه بازیابی با خطا مواجه شد. به لاگ‌ها مراجعه کنید.');
    }

    setIsBusy(false);
    setCurrentOperation('');
  };
  
  const handleFullRestore = () => {
    if (!restorePath || isBusy) return;
    const command = `pnputil /add-driver "${restorePath}\\*.inf" /subdirs /install`;
    window.electronAPI.runCommand(command, `در حال نصب تمام درایورها از "${restorePath}"`);
  };
  
  const parsePnpUtilOutput = (output: string): DriverInfo[] => {
    const drivers: DriverInfo[] = [];
    const blocks = output.split('Published Name :').slice(1);

    for (const block of blocks) {
        const driver: Partial<DriverInfo> = {};
        const lines = block.trim().split(/\r?\n/);

        driver.publishedName = lines[0]?.trim();
        if (!driver.publishedName) continue;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const separatorIndex = line.indexOf(':');
            if (separatorIndex === -1) continue;

            const key = line.substring(0, separatorIndex).trim();
            const value = line.substring(separatorIndex + 1).trim();

            if (key === 'Original Name') driver.originalName = value;
            else if (key === 'Provider Name') driver.provider = value;
            else if (key === 'Class Name') driver.className = value;
        }

        if (driver.publishedName && driver.originalName && driver.provider && driver.className) {
            drivers.push(driver as DriverInfo);
        }
    }
    return drivers;
  };

  const handleScanDrivers = async () => {
    if (isBusy) return;
    const command = `chcp 65001 && pnputil /enum-drivers`;
    setDrivers([]);
    setSelectedDrivers(new Set());
    
    setIsBusy(true);
    setCurrentOperation("در حال اسکن برای یافتن تمام درایورهای شخص ثالث");
    addLog('START', "شروع اسکن درایورهای سیستم");

    const { stdout, stderr, code } = await window.electronAPI.runCommandAndGetOutput(command);

    if (stderr) {
        addLog('OUTPUT', `ERROR: ${stderr}`);
    }
    
    const parsedDrivers = parsePnpUtilOutput(stdout);
    setDrivers(parsedDrivers);
    if (parsedDrivers.length > 0) {
      addLog('INFO', `تعداد ${parsedDrivers.length} درایور پیدا و پردازش شد.`);
    }

    const success = code === 0;
    addLog(success ? 'END_SUCCESS' : 'END_ERROR', `فرآیند اسکن با کد خروجی ${code} پایان یافت.`);
    
    if (success) {
      addNotification('success', 'اسکن کامل شد', `تعداد ${parsedDrivers.length} درایور شخص ثالث یافت شد.`);
    } else {
      addNotification('error', 'خطای اسکن', 'اسکن درایورهای سیستم با خطا مواجه شد.');
    }

    setIsBusy(false);
    setCurrentOperation('');
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

  const handleToggleSelectAll = () => {
    if (selectedDrivers.size === drivers.length) {
      setSelectedDrivers(new Set());
    } else {
      const allDriverNames = drivers.map(d => d.publishedName);
      setSelectedDrivers(new Set(allDriverNames));
    }
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
      const command = `pnputil ${selectiveRestoreFiles.map(path => `/add-driver "${path}"`).join(' ')} /install`;
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
          <div className="flex flex-col h-full">
            <h2 className="text-2xl font-bold mb-4 text-gray-200">پشتیبان‌گیری از تمام درایورها</h2>
            <p className="text-gray-400 mb-6">تمام درایورهای شخص ثالث (third-party) را در یک پوشه ذخیره کنید.</p>
            <div className="flex items-center space-x-reverse space-x-2 mb-6">
                <input type="text" readOnly value={backupPath} placeholder="پوشه مقصد را انتخاب کنید..." className="form-input-custom" />
                <button onClick={() => handleSelectFolder(setBackupPath)} disabled={isBusy} className="btn-secondary flex-shrink-0"><i className="fas fa-folder-open"></i></button>
            </div>
            <div className="mt-auto flex justify-start">
              <button onClick={handleFullBackup} disabled={!backupPath || isBusy} className="btn-primary w-64">
                  <i className="fas fa-play mr-2"></i> شروع پشتیبان‌گیری
              </button>
            </div>
          </div>
        );
      case 'full-restore':
         return (
          <div className="flex flex-col h-full">
            <h2 className="text-2xl font-bold mb-4 text-gray-200">بازیابی تمام درایورها</h2>
            <p className="text-gray-400 mb-6">درایورها را از یک پوشه پشتیبان نصب کنید. توصیه می‌شود ابتدا یک نقطه بازیابی سیستم (Restore Point) ایجاد کنید.</p>
            
            <div className="mb-6 space-y-4">
              <p className="text-gray-400 text-sm">
                  وضعیت System Restore: {isSystemRestoreEnabled === null ? 'در حال بررسی...' : isSystemRestoreEnabled ? <span className="text-green-400 font-bold">فعال</span> : <span className="text-red-400 font-bold">غیرفعال</span>}
              </p>
              <button onClick={handleCreateRestorePoint} disabled={isBusy || !isSystemRestoreEnabled} className="btn-info w-64">
                  <i className="fas fa-shield-alt mr-2"></i> ایجاد نقطه بازیابی
              </button>
            </div>

            <div className="flex items-center space-x-reverse space-x-2 mb-6">
                <input type="text" readOnly value={restorePath} placeholder="پوشه پشتیبان را انتخاب کنید..." className="form-input-custom" />
                <button onClick={() => handleSelectFolder(setRestorePath)} disabled={isBusy} className="btn-secondary flex-shrink-0"><i className="fas fa-folder"></i></button>
            </div>
            <div className="mt-auto flex justify-start">
              <button onClick={handleFullRestore} disabled={!restorePath || isBusy} className="btn-primary w-64">
                  <i className="fas fa-play mr-2"></i> شروع بازیابی
              </button>
            </div>
          </div>
        );
      case 'selective-backup':
        return (
          <div className="flex flex-col h-full">
            <h2 className="text-2xl font-bold mb-4 text-gray-200">پشتیبان‌گیری انتخابی</h2>
            <p className="text-gray-400 mb-2">درایورهای مورد نظر خود را برای پشتیبان‌گیری انتخاب کنید.</p>
            <div className="mb-4">
              <button onClick={handleScanDrivers} disabled={isBusy} className="btn-secondary w-64">
                  <i className="fas fa-search mr-2"></i> اسکن درایورهای سیستم
              </button>
            </div>
             <div className="flex items-center mb-2">
                <input 
                    type="checkbox" 
                    id="select-all-drivers"
                    checked={drivers.length > 0 && selectedDrivers.size === drivers.length}
                    onChange={handleToggleSelectAll}
                    disabled={drivers.length === 0 || isBusy}
                />
                <label htmlFor="select-all-drivers" className="pr-2 text-sm text-gray-300 cursor-pointer">انتخاب / عدم انتخاب همه</label>
            </div>
            <div className="flex-grow overflow-y-auto bg-gray-900/50 ring-1 ring-white/10 rounded-md mb-4 p-2">
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
                <button onClick={() => handleSelectFolder(setSelectiveBackupPath)} disabled={isBusy} className="btn-secondary flex-shrink-0"><i className="fas fa-folder-open"></i></button>
            </div>
            <div className="flex justify-start">
              <button onClick={handleSelectiveBackup} disabled={selectedDrivers.size === 0 || !selectiveBackupPath || isBusy} className="btn-primary w-64">
                  <i className="fas fa-download mr-2"></i> پشتیبان‌گیری از {selectedDrivers.size} درایور
              </button>
            </div>
          </div>
        );
      case 'selective-restore':
         return (
          <div className="flex flex-col h-full">
            <h2 className="text-2xl font-bold mb-4 text-gray-200">بازیابی انتخابی</h2>
            <p className="text-gray-400 mb-6">فایل‌های .inf درایورهای مورد نظر برای نصب را انتخاب کنید.</p>
            
            <div className="mb-6">
               <button onClick={handleCreateRestorePoint} disabled={isBusy || !isSystemRestoreEnabled} className="btn-info w-64">
                  <i className="fas fa-shield-alt mr-2"></i> ایجاد نقطه بازیابی
              </button>
            </div>

            <div className="flex items-center space-x-reverse space-x-2 mb-6">
                <div className="form-input-custom h-24 overflow-y-auto text-gray-400 text-sm p-2">
                    {selectiveRestoreFiles.length > 0 ? (
                        <ul className="space-y-1">
                            {selectiveRestoreFiles.map((file, index) => (
                                <li key={index} className="truncate text-xs font-mono" title={file}>
                                    {file.split(/[\\/]/).pop()}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="flex items-center justify-center h-full">
                            <span>فایل‌های .inf را انتخاب کنید...</span>
                        </div>
                    )}
                </div>
                <button onClick={handleSelectRestoreFiles} disabled={isBusy} className="btn-secondary flex-shrink-0"><i className="fas fa-file-import"></i></button>
            </div>
            <div className="mt-auto flex justify-start">
              <button onClick={handleSelectiveRestore} disabled={selectiveRestoreFiles.length === 0 || isBusy} className="btn-primary w-64">
                  <i className="fas fa-play mr-2"></i> شروع بازیابی انتخابی
              </button>
            </div>
          </div>
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
                        <span className={`w-24 font-bold ${logTypeStyles[log.type]}`}>{`[${log.type}]`}</span>
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
     <div className="flex flex-row-reverse h-full">
        <aside className="w-60 flex-shrink-0 bg-gray-900/50 backdrop-blur-sm ring-1 ring-white/10 flex flex-col p-4">
            <div className="space-y-2">
                 {tabs.map(tab => (
                       <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          disabled={isBusy}
                          className={`w-full flex items-center space-x-reverse space-x-3 p-3 rounded-md text-right text-sm font-medium transition-colors duration-200 disabled:opacity-50 group ${activeTab === tab.id ? 'bg-green-500/20 text-white shadow-inner shadow-black/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
                      >
                          <i className={`fas ${tab.icon} w-6 text-center text-lg transition-colors ${activeTab === tab.id ? 'text-green-300' : 'text-gray-500 group-hover:text-gray-300'}`}></i>
                          <span>{tab.label}</span>
                      </button>
                  ))}
            </div>
        </aside>

        <main className="flex-grow p-6 relative">
           {isBusy && <BusyIndicator operation={currentOperation} />}
           {isSystemRestoreEnabled === false && showRestoreWarningBanner && (
              <div className="bg-yellow-900/50 text-yellow-200 p-3 mb-4 rounded-md text-sm ring-1 ring-yellow-500/50 flex items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <i className="fas fa-exclamation-triangle mt-1"></i>
                    <span>System Restore غیرفعال است. قابلیت ایجاد نقطه بازیابی کار نخواهد کرد. برای فعال‌سازی به کنترل پنل ویندوز مراجعه کنید.</span>
                  </div>
                  <button onClick={() => setShowRestoreWarningBanner(false)} className="text-yellow-300 hover:text-white transition-colors" aria-label="بستن هشدار">
                      <i className="fas fa-times"></i>
                  </button>
              </div>
          )}
           <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl shadow-2xl shadow-black/30 ring-1 ring-white/10 p-6 h-full">
            {renderContent()}
          </div>
        </main>
     </div>
  );

  return (
    <div className="h-screen w-screen overflow-hidden bg-black flex flex-col">
      <TitleBar isMaximized={isMaximized} />
      <NotificationContainer notifications={notifications} onDismiss={removeNotification} />
      <div className="pt-8 flex-grow" style={{minHeight: 0}}>
        {isAdmin === null && (
            <div className="flex-grow flex items-center justify-center h-full">
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
