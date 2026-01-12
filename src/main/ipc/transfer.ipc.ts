// Placeholder for Transfer IPC handlers
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/types';
import { transferService } from '../services/transfer.service';

// Start transfer job
ipcMain.handle(IPC_CHANNELS.TRANSFER_START, async (_event, job) => {
    return transferService.startJob(job);
});

// Pause transfer job
ipcMain.handle(IPC_CHANNELS.TRANSFER_PAUSE, async (_event, jobId) => {
    return transferService.pauseJob(jobId);
});

// Resume transfer job
ipcMain.handle(IPC_CHANNELS.TRANSFER_RESUME, async (_event, jobId) => {
    return transferService.resumeJob(jobId);
});

// Cancel transfer job
ipcMain.handle(IPC_CHANNELS.TRANSFER_CANCEL, async (_event, jobId) => {
    return transferService.cancelJob(jobId);
});

// Retry failed item
ipcMain.handle(IPC_CHANNELS.TRANSFER_RETRY, async (_event, { jobId, itemId }) => {
    return transferService.retryItem(jobId, itemId);
});
