// FIX: Import IpcRendererEvent type directly from electron to avoid namespace error.
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  toggleMaximizeWindow: () => ipcRenderer.send('toggle-maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  onWindowStateChange: (callback: (isMaximized: boolean) => void) => {
    const handler = (_event: IpcRendererEvent, isMaximized: boolean) => callback(isMaximized);
    ipcRenderer.on('window-state-changed', handler);
    
    // Return a cleanup function to remove the listener
    return () => {
      ipcRenderer.removeListener('window-state-changed', handler);
    };
  }
});