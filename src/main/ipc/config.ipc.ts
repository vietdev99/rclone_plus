// Config IPC handlers
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/types';
import { configService } from '../services/config.service';
import { logService } from '../services/logger.service';

// Get app config
ipcMain.handle(IPC_CHANNELS.CONFIG_GET, async () => {
    return configService.getAppConfig();
});

// Set app config
ipcMain.handle(IPC_CHANNELS.CONFIG_SET, async (_event, config) => {
    return configService.setAppConfig(config);
});

// Get all servers
ipcMain.handle(IPC_CHANNELS.CONFIG_GET_SERVERS, async () => {
    return configService.getServers();
});

// Save server
ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE_SERVER, async (_event, server) => {
    return configService.saveServer(server);
});

// Delete server
ipcMain.handle(IPC_CHANNELS.CONFIG_DELETE_SERVER, async (_event, id) => {
    return configService.deleteServer(id);
});

// Get all jobs
ipcMain.handle(IPC_CHANNELS.CONFIG_GET_JOBS, async () => {
    return configService.getJobs();
});

// Save job
ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE_JOB, async (_event, job) => {
    return configService.saveJob(job);
});

// Delete job
ipcMain.handle(IPC_CHANNELS.CONFIG_DELETE_JOB, async (_event, id) => {
    return configService.deleteJob(id);
});

// Get all logs
ipcMain.handle(IPC_CHANNELS.LOG_GET_ALL, async () => {
    return logService.getAllLogs();
});

// Get session
ipcMain.handle(IPC_CHANNELS.CONFIG_GET_SESSION, async () => {
    return configService.getSession();
});

// Save session
ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE_SESSION, async (_event, session) => {
    return configService.saveSession(session);
});
