import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import path from 'path';
import { IPC_CHANNELS } from '../shared/types';
import { createApplicationMenu } from './menu';

// Hardware acceleration enabled for better performance

console.log('[Main] Starting Electron app...');
console.log('[Main] app:', typeof app);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
    console.log('[Main] createWindow called');
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    console.log('[Main] isDev:', isDev);
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        frame: true,
        show: false, // Don't show until ready
        backgroundColor: '#0f0f23', // Match app background to prevent white flash
    });
    console.log('[Main] BrowserWindow created');

    // Show window when content is ready
    mainWindow.once('ready-to-show', () => {
        console.log('[Main] Window ready to show');
        mainWindow?.show();
    });

    // Load the app
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    createApplicationMenu(mainWindow);
}

// App lifecycle
console.log('[Main] Setting up app.whenReady...');
app.whenReady().then(() => {
    console.log('[Main] App is ready!');

    // Import IPC handlers after app is ready
    console.log('[Main] Loading IPC handlers...');
    require('./ipc/ssh.ipc');
    require('./ipc/rclone.ipc');
    require('./ipc/transfer.ipc');
    require('./ipc/config.ipc');
    console.log('[Main] IPC handlers loaded');

    // Notification handler
    ipcMain.handle(IPC_CHANNELS.NOTIFICATION_SHOW, async (_event, { title, body }) => {
        if (Notification.isSupported()) {
            new Notification({ title, body }).show();
            return true;
        }
        return false;
    });

    console.log('[Main] Calling createWindow...');
    createWindow();
}).catch(err => {
    console.error('[Main] Error in whenReady:', err);
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

// Export for IPC handlers to use
export function getMainWindow(): BrowserWindow | null {
    return mainWindow;
}
