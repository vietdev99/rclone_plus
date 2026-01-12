import { BrowserWindow } from 'electron';
import { LogEntry, LogLevel, IPC_CHANNELS } from '../../shared/types';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

class LoggerService {
    private logs: LogEntry[] = [];
    private logFile: string;
    private maxLogs = 1000;

    constructor() {
        const userDataPath = app?.getPath?.('userData') || '.';
        this.logFile = path.join(userDataPath, 'app.log');
    }

    private generateId(): string {
        return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private broadcast(entry: LogEntry): void {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(win => {
            win.webContents.send(IPC_CHANNELS.LOG_ENTRY, entry);
        });
    }

    private writeToFile(entry: LogEntry): void {
        const line = `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${entry.details ? ' ' + JSON.stringify(entry.details) : ''}\n`;
        try {
            fs.appendFileSync(this.logFile, line);
        } catch (error) {
            console.error('Failed to write log to file:', error);
        }
    }

    log(level: LogLevel, message: string, details?: unknown, jobId?: string, serverId?: string): void {
        const entry: LogEntry = {
            id: this.generateId(),
            timestamp: new Date().toISOString(),
            level,
            message,
            details,
            jobId,
            serverId,
        };

        this.logs.push(entry);

        // Keep only recent logs in memory
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }

        // Write to file
        this.writeToFile(entry);

        // Broadcast to renderer
        this.broadcast(entry);

        // Also log to console
        const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
        consoleMethod(`[${level.toUpperCase()}] ${message}`, details || '');
    }

    info(message: string, details?: unknown, jobId?: string, serverId?: string): void {
        this.log('info', message, details, jobId, serverId);
    }

    warn(message: string, details?: unknown, jobId?: string, serverId?: string): void {
        this.log('warn', message, details, jobId, serverId);
    }

    error(message: string, details?: unknown, jobId?: string, serverId?: string): void {
        this.log('error', message, details, jobId, serverId);
    }

    debug(message: string, details?: unknown, jobId?: string, serverId?: string): void {
        this.log('debug', message, details, jobId, serverId);
    }

    getAllLogs(): LogEntry[] {
        return this.logs;
    }

    getLogsByJob(jobId: string): LogEntry[] {
        return this.logs.filter(log => log.jobId === jobId);
    }

    getLogsByServer(serverId: string): LogEntry[] {
        return this.logs.filter(log => log.serverId === serverId);
    }

    clearLogs(): void {
        this.logs = [];
    }
}

export const logService = new LoggerService();
