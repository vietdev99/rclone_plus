import { BrowserWindow } from 'electron';
import { TransferJob, TransferItem, IPC_CHANNELS, UploadedFileInfo, FileDestinationProgress } from '../../shared/types';
import { sshService } from './ssh.service';
import { rcloneService } from './rclone.service';
import { configService } from './config.service';
import { logService } from './logger.service';

class TransferService {
    private activeJobs: Map<string, { job: TransferJob; isPaused: boolean; isCancelled: boolean }> = new Map();
    // Queue for items ready to be downloaded (after upload completes)
    private downloadQueue: Map<string, TransferItem[]> = new Map();
    // Track uploaded files and their destination progress
    private uploadedFiles: Map<string, UploadedFileInfo[]> = new Map();

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
     * Broadcast when a file is uploaded to Drive
     */
    private broadcastFileUploaded(jobId: string, fileInfo: UploadedFileInfo): void {
        // Store file info
        const files = this.uploadedFiles.get(jobId) || [];
        const existingIndex = files.findIndex(f => f.id === fileInfo.id);
        if (existingIndex >= 0) {
            files[existingIndex] = fileInfo;
        } else {
            files.push(fileInfo);
        }
        this.uploadedFiles.set(jobId, files);

        // Broadcast to renderer
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(win => {
            win.webContents.send(IPC_CHANNELS.TRANSFER_FILE_UPLOADED, { jobId, file: fileInfo });
        });
    }

    /**
     * Broadcast file download progress for a specific destination
     */
    private broadcastFileDestinationProgress(
        jobId: string,
        fileId: string,
        serverId: string,
        status: FileDestinationProgress['status'],
        progress: number,
        error?: string
    ): void {
        const files = this.uploadedFiles.get(jobId) || [];
        const fileInfo = files.find(f => f.id === fileId);
        if (fileInfo) {
            const destProgress = fileInfo.destinations.find(d => d.serverId === serverId);
            if (destProgress) {
                destProgress.status = status;
                destProgress.progress = progress;
                if (error) destProgress.error = error;
            }

            // Broadcast updated file info
            const windows = BrowserWindow.getAllWindows();
            windows.forEach(win => {
                win.webContents.send(IPC_CHANNELS.TRANSFER_FILE_PROGRESS, { jobId, file: fileInfo });
            });
        }
    }

