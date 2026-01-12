import { Client, ConnectConfig } from 'ssh2';
import { SSHConfig } from '../../shared/types';
import { logService } from './logger.service';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface SSHConnection {
    id: string;
    client: Client;
    config: SSHConfig;
}

class SSHService {
    private connections: Map<string, SSHConnection> = new Map();

    /**
     * Connect to SSH server
     */
    async connect(config: SSHConfig): Promise<{ success: boolean; error?: string }> {
        // Reuse existing connection if available
        if (this.connections.has(config.id)) {
            const connection = this.connections.get(config.id);
            // Optional: Check if client is actually active (stream writable etc)
            // For now assume it stays alive or we catch errors later
            if (connection?.client) {
                return { success: true };
            }
            this.connections.delete(config.id);
        }

        try {
            const client = new Client();

            const connectConfig: ConnectConfig = {
                host: config.host,
                port: config.port,
                username: config.username,
                // keepaliveInterval: 10000, // Keep connection alive
                // readyTimeout: 20000,
            };

            // Set auth method
            if (config.authType === 'password' && config.password) {
                connectConfig.password = config.password;
            } else if (config.authType === 'key' && config.privateKeyPath) {
                const keyPath = config.privateKeyPath.replace('~', os.homedir());
                connectConfig.privateKey = fs.readFileSync(keyPath);
                if (config.passphrase) {
                    connectConfig.passphrase = config.passphrase;
                }
            }

            return new Promise((resolve) => {
                client.on('ready', () => {
                    this.connections.set(config.id, { id: config.id, client, config });
                    logService.info(`SSH connected to ${config.name} (${config.host})`, undefined, undefined, config.id);
                    resolve({ success: true });
                });

                client.on('error', (err) => {
                    logService.error(`SSH connection error for ${config.name}`, err.message, undefined, config.id);
                    this.connections.delete(config.id); // Remove if error during connect
                    resolve({ success: false, error: err.message });
                });

                client.on('end', () => {
                    this.connections.delete(config.id);
                });

                client.on('close', () => {
                    this.connections.delete(config.id);
                });

                try {
                    client.connect(connectConfig);
                } catch (err: any) {
                    resolve({ success: false, error: err.message });
                }
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logService.error(`SSH connection failed for ${config.name}`, message, undefined, config.id);
            return { success: false, error: message };
        }
    }

    /**
     * Disconnect from SSH server
     */
    disconnect(id: string): void {
        const connection = this.connections.get(id);
        if (connection) {
            connection.client.end();
            this.connections.delete(id);
            logService.info(`SSH disconnected from ${connection.config.name}`);
        }
    }

    /**
     * Test SSH connection
     */
    async testConnection(config: SSHConfig): Promise<{ success: boolean; error?: string }> {
        const result = await this.connect(config);
        // Do NOT disconnect on success, keep it alive for browsing
        return result;
    }

    /**
     * Execute command on SSH server
     */
    async exec(connectionId: string, command: string): Promise<{ stdout: string; stderr: string }> {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            throw new Error(`No connection found with id: ${connectionId}`);
        }

        return new Promise((resolve, reject) => {
            connection.client.exec(command, (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }

                let stdout = '';
                let stderr = '';

                stream.on('data', (data: Buffer) => {
                    stdout += data.toString();
                });

                stream.stderr.on('data', (data: Buffer) => {
                    stderr += data.toString();
                });

                stream.on('close', () => {
                    resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
                });
            });
        });
    }

    /**
     * Execute command with progress callback
     */
    async execWithProgress(
        connectionId: string,
        command: string,
        onProgress: (data: string) => void
    ): Promise<{ stdout: string; stderr: string }> {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            throw new Error(`No connection found with id: ${connectionId}`);
        }

