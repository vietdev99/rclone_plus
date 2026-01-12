import React from 'react';
import { FileArchive, CheckCircle, XCircle, Loader2, Download, Clock } from 'lucide-react';
import { UploadedFileInfo, FileDestinationProgress } from '../../../shared/types';

interface FileProgressTableProps {
    files: UploadedFileInfo[];
}

const FileProgressTable: React.FC<FileProgressTableProps> = ({ files }) => {
    const getStatusIcon = (status: FileDestinationProgress['status']) => {
        switch (status) {
            case 'completed':
                return <CheckCircle size={14} className="status-icon completed" />;
            case 'failed':
                return <XCircle size={14} className="status-icon failed" />;
            case 'downloading':
                return <Download size={14} className="status-icon downloading" />;
            case 'extracting':
                return <Loader2 size={14} className="status-icon extracting spinning" />;
            case 'pending':
            default:
                return <Clock size={14} className="status-icon pending" />;
        }
    };

    const getStatusText = (dest: FileDestinationProgress) => {
        switch (dest.status) {
            case 'completed':
                return 'Done';
            case 'failed':
                return 'Failed';
            case 'downloading':
                return `${dest.progress}%`;
            case 'extracting':
                return 'Extracting...';
            case 'pending':
            default:
                return 'Waiting';
        }
    };

    const formatTime = (timestamp: string) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    };

    if (files.length === 0) {
        return (
            <div className="file-progress-empty">
                <FileArchive size={24} />
                <span>No files uploaded yet</span>
            </div>
        );
    }

    return (
        <div className="file-progress-table">
            <div className="file-progress-header">
                <div className="file-col file-name-col">File</div>
                <div className="file-col file-time-col">Time</div>
                <div className="file-col file-destinations-col">Destinations</div>
            </div>
            <div className="file-progress-body">
                {files.map(file => (
                    <div key={file.id} className="file-progress-row">
                        <div className="file-col file-name-col">
                            <FileArchive size={14} />
                            <span className="file-name" title={file.fileName}>
                                {file.fileName}
                            </span>
                        </div>
                        <div className="file-col file-time-col">
                            {formatTime(file.uploadedAt)}
                        </div>
                        <div className="file-col file-destinations-col">
                            {file.destinations.map(dest => (
                                <div
                                    key={dest.serverId}
                                    className={`dest-progress-chip ${dest.status}`}
                                    title={dest.error || dest.serverName}
                                >
                                    {getStatusIcon(dest.status)}
                                    <span className="dest-name">{dest.serverName}</span>
                                    <span className="dest-status">{getStatusText(dest)}</span>
                                    {dest.status === 'downloading' && (
                                        <div className="dest-progress-bar">
                                            <div
                                                className="dest-progress-fill"
                                                style={{ width: `${dest.progress}%` }}
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default FileProgressTable;
