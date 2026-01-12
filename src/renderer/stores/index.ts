import { create } from 'zustand';
import { SSHConfig, TransferJob, TransferTab, AppConfig, DEFAULT_APP_CONFIG, RcloneConfig, UploadedFileInfo } from '../../shared/types';

// ========== Server Store ==========
interface ServerState {
    servers: SSHConfig[];
    connectionStatus: Record<string, { connected: boolean; error?: string }>;
    loadServers: () => Promise<void>;
    addServer: (server: SSHConfig) => Promise<void>;
    updateServer: (server: SSHConfig) => Promise<void>;
    deleteServer: (id: string) => Promise<void>;
    testConnection: (server: SSHConfig) => Promise<{ success: boolean; error?: string }>;
    connect: (server: SSHConfig) => Promise<{ success: boolean; error?: string }>;
    disconnect: (id: string) => Promise<void>;
}

export const useServerStore = create<ServerState>((set, get) => ({
    servers: [],
    connectionStatus: {},

    loadServers: async () => {
        const servers = await window.electron.config.getServers();
        set({ servers });
    },

    addServer: async (server) => {
        await window.electron.config.saveServer(server);
        await get().loadServers();
    },

    updateServer: async (server) => {
        await window.electron.config.saveServer(server);
        await get().loadServers();
    },

    deleteServer: async (id) => {
        await window.electron.config.deleteServer(id);
        await get().loadServers();
    },

    testConnection: async (server) => {
        const result = await window.electron.ssh.test(server);
        set(state => ({
            connectionStatus: {
                ...state.connectionStatus,
                [server.id]: { connected: result.success, error: result.error }
            }
        }));
        return result;
    },

    connect: async (server) => {
        const result = await window.electron.ssh.connect(server);
        set(state => ({
            connectionStatus: {
                ...state.connectionStatus,
                [server.id]: { connected: result.success, error: result.error }
            }
        }));
        return result;
    },

    disconnect: async (id) => {
        await window.electron.ssh.disconnect(id);
        set(state => ({
            connectionStatus: {
                ...state.connectionStatus,
                [id]: { connected: false }
            }
        }));
    },
}));

// ========== Transfer Store ==========
interface TransferState {
    jobs: TransferJob[];
    activeJobId: string | null;
    loadJobs: () => Promise<void>;
    createJob: (job: TransferJob) => Promise<void>;
    updateJob: (job: TransferJob) => Promise<void>;
    deleteJob: (id: string) => Promise<void>;
    startJob: (job: TransferJob) => Promise<void>;
    pauseJob: (jobId: string) => Promise<void>;
    resumeJob: (jobId: string) => Promise<void>;
    cancelJob: (jobId: string) => Promise<void>;
    retryItem: (jobId: string, itemId: string) => Promise<void>;
    setActiveJob: (jobId: string | null) => void;
    updateItemProgress: (jobId: string, itemId: string, progress: number, status: string) => void;
}

export const useTransferStore = create<TransferState>((set, get) => ({
    jobs: [],
    activeJobId: null,

    loadJobs: async () => {
        const jobs = await window.electron.config.getJobs();
        set({ jobs });
    },

    createJob: async (job) => {
        await window.electron.config.saveJob(job);
        await get().loadJobs();
    },

    updateJob: async (job) => {
        await window.electron.config.saveJob(job);
        await get().loadJobs();
    },

    deleteJob: async (id) => {
        await window.electron.config.deleteJob(id);
        await get().loadJobs();
    },

    startJob: async (job) => {
        set({ activeJobId: job.id });
        await window.electron.transfer.start(job);
    },

    pauseJob: async (jobId) => {
        await window.electron.transfer.pause(jobId);
    },

    resumeJob: async (jobId) => {
        await window.electron.transfer.resume(jobId);
    },

    cancelJob: async (jobId) => {
        await window.electron.transfer.cancel(jobId);
        set({ activeJobId: null });
    },

    retryItem: async (jobId, itemId) => {
        await window.electron.transfer.retry(jobId, itemId);
    },

    setActiveJob: (jobId) => {
        set({ activeJobId: jobId });
    },

    updateItemProgress: (jobId, itemId, progress, status) => {
        set(state => ({
            jobs: state.jobs.map(job => {
                if (job.id !== jobId) return job;
                return {
                    ...job,
                    items: job.items.map(item => {
                        if (item.id !== itemId) return item;
                        return { ...item, progress, status: status as any };
                    })
                };
            })
        }));
    },
}));

// ========== Tab Store ==========
interface DestinationConfig {
    id: string;
    serverId: string;
    destinationFolder: string;
    rcloneConfigId: string;
}

