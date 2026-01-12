import { BrowserWindow } from 'electron';
import { TransferJob, TransferItem, IPC_CHANNELS } from '../../shared/types';
import { sshService } from './ssh.service';
import { rcloneService } from './rclone.service';
import { configService } from './config.service';
import { logService } from './logger.service';

class TransferService {
    private activeJobs: Map<string, { job: TransferJob; isPaused: boolean; isCancelled: boolean }> = new Map();

    private generateId(): string {
        return `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private broadcastProgress(jobId: string, itemId: string, progress: number, status: string): void {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(win => {
            win.webContents.send(IPC_CHANNELS.TRANSFER_PROGRESS, { jobId, itemId, progress, status });
        });
    }

    /**
     * Start a transfer job
     */
    async startJob(job: TransferJob): Promise<void> {
        this.activeJobs.set(job.id, { job, isPaused: false, isCancelled: false });

        logService.info(`=== Starting transfer job: ${job.name} ===`, undefined, job.id);

        try {
            // Step 1: Connect to source server
            const sourceServer = configService.getServerById(job.sourceServerId);
            if (!sourceServer) {
                throw new Error(`Source server not found: ${job.sourceServerId}`);
            }

            logService.info(`[Step 1/6] Connecting to source server: ${sourceServer.name}...`, undefined, job.id, sourceServer.id);
            await sshService.connect(sourceServer);
            logService.info(`[Step 1/6] Connected to source server: ${sourceServer.name}`, undefined, job.id, sourceServer.id);

            // Step 2: Check/install rclone on source
            logService.info(`[Step 2/6] Checking rclone on source server...`, undefined, job.id, sourceServer.id);
            const rcloneCheck = await rcloneService.checkInstalled(sourceServer.id);
            if (!rcloneCheck.installed) {
                logService.info('[Step 2/6] Rclone not found, installing on source server...', undefined, job.id, sourceServer.id);
                await rcloneService.install(sourceServer.id);
                logService.info('[Step 2/6] Rclone installed on source server', undefined, job.id, sourceServer.id);
            } else {
                logService.info(`[Step 2/6] Rclone found on source: ${rcloneCheck.version}`, undefined, job.id, sourceServer.id);
            }

            // Step 3: Copy rclone config to source
            logService.info(`[Step 3/6] Deploying rclone config to source server...`, undefined, job.id, sourceServer.id);
            await rcloneService.copyConfigToServer(sourceServer.id);
            logService.info('[Step 3/6] Rclone config deployed to source server', undefined, job.id, sourceServer.id);

            // Step 4: Get list of items to transfer (zip and split)
            logService.info(`[Step 4/6] Preparing source files for transfer...`, undefined, job.id, sourceServer.id);
            const items = await this.prepareSourceFiles(job, sourceServer.id);
            job.items = items;
            logService.info(`[Step 4/6] Prepared ${items.length} item(s) for transfer`, undefined, job.id, sourceServer.id);

            // Save job state
            configService.saveJob(job);

            // Step 5: Process each item (zip & upload)
            logService.info(`[Step 5/6] Starting zip & upload process...`, undefined, job.id, sourceServer.id);
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const jobState = this.activeJobs.get(job.id);
                if (!jobState || jobState.isCancelled) {
                    logService.warn(`Job cancelled, stopping at item ${i + 1}/${items.length}`, undefined, job.id);
                    break;
                }

                while (jobState?.isPaused) {
                    await this.sleep(1000);
                }

                logService.info(`[Step 5/6] Processing item ${i + 1}/${items.length}: ${item.fileName}`, undefined, job.id);
                await this.processItem(job, item);
            }

            // Step 6: Connect to destination servers and download
            logService.info(`[Step 6/6] Starting download to ${job.destinationServerIds.length} destination(s)...`, undefined, job.id);
            for (let i = 0; i < job.destinationServerIds.length; i++) {
                const destServerId = job.destinationServerIds[i];
                logService.info(`[Step 6/6] Processing destination ${i + 1}/${job.destinationServerIds.length}...`, undefined, job.id, destServerId);
                await this.downloadToDestination(job, destServerId);
            }

            logService.info(`=== Transfer job completed: ${job.name} ===`, undefined, job.id);

            // Show notification
            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0) {
                windows[0].webContents.send(IPC_CHANNELS.NOTIFICATION_SHOW, {
                    title: 'Transfer Complete',
                    body: `Job "${job.name}" has completed successfully.`
                });
            }

        } catch (error) {
            logService.error(`Transfer job failed: ${job.name}`, error, job.id);
        } finally {
            this.activeJobs.delete(job.id);
        }
    }

    /**
     * Format bytes to human readable
     */
    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Prepare source files - zip and split if needed
     */
    private async prepareSourceFiles(job: TransferJob, connectionId: string): Promise<TransferItem[]> {
        const items: TransferItem[] = [];

        // Get folder size
        logService.info(`Calculating folder size: ${job.sourceFolder}`, undefined, job.id);
        const sizeResult = await sshService.exec(connectionId, `du -sb "${job.sourceFolder}" | cut -f1`);
        const totalBytes = parseInt(sizeResult.stdout, 10) || 0;
        const limitBytes = job.zipSizeLimitMB * 1024 * 1024;

        logService.info(`Folder size: ${this.formatBytes(totalBytes)}, Zip limit: ${this.formatBytes(limitBytes)}`, undefined, job.id);

        if (totalBytes <= limitBytes) {
            // Single zip file
            const zipName = `transfer_${Date.now()}.zip`;
            const zipPath = `/tmp/${zipName}`;

            logService.info(`Will create single zip file: ${zipName}`, undefined, job.id);

            const item: TransferItem = {
                id: this.generateId(),
                fileName: zipName,
                sourcePath: zipPath,
                drivePath: `${job.driveFolder}/${zipName}`,
                destinationPath: job.destinationFolder,
                status: 'pending',
                progress: 0,
                createdAt: new Date().toISOString(),
                retryCount: 0,
            };
            items.push(item);
        } else {
            // Multiple parts - create split zip
            const numParts = Math.ceil(totalBytes / limitBytes);
            logService.info(`Will create ${numParts} split zip files (folder exceeds limit)`, undefined, job.id);

            for (let i = 1; i <= numParts; i++) {
                const zipName = `transfer_${Date.now()}_part${i}.zip`;
                const zipPath = `/tmp/${zipName}`;

                const item: TransferItem = {
                    id: this.generateId(),
                    fileName: zipName,
                    sourcePath: zipPath,
                    drivePath: `${job.driveFolder}/${zipName}`,
                    destinationPath: job.destinationFolder,
                    status: 'pending',
                    progress: 0,
                    createdAt: new Date().toISOString(),
                    retryCount: 0,
                };
                items.push(item);
            }
        }

        return items;
    }

    /**
     * Process a single transfer item
     */
    private async processItem(job: TransferJob, item: TransferItem): Promise<void> {
        try {
            const sourceServer = configService.getServerById(job.sourceServerId);
            if (!sourceServer) return;

            // Update status: zipping
            item.status = 'zipping';
            this.broadcastProgress(job.id, item.id, 0, 'zipping');
            logService.info(`[Zip] Creating zip file: ${item.fileName}...`, undefined, job.id, sourceServer.id);

            // Create zip on source server
            await sshService.execWithProgress(
                sourceServer.id,
                `cd "${job.sourceFolder}" && zip -r "${item.sourcePath}" . 2>&1`,
                (data) => {
                    // Parse zip progress if available
                    const match = data.match(/(\d+)%/);
                    if (match) {
                        item.progress = parseInt(match[1], 10);
                        this.broadcastProgress(job.id, item.id, item.progress, 'zipping');
                    }
                }
            );
            logService.info(`[Zip] Zip file created: ${item.sourcePath}`, undefined, job.id, sourceServer.id);

            // Get zip file size
            try {
                const zipSizeResult = await sshService.exec(sourceServer.id, `stat -c%s "${item.sourcePath}"`);
                const zipSize = parseInt(zipSizeResult.stdout, 10) || 0;
                logService.info(`[Zip] Zip file size: ${this.formatBytes(zipSize)}`, undefined, job.id, sourceServer.id);
            } catch { /* ignore */ }

            // Update status: uploading
            item.status = 'uploading';
            item.progress = 0;
            this.broadcastProgress(job.id, item.id, 0, 'uploading');
            logService.info(`[Upload] Uploading to Google Drive: ${item.drivePath}...`, undefined, job.id, sourceServer.id);

            // Upload to drive
            const remoteName = 'gdrive'; // Default remote name
            await rcloneService.upload(
                sourceServer.id,
                item.sourcePath,
                remoteName,
                item.drivePath,
                (percent, speed) => {
                    item.progress = percent;
                    item.speed = speed;
                    this.broadcastProgress(job.id, item.id, percent, 'uploading');
                    // Log progress every 25%
                    if (percent % 25 === 0 && percent > 0) {
                        logService.info(`[Upload] Progress: ${percent}% (${speed})`, undefined, job.id, sourceServer.id);
                    }
                }
            );

            item.status = 'uploaded';
            item.progress = 100;
            this.broadcastProgress(job.id, item.id, 100, 'uploaded');
            logService.info(`[Upload] Upload completed: ${item.fileName}`, undefined, job.id, sourceServer.id);

            // Delete source file if configured
            if (job.deleteAfterUpload) {
                await sshService.exec(sourceServer.id, `rm -f "${item.sourcePath}"`);
                logService.info(`[Cleanup] Deleted source zip: ${item.sourcePath}`, undefined, job.id, sourceServer.id);
            }

            // Save job state
            configService.saveJob(job);

        } catch (error) {
            item.status = 'failed';
            item.error = error instanceof Error ? error.message : 'Unknown error';
            this.broadcastProgress(job.id, item.id, item.progress, 'failed');
            logService.error(`[Error] Failed to process item: ${item.fileName} - ${item.error}`, error, job.id);
        }
    }

    /**
     * Download uploaded items to destination server
     */
    private async downloadToDestination(job: TransferJob, destServerId: string): Promise<void> {
        const destServer = configService.getServerById(destServerId);
        if (!destServer) {
            logService.error(`Destination server not found: ${destServerId}`, undefined, job.id);
            return;
        }

        try {
            logService.info(`[Dest] Connecting to destination: ${destServer.name}...`, undefined, job.id, destServerId);
            await sshService.connect(destServer);
            logService.info(`[Dest] Connected to destination: ${destServer.name}`, undefined, job.id, destServerId);

            // Check/install rclone
            logService.info(`[Dest] Checking rclone on destination...`, undefined, job.id, destServerId);
            const rcloneCheck = await rcloneService.checkInstalled(destServer.id);
            if (!rcloneCheck.installed) {
                logService.info(`[Dest] Installing rclone on destination...`, undefined, job.id, destServerId);
                await rcloneService.install(destServer.id);
                logService.info(`[Dest] Rclone installed on destination`, undefined, job.id, destServerId);
            } else {
                logService.info(`[Dest] Rclone found: ${rcloneCheck.version}`, undefined, job.id, destServerId);
            }

            // Copy rclone config
            logService.info(`[Dest] Deploying rclone config to destination...`, undefined, job.id, destServerId);
            await rcloneService.copyConfigToServer(destServer.id);
            logService.info(`[Dest] Rclone config deployed`, undefined, job.id, destServerId);

            const remoteName = 'gdrive';

            for (let i = 0; i < job.items.length; i++) {
                const item = job.items[i];
                if (item.status !== 'uploaded') continue;

                const jobState = this.activeJobs.get(job.id);
                if (!jobState || jobState.isCancelled) {
                    logService.warn(`Job cancelled during download`, undefined, job.id);
                    break;
                }

                while (jobState?.isPaused) {
                    await this.sleep(1000);
                }

                try {
                    item.status = 'downloading';
                    item.progress = 0;
                    this.broadcastProgress(job.id, item.id, 0, 'downloading');
                    logService.info(`[Download] Downloading from Drive: ${item.drivePath}...`, undefined, job.id, destServerId);

                    // Download from drive
                    const downloadPath = `/tmp/${item.fileName}`;
                    await rcloneService.download(
                        destServer.id,
                        remoteName,
                        item.drivePath,
                        downloadPath,
                        (percent, speed) => {
                            item.progress = percent;
                            item.speed = speed;
                            this.broadcastProgress(job.id, item.id, percent, 'downloading');
                            // Log progress every 25%
                            if (percent % 25 === 0 && percent > 0) {
                                logService.info(`[Download] Progress: ${percent}% (${speed})`, undefined, job.id, destServerId);
                            }
                        }
                    );
                    logService.info(`[Download] Download completed: ${item.fileName}`, undefined, job.id, destServerId);

                    // Extract if configured
                    if (job.autoExtract) {
                        item.status = 'extracting';
                        this.broadcastProgress(job.id, item.id, 0, 'extracting');
                        logService.info(`[Extract] Extracting to: ${item.destinationPath}...`, undefined, job.id, destServerId);

                        await sshService.exec(
                            destServer.id,
                            `unzip -o "${downloadPath}" -d "${item.destinationPath}"`
                        );
                        logService.info(`[Extract] Extraction completed`, undefined, job.id, destServerId);

                        // Clean up zip file
                        await sshService.exec(destServer.id, `rm -f "${downloadPath}"`);
                        logService.info(`[Cleanup] Deleted downloaded zip: ${downloadPath}`, undefined, job.id, destServerId);
                    }

                    // Delete from drive if configured
                    // Use the destination server connection (which already has rclone) instead of source
                    if (job.deleteFromDrive) {
                        logService.info(`[Cleanup] Deleting from Google Drive: ${item.drivePath}...`, undefined, job.id, destServerId);
                        const deleteResult = await rcloneService.delete(destServer.id, remoteName, item.drivePath);
                        if (deleteResult.success) {
                            logService.info(`[Cleanup] Successfully deleted from Drive: ${item.drivePath}`, undefined, job.id, destServerId);
                        } else {
                            logService.warn(`[Cleanup] Failed to delete from Drive: ${deleteResult.error}`, undefined, job.id, destServerId);
                        }
                    }

                    item.status = 'completed';
                    item.progress = 100;
                    item.completedAt = new Date().toISOString();
                    this.broadcastProgress(job.id, item.id, 100, 'completed');
                    logService.info(`[Complete] Item completed: ${item.fileName}`, undefined, job.id, destServerId);

                } catch (error) {
                    item.status = 'failed';
                    item.error = error instanceof Error ? error.message : 'Unknown error';
                    this.broadcastProgress(job.id, item.id, item.progress, 'failed');
                    logService.error(`[Error] Failed to process on destination: ${item.fileName} - ${item.error}`, error, job.id, destServerId);
                }
            }

            sshService.disconnect(destServer.id);
            configService.saveJob(job);

        } catch (error) {
            logService.error(`[Error] Failed to download to destination: ${destServer.name}`, error, job.id, destServerId);
        }
    }

    /**
     * Pause a job
     */
    pauseJob(jobId: string): void {
        const jobState = this.activeJobs.get(jobId);
        if (jobState) {
            jobState.isPaused = true;
            logService.info('Job paused', undefined, jobId);
        }
    }

    /**
     * Resume a job
     */
    resumeJob(jobId: string): void {
        const jobState = this.activeJobs.get(jobId);
        if (jobState) {
            jobState.isPaused = false;
            logService.info('Job resumed', undefined, jobId);
        }
    }

    /**
     * Cancel a job
     */
    cancelJob(jobId: string): void {
        const jobState = this.activeJobs.get(jobId);
        if (jobState) {
            jobState.isCancelled = true;
            logService.info('Job cancelled', undefined, jobId);
        }
    }

    /**
     * Retry a failed item
     */
    async retryItem(jobId: string, itemId: string): Promise<void> {
        const job = configService.getJobById(jobId);
        if (!job) return;

        const item = job.items.find(i => i.id === itemId);
        if (!item || item.status !== 'failed') return;

        item.status = 'pending';
        item.error = undefined;
        item.retryCount++;

        await this.processItem(job, item);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const transferService = new TransferService();
