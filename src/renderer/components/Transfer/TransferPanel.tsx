import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    Upload, Download, Play, Pause, Square, RotateCcw,
    Folder, HardDrive, Cloud, Trash2, Archive, ChevronDown,
    Plus, X, Server, Settings, FileText, CheckCircle, Loader2, Activity
} from 'lucide-react';
import { useServerStore, useTransferStore, useTabStore, useRcloneConfigStore, useLogStore, useUploadedFilesStore } from '../../stores';
import { TransferJob, UploadedFileInfo } from '../../../shared/types';
import ProgressBar from './ProgressBar';
import PathBrowserModal from '../PathBrowser/PathBrowserModal';
import RcloneConfigModal from '../RcloneConfig/RcloneConfigModal';
import ServerActivityPanel from './ServerActivityPanel';
import FileProgressTable from './FileProgressTable';
import './Transfer.css';

interface DestinationConfig {
    id: string;
    serverId: string;
    destinationFolder: string;
    rcloneConfigId: string; // Rclone config for this destination
}

interface TransferConfig {
    name: string;
    sourceServerId: string;
    sourceFolder: string;
    sourceRcloneConfigId: string; // Rclone config for source
    destinations: DestinationConfig[];
    driveFolder: string;
    driveRemoteName: string;
    zipSizeLimitMB: number;
    deleteAfterUpload: boolean;
    deleteFromDrive: boolean;
    autoExtract: boolean;
}

interface TransferPanelProps {
    tabId: string;
}

