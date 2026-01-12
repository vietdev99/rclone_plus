import { contextBridge, ipcRenderer } from 'electron';

// Inline IPC_CHANNELS to avoid module resolution issues
const IPC_CHANNELS = {
    // SSH
    SSH_CONNECT: 'ssh:connect',
    SSH_DISCONNECT: 'ssh:disconnect',
    SSH_TEST: 'ssh:test',
    SSH_EXEC: 'ssh:exec',
    SSH_GENERATE_KEY: 'ssh:generateKey',
    SSH_COPY_KEY: 'ssh:copyKey',
    SSH_LIST_CONFIGS: 'ssh:listConfigs',
    SSH_LIST_DIR: 'ssh:listDir',

    // Rclone
    RCLONE_CHECK: 'rclone:check',
    RCLONE_CHECK_SERVER_CONFIG: 'rclone:checkServerConfig',
    RCLONE_INSTALL: 'rclone:install',
    RCLONE_CONFIGURE: 'rclone:configure',
    RCLONE_GET_OAUTH_URL: 'rclone:getOAuthUrl',
    RCLONE_START_OAUTH: 'rclone:startOAuth',
    RCLONE_COPY_CONFIG: 'rclone:copyConfig',
    RCLONE_LIST_REMOTES: 'rclone:listRemotes',
    RCLONE_INSTALL_LOCAL: 'rclone:installLocal',
    RCLONE_GET_CONFIGS: 'rclone:getConfigs',
    RCLONE_SAVE_CONFIG: 'rclone:saveConfig',
    RCLONE_DELETE_CONFIG: 'rclone:deleteConfig',

    // Transfer
    TRANSFER_START: 'transfer:start',
    TRANSFER_PAUSE: 'transfer:pause',
    TRANSFER_RESUME: 'transfer:resume',
    TRANSFER_CANCEL: 'transfer:cancel',
    TRANSFER_RETRY: 'transfer:retry',
    TRANSFER_PROGRESS: 'transfer:progress',

    // Config
    CONFIG_GET: 'config:get',
    CONFIG_SET: 'config:set',
    CONFIG_GET_SERVERS: 'config:getServers',
    CONFIG_SAVE_SERVER: 'config:saveServer',
    CONFIG_DELETE_SERVER: 'config:deleteServer',
    CONFIG_GET_JOBS: 'config:getJobs',
    CONFIG_SAVE_JOB: 'config:saveJob',
    CONFIG_DELETE_JOB: 'config:deleteJob',
    CONFIG_GET_SESSION: 'config:getSession',
    CONFIG_SAVE_SESSION: 'config:saveSession',

    // Notifications
    NOTIFICATION_SHOW: 'notification:show',

    // Logs
    LOG_ENTRY: 'log:entry',
    LOG_GET_ALL: 'log:getAll',
} as const;

// Type definitions for the exposed API
export interface ElectronAPI {
    // SSH
    ssh: {
        connect: (config: unknown) => Promise<{ success: boolean; error?: string }>;
        disconnect: (id: string) => Promise<void>;
        test: (config: unknown) => Promise<{ success: boolean; error?: string }>;
        exec: (connectionId: string, command: string) => Promise<{ stdout: string; stderr: string }>;
        generateKey: (name: string) => Promise<{ publicKey: string; privateKeyPath: string }>;
        copyKey: (config: unknown, publicKey: string) => Promise<{ success: boolean; error?: string }>;
        listConfigs: () => Promise<Array<{ name: string; host: string; user: string; port?: number; identityFile?: string }>>;
        listDir: (connectionId: string, path: string, limit?: number, offset?: number) => Promise<{
            items: Array<{ name: string; type: 'file' | 'directory'; size: number }>;
            total: number;
            hasMore: boolean;
        }>;
    };

    // Rclone
    rclone: {
        check: (connectionId: string) => Promise<{ installed: boolean; version?: string }>;
        checkServerConfig: (connectionId: string) => Promise<{ hasConfig: boolean; remotes: Array<{ name: string; type: string }>; configPath?: string }>;
        install: (connectionId: string) => Promise<{ success: boolean; error?: string }>;
        configure: (remote: { name: string; token: string }) => Promise<{ success: boolean }>;
        getOAuthUrl: () => Promise<{ url: string }>;
        startOAuth: (remoteName: string) => Promise<{ success: boolean; token?: string; error?: string }>;
        copyConfig: (connectionId: string) => Promise<{ success: boolean; error?: string }>;
        listRemotes: () => Promise<Array<{ name: string; type: string }>>;
        installLocal: () => Promise<boolean>;
        // Rclone Configs CRUD
        getConfigs: () => Promise<unknown[]>;
        saveConfig: (config: unknown) => Promise<void>;
        deleteConfig: (id: string) => Promise<void>;
    };

    // Transfer
    transfer: {
        start: (job: unknown) => Promise<void>;
        pause: (jobId: string) => Promise<void>;
        resume: (jobId: string) => Promise<void>;
        cancel: (jobId: string) => Promise<void>;
        retry: (jobId: string, itemId: string) => Promise<void>;
        onProgress: (callback: (data: { jobId: string; itemId: string; progress: number; status: string }) => void) => () => void;
    };

