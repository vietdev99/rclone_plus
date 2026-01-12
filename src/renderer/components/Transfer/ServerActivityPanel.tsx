import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Server, Upload, Download, CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { useLogStore, useServerStore } from '../../stores';

interface ServerActivityPanelProps {
    serverId: string;
    serverName: string;
    type: 'source' | 'destination';
    jobId?: string;
    isActive?: boolean;
}

const ServerActivityPanel: React.FC<ServerActivityPanelProps> = ({
    serverId,
    serverName,
    type,
    jobId,
    isActive = false,
}) => {
    const logs = useLogStore(state => state.logs);
    const connectionStatus = useServerStore(state => state.connectionStatus);
    const [isExpanded, setIsExpanded] = useState(true);
    const [autoScroll, setAutoScroll] = useState(true);
    const logsRef = useRef<HTMLDivElement>(null);

    // Filter logs for this server and job
    const filteredLogs = logs.filter(log => {
        if (jobId && log.jobId !== jobId) return false;
        return log.serverId === serverId;
    });

    // Get status from logs
    const getStatus = useCallback(() => {
        if (filteredLogs.length === 0) return 'idle';

        const lastLog = filteredLogs[filteredLogs.length - 1];
        if (lastLog.message.includes('Completed') || lastLog.message.includes('completed')) {
            return 'completed';
        }
        if (lastLog.message.includes('Failed') || lastLog.message.includes('failed') || lastLog.message.includes('Error')) {
            return 'error';
        }
        if (lastLog.message.includes('Connecting') || lastLog.message.includes('Installing') ||
            lastLog.message.includes('Deploying') || lastLog.message.includes('ready')) {
            return 'preparing';
        }
        if (lastLog.message.includes('[Zip]') || lastLog.message.includes('[Upload]')) {
            return 'uploading';
        }
        if (lastLog.message.includes('[Download]') || lastLog.message.includes('[Extract]')) {
            return 'downloading';
        }
        return 'running';
    }, [filteredLogs]);

    const status = getStatus();
    const isConnected = connectionStatus[serverId]?.connected;

    // Auto-scroll
    useEffect(() => {
        if (autoScroll && logsRef.current) {
            logsRef.current.scrollTop = logsRef.current.scrollHeight;
        }
    }, [filteredLogs, autoScroll]);

    const handleScroll = useCallback(() => {
        if (logsRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = logsRef.current;
            const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
            setAutoScroll(isAtBottom);
        }
    }, []);

    const getStatusIcon = () => {
        switch (status) {
            case 'completed':
                return <CheckCircle size={16} className="status-icon success" />;
            case 'error':
                return <XCircle size={16} className="status-icon error" />;
            case 'uploading':
                return <Upload size={16} className="status-icon uploading" />;
            case 'downloading':
                return <Download size={16} className="status-icon downloading" />;
            case 'preparing':
            case 'running':
                return <Loader2 size={16} className="status-icon spinning" />;
            default:
                return <Server size={16} className="status-icon idle" />;
        }
    };

    const getStatusText = () => {
        switch (status) {
            case 'completed': return 'Completed';
            case 'error': return 'Error';
            case 'uploading': return 'Uploading...';
            case 'downloading': return 'Downloading...';
            case 'preparing': return 'Preparing...';
            case 'running': return 'Running...';
            default: return 'Idle';
        }
    };

    const formatTime = (timestamp: string) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', { hour12: false });
    };

    return (
        <div className={`server-activity-panel ${type} ${isActive ? 'active' : ''} ${status}`}>
            <div
                className="server-activity-header"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="server-info">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {type === 'source' ? <Upload size={14} /> : <Download size={14} />}
                    <span className="server-name">{serverName}</span>
                    <span className={`server-type-badge ${type}`}>
                        {type === 'source' ? 'SOURCE' : 'DEST'}
                    </span>
                </div>
                <div className="server-status">
                    {getStatusIcon()}
                    <span className="status-text">{getStatusText()}</span>
                </div>
            </div>

            {isExpanded && (
                <div
                    className="server-activity-logs"
                    ref={logsRef}
                    onScroll={handleScroll}
                >
                    {filteredLogs.length === 0 ? (
                        <div className="no-logs">Waiting for activity...</div>
                    ) : (
                        filteredLogs.map(log => (
                            <div key={log.id} className={`log-entry ${log.level}`}>
                                <span className="log-time">{formatTime(log.timestamp)}</span>
                                <span className="log-message">{log.message}</span>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

export default ServerActivityPanel;