        return new Promise((resolve, reject) => {
            connection.client.exec(command, (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }

                let stdout = '';
                let stderr = '';

                stream.on('data', (data: Buffer) => {
                    const chunk = data.toString();
                    stdout += chunk;
                    onProgress(chunk);
                });

                stream.stderr.on('data', (data: Buffer) => {
                    const chunk = data.toString();
                    stderr += chunk;
                    onProgress(chunk);
                });

                stream.on('close', () => {
                    resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
                });
            });
        });
    }

    /**
     * Generate SSH key pair
     */
    async generateKeyPair(name: string): Promise<{ publicKey: string; privateKeyPath: string }> {
        const sshDir = path.join(os.homedir(), '.ssh');
        const keyPath = path.join(sshDir, `id_rsa_${name}`);
        const pubKeyPath = `${keyPath}.pub`;

        // Ensure .ssh directory exists
        if (!fs.existsSync(sshDir)) {
            fs.mkdirSync(sshDir, { mode: 0o700 });
        }

        // Generate key pair using ssh-keygen
        await execAsync(`ssh-keygen -t rsa -b 4096 -f "${keyPath}" -N "" -C "rclone-plus-${name}"`);

        const publicKey = fs.readFileSync(pubKeyPath, 'utf-8').trim();

        logService.info(`Generated SSH key pair for ${name}`, { keyPath, pubKeyPath });

        return { publicKey, privateKeyPath: keyPath };
    }

    /**
     * Copy public key to server's authorized_keys
     */
    async copyPublicKeyToServer(
        config: SSHConfig,
        publicKey: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            // Connect with password first
            const result = await this.connect(config);
            if (!result.success) {
                return result;
            }

            // Append public key to authorized_keys
            const command = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "${publicKey}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
            await this.exec(config.id, command);

            this.disconnect(config.id);

            logService.info(`Copied public key to ${config.name}`);
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, error: message };
        }
    }

    /**
     * List SSH configs from ~/.ssh/config
     */
    async listSSHConfigs(): Promise<Array<{ name: string; host: string; user: string; port?: number; identityFile?: string }>> {
        const configPath = path.join(os.homedir(), '.ssh', 'config');

        if (!fs.existsSync(configPath)) {
            return [];
        }

        const content = fs.readFileSync(configPath, 'utf-8');
        const configs: Array<{ name: string; host: string; user: string; port?: number; identityFile?: string }> = [];

        let currentHost: { name: string; host: string; user: string; port?: number; identityFile?: string } | null = null;

        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed.toLowerCase().startsWith('host ') && !trimmed.includes('*')) {
                if (currentHost) {
                    configs.push(currentHost);
                }
                currentHost = { name: trimmed.substring(5).trim(), host: '', user: '' };
            } else if (currentHost) {
                if (trimmed.toLowerCase().startsWith('hostname ')) {
                    currentHost.host = trimmed.substring(9).trim();
                } else if (trimmed.toLowerCase().startsWith('user ')) {
                    currentHost.user = trimmed.substring(5).trim();
                } else if (trimmed.toLowerCase().startsWith('port ')) {
                    currentHost.port = parseInt(trimmed.substring(5).trim(), 10) || 22;
                } else if (trimmed.toLowerCase().startsWith('identityfile ')) {
                    currentHost.identityFile = trimmed.substring(13).trim();
                }
            }
        }

        if (currentHost) {
            configs.push(currentHost);
        }

        return configs;
    }

    /**
     * Upload file to server via SFTP
     */
    async uploadFile(connectionId: string, localPath: string, remotePath: string): Promise<void> {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            throw new Error(`No connection found with id: ${connectionId}`);
        }

        return new Promise((resolve, reject) => {
            connection.client.sftp((err, sftp) => {
                if (err) {
                    reject(err);
                    return;
                }

                sftp.fastPut(localPath, remotePath, {}, (putErr) => {
                    if (putErr) {
                        reject(putErr);
                    } else {
                        resolve();
                    }
                });
            });
        });
    }

    /**
     * Download file from server via SFTP
     */
    async downloadFile(connectionId: string, remotePath: string, localPath: string): Promise<void> {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            throw new Error(`No connection found with id: ${connectionId}`);
        }

        return new Promise((resolve, reject) => {
            connection.client.sftp((err, sftp) => {
                if (err) {
                    reject(err);
                    return;
                }

                sftp.fastGet(remotePath, localPath, {}, (getErr) => {
                    if (getErr) {
                        reject(getErr);
                    } else {
                        resolve();
                    }
                });
            });
        });
    }

    /**
     * Get connection by ID
     */
    getConnection(id: string): SSHConnection | undefined {
        return this.connections.get(id);
    }

    /**
     * Check if connected
     */
    isConnected(id: string): boolean {
        return this.connections.has(id);
    }

    /**
     * List directory contents on remote server with pagination
     */
    async listDirectory(
        connectionId: string,
        dirPath: string,
        options?: { limit?: number; offset?: number }
    ): Promise<{
        items: Array<{
            name: string;
            type: 'file' | 'directory';
            size: number;
            modifyTime: number;
        }>;
        total: number;
        hasMore: boolean;
    }> {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            throw new Error(`No connection found with id: ${connectionId}`);
        }

        const limit = options?.limit || 50;
        const offset = options?.offset || 0;

        return new Promise((resolve, reject) => {
            connection.client.sftp((err, sftp) => {
                if (err) {
                    reject(err);
                    return;
                }

                sftp.readdir(dirPath, (listErr, list) => {
                    if (listErr) {
                        reject(listErr);
                        return;
                    }

                    const allItems = list
                        .filter(item => !item.filename.startsWith('.'))  // Hide hidden files
                        .map(item => ({
                            name: item.filename,
                            type: (item.attrs.isDirectory() ? 'directory' : 'file') as 'file' | 'directory',
                            size: item.attrs.size,
                            modifyTime: item.attrs.mtime,
                        }))
                        .sort((a, b) => {
                            // Directories first, then alphabetically
                            if (a.type !== b.type) {
                                return a.type === 'directory' ? -1 : 1;
                            }
                            return a.name.localeCompare(b.name);
                        });

                    const total = allItems.length;
                    const paginatedItems = allItems.slice(offset, offset + limit);
                    const hasMore = offset + limit < total;

                    resolve({
                        items: paginatedItems,
                        total,
                        hasMore,
                    });
                });
            });
        });
    }
}

export const sshService = new SSHService();
