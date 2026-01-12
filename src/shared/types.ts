// Shared types between main and renderer processes

// ========== SSH Types ==========
export type SSHAuthType = 'password' | 'key' | 'config';

export interface SSHConfig {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    authType: SSHAuthType;
    password?: string; // Encrypted
    privateKeyPath?: string;
    passphrase?: string; // For encrypted keys
    configName?: string; // Reference to ~/.ssh/config
}

export interface SSHConnectionStatus {
    id: string;
    connected: boolean;
    error?: string;
    lastConnected?: Date;
}

// ========== Rclone Types ==========
export interface RcloneRemote {
    name: string;
    type: 'drive'; // Google Drive
    clientId?: string;
    clientSecret?: string;
    token?: string;
    rootFolderId?: string;
}

// Rclone Config - một cấu hình đầy đủ để sync
export interface RcloneConfig {
    id: string;
    name: string;                    // Tên config (vd: "My Google Drive")
    remoteName: string;              // Tên remote trong rclone.conf (vd: "gdrive")
    remoteType: 'drive';             // Loại remote
    driveFolder: string;             // Folder trên Drive (vd: "rclone-transfer")
    isConfigured: boolean;           // Đã cấu hình token chưa
    createdAt: string;
    updatedAt: string;
}

export interface RcloneProgress {
    bytes: number;
    totalBytes: number;
    percent: number;
    speed: string; // e.g., "10.5 MB/s"
    eta: string; // e.g., "2m30s"
}

// ========== Transfer Types ==========
export type TransferItemStatus =
    | 'pending'
    | 'zipping'
    | 'uploading'
    | 'uploaded'
    | 'downloading'
    | 'extracting'
    | 'completed'
    | 'failed';

export interface TransferItem {
    id: string;
    fileName: string;
    sourcePath: string;
    drivePath: string;
    destinationPath: string;
    status: TransferItemStatus;
    progress: number; // 0-100
    speed?: string;
    eta?: string;
    error?: string;
    createdAt: string;
    completedAt?: string;
    retryCount: number;
}

export interface TransferJob {
    id: string;
    name: string;
    sourceServerId: string;
    destinationServerIds: string[];
    sourceFolder: string;
    destinationFolder: string;
    driveFolder: string;
    zipSizeLimitMB: number;
    deleteAfterUpload: boolean;
    deleteFromDrive: boolean;
    autoExtract: boolean;
    status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
    items: TransferItem[];
    createdAt: string;
    updatedAt: string;
}

// Track file sync progress per destination
export interface FileDestinationProgress {
    serverId: string;
    serverName: string;
    status: 'pending' | 'downloading' | 'extracting' | 'completed' | 'failed';
    progress: number; // 0-100
    error?: string;
}

export interface UploadedFileInfo {
    id: string;
    fileName: string;
    drivePath: string;
    uploadedAt: string;
    size?: string;
    destinations: FileDestinationProgress[];
}

// ========== Tab Types ==========
export interface TransferTab {
    id: string;
    name: string;
    jobId?: string;
    isActive: boolean;
}

// ========== Log Types ==========
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
    id: string;
    timestamp: string;
    level: LogLevel;
    message: string;
    details?: unknown;
    jobId?: string;
    serverId?: string;
}

// ========== IPC Channel Names ==========
export const IPC_CHANNELS = {
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

    // Rclone Configs (stored configs)
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
    TRANSFER_FILE_UPLOADED: 'transfer:fileUploaded',
    TRANSFER_FILE_PROGRESS: 'transfer:fileProgress',

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

// ========== App Config ==========
export interface AppConfig {
    theme: 'light' | 'dark' | 'system';
    defaultZipSizeMB: number;
    maxRetries: number;
    notificationsEnabled: boolean;
    logLevel: LogLevel;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
    theme: 'system',
    defaultZipSizeMB: 1024,
    maxRetries: 3,
    notificationsEnabled: true,
    logLevel: 'info',
};
