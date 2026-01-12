import { sshService } from './ssh.service';
import { logService } from './logger.service';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { RcloneConfig } from '../../shared/types';

const execAsync = promisify(exec);

class RcloneService {
    private localConfigPath: string;
    private rcloneBinPath: string;
    private rcloneConfigsPath: string;

    constructor() {
        this.localConfigPath = path.join(os.homedir(), '.config', 'rclone', 'rclone.conf');
        // Since we are in Main process code, we can import app dynamically or compute path
        // We'll compute typical userData path for simplicity or rely on relative path if needed.
        // Better: let's use a fixed path safely in home dir for portability if app is not available
        const appData = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : '/var/local');
        const userData = path.join(appData, 'rclone-plus');
        this.rcloneBinPath = path.join(userData, 'bin', process.platform === 'win32' ? 'rclone.exe' : 'rclone');
        this.rcloneConfigsPath = path.join(userData, 'rclone-configs.json');
    }

    private getRcloneCmd(): string {
        return fs.existsSync(this.rcloneBinPath) ? `"${this.rcloneBinPath}"` : 'rclone';
    }

    /**
     * Check if rclone is installed on server
     */
    async checkInstalled(connectionId: string): Promise<{ installed: boolean; version?: string }> {
        try {
            const result = await sshService.exec(connectionId, 'rclone version 2>/dev/null | head -1');
            if (result.stdout) {
                const version = result.stdout.replace('rclone ', '').trim();
                return { installed: true, version };
            }
            return { installed: false };
        } catch {
            return { installed: false };
        }
    }

    /**
     * Check if rclone config exists on server and return remotes
     */
    async checkServerConfig(connectionId: string): Promise<{
        hasConfig: boolean;
        remotes: Array<{ name: string; type: string }>;
        configPath?: string;
    }> {
        try {
            // Check if config file exists
            const configCheck = await sshService.exec(connectionId, 'cat ~/.config/rclone/rclone.conf 2>/dev/null');

            if (!configCheck.stdout || configCheck.stdout.trim() === '') {
                return { hasConfig: false, remotes: [] };
            }

            // Parse remotes from config
            const remotes: Array<{ name: string; type: string }> = [];
            const lines = configCheck.stdout.split('\n');
            let currentRemote: string | null = null;

            for (const line of lines) {
                const trimmed = line.trim();
                // Match [remote_name]
                const remoteMatch = trimmed.match(/^\[([^\]]+)\]$/);
                if (remoteMatch) {
                    currentRemote = remoteMatch[1];
                } else if (currentRemote && trimmed.startsWith('type = ')) {
                    const type = trimmed.replace('type = ', '').trim();
                    remotes.push({ name: currentRemote, type });
                    currentRemote = null;
                }
            }

            logService.info(`Found ${remotes.length} rclone remotes on server`, { remotes }, undefined, connectionId);

            return {
                hasConfig: true,
                remotes,
                configPath: '~/.config/rclone/rclone.conf'
            };
        } catch (error) {
            logService.debug('Error checking server rclone config', error);
            return { hasConfig: false, remotes: [] };
        }
    }

    /**
     * Install rclone on server
     */
    async install(connectionId: string): Promise<{ success: boolean; error?: string }> {
        try {
            logService.info('Installing rclone on server...', undefined, undefined, connectionId);

            // Use the official rclone install script
            const installCommand = 'curl https://rclone.org/install.sh | sudo bash';

            const result = await sshService.exec(connectionId, installCommand);

            if (result.stderr && result.stderr.includes('error')) {
                // Try user-level installation if sudo fails
                const userInstall = `
          mkdir -p ~/bin &&
          cd /tmp &&
          curl -O https://downloads.rclone.org/rclone-current-linux-amd64.zip &&
          unzip -o rclone-current-linux-amd64.zip &&
          cp rclone-*-linux-amd64/rclone ~/bin/ &&
          chmod +x ~/bin/rclone &&
          rm -rf rclone-*
        `;
                await sshService.exec(connectionId, userInstall);

                // Add to PATH if not already
                await sshService.exec(connectionId, 'echo \'export PATH="$HOME/bin:$PATH"\' >> ~/.bashrc');
            }

            // Verify installation
            const check = await this.checkInstalled(connectionId);
            if (check.installed) {
                logService.info(`Rclone installed successfully: ${check.version}`, undefined, undefined, connectionId);
                return { success: true };
            }

            return { success: false, error: 'Installation verification failed' };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logService.error('Failed to install rclone', message, undefined, connectionId);
            return { success: false, error: message };
        }
    }

    /**
     * Configure rclone remote (local machine)
     */
    async configure(remote: { name: string; token: string }): Promise<{ success: boolean }> {
        try {
            // Ensure config directory exists
            const configDir = path.dirname(this.localConfigPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }

            // Read existing config or create new
            let configContent = '';
            if (fs.existsSync(this.localConfigPath)) {
                configContent = fs.readFileSync(this.localConfigPath, 'utf-8');
            }

            // Remove existing remote with same name
            const remoteRegex = new RegExp(`\\[${remote.name}\\][\\s\\S]*?(?=\\[|$)`, 'g');
            configContent = configContent.replace(remoteRegex, '');

            // Add new remote config
            const newConfig = `
[${remote.name}]
type = drive
token = ${remote.token}
`;
            configContent += newConfig;

            fs.writeFileSync(this.localConfigPath, configContent.trim() + '\n');

            logService.info(`Configured rclone remote: ${remote.name}`);
            return { success: true };
        } catch (error) {
            logService.error('Failed to configure rclone', error);
            return { success: false };
        }
    }

    /**
     * Get OAuth URL for Google Drive authorization
     */
    async getOAuthUrl(): Promise<{ url: string }> {
        // Note: This requires rclone to be installed locally
        // For a full OAuth flow, you would typically:
        // 1. Use rclone authorize in headless mode
        // 2. Or implement OAuth directly in the app

        try {
            // Check if rclone is installed locally
            const { stdout } = await execAsync('rclone version');
            logService.debug('Local rclone version', stdout);

            // Return instruction URL - actual OAuth would need more setup
            return {
                url: 'Please run "rclone config" in terminal to configure Google Drive and copy the token.'
            };
        } catch {
            return {
                url: 'Rclone not found locally. Please install rclone first: https://rclone.org/install/'
            };
        }
    }

    /**
     * Copy rclone config to server
     */
    async copyConfigToServer(connectionId: string): Promise<{ success: boolean; error?: string }> {
        try {
            if (!fs.existsSync(this.localConfigPath)) {
                return { success: false, error: 'Local rclone config not found. Please configure rclone first.' };
            }

            const configContent = fs.readFileSync(this.localConfigPath, 'utf-8');

            // Create config directory on server
            await sshService.exec(connectionId, 'mkdir -p ~/.config/rclone');

            // Write config to server
            const escapedContent = configContent.replace(/'/g, "'\\''");
            await sshService.exec(connectionId, `echo '${escapedContent}' > ~/.config/rclone/rclone.conf`);

            logService.info('Copied rclone config to server', undefined, undefined, connectionId);
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logService.error('Failed to copy rclone config', message, undefined, connectionId);
            return { success: false, error: message };
        }
    }

    /**
     * Upload file to remote using rclone on server
     * Uses `rclone copyto` to upload as a single file (not to a folder)
     */
    async upload(
        connectionId: string,
        sourcePath: string,
        remoteName: string,
        remotePath: string,
        onProgress?: (percent: number, speed: string) => void
    ): Promise<{ success: boolean; error?: string }> {
        try {
            // Use rclone copyto to upload as a single file (not to a directory)
            // copyto copies source file to dest file (not dest folder)
            const command = `rclone copyto "${sourcePath}" "${remoteName}:${remotePath}" --progress --stats 1s 2>&1`;

            await sshService.execWithProgress(connectionId, command, (data) => {
                // Parse progress from rclone output
                const percentMatch = data.match(/(\d+)%/);
                const speedMatch = data.match(/(\d+\.?\d*\s*[KMGT]?B\/s)/);

                if (percentMatch && onProgress) {
                    const percent = parseInt(percentMatch[1], 10);
                    const speed = speedMatch ? speedMatch[1] : '';
                    onProgress(percent, speed);
                }
            });

            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, error: message };
        }
    }

    /**
     * Download file from remote using rclone on server
     * Uses `rclone copyto` to download as a single file (not to a folder)
     */
    async download(
        connectionId: string,
        remoteName: string,
        remotePath: string,
        destPath: string,
        onProgress?: (percent: number, speed: string) => void
    ): Promise<{ success: boolean; error?: string }> {
        try {
            // Use rclone copyto to download as a single file (not to a directory)
            const command = `rclone copyto "${remoteName}:${remotePath}" "${destPath}" --progress --stats 1s 2>&1`;

            await sshService.execWithProgress(connectionId, command, (data) => {
                const percentMatch = data.match(/(\d+)%/);
                const speedMatch = data.match(/(\d+\.?\d*\s*[KMGT]?B\/s)/);

                if (percentMatch && onProgress) {
                    const percent = parseInt(percentMatch[1], 10);
                    const speed = speedMatch ? speedMatch[1] : '';
                    onProgress(percent, speed);
                }
            });

            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, error: message };
        }
    }

    /**
     * Delete a single file from remote
     * Uses `rclone deletefile` to delete a specific file (not a directory)
     */
    async delete(connectionId: string, remoteName: string, remotePath: string): Promise<{ success: boolean; error?: string }> {
        try {
            // Use rclone deletefile to delete a single file
            // This is more reliable than `rclone delete` which deletes files inside a directory
            const result = await sshService.exec(connectionId, `rclone deletefile "${remoteName}:${remotePath}" 2>&1`);

            if (result.stderr && result.stderr.includes('error')) {
                logService.error(`[Cleanup] Failed to delete from Drive: ${result.stderr}`);
                return { success: false, error: result.stderr };
            }

            logService.info(`[Cleanup] Deleted file from Drive: ${remotePath}`);
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logService.error(`[Cleanup] Delete failed: ${message}`);
            return { success: false, error: message };
        }
    }

    /**
     * List files in remote path
     */
    async list(connectionId: string, remoteName: string, remotePath: string): Promise<string[]> {
        try {
            const result = await sshService.exec(connectionId, `rclone ls "${remoteName}:${remotePath}"`);
            return result.stdout.split('\n').filter(Boolean);
        } catch {
            return [];
        }
    }

    /**
     * Start OAuth flow for Google Drive
     * Opens browser for authentication and returns token
     */
    async startOAuth(remoteName: string): Promise<{ success: boolean; token?: string; error?: string }> {
        try {
            logService.info(`Starting OAuth flow for ${remoteName}`);

            // Check if rclone is installed locally
            let rcloneCmd = this.getRcloneCmd();
            try {
                await execAsync(`${rcloneCmd} version`);
            } catch {
                logService.info('Rclone not found locally. Attempting to download...');
                const installed = await this.installLocalRclone();
                if (!installed) {
                    return {
                        success: false,
                        error: 'Rclone is not installed locally and auto-download failed. Please install manually: https://rclone.org/install/'
                    };
                }
                rcloneCmd = this.getRcloneCmd();
            }

            // Run rclone authorize in headless mode
            // This will open a browser for OAuth
            const { stdout, stderr } = await execAsync(
                `${rcloneCmd} authorize "drive"`,
                { timeout: 120000 } // 2 minute timeout for user to complete auth
            );

            logService.debug('OAuth stdout:', stdout);
            logService.debug('OAuth stderr:', stderr);

            // Parse token from output
            // The token is usually in a JSON format in the output
            const tokenMatch = stdout.match(/\{[^{}]*"access_token"[^{}]*\}/);
            if (tokenMatch) {
                const token = tokenMatch[0];
                logService.info('OAuth completed successfully');
                return { success: true, token };
            }

            // Check if token is in stderr (rclone sometimes outputs there)
            const stderrTokenMatch = stderr.match(/\{[^{}]*"access_token"[^{}]*\}/);
            if (stderrTokenMatch) {
                const token = stderrTokenMatch[0];
                return { success: true, token };
            }

            return { success: false, error: 'Could not parse OAuth token from response' };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'OAuth failed';
            logService.error('OAuth failed', message);
            return { success: false, error: message };
        }
    }

    /**
     * List configured remotes from local rclone config
     */
    async listLocalRemotes(): Promise<Array<{ name: string; type: string }>> {
        try {
            if (!fs.existsSync(this.localConfigPath)) {
                return [];
            }

            const content = fs.readFileSync(this.localConfigPath, 'utf-8');
            const remotes: Array<{ name: string; type: string }> = [];
            const lines = content.split('\n');
            let currentRemote: string | null = null;

            for (const line of lines) {
                const trimmed = line.trim();
                const remoteMatch = trimmed.match(/^\[([^\]]+)\]$/);
                if (remoteMatch) {
                    currentRemote = remoteMatch[1];
                } else if (currentRemote && trimmed.startsWith('type = ')) {
                    const type = trimmed.replace('type = ', '').trim();
                    remotes.push({ name: currentRemote, type });
                    currentRemote = null;
                }
            }

            return remotes;
        } catch (error) {
            logService.error('Failed to list local remotes', error);
            return [];
        }
    }


    // ========== Rclone Config CRUD ==========

    /**
     * Get all saved rclone configs
     */
    getRcloneConfigs(): RcloneConfig[] {
        try {
            if (!fs.existsSync(this.rcloneConfigsPath)) {
                return [];
            }
            const content = fs.readFileSync(this.rcloneConfigsPath, 'utf-8');
            return JSON.parse(content) as RcloneConfig[];
        } catch (error) {
            logService.error('Failed to read rclone configs', error);
            return [];
        }
    }

    /**
     * Save a rclone config (create or update)
     */
    saveRcloneConfig(config: RcloneConfig): { success: boolean; config: RcloneConfig } {
        try {
            const configs = this.getRcloneConfigs();
            const existingIndex = configs.findIndex(c => c.id === config.id);

            if (existingIndex >= 0) {
                // Update existing
                configs[existingIndex] = {
                    ...config,
                    updatedAt: new Date().toISOString(),
                };
            } else {
                // Create new
                configs.push({
                    ...config,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                });
            }

            fs.writeFileSync(this.rcloneConfigsPath, JSON.stringify(configs, null, 2));
            logService.info(`Saved rclone config: ${config.name}`);
            return { success: true, config: configs[existingIndex >= 0 ? existingIndex : configs.length - 1] };
        } catch (error) {
            logService.error('Failed to save rclone config', error);
            return { success: false, config };
        }
    }

    /**
     * Delete a rclone config by id
     */
    deleteRcloneConfig(id: string): { success: boolean } {
        try {
            const configs = this.getRcloneConfigs();
            const filtered = configs.filter(c => c.id !== id);

            if (filtered.length === configs.length) {
                return { success: false }; // Not found
            }

            fs.writeFileSync(this.rcloneConfigsPath, JSON.stringify(filtered, null, 2));
            logService.info(`Deleted rclone config: ${id}`);
            return { success: true };
        } catch (error) {
            logService.error('Failed to delete rclone config', error);
            return { success: false };
        }
    }

    /**
     * Download rclone binary locally (Windows only support for now)
     */
    async installLocalRclone(): Promise<boolean> {
        if (process.platform !== 'win32') return false; // Basic support for now

        try {
            const binDir = path.dirname(this.rcloneBinPath);
            if (!fs.existsSync(binDir)) {
                fs.mkdirSync(binDir, { recursive: true });
            }

            const downloadUrl = 'https://downloads.rclone.org/v1.65.1/rclone-v1.65.1-windows-amd64.zip';
            const zipPath = path.join(binDir, 'rclone.zip');

            logService.info('Downloading rclone...');
            // Use Powershell to download
            await execAsync(`powershell -Command "Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${zipPath}'"`);

            logService.info('Extracting rclone...');
            // Use Powershell to unzip
            await execAsync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${binDir}' -Force"`);

            // Move exe from subfolder to bin
            const items = fs.readdirSync(binDir);
            const folder = items.find(i => i.startsWith('rclone-v') && fs.lstatSync(path.join(binDir, i)).isDirectory());

            if (folder) {
                const exePath = path.join(binDir, folder, 'rclone.exe');
                if (fs.existsSync(exePath)) {
                    fs.copyFileSync(exePath, this.rcloneBinPath);
                    // Cleanup
                    try {
                        // Use shell recursive delete to avoid permission issues
                        await execAsync(`rd /s /q "${path.join(binDir, folder)}"`);
                        fs.unlinkSync(zipPath);
                    } catch (e) {
                        logService.warn('Cleanup warning', e);
                    }
                    return true;
                }
            }
            return false;
        } catch (error) {
            logService.error('Failed to download local rclone', error);
            return false;
        }
    }
}

export const rcloneService = new RcloneService();
