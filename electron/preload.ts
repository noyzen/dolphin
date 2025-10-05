// FIX: Import IpcRendererEvent type directly from electron to avoid namespace error.
import { contextBridge, ipcRenderer, IpcRendererEvent, OpenDialogOptions } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  toggleMaximizeWindow: () => ipcRenderer.send('toggle-maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  onWindowStateChange: (callback: (isMaximized: boolean) => void) => {
    const handler = (_event: IpcRendererEvent, isMaximized: boolean) => callback(isMaximized);
    ipcRenderer.on('window-state-changed', handler);
    return () => ipcRenderer.removeListener('window-state-changed', handler);
  },

  // Driver Dolphin functionality
  checkAdmin: (): Promise<boolean> => ipcRenderer.invoke('check-admin'),
  selectDialog: (options: OpenDialogOptions): Promise<string[]> => ipcRenderer.invoke('select-dialog', options),
  runCommand: (command: string, description: string) => ipcRenderer.send('run-command', command, description),
  runCommandAndGetOutput: (command: string): Promise<{ stdout: string; stderr:string; code: number | null; }> => ipcRenderer.invoke('run-command-and-get-output', command),
  checkSystemRestore: (): Promise<boolean> => ipcRenderer.invoke('check-system-restore'),
  getWindowsPath: (): Promise<string> => ipcRenderer.invoke('get-windows-path'),

  // Command output listeners
  onCommandStart: (callback: (description: string) => void) => {
    ipcRenderer.on('command-start', (_event, description) => callback(description));
    return () => ipcRenderer.removeAllListeners('command-start');
  },
  onCommandOutput: (callback: (output: string) => void) => {
    ipcRenderer.on('command-output', (_event, output) => callback(output));
    return () => ipcRenderer.removeAllListeners('command-output');
  },
  onCommandEnd: (callback: (code: number | null) => void) => {
    ipcRenderer.on('command-end', (_event, code) => callback(code));
    return () => ipcRenderer.removeAllListeners('command-end');
  }
});