    /**
     * Start a transfer job with parallel upload/download pipeline
     */
    async startJob(job: TransferJob): Promise<void> {
        this.activeJobs.set(job.id, { job, isPaused: false, isCancelled: false });
        this.downloadQueue.set(job.id, []);

        logService.info(`=== Starting transfer job: ${job.name} ===`, undefined, job.id);

        try {
            // Step 1: Connect to source server
            const sourceServer = configService.getServerById(job.sourceServerId);
            if (!sourceServer) {
                throw new Error(`Source server not found: ${job.sourceServerId}`);
            }

            logService.info(`[Step 1/4] Connecting to source server: ${sourceServer.name}...`, undefined, job.id, sourceServer.id);
            await sshService.connect(sourceServer);
            logService.info(`[Step 1/4] Connected to source server: ${sourceServer.name}`, undefined, job.id, sourceServer.id);

            // Step 2: Check/install rclone on source
            logService.info(`[Step 2/4] Checking rclone on source server...`, undefined, job.id, sourceServer.id);
            const rcloneCheck = await rcloneService.checkInstalled(sourceServer.id);
            if (!rcloneCheck.installed) {
                logService.info('[Step 2/4] Rclone not found, installing on source server...', undefined, job.id, sourceServer.id);
                await rcloneService.install(sourceServer.id);
                logService.info('[Step 2/4] Rclone installed on source server', undefined, job.id, sourceServer.id);
            } else {
                logService.info(`[Step 2/4] Rclone found on source: ${rcloneCheck.version}`, undefined, job.id, sourceServer.id);
            }

            // Step 3: Copy rclone config to source + Prepare destinations in parallel
            logService.info(`[Step 3/4] Setting up source and destinations...`, undefined, job.id, sourceServer.id);

            // Prepare source
            await rcloneService.copyConfigToServer(sourceServer.id);
            logService.info('[Step 3/4] Rclone config deployed to source server', undefined, job.id, sourceServer.id);

            // Prepare source files
            const items = await this.prepareSourceFiles(job, sourceServer.id);
            job.items = items;
            logService.info(`[Step 3/4] Prepared ${items.length} item(s) for transfer`, undefined, job.id, sourceServer.id);
            configService.saveJob(job);

            // Prepare all destination servers in parallel
            const destPrepPromises = job.destinationServerIds.map(destId =>
                this.prepareDestinationServer(job, destId)
            );
            await Promise.all(destPrepPromises);
            logService.info(`[Step 3/4] All ${job.destinationServerIds.length} destination(s) ready`, undefined, job.id);

            // Step 4: Run upload and download workers in parallel
            logService.info(`[Step 4/4] Starting parallel transfer pipeline...`, undefined, job.id);

            // Track completion
            let uploadComplete = false;

            // Upload worker: zip & upload, then add to download queue
            const uploadWorker = (async () => {
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    const jobState = this.activeJobs.get(job.id);
                    if (!jobState || jobState.isCancelled) {
                        logService.warn(`[Upload] Job cancelled`, undefined, job.id);
                        break;
                    }

                    while (jobState?.isPaused) {
                        await this.sleep(1000);
                    }

                    logService.info(`[Upload] Processing item ${i + 1}/${items.length}: ${item.fileName}`, undefined, job.id);
                    await this.processItem(job, item);

                    // Add to download queue after successful upload
                    // Note: File broadcasting is now handled inside processItem for streaming support
                    if (item.status === 'uploaded') {
                        const queue = this.downloadQueue.get(job.id) || [];
                        queue.push(item);
                        this.downloadQueue.set(job.id, queue);
                        logService.info(`[Queue] Item ready for download: ${item.fileName}`, undefined, job.id);
                    }
                }
                uploadComplete = true;
                logService.info(`[Upload] All uploads completed`, undefined, job.id);
            })();

            // Download worker: poll uploadedFiles and download each file to destinations immediately
            const downloadWorker = (async () => {
                const processedFiles = new Set<string>();

                // Wait a bit for first file to be uploaded
                await this.sleep(2000);

                while (true) {
                    const jobState = this.activeJobs.get(job.id);
                    if (!jobState || jobState.isCancelled) {
                        logService.warn(`[Download] Job cancelled`, undefined, job.id);
                        break;
                    }

                    // Check if we're done - uploadComplete and all files processed
                    const uploadedFiles = this.uploadedFiles.get(job.id) || [];
                    if (uploadComplete && processedFiles.size >= uploadedFiles.length && uploadedFiles.length > 0) {
                        break;
                    }

                    // Get files that haven't been processed yet
                    const pendingFiles = uploadedFiles.filter(f => !processedFiles.has(f.id));

                    if (pendingFiles.length === 0) {
                        // No files ready yet, wait
                        await this.sleep(500);
                        continue;
                    }

                    // Process each pending file to all destinations in parallel
                    for (const file of pendingFiles) {
                        logService.info(`[Download] Starting download for: ${file.fileName}`, undefined, job.id);

                        // Download this file to all destinations in parallel
                        const downloadPromises = job.destinationServerIds.map(destId =>
                            this.downloadFileToDestination(job, file, destId)
                        );
                        await Promise.all(downloadPromises);

                        processedFiles.add(file.id);
                        logService.info(`[Download] File completed: ${file.fileName}`, undefined, job.id);
                    }
                }

                // Step 4b: Bulk extract if this was a split job
                const zipInfo = (job as any)._zipInfo;
                if (job.autoExtract && zipInfo?.needsSplit) {
                    logService.info(`[Extract] Starting bulk extraction of ${zipInfo.actualParts} parts...`, undefined, job.id);

                    const extractPromises = job.destinationServerIds.map(async destId => {
                        const destServer = configService.getServerById(destId);
                        if (!destServer) return;

                        try {
                            logService.info(`[Extract] ${destServer.name}: Unzipping components...`, undefined, job.id, destId);
                            // Unzip all parts matching the pattern
                            await sshService.exec(destServer.id, `cd "${job.destinationFolder}" && unzip -o "${zipInfo.baseZipName}.part*.zip"`);
                            // Cleanup parts
                            await sshService.exec(destServer.id, `cd "${job.destinationFolder}" && rm "${zipInfo.baseZipName}.part*.zip"`);
                            logService.info(`[Extract] ${destServer.name}: Bulk extraction completed`, undefined, job.id, destId);
                        } catch (err) {
                            logService.error(`[Extract] ${destServer.name}: Failed bulk extraction`, err, job.id, destId);
                        }
                    });

                    await Promise.all(extractPromises);
                }

                // Mark main item as completed
                for (const item of items) {
                    item.status = 'completed';
                    item.completedAt = new Date().toISOString();
                    this.broadcastProgress(job.id, item.id, 100, 'completed');
                }

                logService.info(`[Download] All downloads completed`, undefined, job.id);
            })();

            // Wait for both workers to complete
            await Promise.all([uploadWorker, downloadWorker]);

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
            this.downloadQueue.delete(job.id);
            this.uploadedFiles.delete(job.id);
        }
    }

    /**
     * Prepare a destination server (connect, install rclone, copy config)
     */
    private async prepareDestinationServer(job: TransferJob, destServerId: string): Promise<void> {
        const destServer = configService.getServerById(destServerId);
        if (!destServer) {
            logService.error(`Destination server not found: ${destServerId}`, undefined, job.id);
            return;
        }

        try {
            logService.info(`[Dest] Connecting to destination: ${destServer.name}...`, undefined, job.id, destServerId);
            await sshService.connect(destServer);

            const rcloneCheck = await rcloneService.checkInstalled(destServer.id);
            if (!rcloneCheck.installed) {
                logService.info(`[Dest] Installing rclone on ${destServer.name}...`, undefined, job.id, destServerId);
                await rcloneService.install(destServer.id);
            }

            await rcloneService.copyConfigToServer(destServer.id);
            logService.info(`[Dest] ${destServer.name} ready`, undefined, job.id, destServerId);
        } catch (error) {
            logService.error(`[Dest] Failed to prepare ${destServer.name}`, error, job.id, destServerId);
            throw error;
        }
    }

    /**
     * Download a single uploaded file to a single destination
     * This handles individual part files immediately after upload
     */
    private async downloadFileToDestination(job: TransferJob, file: UploadedFileInfo, destServerId: string): Promise<void> {
        const destServer = configService.getServerById(destServerId);
        if (!destServer) return;

        const remoteName = 'gdrive';

        try {
            // Update file destination status to downloading
            this.broadcastFileDestinationProgress(job.id, file.id, destServerId, 'downloading', 0);

            const downloadPath = `/tmp/${file.fileName}`;

            logService.info(`[Download] ${destServer.name}: Downloading ${file.fileName}`, undefined, job.id, destServerId);

            await rcloneService.download(
                destServer.id,
                remoteName,
                file.drivePath,
                downloadPath,
                (percent) => {
                    this.broadcastFileDestinationProgress(job.id, file.id, destServerId, 'downloading', percent);
                }
            );

            // Extract if enabled
            // For split archives, we wait until all parts are downloaded
            const zipInfo = (job as any)._zipInfo;
            const isSplitPart = zipInfo?.needsSplit;

            if (job.autoExtract && !isSplitPart) {
                // Single file extraction - do it immediately
                this.broadcastFileDestinationProgress(job.id, file.id, destServerId, 'extracting', 100);
                logService.info(`[Extract] ${destServer.name}: Extracting ${file.fileName}`, undefined, job.id, destServerId);
                await sshService.exec(destServer.id, `unzip -o "${downloadPath}" -d "${job.destinationFolder}"`);
                await sshService.exec(destServer.id, `rm -f "${downloadPath}"`);
            } else {
                // Move to destination folder (either no extract, or deferred extract for splits)
                const destZipPath = `${job.destinationFolder}/${file.fileName}`;
                await sshService.exec(destServer.id, `mv "${downloadPath}" "${destZipPath}"`);
                logService.info(`[Download] ${destServer.name}: Saved to ${destZipPath}${isSplitPart && job.autoExtract ? ' (waiting for bulk extract)' : ''}`, undefined, job.id, destServerId);
            }

            // Delete from Drive if configured
            if (job.deleteFromDrive) {
                await rcloneService.delete(destServer.id, remoteName, file.drivePath);
            }

            // Mark destination as completed
            this.broadcastFileDestinationProgress(job.id, file.id, destServerId, 'completed', 100);
            logService.info(`[Download] ${destServer.name}: Completed ${file.fileName}`, undefined, job.id, destServerId);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            this.broadcastFileDestinationProgress(job.id, file.id, destServerId, 'failed', 0, errorMsg);
            logService.error(`[Download] ${destServer.name}: Failed ${file.fileName}`, error, job.id, destServerId);
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
     * This method only prepares metadata. Actual zipping happens in processItem.
     * For split archives, we create zip first then discover the split files.
     */
    private async prepareSourceFiles(job: TransferJob, connectionId: string): Promise<TransferItem[]> {
        const items: TransferItem[] = [];

        // Get folder size
        logService.info(`Calculating folder size: ${job.sourceFolder}`, undefined, job.id);
        const sizeResult = await sshService.exec(connectionId, `du -sb "${job.sourceFolder}" | cut -f1`);
        const totalBytes = parseInt(sizeResult.stdout, 10) || 0;
        const limitBytes = job.zipSizeLimitMB * 1024 * 1024;

        logService.info(`Folder size: ${this.formatBytes(totalBytes)}, Zip limit: ${this.formatBytes(limitBytes)}`, undefined, job.id);

        const timestamp = Date.now();
        const baseZipName = `transfer_${timestamp}`;
        const baseZipPath = `/tmp/${baseZipName}.zip`;

        // Store info for later use in processItem
        (job as any)._zipInfo = {
            needsSplit: totalBytes > limitBytes,
            limitMB: job.zipSizeLimitMB,
            baseZipName,
            baseZipPath,
            totalBytes,
        };

        if (totalBytes <= limitBytes) {
            // Single zip file - no splitting needed
            logService.info(`Will create single zip file: ${baseZipName}.zip`, undefined, job.id);

            const item: TransferItem = {
                id: this.generateId(),
                fileName: `${baseZipName}.zip`,
                sourcePath: baseZipPath,
                drivePath: `${job.driveFolder}/${baseZipName}.zip`,
                destinationPath: job.destinationFolder,
                status: 'pending',
                progress: 0,
                createdAt: new Date().toISOString(),
                retryCount: 0,
            };
            items.push(item);
        } else {
            // Need to split - estimate number of parts
            const estimatedParts = Math.ceil(totalBytes / limitBytes);
            logService.info(`Will create split zip (estimated ${estimatedParts} parts, max ${job.zipSizeLimitMB}MB each)`, undefined, job.id);

            // Create a placeholder item - actual split files will be discovered after zipping
            const item: TransferItem = {
                id: this.generateId(),
                fileName: `${baseZipName}.zip`,
                sourcePath: baseZipPath,
                drivePath: `${job.driveFolder}/${baseZipName}.zip`,
                destinationPath: job.destinationFolder,
                status: 'pending',
                progress: 0,
                createdAt: new Date().toISOString(),
                retryCount: 0,
            };
            items.push(item);
        }

        return items;
    }

    /**
     * Process a single transfer item with streaming zip+upload approach
     * For large folders: zip a batch of files → upload immediately → delete → repeat
     * This minimizes disk usage on the source server
     */
    private async processItem(job: TransferJob, item: TransferItem): Promise<void> {
        try {
            const sourceServer = configService.getServerById(job.sourceServerId);
            if (!sourceServer) return;

            const zipInfo = (job as any)._zipInfo;
            const needsSplit = zipInfo?.needsSplit || false;
            const limitMB = zipInfo?.limitMB || job.zipSizeLimitMB;
            const limitBytes = limitMB * 1024 * 1024;
            const remoteName = 'gdrive';

            // Update status: zipping
            item.status = 'zipping';
            this.broadcastProgress(job.id, item.id, 0, 'zipping');

            if (needsSplit) {
                // STREAMING APPROACH: Group files into batches, zip each batch, upload, delete
                logService.info(`[Zip] Streaming mode: creating parts as we go (max ${limitMB}MB per part)...`, undefined, job.id, sourceServer.id);

                // Get list of all files with their sizes
                const filesResult = await sshService.exec(
                    sourceServer.id,
                    `find "${job.sourceFolder}" -type f -exec stat --printf='%s %n\\n' {} \\; 2>/dev/null`
                );

                const files: Array<{ size: number; path: string; relativePath: string }> = [];
                const lines = filesResult.stdout.split('\n').filter(l => l.trim());

                for (const line of lines) {
                    const spaceIndex = line.indexOf(' ');
                    if (spaceIndex > 0) {
                        const size = parseInt(line.substring(0, spaceIndex), 10) || 0;
                        const fullPath = line.substring(spaceIndex + 1);
                        // Get relative path from source folder
                        const relativePath = fullPath.replace(job.sourceFolder, '').replace(/^\//, '');
                        files.push({ size, path: fullPath, relativePath });
                    }
                }

                logService.info(`[Zip] Found ${files.length} files to process`, undefined, job.id, sourceServer.id);

                // Group files into batches by size limit
                const batches: Array<Array<{ size: number; path: string; relativePath: string }>> = [];
                let currentBatch: typeof files = [];
                let currentBatchSize = 0;

                for (const file of files) {
                    // If single file exceeds limit, put it in its own batch
                    if (file.size > limitBytes) {
                        if (currentBatch.length > 0) {
                            batches.push(currentBatch);
                            currentBatch = [];
                            currentBatchSize = 0;
                        }
                        batches.push([file]);
                        continue;
                    }

                    // Check if adding this file would exceed limit
                    if (currentBatchSize + file.size > limitBytes && currentBatch.length > 0) {
                        batches.push(currentBatch);
                        currentBatch = [];
                        currentBatchSize = 0;
                    }

                    currentBatch.push(file);
                    currentBatchSize += file.size;
                }

                // Don't forget the last batch
                if (currentBatch.length > 0) {
                    batches.push(currentBatch);
                }

                logService.info(`[Zip] Split into ${batches.length} batch(es)`, undefined, job.id, sourceServer.id);

                // Store the number of parts for download phase
                (job as any)._zipInfo.actualParts = batches.length;

                // Process each batch: zip → upload → delete
                const baseName = zipInfo.baseZipName;
                for (let i = 0; i < batches.length; i++) {
                    const batch = batches[i];
                    const partNum = String(i + 1).padStart(3, '0');
                    const partFileName = batches.length === 1 ? `${baseName}.zip` : `${baseName}.part${partNum}.zip`;
                    const partPath = `/tmp/${partFileName}`;
                    const drivePath = `${job.driveFolder}/${partFileName}`;

                    logService.info(`[Zip] Creating part ${i + 1}/${batches.length}: ${batch.length} files...`, undefined, job.id, sourceServer.id);

                    // Create file list for this batch
                    const fileListPath = `/tmp/${baseName}_batch${partNum}.txt`;
                    const fileListContent = batch.map(f => f.relativePath).join('\n');
                    await sshService.exec(sourceServer.id, `cat > "${fileListPath}" << 'FILELIST'\n${fileListContent}\nFILELIST`);

                    // Zip this batch
                    await sshService.execWithProgress(
                        sourceServer.id,
                        `cd "${job.sourceFolder}" && zip -rv "${partPath}" -@ < "${fileListPath}" 2>&1`,
                        (data) => {
                            // Just log progress
                            const addingMatches = data.match(/adding:/gi);
                            if (addingMatches && addingMatches.length > 0) {
                                // Silent progress
                            }
                        }
                    );

                    // Clean up file list
                    await sshService.exec(sourceServer.id, `rm -f "${fileListPath}"`);

                    // Get zip file size
                    let zipSize = 0;
                    try {
                        const sizeResult = await sshService.exec(sourceServer.id, `stat -c%s "${partPath}"`);
                        zipSize = parseInt(sizeResult.stdout, 10) || 0;
                    } catch { /* ignore */ }

                    logService.info(`[Zip] Part ${i + 1}/${batches.length} created: ${partFileName} (${this.formatBytes(zipSize)})`, undefined, job.id, sourceServer.id);

                    // Upload this part immediately
                    item.status = 'uploading';
                    this.broadcastProgress(job.id, item.id, Math.round((i / batches.length) * 100), 'uploading');

                    let lastLoggedPercent = 0;
                    await rcloneService.upload(
                        sourceServer.id,
                        partPath,
                        remoteName,
                        drivePath,
                        (percent, speed) => {
                            const overallPercent = Math.round(((i + percent / 100) / batches.length) * 100);
                            item.progress = overallPercent;
                            item.speed = speed;
                            this.broadcastProgress(job.id, item.id, overallPercent, 'uploading');
                            if (percent >= lastLoggedPercent + 20) {
                                logService.info(`[Upload] Part ${i + 1}/${batches.length}: ${percent}% ${speed ? `(${speed})` : ''}`, undefined, job.id, sourceServer.id);
                                lastLoggedPercent = Math.floor(percent / 20) * 20;
                            }
                        }
                    );

                    logService.info(`[Upload] Part ${i + 1}/${batches.length} uploaded to Drive`, undefined, job.id, sourceServer.id);

                    // Broadcast this file as uploaded to queue
                    const fileInfo: UploadedFileInfo = {
                        id: `${item.id}_part${partNum}`,
                        fileName: partFileName,
                        drivePath: drivePath,
                        uploadedAt: new Date().toISOString(),
                        size: this.formatBytes(zipSize),
                        destinations: job.destinationServerIds.map(destId => {
                            const destServer = configService.getServerById(destId);
                            return {
                                serverId: destId,
                                serverName: destServer?.name || 'Unknown',
                                status: 'pending' as const,
                                progress: 0,
                            };
                        }),
                    };
                    this.broadcastFileUploaded(job.id, fileInfo);

                    // Delete the zip part from source if configured
                    if (job.deleteAfterUpload) {
                        await sshService.exec(sourceServer.id, `rm -f "${partPath}"`);
                        logService.info(`[Cleanup] Deleted part ${i + 1} from source`, undefined, job.id, sourceServer.id);
                    }
                }

                logService.info(`[Upload] All ${batches.length} parts uploaded successfully`, undefined, job.id, sourceServer.id);

            } else {
                // Single zip file (no splitting needed)
                logService.info(`[Zip] Creating single zip file: ${item.fileName}...`, undefined, job.id, sourceServer.id);

                let fileCount = 0;
                let lastLoggedCount = 0;

                await sshService.execWithProgress(
                    sourceServer.id,
                    `cd "${job.sourceFolder}" && zip -rv "${item.sourcePath}" . 2>&1`,
                    (data) => {
                        const addingMatches = data.match(/adding:/gi);
                        if (addingMatches) {
                            fileCount += addingMatches.length;
                            if (fileCount - lastLoggedCount >= 10) {
                                logService.info(`[Zip] Added ${fileCount} files...`, undefined, job.id, sourceServer.id);
                                lastLoggedCount = fileCount;
                            }
                        }
                    }
                );
                logService.info(`[Zip] Zip file created: ${item.sourcePath} (${fileCount} files)`, undefined, job.id, sourceServer.id);

                // Get zip file size
                let zipSize = 0;
                try {
                    const zipSizeResult = await sshService.exec(sourceServer.id, `stat -c%s "${item.sourcePath}"`);
                    zipSize = parseInt(zipSizeResult.stdout, 10) || 0;
                    logService.info(`[Zip] Zip file size: ${this.formatBytes(zipSize)}`, undefined, job.id, sourceServer.id);
                } catch { /* ignore */ }

                // Upload single file
                item.status = 'uploading';
                item.progress = 0;
                this.broadcastProgress(job.id, item.id, 0, 'uploading');
                logService.info(`[Upload] Uploading to Google Drive: ${item.drivePath}...`, undefined, job.id, sourceServer.id);

                let lastLoggedPercent = 0;
                await rcloneService.upload(
                    sourceServer.id,
                    item.sourcePath,
                    remoteName,
                    item.drivePath,
                    (percent, speed) => {
                        item.progress = percent;
                        item.speed = speed;
                        this.broadcastProgress(job.id, item.id, percent, 'uploading');
                        if (percent >= lastLoggedPercent + 10) {
                            logService.info(`[Upload] Progress: ${percent}% ${speed ? `(${speed})` : ''}`, undefined, job.id, sourceServer.id);
                            lastLoggedPercent = Math.floor(percent / 10) * 10;
                        }
                    }
                );

                // Broadcast uploaded file to queue
                const fileInfo: UploadedFileInfo = {
                    id: item.id,
                    fileName: item.fileName,
                    drivePath: item.drivePath,
                    uploadedAt: new Date().toISOString(),
                    size: this.formatBytes(zipSize),
                    destinations: job.destinationServerIds.map(destId => {
                        const destServer = configService.getServerById(destId);
                        return {
                            serverId: destId,
                            serverName: destServer?.name || 'Unknown',
                            status: 'pending' as const,
                            progress: 0,
                        };
                    }),
                };
                this.broadcastFileUploaded(job.id, fileInfo);

                // Delete source file if configured
                if (job.deleteAfterUpload) {
                    await sshService.exec(sourceServer.id, `rm -f "${item.sourcePath}"`);
                    logService.info(`[Cleanup] Deleted source zip: ${item.sourcePath}`, undefined, job.id, sourceServer.id);
                }
            }

            item.status = 'uploaded';
            item.progress = 100;
            this.broadcastProgress(job.id, item.id, 100, 'uploaded');
            logService.info(`[Upload] Upload completed: ${item.fileName}`, undefined, job.id, sourceServer.id);

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
     * Cancel a job - also kills running processes on servers
     */
    async cancelJob(jobId: string): Promise<void> {
        const jobState = this.activeJobs.get(jobId);
        if (jobState) {
            jobState.isCancelled = true;
            logService.info('Job cancelled - killing remote processes...', undefined, jobId);

            const job = jobState.job;

            // Kill zip and rclone processes on source server
            try {
                if (job.sourceServerId) {
                    // Kill any zip processes for this transfer
                    await sshService.exec(job.sourceServerId, `pkill -f "zip.*transfer_" 2>/dev/null || true`);
                    // Kill any rclone processes
                    await sshService.exec(job.sourceServerId, `pkill -f "rclone.*copyto" 2>/dev/null || true`);
                    logService.info('Killed processes on source server', undefined, jobId);
                }
            } catch (e) {
                // Ignore errors - process may already be dead
            }

            // Kill rclone processes on destination servers
            for (const destId of job.destinationServerIds || []) {
                try {
                    await sshService.exec(destId, `pkill -f "rclone.*copyto" 2>/dev/null || true`);
                    await sshService.exec(destId, `pkill -f "unzip" 2>/dev/null || true`);
                    logService.info(`Killed processes on destination server`, undefined, jobId, destId);
                } catch (e) {
                    // Ignore errors
                }
            }

            logService.info('Job cancelled successfully', undefined, jobId);
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