const generateId = () => `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const TransferPanel: React.FC<TransferPanelProps> = ({ tabId }) => {
    const servers = useServerStore(state => state.servers);
    const updateTab = useTabStore(state => state.updateTab);
    const tabs = useTabStore(state => state.tabs); // Needed to find current tab
    const getTabConfig = useTabStore(state => state.getTabConfig);
    const setTabConfig = useTabStore(state => state.setTabConfig);
    const createJob = useTransferStore(state => state.createJob);
    const jobs = useTransferStore(state => state.jobs); // Needed to find active job
    const startJob = useTransferStore(state => state.startJob);
    const pauseJob = useTransferStore(state => state.pauseJob);
    const resumeJob = useTransferStore(state => state.resumeJob);
    const cancelJob = useTransferStore(state => state.cancelJob);
    const retryItem = useTransferStore(state => state.retryItem);

    // Rclone configs
    const { configs: rcloneConfigs, loadConfigs: loadRcloneConfigs } = useRcloneConfigStore();

    // Logs
    const logs = useLogStore(state => state.logs);
    const clearLogs = useLogStore(state => state.clearLogs);

    // Uploaded files store
    const { addFile, updateFile, clearFilesForJob, getFilesForJob } = useUploadedFilesStore();

    // Auto-scroll ref for activity log
    const logsListRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);

    // Activity log tabs - 'general' or server ID
    const [activeLogTab, setActiveLogTab] = useState<string>('general');

    // Get config from store for this tab
    const storedConfig = getTabConfig(tabId);
    const [config, setConfig] = useState<TransferConfig>(storedConfig);

    // Sync config changes back to store and update tab name
    useEffect(() => {
        setTabConfig(tabId, config);
        // Update tab name when job name changes
        if (config.name) {
            updateTab(tabId, { name: config.name });
        }
    }, [config, tabId, setTabConfig, updateTab]);

    // Load config when tab changes
    useEffect(() => {
        const tabConfig = getTabConfig(tabId);
        setConfig(tabConfig);
    }, [tabId, getTabConfig]);

    // Load rclone configs on mount
    useEffect(() => {
        loadRcloneConfigs();
    }, [loadRcloneConfigs]);

    // Listen for file uploaded and progress events
    useEffect(() => {
        const unsubUploaded = window.electron.transfer.onFileUploaded((data) => {
            addFile(data.jobId, data.file as UploadedFileInfo);
        });

        const unsubProgress = window.electron.transfer.onFileProgress((data) => {
            updateFile(data.jobId, data.file as UploadedFileInfo);
        });

        return () => {
            unsubUploaded();
            unsubProgress();
        };
    }, [addFile, updateFile]);

    // Helper to get selected rclone config
    const getSelectedRcloneConfig = (configId: string) => {
        return rcloneConfigs.find(c => c.id === configId);
    };

    // Filter logs for transfer activity
    const filteredLogs = logs.filter(log =>
        log.message.includes('[Step') ||
        log.message.includes('[Zip') ||
        log.message.includes('[Upload') ||
        log.message.includes('[Download') ||
        log.message.includes('[Dest') ||
        log.message.includes('[Extract') ||
        log.message.includes('[Cleanup') ||
        log.message.includes('[Complete') ||
        log.message.includes('[Error') ||
        log.message.includes('===')
    ).slice(-50);

    // Auto-scroll logs when new logs arrive
    useEffect(() => {
        if (autoScroll && logsListRef.current) {
            logsListRef.current.scrollTop = logsListRef.current.scrollHeight;
        }
    }, [filteredLogs, autoScroll]);

    const [isExpanded, setIsExpanded] = useState(true);
    const [activeJob, setActiveJob] = useState<TransferJob | null>(null);
    const [jobRunning, setJobRunning] = useState(false); // Track running state explicitly

    // Handle scroll to detect user scroll
    const handleLogsScroll = useCallback(() => {
        if (logsListRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = logsListRef.current;
            // If user scrolled to bottom (within 20px), enable auto-scroll
            const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
            setAutoScroll(isAtBottom);
        }
    }, []);

    // Calculate overall progress based on steps
    const calculateOverallProgress = useCallback(() => {
        if (!activeJob) return 0;

        // Check logs for step completion
        const completedSteps = new Set<number>();
        filteredLogs.forEach(log => {
            const stepMatch = log.message.match(/\[Step (\d+)\/6\]/);
            if (stepMatch) {
                completedSteps.add(parseInt(stepMatch[1], 10));
            }
        });

        // Check for job completion
        const isCompleted = filteredLogs.some(log => log.message.includes('=== Transfer job completed'));
        if (isCompleted) return 100;

        // Each step is ~16.67%
        return Math.min(completedSteps.size * 16.67, 99);
    }, [activeJob, filteredLogs]);

    // Check if job is finished (based on logs)
    const isJobFinished = useCallback(() => {
        return filteredLogs.some(log => log.message.includes('=== Transfer job completed'));
    }, [filteredLogs]);

    // Update jobRunning when job finishes or fails
    useEffect(() => {
        if (filteredLogs.some(log =>
            log.message.includes('=== Transfer job completed') ||
            log.message.includes('Transfer job failed')
        )) {
            setJobRunning(false);
        }
    }, [filteredLogs]);

    // Check if job is running - use explicit state
    const isJobRunning = useCallback(() => {
        return jobRunning;
    }, [jobRunning]);

    // Sync activeJob from store if tab has a jobId
    const currentTab = tabs.find(t => t.id === tabId);
    useEffect(() => {
        if (currentTab?.jobId) {
            const job = jobs.find(j => j.id === currentTab.jobId);
            if (job) {
                setActiveJob(job);
            }
        }
    }, [currentTab?.jobId, jobs]);

    // Modal states
    const [showPathBrowser, setShowPathBrowser] = useState(false);
    const [pathBrowserTarget, setPathBrowserTarget] = useState<{ type: 'source' | 'destination'; destId?: string } | null>(null);
    const [showRcloneConfig, setShowRcloneConfig] = useState(false);

    const sourceServer = servers.find(s => s.id === config.sourceServerId);
    const availableDestServers = servers.filter(s => s.id !== config.sourceServerId);

    const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        setConfig(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked :
                type === 'number' ? parseInt(value) || 0 : value,
        }));
    };

    const handleAddDestination = () => {
        if (availableDestServers.length === 0) return;

        // Use first available server or reuse existing ones
        const firstServer = availableDestServers[0];

        setConfig(prev => ({
            ...prev,
            destinations: [
                ...prev.destinations,
                {
                    id: generateId(),
                    serverId: firstServer.id,
                    destinationFolder: '/home',
                    rcloneConfigId: rcloneConfigs[0]?.id || '',
                }
            ]
        }));
    };

    const handleRemoveDestination = (destId: string) => {
        setConfig(prev => ({
            ...prev,
            destinations: prev.destinations.filter(d => d.id !== destId)
        }));
    };

    const handleDestinationChange = (destId: string, field: keyof DestinationConfig, value: string) => {
        setConfig(prev => ({
            ...prev,
            destinations: prev.destinations.map(d =>
                d.id === destId ? { ...d, [field]: value } : d
            )
        }));
    };

    const handleStart = async () => {
        // Clear previous logs and reset state before starting new transfer
        clearLogs();
        setAutoScroll(true);
        setJobRunning(true); // Mark job as running

        // Clear previous uploaded files if there was an active job
        if (activeJob) {
            clearFilesForJob(activeJob.id);
        }

        const job: TransferJob = {
            id: `job_${generateId()}`,
            name: config.name,
            sourceServerId: config.sourceServerId,
            destinationServerIds: config.destinations.map(d => d.serverId),
            sourceFolder: config.sourceFolder,
            destinationFolder: config.destinations[0]?.destinationFolder || '',
            driveFolder: config.driveFolder,
            zipSizeLimitMB: config.zipSizeLimitMB,
            deleteAfterUpload: config.deleteAfterUpload,
            deleteFromDrive: config.deleteFromDrive,
            autoExtract: config.autoExtract,
            status: 'running',
            items: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        await createJob(job);
        setActiveJob(job);
        updateTab(tabId, { name: config.name || 'Transfer', jobId: job.id });
        await startJob(job);
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'var(--success)';
            case 'failed': return 'var(--error)';
            case 'uploading':
            case 'downloading': return 'var(--accent-primary)';
            case 'zipping':
            case 'extracting': return 'var(--warning)';
            default: return 'var(--text-muted)';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'pending': return 'Pending';
            case 'zipping': return 'Zipping...';
            case 'uploading': return 'Uploading';
            case 'uploaded': return 'Uploaded';
            case 'downloading': return 'Downloading';
            case 'extracting': return 'Extracting...';
            case 'completed': return 'Completed';
            case 'failed': return 'Failed';
            default: return status;
        }
    };

    const canStart = config.sourceServerId && config.sourceFolder && config.destinations.length > 0;

    return (
        <>
            <div className="transfer-panel">
                {/* Configuration Section */}
                <div className={`config-section glass ${isExpanded ? 'expanded' : 'collapsed'}`}>
                    <div
                        className="config-header"
                        onClick={() => setIsExpanded(!isExpanded)}
                    >
                        <h3>
                            <HardDrive size={20} />
                            Transfer Configuration
                        </h3>
                        <ChevronDown
                            size={20}
                            className={`chevron ${isExpanded ? 'expanded' : ''}`}
                        />
                    </div>

                    {isExpanded && (
                        <div className="config-body">
                            {/* Job Name */}
                            <div className="config-row">
                                <div className="config-field full-width">
                                    <label>Job Name</label>
                                    <input
                                        type="text"
                                        name="name"
                                        value={config.name}
                                        onChange={handleConfigChange}
                                        placeholder="My Transfer Job"
                                    />
                                </div>
                            </div>

                            {/* Three Panel Layout - Source | Queue | Destinations */}
                            <div className="transfer-panels has-queue">
                                {/* Left Panel: Source */}
                                <div className="transfer-panel-source">
                                    <div className="panel-title">
                                        <Upload size={16} />
                                        Source Server
                                    </div>

                                    <div className="config-field">
                                        <label>Server</label>
                                        <select
                                            name="sourceServerId"
                                            value={config.sourceServerId}
                                            onChange={handleConfigChange}
                                        >
                                            <option value="">Select server...</option>
                                            {servers.map(server => (
                                                <option key={server.id} value={server.id}>
                                                    {server.name} ({server.host})
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="config-field">
                                        <label>Source Folder</label>
                                        <div className="path-input">
                                            <input
                                                type="text"
                                                name="sourceFolder"
                                                value={config.sourceFolder}
                                                onChange={handleConfigChange}
                                                placeholder="/path/to/source"
                                            />
                                            <button
                                                className="btn-icon"
                                                title="Browse"
                                                onClick={() => {
                                                    if (config.sourceServerId) {
                                                        setPathBrowserTarget({ type: 'source' });
                                                        setShowPathBrowser(true);
                                                    }
                                                }}
                                                disabled={!config.sourceServerId}
                                            >
                                                <Folder size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Rclone Config */}
                                    <div className="rclone-config">
                                        <div className="config-subsection">
                                            <Cloud size={14} />
                                            <span>Rclone Config</span>
                                            <button
                                                className="btn-icon-mini"
                                                title="Manage Rclone Configs"
                                                onClick={() => setShowRcloneConfig(true)}
                                            >
                                                <Settings size={12} />
                                            </button>
                                        </div>

                                        <div className="config-field">
                                            <label>
                                                <Cloud size={14} />
                                                Drive Config
                                            </label>
                                            <select
                                                name="sourceRcloneConfigId"
                                                value={config.sourceRcloneConfigId}
                                                onChange={handleConfigChange}
                                            >
                                                <option value="">Select config...</option>
                                                {rcloneConfigs.map(rc => (
                                                    <option key={rc.id} value={rc.id}>
                                                        {rc.name} ({rc.remoteName}:{rc.driveFolder})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {config.sourceRcloneConfigId && (
                                            <div className="selected-config-info">
                                                {(() => {
                                                    const selectedConfig = getSelectedRcloneConfig(config.sourceRcloneConfigId);
                                                    return selectedConfig ? (
                                                        <span className="config-path">
                                                            {selectedConfig.remoteName}:{selectedConfig.driveFolder}
                                                        </span>
                                                    ) : null;
                                                })()}
                                            </div>
                                        )}

                                        <div className="config-field">
                                            <label>
                                                <Archive size={14} />
                                                Max Zip Size (MB)
                                            </label>
                                            <input
                                                type="number"
                                                name="zipSizeLimitMB"
                                                value={config.zipSizeLimitMB}
                                                onChange={handleConfigChange}
                                                min={100}
                                                max={10240}
                                            />
                                        </div>
                                    </div>

                                    {/* Options */}
                                    <div className="transfer-options">
                                        <label className="checkbox-label">
                                            <input
                                                type="checkbox"
                                                name="deleteAfterUpload"
                                                checked={config.deleteAfterUpload}
                                                onChange={handleConfigChange}
                                            />
                                            <Trash2 size={14} />
                                            Delete zip file after upload
                                        </label>

                                        <label className="checkbox-label">
                                            <input
                                                type="checkbox"
                                                name="deleteFromDrive"
                                                checked={config.deleteFromDrive}
                                                onChange={handleConfigChange}
                                            />
                                            <Cloud size={14} />
                                            Delete from Drive after all destination download
                                        </label>
                                    </div>
                                </div>

                                {/* Middle Panel: Queue (Always visible) */}
                                <div className="transfer-panel-queue glass">
                                    <div className="panel-title">
                                        <Folder size={16} />
                                        Transfer Queue
                                        {activeJob && (
                                            <span className="overall-progress">
                                                {Math.round(calculateOverallProgress())}%
                                            </span>
                                        )}
                                    </div>

                                    {activeJob ? (
                                        <>
                                            {/* Overall Progress Bar */}
                                            <div className="overall-progress-bar">
                                                <div
                                                    className={`overall-progress-fill ${isJobFinished() ? 'completed' : 'running'}`}
                                                    style={{ width: `${calculateOverallProgress()}%` }}
                                                />
                                            </div>

                                            {/* Queue Actions - only show if job is running */}
                                            {isJobRunning() && (
                                                <div className="queue-actions-compact">
                                                    <button
                                                        className="btn-icon-small"
                                                        onClick={() => pauseJob(activeJob.id)}
                                                        title="Pause"
                                                    >
                                                        <Pause size={14} />
                                                    </button>
                                                    <button
                                                        className="btn-icon-small danger"
                                                        onClick={() => {
                                                            cancelJob(activeJob.id);
                                                            setActiveJob(null);
                                                            setJobRunning(false);
                                                        }}
                                                        title="Cancel"
                                                    >
                                                        <Square size={14} />
                                                    </button>
                                                </div>
                                            )}

                                            {/* Split Layout: Files on top, Activity logs on bottom */}
                                            <div className="queue-content-split">
                                                {/* TOP: Files Section */}
                                                <div className="queue-files-section">
                                                    {isJobFinished() ? (
                                                        <div className="queue-finished">
                                                            <CheckCircle size={20} />
                                                            <span>Transfer completed successfully!</span>
                                                        </div>
                                                    ) : activeJob.items.length === 0 && getFilesForJob(activeJob.id).length === 0 ? (
                                                        <div className="queue-preparing">
                                                            <Loader2 size={16} className="animate-spin" />
                                                            <span>Preparing files...</span>
                                                        </div>
                                                    ) : (
                                                        /* Uploaded Files Progress Table */
                                                        <div className="uploaded-files-section">
                                                            <div className="uploaded-files-header">
                                                                <Cloud size={14} />
                                                                <span>Files on Drive</span>
                                                                <span className="file-count">{getFilesForJob(activeJob.id).length} file(s)</span>
                                                            </div>
                                                            <FileProgressTable files={getFilesForJob(activeJob.id)} />
                                                        </div>
                                                    )}
                                                </div>

                                                {/* BOTTOM: Activity Log Section */}
                                                <div className="queue-logs">
                                                    <div className="activity-tabs-header">
                                                        <Activity size={14} />
                                                        <span>Activity Log</span>
                                                    </div>

                                                    {/* Tab Buttons */}
                                                    <div className="activity-tabs">
                                                        <button
                                                            className={`activity-tab ${activeLogTab === 'general' ? 'active' : ''}`}
                                                            onClick={() => setActiveLogTab('general')}
                                                        >
                                                            <FileText size={12} />
                                                            General
                                                        </button>
                                                        {config.sourceServerId && sourceServer && (
                                                            <button
                                                                className={`activity-tab source ${activeLogTab === config.sourceServerId ? 'active' : ''}`}
                                                                onClick={() => setActiveLogTab(config.sourceServerId)}
                                                            >
                                                                <Upload size={12} />
                                                                {sourceServer.name}
                                                            </button>
                                                        )}
                                                        {config.destinations.map((dest, idx) => {
                                                            const destServer = servers.find(s => s.id === dest.serverId);
                                                            if (!destServer) return null;
                                                            return (
                                                                <button
                                                                    key={`dest-${dest.id}-${dest.serverId}`}
                                                                    className={`activity-tab destination ${activeLogTab === dest.serverId ? 'active' : ''}`}
                                                                    onClick={() => setActiveLogTab(dest.serverId)}
                                                                >
                                                                    <Download size={12} />
                                                                    {destServer.name}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>

                                                    {/* Tab Content */}
                                                    <div className="activity-tab-content">
                                                        {activeLogTab === 'general' ? (
                                                            <div className="general-logs-list">
                                                                {filteredLogs.filter(log => !log.serverId).length === 0 ? (
                                                                    <div className="no-logs">Waiting for activity...</div>
                                                                ) : (
                                                                    filteredLogs.filter(log => !log.serverId).map((log, idx) => (
                                                                        <div key={log.id || idx} className="general-log-entry">
                                                                            <span className="log-time">
                                                                                {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                                                                            </span>
                                                                            <span className="log-msg">{log.message}</span>
                                                                        </div>
                                                                    ))
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <ServerActivityPanel
                                                                serverId={activeLogTab}
                                                                serverName={
                                                                    activeLogTab === config.sourceServerId
                                                                        ? sourceServer?.name || 'Source'
                                                                        : servers.find(s => s.id === activeLogTab)?.name || 'Destination'
                                                                }
                                                                type={activeLogTab === config.sourceServerId ? 'source' : 'destination'}
                                                                jobId={activeJob?.id}
                                                                isActive={isJobRunning()}
                                                            />
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="queue-empty-state">
                                            <Cloud size={40} />
                                            <p>No active transfer</p>
                                            <span>Configure source and destinations, then click "Start Transfer"</span>
                                        </div>
                                    )}
                                </div>

                                {/* Right Panel: Destinations */}
                                <div className="transfer-panel-destinations">
                                    <div className="panel-title">
                                        <Download size={16} />
                                        Destination Servers
                                        <button
                                            className="btn-add-dest"
                                            onClick={handleAddDestination}
                                            disabled={availableDestServers.length === 0}
                                        >
                                            <Plus size={14} />
                                            Add
                                        </button>
                                    </div>

                                    {config.destinations.length === 0 ? (
                                        <div className="no-destinations">
                                            <Server size={32} />
                                            <p>No destinations added</p>
                                            <button
                                                className="btn btn-secondary"
                                                onClick={handleAddDestination}
                                                disabled={!config.sourceServerId}
                                            >
                                                <Plus size={16} />
                                                Add Destination
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="destination-blocks">
                                            {config.destinations.map((dest, idx) => {
                                                const destServer = servers.find(s => s.id === dest.serverId);
                                                return (
                                                    <div key={dest.id} className="destination-block">
                                                        <div className="dest-block-header">
                                                            <span className="dest-number">#{idx + 1}</span>
                                                            <button
                                                                className="btn-remove-dest"
                                                                onClick={() => handleRemoveDestination(dest.id)}
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        </div>

                                                        <div className="config-field">
                                                            <label>Server</label>
                                                            <select
                                                                value={dest.serverId}
                                                                onChange={(e) => handleDestinationChange(dest.id, 'serverId', e.target.value)}
                                                            >
                                                                {availableDestServers.map(server => (
                                                                    <option key={server.id} value={server.id}>
                                                                        {server.name} ({server.host})
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </div>

                                                        <div className="config-field">
                                                            <label>Destination Folder</label>
                                                            <div className="path-input">
                                                                <input
                                                                    type="text"
                                                                    value={dest.destinationFolder}
                                                                    onChange={(e) => handleDestinationChange(dest.id, 'destinationFolder', e.target.value)}
                                                                    placeholder="/path/to/destination"
                                                                />
                                                                <button
                                                                    className="btn-icon"
                                                                    title="Browse"
                                                                    onClick={() => {
                                                                        setPathBrowserTarget({ type: 'destination', destId: dest.id });
                                                                        setShowPathBrowser(true);
                                                                    }}
                                                                >
                                                                    <Folder size={16} />
                                                                </button>
                                                            </div>
                                                        </div>

                                                        <div className="config-field">
                                                            <label>
                                                                <Cloud size={14} />
                                                                Rclone Config
                                                            </label>
                                                            <select
                                                                value={dest.rcloneConfigId}
                                                                onChange={(e) => handleDestinationChange(dest.id, 'rcloneConfigId', e.target.value)}
                                                            >
                                                                <option value="">Select config...</option>
                                                                {rcloneConfigs.map(rc => (
                                                                    <option key={rc.id} value={rc.id}>
                                                                        {rc.name}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </div>

                                                        <label className="checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={config.autoExtract}
                                                                onChange={handleConfigChange}
                                                                name="autoExtract"
                                                            />
                                                            <Archive size={14} />
                                                            Auto-extract on this server
                                                        </label>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Start/Stop Button */}
                            <div className="config-actions">
                                {isJobRunning() ? (
                                    <button
                                        className="btn btn-danger btn-lg"
                                        onClick={() => {
                                            if (activeJob) {
                                                cancelJob(activeJob.id);
                                                setActiveJob(null);
                                                setJobRunning(false);
                                            }
                                        }}
                                    >
                                        <Square size={18} />
                                        Stop Transfer
                                    </button>
                                ) : (
                                    <button
                                        className="btn btn-primary btn-lg"
                                        onClick={handleStart}
                                        disabled={!canStart}
                                    >
                                        <Play size={18} />
                                        Start Transfer
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>

            </div>

            {/* Path Browser Modal */}
            {
                showPathBrowser && pathBrowserTarget && (
                    <PathBrowserModal
                        isOpen={showPathBrowser}
                        onClose={() => {
                            setShowPathBrowser(false);
                            setPathBrowserTarget(null);
                        }}
                        onSelect={(path) => {
                            if (pathBrowserTarget.type === 'source') {
                                setConfig(prev => ({ ...prev, sourceFolder: path }));
                            } else if (pathBrowserTarget.destId) {
                                handleDestinationChange(pathBrowserTarget.destId, 'destinationFolder', path);
                            }
                        }}
                        serverId={
                            pathBrowserTarget.type === 'source'
                                ? config.sourceServerId
                                : config.destinations.find(d => d.id === pathBrowserTarget.destId)?.serverId || ''
                        }
                        serverName={
                            pathBrowserTarget.type === 'source'
                                ? sourceServer?.name || 'Server'
                                : servers.find(s => s.id === config.destinations.find(d => d.id === pathBrowserTarget.destId)?.serverId)?.name || 'Server'
                        }
                        initialPath={
                            pathBrowserTarget.type === 'source'
                                ? config.sourceFolder || '/home'
                                : config.destinations.find(d => d.id === pathBrowserTarget.destId)?.destinationFolder || '/home'
                        }
                    />
                )
            }

            {/* Rclone Config Modal */}
            <RcloneConfigModal
                isOpen={showRcloneConfig}
                onClose={() => setShowRcloneConfig(false)}
                serverId={config.sourceServerId || undefined}
                serverName={sourceServer?.name}
            />
        </>
    );
};

export default TransferPanel;