interface TransferConfig {
    name: string;
    sourceServerId: string;
    sourceFolder: string;
    sourceRcloneConfigId: string;
    destinations: DestinationConfig[];
    driveFolder: string;
    driveRemoteName: string;
    zipSizeLimitMB: number;
    deleteAfterUpload: boolean;
    deleteFromDrive: boolean;
    autoExtract: boolean;
}

const DEFAULT_TRANSFER_CONFIG: TransferConfig = {
    name: '',
    sourceServerId: '',
    sourceFolder: '',
    sourceRcloneConfigId: '',
    destinations: [],
    driveFolder: 'rclone-transfer',
    driveRemoteName: 'gdrive',
    zipSizeLimitMB: 1024,
    deleteAfterUpload: false,
    deleteFromDrive: true,
    autoExtract: true,
};

interface TabState {
    tabs: TransferTab[];
    activeTabId: string;
    tabConfigs: Record<string, TransferConfig>;
    addTab: () => void;
    removeTab: (id: string) => void;
    setActiveTab: (id: string) => void;
    updateTab: (id: string, updates: Partial<TransferTab>) => void;
    getTabConfig: (id: string) => TransferConfig;
    setTabConfig: (id: string, config: TransferConfig) => void;
    saveSession: () => Record<string, TransferConfig>;
    loadSession: (configs: Record<string, TransferConfig>) => void;
}

