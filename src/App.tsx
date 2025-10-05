import React, { useState, useEffect } from 'react';

// FIX: Add WebkitAppRegion to React's CSSProperties to allow its use in style objects
// for the custom Electron title bar without causing TypeScript errors.
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}

// Define types for the exposed Electron API for better intellisense and type safety
declare global {
  interface Window {
    electronAPI: {
      minimizeWindow: () => void;
      toggleMaximizeWindow: () => void;
      closeWindow: () => void;
      onWindowStateChange: (callback: (isMaximized: boolean) => void) => () => void;
    };
  }
}

const TitleBar: React.FC<{ isMaximized: boolean }> = ({ isMaximized }) => {
  const handleMinimize = () => window.electronAPI.minimizeWindow();
  const handleMaximize = () => window.electronAPI.toggleMaximizeWindow();
  const handleClose = () => window.electronAPI.closeWindow();

  return (
    // The main title bar div is draggable.
    // In RTL, flex items are ordered from right to left. `justify-between` pushes them to the edges.
    <div
      style={{ WebkitAppRegion: 'drag' }}
      className="h-8 bg-gray-900/70 backdrop-blur-sm flex items-center justify-between fixed top-0 left-0 right-0 z-50 ring-1 ring-white/10"
    >
      {/* Window Title on the RIGHT (first item in RTL flex) */}
      <div className="px-4 flex items-center h-full text-gray-300 text-sm font-medium">
        <span>سلام دنیا</span>
      </div>

      {/* Controls will be on the LEFT (last item in RTL flex). */}
      <div className="flex items-center h-full">
        {/* Buttons are not draggable. To get [Close][Max][Min] from left-to-right in RTL, source order is reversed. */}
        <button
          onClick={handleMinimize}
          style={{ WebkitAppRegion: 'no-drag' }}
          className="w-10 h-full flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-colors duration-150 focus:outline-none"
          aria-label="Minimize"
        >
          <i className="fas fa-window-minimize text-xs"></i>
        </button>
        <button
          onClick={handleMaximize}
          style={{ WebkitAppRegion: 'no-drag' }}
          className="w-10 h-full flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-colors duration-150 focus:outline-none"
          aria-label={isMaximized ? "Restore" : "Maximize"}
        >
          <i className={`fas ${isMaximized ? 'fa-window-restore' : 'fa-window-maximize'} text-xs`}></i>
        </button>
        <button
          onClick={handleClose}
          style={{ WebkitAppRegion: 'no-drag' }}
          className="w-10 h-full flex items-center justify-center text-gray-400 hover:bg-red-500 hover:text-white transition-colors duration-150 focus:outline-none"
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

  useEffect(() => {
    // Listen for window state changes from the main process
    const cleanup = window.electronAPI.onWindowStateChange((maximized) => {
      setIsMaximized(maximized);
    });

    // Clean up the listener when the component unmounts
    return () => cleanup();
  }, []);
  
  return (
    <div className="h-screen w-screen overflow-hidden">
      <TitleBar isMaximized={isMaximized} />
      {/* Add pt-8 to push content below the fixed title bar */}
      <div className="h-full pt-8 flex flex-col items-center justify-center p-4 selection:bg-green-600 selection:text-white">
        <main className="w-full max-w-2xl bg-gray-800/50 backdrop-blur-sm rounded-2xl shadow-2xl shadow-black/30 ring-1 ring-white/10 overflow-hidden">
          <div className="p-8 sm:p-12 text-center">
            <div className="flex justify-center mb-6">
              <span className="text-6xl text-green-400">
                <i className="fas fa-globe-asia"></i>
              </span>
            </div>
            <h1 className="animated-gradient text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-green-600 mb-4">
              سلام دنیا!
            </h1>
            <p className="text-lg text-gray-300 max-w-md mx-auto mb-8">
              این یک نمونه برنامه دسکتاپ زیبا با الکترون و ری‌اکت است که به صورت آفلاین و قابل حمل طراحی شده.
            </p>
            <button className="bg-green-600 text-white font-bold py-3 px-8 rounded-full hover:bg-green-500 active:scale-95 transition-all duration-300 ease-in-out shadow-lg shadow-green-600/20 focus:outline-none focus:ring-4 focus:ring-green-600/50">
              <i className="fas fa-rocket ml-2"></i>
              شروع کنید
            </button>
          </div>
          <footer className="bg-black/20 p-4 border-t border-white/10">
            <div className="flex justify-center items-center space-x-reverse space-x-4 text-gray-400">
              <a href="#" className="hover:text-green-400 transition-colors"><i className="fab fa-github fa-lg"></i></a>
              <a href="#" className="hover:text-green-400 transition-colors"><i className="fab fa-twitter fa-lg"></i></a>
              <a href="#" className="hover:text-green-400 transition-colors"><i className="fab fa-linkedin-in fa-lg"></i></a>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
};

export default App;