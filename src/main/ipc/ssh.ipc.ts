// Placeholder for SSH IPC handlers
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/types';
import { sshService } from '../services/ssh.service';

// Connect to SSH server
ipcMain.handle(IPC_CHANNELS.SSH_CONNECT, async (_event, config) => {
    return sshService.connect(config);
});

// Disconnect from SSH server
ipcMain.handle(IPC_CHANNELS.SSH_DISCONNECT, async (_event, id) => {
    return sshService.disconnect(id);
});

// Test SSH connection
ipcMain.handle(IPC_CHANNELS.SSH_TEST, async (_event, config) => {
    return sshService.testConnection(config);
});

// Execute command on SSH server
ipcMain.handle(IPC_CHANNELS.SSH_EXEC, async (_event, { connectionId, command }) => {
    return sshService.exec(connectionId, command);
});

// Generate SSH key pair
ipcMain.handle(IPC_CHANNELS.SSH_GENERATE_KEY, async (_event, name) => {
    return sshService.generateKeyPair(name);
});

// Copy public key to server
ipcMain.handle(IPC_CHANNELS.SSH_COPY_KEY, async (_event, { config, publicKey }) => {
    return sshService.copyPublicKeyToServer(config, publicKey);
});

// List SSH configs from ~/.ssh/config
ipcMain.handle(IPC_CHANNELS.SSH_LIST_CONFIGS, async () => {
    return sshService.listSSHConfigs();
});

// List directory contents on remote server with pagination
ipcMain.handle(IPC_CHANNELS.SSH_LIST_DIR, async (_event, { connectionId, path, limit, offset }) => {
    return sshService.listDirectory(connectionId, path, { limit, offset });
});
