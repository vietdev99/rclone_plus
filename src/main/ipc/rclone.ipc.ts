// Placeholder for Rclone IPC handlers
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/types';
import { rcloneService } from '../services/rclone.service';

// Check if rclone is installed on server
ipcMain.handle(IPC_CHANNELS.RCLONE_CHECK, async (_event, connectionId) => {
    return rcloneService.checkInstalled(connectionId);
});

// Check if rclone config exists on server
ipcMain.handle(IPC_CHANNELS.RCLONE_CHECK_SERVER_CONFIG, async (_event, connectionId) => {
    return rcloneService.checkServerConfig(connectionId);
});

// Install rclone on server
ipcMain.handle(IPC_CHANNELS.RCLONE_INSTALL, async (_event, connectionId) => {
    return rcloneService.install(connectionId);
});

// Configure rclone remote
ipcMain.handle(IPC_CHANNELS.RCLONE_CONFIGURE, async (_event, remote) => {
    return rcloneService.configure(remote);
});

// Get OAuth URL for Google Drive
ipcMain.handle(IPC_CHANNELS.RCLONE_GET_OAUTH_URL, async () => {
    return rcloneService.getOAuthUrl();
});

// Copy rclone config to server
ipcMain.handle(IPC_CHANNELS.RCLONE_COPY_CONFIG, async (_event, connectionId) => {
    return rcloneService.copyConfigToServer(connectionId);
});

// Start OAuth flow for Google Drive
ipcMain.handle(IPC_CHANNELS.RCLONE_START_OAUTH, async (_event, remoteName) => {
    return rcloneService.startOAuth(remoteName);
});

// List local rclone remotes
ipcMain.handle(IPC_CHANNELS.RCLONE_LIST_REMOTES, async () => {
    return rcloneService.listLocalRemotes();
});

// Install rclone locally
ipcMain.handle(IPC_CHANNELS.RCLONE_INSTALL_LOCAL, async () => {
    return rcloneService.installLocalRclone();
});

// ========== Rclone Configs CRUD ==========
// Get all rclone configs
ipcMain.handle(IPC_CHANNELS.RCLONE_GET_CONFIGS, async () => {
    return rcloneService.getRcloneConfigs();
});

// Save rclone config
ipcMain.handle(IPC_CHANNELS.RCLONE_SAVE_CONFIG, async (_event, config) => {
    return rcloneService.saveRcloneConfig(config);
});

// Delete rclone config
ipcMain.handle(IPC_CHANNELS.RCLONE_DELETE_CONFIG, async (_event, id) => {
    return rcloneService.deleteRcloneConfig(id);
});