    // Config
    config: {
        get: () => Promise<unknown>;
        set: (config: unknown) => Promise<void>;
        getServers: () => Promise<unknown[]>;
        saveServer: (server: unknown) => Promise<void>;
        deleteServer: (id: string) => Promise<void>;
        getJobs: () => Promise<unknown[]>;
        saveJob: (job: unknown) => Promise<void>;
        deleteJob: (id: string) => Promise<void>;
        getSession: () => Promise<unknown>;
        saveSession: (session: unknown) => Promise<void>;
    };

    // Notification
    notification: {
        show: (title: string, body: string) => Promise<boolean>;
    };

    // Logs
    logs: {
        onEntry: (callback: (entry: { level: string; message: string; timestamp: string }) => void) => () => void;
        getAll: () => Promise<Array<{ level: string; message: string; timestamp: string }>>;
    };

    menu: {
        onSaveSession: (callback: () => void) => () => void;
    };
}

// Expose API to renderer
const electronAPI: ElectronAPI = {
    ssh: {
        connect: (config) => ipcRenderer.invoke(IPC_CHANNELS.SSH_CONNECT, config),
        disconnect: (id) => ipcRenderer.invoke(IPC_CHANNELS.SSH_DISCONNECT, id),
        test: (config) => ipcRenderer.invoke(IPC_CHANNELS.SSH_TEST, config),
        exec: (connectionId, command) => ipcRenderer.invoke(IPC_CHANNELS.SSH_EXEC, { connectionId, command }),
        generateKey: (name) => ipcRenderer.invoke(IPC_CHANNELS.SSH_GENERATE_KEY, name),
        copyKey: (config, publicKey) => ipcRenderer.invoke(IPC_CHANNELS.SSH_COPY_KEY, { config, publicKey }),
        listConfigs: () => ipcRenderer.invoke(IPC_CHANNELS.SSH_LIST_CONFIGS),
        listDir: (connectionId, path, limit, offset) => ipcRenderer.invoke(IPC_CHANNELS.SSH_LIST_DIR, { connectionId, path, limit, offset }),
    },

    rclone: {
        check: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.RCLONE_CHECK, connectionId),
        checkServerConfig: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.RCLONE_CHECK_SERVER_CONFIG, connectionId),
        install: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.RCLONE_INSTALL, connectionId),
        configure: (remote) => ipcRenderer.invoke(IPC_CHANNELS.RCLONE_CONFIGURE, remote),
        getOAuthUrl: () => ipcRenderer.invoke(IPC_CHANNELS.RCLONE_GET_OAUTH_URL),
        startOAuth: (remoteName) => ipcRenderer.invoke(IPC_CHANNELS.RCLONE_START_OAUTH, remoteName),
        copyConfig: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.RCLONE_COPY_CONFIG, connectionId),
        listRemotes: () => ipcRenderer.invoke(IPC_CHANNELS.RCLONE_LIST_REMOTES),
        installLocal: () => ipcRenderer.invoke(IPC_CHANNELS.RCLONE_INSTALL_LOCAL),
        // Rclone Configs CRUD
        getConfigs: () => ipcRenderer.invoke(IPC_CHANNELS.RCLONE_GET_CONFIGS),
        saveConfig: (config) => ipcRenderer.invoke(IPC_CHANNELS.RCLONE_SAVE_CONFIG, config),
        deleteConfig: (id) => ipcRenderer.invoke(IPC_CHANNELS.RCLONE_DELETE_CONFIG, id),
    },

    transfer: {
        start: (job) => ipcRenderer.invoke(IPC_CHANNELS.TRANSFER_START, job),
        pause: (jobId) => ipcRenderer.invoke(IPC_CHANNELS.TRANSFER_PAUSE, jobId),
        resume: (jobId) => ipcRenderer.invoke(IPC_CHANNELS.TRANSFER_RESUME, jobId),
        cancel: (jobId) => ipcRenderer.invoke(IPC_CHANNELS.TRANSFER_CANCEL, jobId),
        retry: (jobId, itemId) => ipcRenderer.invoke(IPC_CHANNELS.TRANSFER_RETRY, { jobId, itemId }),
        onProgress: (callback) => {
            const handler = (_event: Electron.IpcRendererEvent, data: { jobId: string; itemId: string; progress: number; status: string }) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.TRANSFER_PROGRESS, handler);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.TRANSFER_PROGRESS, handler);
        },
    },

    config: {
        get: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET),
        set: (config) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET, config),
        getServers: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET_SERVERS),
        saveServer: (server) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SAVE_SERVER, server),
        deleteServer: (id) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_DELETE_SERVER, id),
        getJobs: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET_JOBS),
        saveJob: (job) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SAVE_JOB, job),
        deleteJob: (id) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_DELETE_JOB, id),
        getSession: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET_SESSION),
        saveSession: (session) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SAVE_SESSION, session),
    },

    notification: {
        show: (title, body) => ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATION_SHOW, { title, body }),
    },

    logs: {
        onEntry: (callback) => {
            const handler = (_event: Electron.IpcRendererEvent, entry: { level: string; message: string; timestamp: string }) => callback(entry);
            ipcRenderer.on(IPC_CHANNELS.LOG_ENTRY, handler);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.LOG_ENTRY, handler);
        },
        getAll: () => ipcRenderer.invoke(IPC_CHANNELS.LOG_GET_ALL),
    },
    menu: {
        onSaveSession: (callback) => {
            const handler = () => callback();
            ipcRenderer.on('menu:save-session', handler);
            return () => ipcRenderer.removeListener('menu:save-session', handler);
        }
    }
};

contextBridge.exposeInMainWorld('electron', electronAPI);
