import Store from 'electron-store';
import { SSHConfig, TransferJob, AppConfig, DEFAULT_APP_CONFIG } from '../../shared/types';
import { cryptoService } from './crypto.service';

interface StoreSchema {
    appConfig: AppConfig;
    servers: SSHConfig[];
    jobs: TransferJob[];
}

class ConfigService {
    private store: Store<StoreSchema>;

    constructor() {
        // Using any to bypass strict typing issues with electron-store v11
        this.store = new Store({
            name: 'rclone-plus-config',
            defaults: {
                appConfig: DEFAULT_APP_CONFIG,
                servers: [] as SSHConfig[],
                jobs: [] as TransferJob[],
            },
        }) as Store<StoreSchema>;
    }

    // ========== App Config ==========
    getAppConfig(): AppConfig {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = this.store as any;
        return store.get('appConfig') || DEFAULT_APP_CONFIG;
    }

    setAppConfig(config: Partial<AppConfig>): void {
        const current = this.getAppConfig();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = this.store as any;
        store.set('appConfig', { ...current, ...config });
    }

    // ========== Servers ==========
    getServers(): SSHConfig[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = this.store as any;
        const servers: SSHConfig[] = store.get('servers') || [];
        // Decrypt passwords before returning
        return servers.map((server: SSHConfig) => ({
            ...server,
            password: server.password ? cryptoService.decrypt(server.password) : undefined,
            passphrase: server.passphrase ? cryptoService.decrypt(server.passphrase) : undefined,
        }));
    }

    saveServer(server: SSHConfig): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = this.store as any;
        const servers: SSHConfig[] = store.get('servers') || [];

        // Encrypt sensitive data
        const encryptedServer: SSHConfig = {
            ...server,
            password: server.password ? cryptoService.encrypt(server.password) : undefined,
            passphrase: server.passphrase ? cryptoService.encrypt(server.passphrase) : undefined,
        };

        const existingIndex = servers.findIndex((s: SSHConfig) => s.id === server.id);
        if (existingIndex >= 0) {
            servers[existingIndex] = encryptedServer;
        } else {
            servers.push(encryptedServer);
        }

        store.set('servers', servers);
    }

    deleteServer(id: string): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = this.store as any;
        const servers: SSHConfig[] = store.get('servers') || [];
        store.set('servers', servers.filter((s: SSHConfig) => s.id !== id));
    }

    getServerById(id: string): SSHConfig | undefined {
        return this.getServers().find(s => s.id === id);
    }

    // ========== Jobs ==========
    getJobs(): TransferJob[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = this.store as any;
        return store.get('jobs') || [];
    }

    saveJob(job: TransferJob): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = this.store as any;
        const jobs: TransferJob[] = store.get('jobs') || [];
        const existingIndex = jobs.findIndex((j: TransferJob) => j.id === job.id);

        if (existingIndex >= 0) {
            jobs[existingIndex] = job;
        } else {
            jobs.push(job);
        }

        store.set('jobs', jobs);
    }

    deleteJob(id: string): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = this.store as any;
        const jobs: TransferJob[] = store.get('jobs') || [];
        store.set('jobs', jobs.filter((j: TransferJob) => j.id !== id));
    }



    getJobById(id: string): TransferJob | undefined {
        return this.getJobs().find(j => j.id === id);
    }

    // ========== Session ==========
    getSession(): Record<string, any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = this.store as any;
        return store.get('session') || {};
    }

    saveSession(session: Record<string, any>): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = this.store as any;
        store.set('session', session);
    }
}

export const configService = new ConfigService();
