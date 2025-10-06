import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { OpenDialogOptions } from 'electron';

// Type definitions
interface DriverInfo {
  publishedName: string;
  originalName: string;
  provider: string;
  className: string;
  version: string;
}

interface DriverFromBackup {
  id: string;
  displayName: string;
  infName: string;
  fullInfPath: string;
  provider: string;
  className: string;
  version: string;
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
      getSetting: (key: string) => Promise<any>;
      setSetting: (key: string, value: any) => void;
      validatePath: (path: string) => Promise<boolean>;
      scanBackupFolder: (folderPath: string) => Promise<{ drivers: DriverFromBackup[], errors: string[] }>;
      isFolderEmpty: (folderPath: string) => Promise<boolean>;
      showConfirmationDialog: (options: any) => Promise<number>;
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
      className={`relative w-80 max-w-sm rounded-lg shadow-lg backdrop-blur-md ring-1 ring-white/10 overflow-hidden border-r-4 transition-all duration-300 ease-in-out transform ${style.base} ${show ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-full'}`}
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
          className="absolute top-2 left-2 text-gray-400 hover:text-white transition-colors"
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
    <div className="fixed top-10 left-4 z-[100] space-y-3" style={{ WebkitAppRegion: 'no-drag' }}>
      {notifications.map(notification => (
        <NotificationUI key={notification.id} notification={notification} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

const AboutModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[101]" onClick={onClose}>
        <div className="bg-brand-med rounded-lg shadow-2xl ring-1 ring-brand-border max-w-md w-full text-center p-8 m-4" onClick={e => e.stopPropagation()}>
            <i className="fas fa-water text-5xl text-brand-accent mb-4"></i>
            <h2 className="text-2xl font-bold text-white mb-2">دلفین درایور</h2>
            <p className="text-gray-400 mb-6">یک ابزار مدرن و آفلاین برای پشتیبان‌گیری و بازیابی درایورهای ویندوز.</p>
            <p className="text-xs text-gray-500 mb-6">نسخه ۱.۰.۰</p>
            <button onClick={onClose} className="btn-secondary px-8">بستن</button>
        </div>
    </div>
  );
};


const TitleBar: React.FC<{ isMaximized: boolean; onAboutClick: () => void; }> = ({ isMaximized, onAboutClick }) => {
  return (
    <div
      style={{ WebkitAppRegion: 'drag' }}
      className="h-8 bg-brand-dark/70 backdrop-blur-sm flex items-center justify-between fixed top-0 left-0 right-0 z-50 ring-1 ring-brand-border"
    >
      <div className="px-4 flex items-center gap-3 h-full text-gray-300 text-sm font-medium">
        <i className="fas fa-water text-brand-accent"></i>
        <span>دلفین درایور</span>
      </div>
      <div className="flex items-center h-full">
         <button
          onClick={onAboutClick}
          style={{ WebkitAppRegion: 'no-drag' }}
          className="w-10 h-full flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          aria-label="درباره"
          title="درباره دلفین درایور"
        >
          <i className="fas fa-info-circle text-sm"></i>
        </button>
        <button
          onClick={() => window.electronAPI.minimizeWindow()}
          style={{ WebkitAppRegion: 'no-drag' }}
          className="w-10 h-full flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          aria-label="کوچک‌نمایی"
        >
          <i className="fas fa-window-minimize text-xs"></i>
        </button>
        <button
          onClick={() => window.electronAPI.toggleMaximizeWindow()}
          style={{ WebkitAppRegion: 'no-drag' }}
          className="w-10 h-full flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          aria-label={isMaximized ? "بازگردانی" : "بزرگ‌نمایی"}
        >
          <i className={`fas ${isMaximized ? 'fa-window-restore' : 'fa-window-maximize'} text-xs`}></i>
        </button>
        <button
          onClick={() => window.electronAPI.closeWindow()}
          style={{ WebkitAppRegion: 'no-drag' }}
          className="w-10 h-full flex items-center justify-center text-gray-400 hover:bg-red-500 hover:text-white transition-colors"
          aria-label="بستن"
        >
          <i className="fas fa-times text-sm"></i>
        </button>
      </div>
    </div>
  );
};

const BusyIndicator: React.FC<{ operation: string }> = ({ operation }) => (
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-50 transition-opacity duration-300">
        <i className="fas fa-cog fa-spin text-5xl text-brand-accent mb-4"></i>
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
  const currentOperationRef = useRef('');

  useEffect(() => {
    currentOperationRef.current = currentOperation;
  }, [currentOperation]);

  const [showAboutModal, setShowAboutModal] = useState(false);

  // Paths
  const [backupPath, setBackupPath] = useState('');
  const [restorePath, setRestorePath] = useState('');
  const [selectiveBackupPath, setSelectiveBackupPath] = useState('');
  const [selectiveRestoreFolder, setSelectiveRestoreFolder] = useState('');

  // System state
  const [isSystemRestoreEnabled, setIsSystemRestoreEnabled] = useState<boolean | null>(null);
  const [showRestoreWarningBanner, setShowRestoreWarningBanner] = useState(true);

  // Selective Backup
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [selectedDrivers, setSelectedDrivers] = useState<Set<string>>(new Set());
  const [windowsPath, setWindowsPath] = useState('');
  const [selectiveBackupSearch, setSelectiveBackupSearch] = useState('');
  
  // Selective Restore
  const [driversFromBackup, setDriversFromBackup] = useState<DriverFromBackup[]>([]);
  const [selectedDriversFromBackup, setSelectedDriversFromBackup] = useState<Set<string>>(new Set());
  const [selectiveRestoreSearch, setSelectiveRestoreSearch] = useState('');

  const notificationIdCounter = useRef(0);

  const addLog = useCallback((type: LogType, message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs(prev => [...prev, { id: logIdCounter++, timestamp, type, message }]);
  }, []);

  const addNotification = useCallback((type: Notification['type'], title: string, message: string) => {
    const id = notificationIdCounter.current++;
    setNotifications(prev => [...prev, { id, type, title, message }]);
  }, []);

  const removeNotification = useCallback((id: number) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const scanBackupFolder = useCallback(async (folder: string) => {
      if (!folder) return;
      setIsBusy(true);
      setCurrentOperation(`در حال اسکن پوشه پشتیبان`);
      addLog('START', `Scanning backup folder: ${folder}`);
      
      const { drivers: foundDrivers, errors } = await window.electronAPI.scanBackupFolder(folder);
      
      if (errors && errors.length > 0) {
          errors.forEach(err => addLog('INFO', `Scan Log: ${err}`));
      }

      setDriversFromBackup(foundDrivers);
      setSelectedDriversFromBackup(new Set());
      setIsBusy(false);
      setCurrentOperation('');
      
      addLog('END_SUCCESS', `Scan complete. Found ${foundDrivers.length} driver packages.`);
      
      const hasRealErrors = errors && errors.some(e => !e.startsWith('Scan complete: No .inf'));

      if (hasRealErrors) {
          addNotification('error', 'خطا در اسکن', 'برخی از فایل‌های درایور قابل پردازش نبودند. به لاگ‌ها مراجعه کنید.');
      }

      if (foundDrivers.length > 0) {
        addNotification('info', 'اسکن کامل شد', `تعداد ${foundDrivers.length} درایور در پوشه یافت شد.`);
      } else if (!hasRealErrors) {
        addNotification('warning', 'اسکن کامل شد', `هیچ درایوری در پوشه انتخاب شده یافت نشد.`);
      }
  }, [addLog, addNotification]);

  const onCommandStart = useCallback((description: string) => {
      setIsBusy(true);
      setCurrentOperation(description);
      addLog('START', `Operation started: ${description}`);
  }, [addLog]);

  const onCommandOutput = useCallback((output: string) => {
      const cleanedOutput = output.trim();
      if (cleanedOutput) {
         addLog('OUTPUT', cleanedOutput);
      }
  }, [addLog]);

  const onCommandEnd = useCallback((code: number | null) => {
      const success = code === 0;
      addLog(success ? 'END_SUCCESS' : 'END_ERROR', `Operation finished with exit code ${code}.`);
      setIsBusy(false);
      
      const operationName = currentOperationRef.current;
      if (operationName) {
          if (success) {
              addNotification('success', 'عملیات موفق', `${operationName} با موفقیت به پایان رسید.`);
          } else {
              addNotification('error', 'عملیات ناموفق', `${operationName} با خطا مواجه شد. به لاگ‌ها مراجعه کنید.`);
          }
      }
      setCurrentOperation('');
  }, [addLog, addNotification]);

  useEffect(() => {
    window.electronAPI.checkAdmin().then(setIsAdmin);
    addLog('INFO', 'Application initialized.');
    const cleanupWindowState = window.electronAPI.onWindowStateChange(setIsMaximized);
    window.electronAPI.getWindowsPath().then(setWindowsPath);

    const validateAndSetPath = async (key: string, setter: React.Dispatch<React.SetStateAction<string>>, scanCallback?: (path: string) => void) => {
        const path = await window.electronAPI.getSetting(key) || '';
        if (path) {
            const isValid = await window.electronAPI.validatePath(path);
            if (isValid) {
                setter(path);
                if (scanCallback) scanCallback(path);
            } else {
                addNotification('warning', 'مسیر نامعتبر', `پوشه ذخیره شده یافت نشد: ${path}`);
                setter('');
                window.electronAPI.setSetting(key, '');
            }
        }
    };
    
    const loadSettings = async () => {
        await validateAndSetPath('backupPath', setBackupPath);
        await validateAndSetPath('restorePath', setRestorePath);
        await validateAndSetPath('selectiveBackupPath', setSelectiveBackupPath);
        await validateAndSetPath('selectiveRestoreFolder', setSelectiveRestoreFolder, scanBackupFolder);
    };
    loadSettings();
    
    window.electronAPI.checkSystemRestore().then(status => {
      setIsSystemRestoreEnabled(status);
      if (!status) {
        addLog('WARN', 'System Restore is disabled. Creating a restore point will fail.');
      } else {
        addLog('INFO', 'System Restore is enabled.');
      }
    });
    
    const cleanupStart = window.electronAPI.onCommandStart(onCommandStart);
    const cleanupOutput = window.electronAPI.onCommandOutput(onCommandOutput);
    const cleanupEnd = window.electronAPI.onCommandEnd(onCommandEnd);
    
    return () => {
      cleanupWindowState();
      cleanupStart();
      cleanupOutput();
      cleanupEnd();
    };
  }, [addLog, addNotification, onCommandStart, onCommandOutput, onCommandEnd, scanBackupFolder]);
  
  const createPathSetter = (stateSetter: React.Dispatch<React.SetStateAction<string>>, key: string) => {
    return (path: string) => {
      stateSetter(path);
      window.electronAPI.setSetting(key, path);
    }
  };
  
  const setPersistedBackupPath = createPathSetter(setBackupPath, 'backupPath');
  const setPersistedRestorePath = createPathSetter(setRestorePath, 'restorePath');
  const setPersistedSelectiveBackupPath = createPathSetter(setSelectiveBackupPath, 'selectiveBackupPath');
  const setPersistedSelectiveRestoreFolder = createPathSetter(setSelectiveRestoreFolder, 'selectiveRestoreFolder');


  const handleSelectFolder = async (setter: (path: string) => void) => {
    const paths = await window.electronAPI.selectDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (paths && paths.length > 0) {
      setter(paths[0]);
    }
  };

  const confirmNonEmptyFolder = async (path: string): Promise<boolean> => {
    const isEmpty = await window.electronAPI.isFolderEmpty(path);
    if (!isEmpty) {
        const response = await window.electronAPI.showConfirmationDialog({
            type: 'warning',
            title: 'پوشه مقصد خالی نیست',
            message: 'پوشه مقصد انتخاب شده حاوی فایل‌هایی است. فایل‌های موجود ممکن است رونویسی شوند.\n\nآیا می‌خواهید ادامه دهید؟',
            buttons: ['ادامه پشتیبان‌گیری', 'لغو'],
            defaultId: 1,
            cancelId: 1,
        });
        if (response === 1) { // User cancelled
            addLog('INFO', 'Backup cancelled by user due to non-empty destination.');
            return false;
        }
    }
    return true;
  };

  const handleFullBackup = async () => {
    if (!backupPath || isBusy) return;
    if (!(await confirmNonEmptyFolder(backupPath))) return;
    const command = `dism /online /export-driver /destination:"${backupPath}"`;
    window.electronAPI.runCommand(command, "در حال پشتیبان‌گیری از تمام درایورهای نصب شده");
  };

  const handleCreateRestorePoint = async () => {
    if (isBusy) return;
    const command = `powershell -Command "Checkpoint-Computer -Description 'DriverDolphin Pre-Restore Point' -RestorePointType 'MODIFY_SETTINGS'"`;
    window.electronAPI.runCommand(command, "در حال ایجاد یک نقطه بازیابی سیستم جدید");
  };

  const handleRestoreProcess = async (driversToRestore: DriverFromBackup[]) => {
      const command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "@(Get-WindowsDriver -Online | Select-Object @{n='publishedName';e={$_.Driver}}, @{n='originalName';e={$_.OriginalFileName}}, @{n='provider';e={$_.ProviderName}}, @{n='className';e={$_.ClassName}}, @{n='version';e={$_.DriverVersion}}) | ConvertTo-Json"`;
      addLog('INFO', 'Scanning currently installed drivers for comparison.');
      setCurrentOperation("در حال بررسی درایورهای نصب شده...");
      setIsBusy(true);

      const { stdout, code } = await window.electronAPI.runCommandAndGetOutput(command);
      if (code !== 0 || !stdout.trim()) {
          addLog('END_ERROR', 'Failed to get list of installed drivers.');
          addNotification('error', 'خطا', 'لیست درایورهای نصب شده برای مقایسه دریافت نشد.');
          setIsBusy(false);
          setCurrentOperation('');
          return;
      }

      let installedDrivers: DriverInfo[] = [];
      try {
        installedDrivers = JSON.parse(stdout.trim());
      } catch (e) {
        addLog('END_ERROR', 'Failed to parse list of installed drivers.');
        addNotification('error', 'خطا', 'Parsing installed driver list failed.');
        setIsBusy(false);
        setCurrentOperation('');
        return;
      }

      const driversToInstallPaths = new Set<string>();
      let replaceAllConfirmed = false;

      for (const backupDriver of driversToRestore) {
          const existingDriver = installedDrivers.find(
              (d) => d.originalName === backupDriver.infName && d.version === backupDriver.version
          );

          if (existingDriver) {
              if (replaceAllConfirmed) {
                  driversToInstallPaths.add(backupDriver.fullInfPath);
                  continue;
              }

              setCurrentOperation(`در انتظار تایید کاربر برای ${backupDriver.displayName}`);
              const response = await window.electronAPI.showConfirmationDialog({
                  type: 'question',
                  title: 'درایور از قبل نصب شده است',
                  message: `یک درایور با همین نسخه از قبل نصب شده است:`,
                  detail: `درایور: ${backupDriver.displayName}\nنسخه: ${backupDriver.version}\n\nآیا می‌خواهید آن را جایگزین کنید؟`,
                  buttons: ['بله', 'خیر', 'بله برای همه', 'لغو'],
                  defaultId: 1,
                  cancelId: 3,
              });

              if (response === 0) { // Yes
                  driversToInstallPaths.add(backupDriver.fullInfPath);
              } else if (response === 1) { // No
                  addLog('INFO', `User skipped reinstalling driver: ${backupDriver.displayName}`);
              } else if (response === 2) { // Yes to All
                  replaceAllConfirmed = true;
                  driversToInstallPaths.add(backupDriver.fullInfPath);
              } else if (response === 3) { // Cancel
                  addLog('INFO', 'Restore operation cancelled by user.');
                  addNotification('info', 'لغو شد', 'عملیات بازیابی توسط کاربر لغو شد.');
                  setIsBusy(false);
                  setCurrentOperation('');
                  return;
              }
          } else {
              driversToInstallPaths.add(backupDriver.fullInfPath);
          }
      }

      const finalPaths = Array.from(driversToInstallPaths);
      if (finalPaths.length > 0) {
          const installCommand = finalPaths.map(path => `pnputil /add-driver "${path}" /install`).join(' & ');
          window.electronAPI.runCommand(installCommand, `در حال نصب ${finalPaths.length} درایور`);
          addNotification('info', 'نصب شروع شد', 'برای مشاهده جزئیات نصب هر درایور به لاگ‌ها مراجعه کنید.');
      } else {
          addLog('INFO', 'No drivers required installation.');
          addNotification('info', 'بروز است', 'تمام درایورهای انتخاب شده از قبل نصب شده‌اند.');
          setIsBusy(false);
          setCurrentOperation('');
      }
  };
  
  const handleFullRestore = async () => {
    if (!restorePath || isBusy) return;

    setIsBusy(true);
    setCurrentOperation(`در حال اسکن پوشه پشتیبان: ${restorePath}`);
    addLog('START', `Scanning backup folder for full restore: ${restorePath}`);
    
    const { drivers: driversInBackup, errors } = await window.electronAPI.scanBackupFolder(restorePath);
    
    if (errors && errors.length > 0) {
        errors.forEach(err => addLog('INFO', `Scan Log: ${err}`));
    }

    if (driversInBackup.length === 0) {
        addLog('END_ERROR', 'No drivers found in the specified folder.');
        if (!errors || errors.every(e => e.includes('No .inf files found'))) {
          addNotification('warning', 'درایوری یافت نشد', 'پوشه انتخاب شده حاوی پکیج درایور معتبری نیست.');
        } else {
          addNotification('error', 'خطا در اسکن', 'اسکن پوشه پشتیبان ناموفق بود. به لاگ‌ها مراجعه کنید.');
        }
        setIsBusy(false);
        setCurrentOperation('');
        return;
    }

    addLog('INFO', `Scan complete. Found ${driversInBackup.length} driver definitions.`);
    await handleRestoreProcess(driversInBackup);
  };

  const handleScanDrivers = async () => {
    if (isBusy) return;
    const command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "@(Get-WindowsDriver -Online | Select-Object @{n='publishedName';e={$_.Driver}}, @{n='originalName';e={$_.OriginalFileName}}, @{n='provider';e={$_.ProviderName}}, @{n='className';e={$_.ClassName}}, @{n='version';e={$_.DriverVersion}}) | ConvertTo-Json"`;

    setDrivers([]);
    setSelectedDrivers(new Set());
    
    setIsBusy(true);
    setCurrentOperation("در حال اسکن درایورهای نصب شده سیستم");
    addLog('START', "Scanning system for installed drivers.");

    const { stdout, stderr, code } = await window.electronAPI.runCommandAndGetOutput(command);
    
    let success = code === 0;

    if (stderr) {
        addLog('OUTPUT', `ERROR: ${stderr}`);
    }
    
    let parsedDrivers: DriverInfo[] = [];
    if (stdout && stdout.trim()) {
        try {
            const result = JSON.parse(stdout.trim());
            parsedDrivers = Array.isArray(result) ? result : (result ? [result] : []);
            setDrivers(parsedDrivers);
            addLog('INFO', `${parsedDrivers.length} drivers found and processed.`);
        } catch (e: any) {
            addLog('END_ERROR', `Failed to parse driver scan output: ${e.message}`);
            success = false;
        }
    } else {
      addLog('INFO', `Scan complete, no drivers found.`);
    }
    
    addLog(success ? 'END_SUCCESS' : 'END_ERROR', `Scan process finished with exit code ${code}.`);
    
    if (success) {
      addNotification('success', 'اسکن کامل شد', `تعداد ${parsedDrivers.length} درایور یافت شد.`);
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

  const filteredDrivers = useMemo(() => {
    if (!selectiveBackupSearch) return drivers;
    const lowercasedFilter = selectiveBackupSearch.toLowerCase();
    return drivers.filter(driver => 
        driver.provider.toLowerCase().includes(lowercasedFilter) ||
        driver.className.toLowerCase().includes(lowercasedFilter) ||
        driver.originalName.toLowerCase().includes(lowercasedFilter) ||
        driver.version.toLowerCase().includes(lowercasedFilter)
    );
  }, [drivers, selectiveBackupSearch]);

  const handleToggleSelectAll = () => {
    const allFilteredSelected = filteredDrivers.length > 0 && filteredDrivers.every(d => selectedDrivers.has(d.publishedName));
    setSelectedDrivers(prev => {
        const newSet = new Set(prev);
        if (allFilteredSelected) {
            filteredDrivers.forEach(d => newSet.delete(d.publishedName));
        } else {
            filteredDrivers.forEach(d => newSet.add(d.publishedName));
        }
        return newSet;
    });
  };
  
  const handleSelectiveBackup = async () => {
      if(selectedDrivers.size === 0 || !selectiveBackupPath || isBusy) return;
      if (!(await confirmNonEmptyFolder(selectiveBackupPath))) return;

      const getBaseName = (filePath: string) => {
          if (!filePath) return '';
          const pathSeparator = filePath.includes('\\') ? '\\' : '/';
          return filePath.substring(filePath.lastIndexOf(pathSeparator) + 1);
      };

      const selectedDriverInfo = drivers.filter(d => selectedDrivers.has(d.publishedName));
      const infNames = selectedDriverInfo.map(d => getBaseName(d.originalName).replace('.inf', ''));
      
      if (infNames.length === 0) {
        addNotification('warning', 'درایور معتبری انتخاب نشده', 'نام فایل برای درایورهای انتخاب شده شناسایی نشد.');
        return;
      }
      
      const fileRepoPath = `${windowsPath}\\System32\\DriverStore\\FileRepository`;
      
      // A more specific filter to avoid matching similar names (e.g., driver vs driver_ext)
      const whereClauses = infNames.map(n => `($_.Name -like '${n}.inf_*')`).join(' -or ');

      const psCommand = `
        $dest = '${selectiveBackupPath}';
        $sourcePath = '${fileRepoPath}';
        $driverFolders = Get-ChildItem -Path $sourcePath -Directory | Where-Object { ${whereClauses} };
        if ($null -eq $driverFolders) {
            Write-Host "No matching driver packages found in FileRepository to copy."
        } else {
            $driverFolders | ForEach-Object { 
                Write-Host "Copying driver package: $($_.Name)";
                Copy-Item -Path $_.FullName -Destination $dest -Recurse -Container -Force -Confirm:$false 
            }
        }
      `;
      
      // Clean up the command string for execution
      const command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand.replace(/\r?\n|\r/g, ' ').replace(/\s\s+/g, ' ').trim()}"`;
      
      window.electronAPI.runCommand(command, `در حال پشتیبان‌گیری از ${selectedDrivers.size} درایور انتخاب شده`);
  };
  
  const handleSelectiveRestore = () => {
      if (selectedDriversFromBackup.size === 0 || isBusy) return;
      const driversToRestore = driversFromBackup.filter(d => selectedDriversFromBackup.has(d.id));
      handleRestoreProcess(driversToRestore);
  };
  
  const toggleBackupDriverSelection = (driverId: string) => {
    setSelectedDriversFromBackup(prev => {
        const newSet = new Set(prev);
        if (newSet.has(driverId)) {
            newSet.delete(driverId);
        } else {
            newSet.add(driverId);
        }
        return newSet;
    });
  };

  const filteredDriversFromBackup = useMemo(() => {
    if (!selectiveRestoreSearch) return driversFromBackup;
    const lowercasedFilter = selectiveRestoreSearch.toLowerCase();
    return driversFromBackup.filter(driver =>
        driver.displayName.toLowerCase().includes(lowercasedFilter) ||
        driver.infName.toLowerCase().includes(lowercasedFilter) ||
        driver.provider.toLowerCase().includes(lowercasedFilter) ||
        driver.version.toLowerCase().includes(lowercasedFilter)
    );
  }, [driversFromBackup, selectiveRestoreSearch]);
  
  const handleToggleSelectAllBackupDrivers = () => {
      const allFilteredSelected = filteredDriversFromBackup.length > 0 && filteredDriversFromBackup.every(d => selectedDriversFromBackup.has(d.id));
      setSelectedDriversFromBackup(prev => {
          const newSet = new Set(prev);
          if (allFilteredSelected) {
              filteredDriversFromBackup.forEach(d => newSet.delete(d.id));
          } else {
              filteredDriversFromBackup.forEach(d => newSet.add(d.id));
          }
          return newSet;
      });
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
            <h2 className="text-2xl font-bold mb-4 text-gray-200">پشتیبان‌گیری کامل از درایورها</h2>
            <p className="text-gray-400 mb-6">از تمام درایورهای نصب شده (غیر پیش‌فرض ویندوز) در یک پوشه پشتیبان تهیه کنید تا بتوانید بعداً آن‌ها را بازیابی کنید.</p>
            <div className="flex items-center space-x-reverse space-x-2 mb-6">
                <input type="text" readOnly value={backupPath} placeholder="پوشه مقصد را انتخاب کنید..." className="form-input-custom" />
                <button onClick={() => handleSelectFolder(setPersistedBackupPath)} disabled={isBusy} className="btn-secondary flex-shrink-0" title="انتخاب پوشه"><i className="fas fa-folder-open"></i></button>
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
            <h2 className="text-2xl font-bold mb-4 text-gray-200">بازیابی کامل درایورها</h2>
            <p className="text-gray-400 mb-6">تمام درایورهای موجود در پوشه پشتیبان را نصب کنید. این کار برای بازیابی درایورها روی یک ویندوز جدید یا همین سیستم مناسب است. برای اطمینان، ابتدا یک نقطه بازیابی سیستم ایجاد کنید.</p>
            
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
                <button onClick={() => handleSelectFolder(setPersistedRestorePath)} disabled={isBusy} className="btn-secondary flex-shrink-0" title="انتخاب پوشه"><i className="fas fa-folder"></i></button>
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
            <div className="flex-shrink-0">
                <h2 className="text-2xl font-bold mb-4 text-gray-200">پشتیبان‌گیری انتخابی</h2>
                <p className="text-gray-400 mb-2">درایورهای نصب شده روی سیستم را اسکن کرده و موارد دلخواه را برای پشتیبان‌گیری انتخاب کنید.</p>
                <div className="mb-4">
                  <button onClick={handleScanDrivers} disabled={isBusy} className="btn-secondary w-64">
                      <i className="fas fa-search mr-2"></i> اسکن تمام درایورها
                  </button>
                </div>
                <div className="relative mb-2">
                    <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"></i>
                    <input type="text" value={selectiveBackupSearch} onChange={e => setSelectiveBackupSearch(e.target.value)} placeholder="جستجوی درایور..." className="form-input-custom pl-10" />
                </div>
                 <div className="flex items-center mb-2 text-sm text-gray-300">
                    <input 
                        type="checkbox" 
                        id="select-all-drivers"
                        checked={filteredDrivers.length > 0 && filteredDrivers.every(d => selectedDrivers.has(d.publishedName))}
                        onChange={handleToggleSelectAll}
                        disabled={filteredDrivers.length === 0 || isBusy}
                    />
                    <label htmlFor="select-all-drivers" className="pr-2 cursor-pointer">انتخاب همه موارد نمایش داده شده</label>
                    <span className="pr-4 mr-auto text-gray-400">نمایش {filteredDrivers.length} از {drivers.length} درایور</span>
                </div>
            </div>
            <div dir="ltr" className="driver-list flex-grow overflow-y-auto bg-brand-med/50 ring-1 ring-brand-border rounded-md p-1">
                {drivers.length > 0 && filteredDrivers.length === 0 && <p className="text-gray-500 text-center p-4">هیچ درایوری با عبارت جستجو شده مطابقت ندارد.</p>}
                {drivers.length === 0 && <p className="text-gray-500 text-center p-4">برای مشاهده لیست، سیستم را اسکن کنید.</p>}
                {filteredDrivers.map(driver => (
                    <div key={driver.publishedName} className="driver-list-item">
                        <input type="checkbox" id={driver.publishedName} checked={selectedDrivers.has(driver.publishedName)} onChange={() => toggleDriverSelection(driver.publishedName)} />
                        <label htmlFor={driver.publishedName} className="flex-grow cursor-pointer text-sm pl-3">
                            <span className="font-bold text-gray-200 block">{driver.provider} - {driver.className}</span>
                            <span className="text-gray-400 text-xs block">Version: {driver.version} ({driver.originalName})</span>
                        </label>
                    </div>
                ))}
            </div>
            <div className="flex-shrink-0 mt-4">
                 <div className="flex items-center space-x-reverse space-x-2 mb-4">
                    <input type="text" readOnly value={selectiveBackupPath} placeholder="پوشه مقصد را انتخاب کنید..." className="form-input-custom" />
                    <button onClick={() => handleSelectFolder(setPersistedSelectiveBackupPath)} disabled={isBusy} className="btn-secondary flex-shrink-0" title="انتخاب پوشه"><i className="fas fa-folder-open"></i></button>
                </div>
                <div className="flex justify-start">
                  <button onClick={handleSelectiveBackup} disabled={selectedDrivers.size === 0 || !selectiveBackupPath || isBusy} className="btn-primary w-64">
                      <i className="fas fa-download mr-2"></i> پشتیبان‌گیری از {selectedDrivers.size} درایور
                  </button>
                </div>
            </div>
          </div>
        );
      case 'selective-restore':
         return (
          <div className="flex flex-col h-full">
            <div className="flex-shrink-0">
                <h2 className="text-2xl font-bold mb-4 text-gray-200">بازیابی انتخابی از پوشه</h2>
                <p className="text-gray-400 mb-2">یک پوشه پشتیبان را انتخاب کرده و درایورهای مورد نظر برای نصب را مشخص کنید.</p>
                <div className="mb-4">
                   <button onClick={handleCreateRestorePoint} disabled={isBusy || !isSystemRestoreEnabled} className="btn-info w-64">
                      <i className="fas fa-shield-alt mr-2"></i> ایجاد نقطه بازیابی
                  </button>
                </div>
                <div className="flex items-center space-x-reverse space-x-2 mb-4">
                    <input type="text" readOnly value={selectiveRestoreFolder} placeholder="پوشه پشتیبان را انتخاب و اسکن کنید..." className="form-input-custom" />
                    <button onClick={async () => {
                        await handleSelectFolder((path) => {
                            setPersistedSelectiveRestoreFolder(path);
                            scanBackupFolder(path);
                        });
                    }} disabled={isBusy} className="btn-secondary flex-shrink-0" title="انتخاب و اسکن پوشه"><i className="fas fa-search-location"></i></button>
                </div>
                <div className="relative mb-2">
                    <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"></i>
                    <input type="text" value={selectiveRestoreSearch} onChange={e => setSelectiveRestoreSearch(e.target.value)} placeholder="جستجوی درایور در پشتیبان..." className="form-input-custom pl-10" />
                </div>
                <div className="flex items-center mb-2 text-sm text-gray-300">
                    <input 
                        type="checkbox" 
                        id="select-all-backup-drivers"
                        checked={filteredDriversFromBackup.length > 0 && filteredDriversFromBackup.every(d => selectedDriversFromBackup.has(d.id))}
                        onChange={handleToggleSelectAllBackupDrivers}
                        disabled={filteredDriversFromBackup.length === 0 || isBusy}
                    />
                    <label htmlFor="select-all-backup-drivers" className="pr-2 cursor-pointer">انتخاب همه موارد نمایش داده شده</label>
                    <span className="pr-4 mr-auto text-gray-400">نمایش {filteredDriversFromBackup.length} از {driversFromBackup.length} درایور</span>
                </div>
            </div>
            <div dir="ltr" className="driver-list flex-grow overflow-y-auto bg-brand-med/50 ring-1 ring-brand-border rounded-md p-1">
                {driversFromBackup.length > 0 && filteredDriversFromBackup.length === 0 && <p className="text-gray-500 text-center p-4">هیچ درایوری با عبارت جستجو شده مطابقت ندارد.</p>}
                {driversFromBackup.length === 0 && <p className="text-gray-500 text-center p-4">یک پوشه پشتیبان را برای اسکن انتخاب کنید.</p>}
                {filteredDriversFromBackup.map(driver => (
                    <div key={driver.id} className="driver-list-item">
                        <input type="checkbox" id={driver.id} checked={selectedDriversFromBackup.has(driver.id)} onChange={() => toggleBackupDriverSelection(driver.id)} />
                        <label htmlFor={driver.id} className="flex-grow cursor-pointer text-sm pl-3">
                            <span className="font-bold text-gray-200 block">{driver.displayName}</span>
                            <span className="text-gray-400 text-xs block">Version: {driver.version} ({driver.infName})</span>
                        </label>
                    </div>
                ))}
            </div>
            <div className="mt-auto flex justify-start pt-4 flex-shrink-0">
              <button onClick={handleSelectiveRestore} disabled={selectedDriversFromBackup.size === 0 || isBusy} className="btn-primary w-64">
                  <i className="fas fa-play mr-2"></i> نصب {selectedDriversFromBackup.size} درایور
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
                <button onClick={() => navigator.clipboard.writeText(logs.map(l => `[${l.timestamp}] [${l.type}] ${l.message}`).join('\n'))} className="btn-secondary" title="کپی کردن لاگ‌ها"><i className="fas fa-copy"></i></button>
                <button onClick={() => setLogs([])} className="btn-secondary" title="پاک کردن لاگ‌ها"><i className="fas fa-trash"></i></button>
            </div>
            <div ref={logContainerRef} dir="ltr" className="flex-grow bg-brand-dark/80 rounded-lg ring-1 ring-brand-border p-4 font-mono text-xs overflow-y-auto whitespace-pre-wrap">
                {filteredLogs.map(log => (
                    <div key={log.id} className="flex items-baseline gap-4 py-1">
                        <span className="text-gray-500 w-20 flex-shrink-0 text-left">{log.timestamp}</span>
                        <span className={`w-24 flex-shrink-0 font-bold text-center ${logTypeStyles[log.type]}`}>{`[${log.type}]`}</span>
                        <span className={`flex-grow text-left ${logTypeStyles[log.type]}`}>{log.message}</span>
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
        <div className="bg-brand-med/50 ring-1 ring-red-500/30 rounded-lg p-10 max-w-lg">
            <i className="fas fa-user-shield text-5xl text-red-400 mb-6"></i>
            <h1 className="text-3xl font-bold text-red-300 mb-4">نیاز به دسترسی مدیر</h1>
            <p className="text-gray-300 mb-8">برنامه دلفین درایور برای مدیریت درایورهای سیستمی نیاز به اجرا با دسترسی مدیر (Administrator) دارد. لطفاً برنامه را با دسترسی مناسب مجدداً اجرا کنید.</p>
            <div className="text-right bg-brand-dark/70 p-6 rounded-md ring-1 ring-brand-border">
                <h2 className="font-bold text-lg text-gray-100 mb-4">چگونه به عنوان مدیر اجرا کنیم:</h2>
                <ol className="list-decimal list-inside space-y-3 text-gray-300">
                    <li>این پنجره را ببندید.</li>
                    <li>فایل اجرایی یا میان‌بر برنامه <strong className="text-brand-accent">دلفین درایور</strong> را پیدا کنید.</li>
                    <li>روی آیکن برنامه <strong className="text-brand-accent">راست‌کلیک</strong> کنید.</li>
                    <li>از منوی باز شده گزینه <strong className="text-brand-accent">"Run as administrator"</strong> را انتخاب کنید.</li>
                </ol>
            </div>
        </div>
    </div>
  );

  const renderAppContent = () => (
     <div className="flex flex-col h-full">
        <nav className="flex-shrink-0 flex items-center justify-center border-b border-brand-border bg-brand-med/50 backdrop-blur-sm">
             {tabs.map(tab => (
                   <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      disabled={isBusy}
                      className={`relative flex items-center space-x-reverse space-x-2 p-4 text-sm font-medium transition-all duration-300 disabled:opacity-50 outline-none focus:outline-none ${
                        activeTab === tab.id
                            ? 'text-brand-accent'
                            : 'text-gray-400 hover:text-white'
                      }`}
                  >
                      <i className={`fas ${tab.icon} w-5 text-center text-lg`}></i>
                      <span>{tab.label}</span>
                      {activeTab === tab.id && (
                        <span className="absolute bottom-0 right-0 left-0 h-1 bg-brand-accent rounded-t-full shadow-[0_0_10px_theme(colors.brand.accent)]"></span>
                      )}
                  </button>
              ))}
        </nav>

        <main className="flex-grow p-6 relative overflow-y-auto">
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
           <div key={activeTab} className="content-fade-in bg-brand-med/60 backdrop-blur-sm rounded-xl shadow-2xl shadow-black/50 ring-1 ring-brand-border p-6 h-full">
            {renderContent()}
          </div>
        </main>
     </div>
  );

  return (
    <div className="h-screen w-screen overflow-hidden bg-black flex flex-col">
      {showAboutModal && <AboutModal onClose={() => setShowAboutModal(false)} />}
      <TitleBar isMaximized={isMaximized} onAboutClick={() => setShowAboutModal(true)} />
      <NotificationContainer notifications={notifications} onDismiss={removeNotification} />
      <div className="pt-8 flex-grow" style={{minHeight: 0}}>
        {isAdmin === null && (
            <div className="flex-grow flex items-center justify-center h-full">
                <div className="flex flex-col items-center">
                    <i className="fas fa-spinner fa-spin text-3xl text-gray-400"></i>
                    <p className="text-gray-400 mt-3">در حال بررسی دسترسی‌ها...</p>
                </div>
            </div>
        )}
        {isAdmin === false && renderAdminGate()}
        {isAdmin === true && renderAppContent()}
      </div>
    </div>
  );
};

export default App;