const createTabId = () => `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const initialTabId = createTabId();

export const useTabStore = create<TabState>((set, get) => ({
    tabs: [{ id: initialTabId, name: 'Transfer 1', isActive: true }],
    activeTabId: initialTabId,
    tabConfigs: { [initialTabId]: { ...DEFAULT_TRANSFER_CONFIG } },

    addTab: () => {
        const newTab: TransferTab = {
            id: createTabId(),
            name: `Transfer ${get().tabs.length + 1}`,
            isActive: false,
        };
        set(state => ({
            tabs: [...state.tabs.map(t => ({ ...t, isActive: false })), { ...newTab, isActive: true }],
            activeTabId: newTab.id,
            tabConfigs: { ...state.tabConfigs, [newTab.id]: { ...DEFAULT_TRANSFER_CONFIG } },
        }));
    },

    removeTab: (id) => {
        set(state => {
            const newTabs = state.tabs.filter(t => t.id !== id);
            const { [id]: removed, ...remainingConfigs } = state.tabConfigs;

            if (newTabs.length === 0) {
                const newTabId = createTabId();
                const newTab: TransferTab = { id: newTabId, name: 'Transfer 1', isActive: true };
                return {
                    tabs: [newTab],
                    activeTabId: newTabId,
                    tabConfigs: { [newTabId]: { ...DEFAULT_TRANSFER_CONFIG } }
                };
            }
            if (state.activeTabId === id) {
                newTabs[0].isActive = true;
                return { tabs: newTabs, activeTabId: newTabs[0].id, tabConfigs: remainingConfigs };
            }
            return { tabs: newTabs, tabConfigs: remainingConfigs };
        });
    },

    setActiveTab: (id) => {
        set(state => ({
            tabs: state.tabs.map(t => ({ ...t, isActive: t.id === id })),
            activeTabId: id,
        }));
    },

    updateTab: (id, updates) => {
        set(state => ({
            tabs: state.tabs.map(t => t.id === id ? { ...t, ...updates } : t),
        }));
    },

    getTabConfig: (id) => {
        const state = get();
        return state.tabConfigs[id] || { ...DEFAULT_TRANSFER_CONFIG };
    },

    setTabConfig: (id, config) => {
        set(state => ({
            tabConfigs: { ...state.tabConfigs, [id]: config },
        }));
    },

    saveSession: () => {
        return get().tabConfigs;
    },

    loadSession: (configs) => {
        set(state => ({
            tabConfigs: { ...state.tabConfigs, ...configs },
        }));
    },
}));

// ========== Config Store ==========
interface ConfigState {
    config: AppConfig;
    loadConfig: () => Promise<void>;
    updateConfig: (updates: Partial<AppConfig>) => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set) => ({
    config: DEFAULT_APP_CONFIG,

    loadConfig: async () => {
        const config = await window.electron.config.get();
        set({ config });
    },

    updateConfig: async (updates) => {
        await window.electron.config.set(updates);
        set(state => ({ config: { ...state.config, ...updates } }));
    },
}));

// ========== Log Store ==========
interface LogEntry {
    id: string;
    timestamp: string;
    level: string;
    message: string;
    serverId?: string; // Optional: which server this log belongs to
    jobId?: string;    // Optional: which job this log belongs to
}

interface LogState {
    logs: LogEntry[];
    addLog: (entry: LogEntry) => void;
    clearLogs: () => void;
    clearLogsForJob: (jobId: string) => void;
    getLogsForServer: (serverId: string) => LogEntry[];
    getGeneralLogs: () => LogEntry[];
    loadLogs: () => Promise<void>;
}

export const useLogStore = create<LogState>((set, get) => ({
    logs: [],

    addLog: (entry) => {
        set(state => ({
            logs: [...state.logs.slice(-1999), entry], // Keep last 2000 logs
        }));
    },

    clearLogs: () => {
        set({ logs: [] });
    },

    clearLogsForJob: (jobId: string) => {
        set(state => ({
            logs: state.logs.filter(log => log.jobId !== jobId),
        }));
    },

    getLogsForServer: (serverId: string) => {
        return get().logs.filter(log => log.serverId === serverId);
    },

    getGeneralLogs: () => {
        return get().logs.filter(log => !log.serverId);
    },

    loadLogs: async () => {
        const logs = await window.electron.logs.getAll();
        set({ logs });
    },
}));

// ========== Rclone Config Store ==========
interface RcloneConfigState {
    configs: RcloneConfig[];
    isLoading: boolean;
    loadConfigs: () => Promise<void>;
    addConfig: (config: RcloneConfig) => Promise<void>;
    updateConfig: (config: RcloneConfig) => Promise<void>;
    deleteConfig: (id: string) => Promise<void>;
    getConfigById: (id: string) => RcloneConfig | undefined;
}

const createRcloneConfigId = () => `rclone_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const useRcloneConfigStore = create<RcloneConfigState>((set, get) => ({
    configs: [],
    isLoading: false,

    loadConfigs: async () => {
        set({ isLoading: true });
        try {
            const configs = await window.electron.rclone.getConfigs();
            set({ configs: configs || [] });
        } catch (error) {
            console.error('Failed to load rclone configs:', error);
            set({ configs: [] });
        } finally {
            set({ isLoading: false });
        }
    },

    addConfig: async (config) => {
        const newConfig: RcloneConfig = {
            ...config,
            id: config.id || createRcloneConfigId(),
            createdAt: config.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await window.electron.rclone.saveConfig(newConfig);
        await get().loadConfigs();
    },

    updateConfig: async (config) => {
        const updatedConfig: RcloneConfig = {
            ...config,
            updatedAt: new Date().toISOString(),
        };
        await window.electron.rclone.saveConfig(updatedConfig);
        await get().loadConfigs();
    },

    deleteConfig: async (id) => {
        await window.electron.rclone.deleteConfig(id);
        await get().loadConfigs();
    },

    getConfigById: (id) => {
        return get().configs.find(c => c.id === id);
    },
}));

// ========== Uploaded Files Store ==========
interface UploadedFilesState {
    files: Record<string, UploadedFileInfo[]>; // jobId -> files
    addFile: (jobId: string, file: UploadedFileInfo) => void;
    updateFile: (jobId: string, file: UploadedFileInfo) => void;
    clearFilesForJob: (jobId: string) => void;
    getFilesForJob: (jobId: string) => UploadedFileInfo[];
}

export const useUploadedFilesStore = create<UploadedFilesState>((set, get) => ({
    files: {},

    addFile: (jobId, file) => {
        set(state => {
            const jobFiles = state.files[jobId] || [];
            const existingIndex = jobFiles.findIndex(f => f.id === file.id);
            if (existingIndex >= 0) {
                // Update existing file
                const newJobFiles = [...jobFiles];
                newJobFiles[existingIndex] = file;
                return { files: { ...state.files, [jobId]: newJobFiles } };
            } else {
                // Add new file
                return { files: { ...state.files, [jobId]: [...jobFiles, file] } };
            }
        });
    },

    updateFile: (jobId, file) => {
        set(state => {
            const jobFiles = state.files[jobId] || [];
            const existingIndex = jobFiles.findIndex(f => f.id === file.id);
            if (existingIndex >= 0) {
                const newJobFiles = [...jobFiles];
                newJobFiles[existingIndex] = file;
                return { files: { ...state.files, [jobId]: newJobFiles } };
            }
            return state;
        });
    },

    clearFilesForJob: (jobId) => {
        set(state => {
            const { [jobId]: removed, ...rest } = state.files;
            return { files: rest };
        });
    },

    getFilesForJob: (jobId) => {
        return get().files[jobId] || [];
    },
}));
