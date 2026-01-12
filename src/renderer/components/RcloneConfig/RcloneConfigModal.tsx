import { useState, useEffect } from 'react';
import { X, Cloud, Check, AlertCircle, Loader2, Download, RefreshCw, Copy, Plus, Trash2, Edit2 } from 'lucide-react';
import { useRcloneConfigStore } from '../../stores';
import { RcloneConfig } from '../../../shared/types';
import './RcloneConfig.css';

interface RcloneConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    serverId?: string;
    serverName?: string;
}

interface RemoteConfig {
    name: string;
    type: string;
}

const RcloneConfigModal: React.FC<RcloneConfigModalProps> = ({
    isOpen,
    onClose,
    serverId,
    serverName,
}) => {
    const { configs, loadConfigs, addConfig, updateConfig, deleteConfig } = useRcloneConfigStore();
    const [localRemotes, setLocalRemotes] = useState<RemoteConfig[]>([]);
    const [isLoadingRemotes, setIsLoadingRemotes] = useState(false);
    const [isStartingOAuth, setIsStartingOAuth] = useState(false);
    const [oauthStatus, setOauthStatus] = useState<{ success?: boolean; message?: string } | null>(null);
    const [isInstallingRclone, setIsInstallingRclone] = useState(false);
    const [isInstallingLocal, setIsInstallingLocal] = useState(false);
    const [isCopyingConfig, setIsCopyingConfig] = useState(false);
    const [serverRcloneStatus, setServerRcloneStatus] = useState<{
        installed: boolean;
        hasConfig: boolean;
        remotes: RemoteConfig[];
    } | null>(null);

    const [newRemoteName, setNewRemoteName] = useState('gdrive');
    const [driveFolderPath, setDriveFolderPath] = useState('rclone-transfer');

    // New config form state
    const [isAddingConfig, setIsAddingConfig] = useState(false);
    const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
    const [configForm, setConfigForm] = useState({
        name: '',
        remoteName: '',
        driveFolder: 'rclone-transfer',
    });

    useEffect(() => {
        if (isOpen) {
            loadLocalRemotes();
            loadConfigs();
            if (serverId) {
                checkServerStatus();
            }
        }
    }, [isOpen, serverId]);

    const resetConfigForm = () => {
        setConfigForm({ name: '', remoteName: '', driveFolder: 'rclone-transfer' });
        setIsAddingConfig(false);
        setEditingConfigId(null);
    };

    const handleSaveConfig = async () => {
        if (!configForm.name || !configForm.remoteName) return;

        const newConfig: RcloneConfig = {
            id: editingConfigId || crypto.randomUUID(),
            name: configForm.name,
            remoteName: configForm.remoteName,
            remoteType: 'drive',
            driveFolder: configForm.driveFolder,
            isConfigured: localRemotes.some(r => r.name === configForm.remoteName),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        if (editingConfigId) {
            await updateConfig(newConfig);
        } else {
            await addConfig(newConfig);
        }
        resetConfigForm();
    };

    const handleEditConfig = (config: RcloneConfig) => {
        setConfigForm({
            name: config.name,
            remoteName: config.remoteName,
            driveFolder: config.driveFolder,
        });
        setEditingConfigId(config.id);
        setIsAddingConfig(true);
    };

    const handleDeleteConfig = async (id: string) => {
        if (confirm('Are you sure you want to delete this config?')) {
            await deleteConfig(id);
        }
    };

    const loadLocalRemotes = async () => {
        setIsLoadingRemotes(true);
        try {
            const remotes = await window.electron.rclone.listRemotes();
            setLocalRemotes(remotes);
        } catch (error) {
            console.error('Failed to load remotes:', error);
        } finally {
            setIsLoadingRemotes(false);
        }
    };

    const checkServerStatus = async () => {
        if (!serverId) return;

        try {
            const [installCheck, configCheck] = await Promise.all([
                window.electron.rclone.check(serverId),
                window.electron.rclone.checkServerConfig(serverId),
            ]);

            setServerRcloneStatus({
                installed: installCheck.installed,
                hasConfig: configCheck.hasConfig,
                remotes: configCheck.remotes || [],
            });
        } catch (error) {
            console.error('Failed to check server status:', error);
        }
    };

    const handleStartOAuth = async () => {
        setIsStartingOAuth(true);
        setOauthStatus(null);
        try {
            const result = await window.electron.rclone.startOAuth(newRemoteName);
            if (result.success && result.token) {
                // Configure the new remote with the token
                await window.electron.rclone.configure({
                    name: newRemoteName,
                    token: result.token,
                });
                setOauthStatus({ success: true, message: 'Google Drive authorized successfully!' });
                loadLocalRemotes();
            } else {
                setOauthStatus({ success: false, message: result.error || 'OAuth failed' });
            }
        } catch (error) {
            setOauthStatus({ success: false, message: 'OAuth process failed. Please try again.' });
        } finally {
            setIsStartingOAuth(false);
        }
    };

    const handleInstallRclone = async () => {
        if (!serverId) return;

        setIsInstallingRclone(true);
        try {
            const result = await window.electron.rclone.install(serverId);
            if (result.success) {
                await checkServerStatus();
            } else {
                alert(`Failed to install rclone: ${result.error}`);
            }
        } finally {
            setIsInstallingRclone(false);
        }
    };

    const handleCopyConfigToServer = async () => {
        if (!serverId) return;

        setIsCopyingConfig(true);
        try {
            const result = await window.electron.rclone.copyConfig(serverId);
            if (result.success) {
                await checkServerStatus();
                alert('Rclone config copied to server successfully!');
            } else {
                alert(`Failed to copy config: ${result.error}`);
            }
        } finally {
            setIsCopyingConfig(false);
        }
    };

    const handleInstallLocalRclone = async () => {
        setIsInstallingLocal(true);
        try {
            const success = await window.electron.rclone.installLocal();
            if (success) {
                alert('Rclone installed successfully! Please try authorizing again.');
                setOauthStatus(null); // Clear error
            } else {
                alert('Failed to install rclone locally. Please check logs.');
            }
        } catch (error) {
            console.error('Local install error:', error);
            alert('Error triggering local installation.');
        } finally {
            setIsInstallingLocal(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="rclone-config-modal glass animate-slideUp" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>
                        <Cloud size={20} />
                        Rclone Configuration
                    </h2>
                    <button className="modal-close" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="rclone-config-content">
                    {/* Local Remotes Section */}
                    <div className="config-section">
                        <div className="section-header">
                            <h3>Local Rclone Remotes</h3>
                            <button
                                className="btn-refresh"
                                onClick={loadLocalRemotes}
                                disabled={isLoadingRemotes}
                            >
                                <RefreshCw size={14} className={isLoadingRemotes ? 'animate-spin' : ''} />
                            </button>
                        </div>

                        {isLoadingRemotes ? (
                            <div className="loading-state">
                                <Loader2 size={20} className="animate-spin" />
                                <span>Loading remotes...</span>
                            </div>
                        ) : localRemotes.length === 0 ? (
                            <div className="empty-state">
                                <Cloud size={24} />
                                <p>No remotes configured</p>
                            </div>
                        ) : (
                            <div className="remotes-list">
                                {localRemotes.map((remote, idx) => (
                                    <div key={idx} className="remote-item">
                                        <Cloud size={16} />
                                        <span className="remote-name">{remote.name}</span>
                                        <span className="remote-type">{remote.type}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Add New Remote */}
                        <div className="add-remote-section">
                            <h4>Add Google Drive Remote</h4>
                            <div className="add-remote-form">
                                <input
                                    type="text"
                                    value={newRemoteName}
                                    onChange={(e) => setNewRemoteName(e.target.value)}
                                    placeholder="Remote name (e.g., gdrive)"
                                />
                                <button
                                    className="btn btn-primary"
                                    onClick={handleStartOAuth}
                                    disabled={isStartingOAuth || !newRemoteName}
                                >
                                    {isStartingOAuth ? (
                                        <>
                                            <Loader2 size={16} className="animate-spin" />
                                            Authorizing...
                                        </>
                                    ) : (
                                        <>
                                            <Cloud size={16} />
                                            Authorize Google Drive
                                        </>
                                    )}
                                </button>
                            </div>

                            {oauthStatus && (
                                <div className={`oauth-status ${oauthStatus.success ? 'success' : 'error'}`}>
                                    <div className="status-content">
                                        {oauthStatus.success ? <Check size={16} /> : <AlertCircle size={16} />}
                                        <span>{oauthStatus.message}</span>
                                    </div>
                                    {!oauthStatus.success && oauthStatus.message?.toLowerCase().includes('installed') && (
                                        <button
                                            className="btn btn-sm btn-primary mt-2"
                                            onClick={handleInstallLocalRclone}
                                            disabled={isInstallingLocal}
                                        >
                                            {isInstallingLocal ? (
                                                <>
                                                    <Loader2 size={14} className="animate-spin" />
                                                    Installing...
                                                </>
                                            ) : (
                                                <>
                                                    <Download size={14} />
                                                    Install Rclone Locally
                                                </>
                                            )}
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Drive Folder Path - show when remotes exist */}
                            {localRemotes.length > 0 && (
                                <div className="drive-folder-section">
                                    <h4>Drive Sync Folder</h4>
                                    <p className="section-hint">
                                        Folder on Google Drive where files will be uploaded/synced
                                    </p>
                                    <div className="drive-folder-input">
                                        <span className="remote-prefix">{localRemotes[0]?.name || 'gdrive'}:</span>
                                        <input
                                            type="text"
                                            value={driveFolderPath}
                                            onChange={(e) => setDriveFolderPath(e.target.value)}
                                            placeholder="rclone-transfer"
                                        />
                                    </div>
                                    <p className="folder-preview">
                                        Full path: <code>{localRemotes[0]?.name || 'gdrive'}:{driveFolderPath}</code>
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Saved Configs Section */}
                    <div className="config-section">
                        <div className="section-header">
                            <h3>Saved Rclone Configs</h3>
                            <button
                                className="btn-refresh"
                                onClick={() => setIsAddingConfig(true)}
                                title="Add new config"
                            >
                                <Plus size={14} />
                            </button>
                        </div>

                        {configs.length === 0 && !isAddingConfig ? (
                            <div className="empty-state">
                                <Cloud size={24} />
                                <p>No configs saved yet</p>
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => setIsAddingConfig(true)}
                                >
                                    <Plus size={14} />
                                    Create Config
                                </button>
                            </div>
                        ) : (
                            <div className="configs-list">
                                {configs.map((config) => (
                                    <div key={config.id} className="config-item">
                                        <div className="config-item-info">
                                            <div className="config-item-name">{config.name}</div>
                                            <div className="config-item-details">
                                                {config.remoteName}:{config.driveFolder}
                                            </div>
                                        </div>
                                        <div className="config-item-actions">
                                            <button
                                                className="btn-icon"
                                                onClick={() => handleEditConfig(config)}
                                                title="Edit"
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button
                                                className="btn-icon danger"
                                                onClick={() => handleDeleteConfig(config.id)}
                                                title="Delete"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Add/Edit Config Form */}
                        {isAddingConfig && (
                            <div className="add-config-form">
                                <h4>{editingConfigId ? 'Edit Config' : 'New Config'}</h4>
                                <div className="form-group">
                                    <label>Config Name</label>
                                    <input
                                        type="text"
                                        value={configForm.name}
                                        onChange={(e) => setConfigForm(f => ({ ...f, name: e.target.value }))}
                                        placeholder="My Google Drive"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Remote Name</label>
                                    <select
                                        value={configForm.remoteName}
                                        onChange={(e) => setConfigForm(f => ({ ...f, remoteName: e.target.value }))}
                                    >
                                        <option value="">Select a remote...</option>
                                        {localRemotes.map((r, i) => (
                                            <option key={i} value={r.name}>{r.name} ({r.type})</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Drive Folder</label>
                                    <input
                                        type="text"
                                        value={configForm.driveFolder}
                                        onChange={(e) => setConfigForm(f => ({ ...f, driveFolder: e.target.value }))}
                                        placeholder="rclone-transfer"
                                    />
                                </div>
                                <div className="form-actions">
                                    <button className="btn btn-secondary" onClick={resetConfigForm}>
                                        Cancel
                                    </button>
                                    <button
                                        className="btn btn-primary"
                                        onClick={handleSaveConfig}
                                        disabled={!configForm.name || !configForm.remoteName}
                                    >
                                        {editingConfigId ? 'Update' : 'Save'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Server Section (if serverId provided) */}
                    {serverId && serverName && (
                        <div className="config-section">
                            <div className="section-header">
                                <h3>Server: {serverName}</h3>
                                <button
                                    className="btn-refresh"
                                    onClick={checkServerStatus}
                                >
                                    <RefreshCw size={14} />
                                </button>
                            </div>

                            {serverRcloneStatus ? (
                                <div className="rclone-server-status">
                                    <div className="status-item">
                                        <span>Rclone Installed:</span>
                                        {serverRcloneStatus.installed ? (
                                            <span className="status-yes"><Check size={14} /> Yes</span>
                                        ) : (
                                            <span className="status-no"><AlertCircle size={14} /> No</span>
                                        )}
                                    </div>

                                    {/* Action buttons row */}
                                    <div className="server-actions">
                                        {!serverRcloneStatus.installed && (
                                            <button
                                                className="btn btn-secondary"
                                                onClick={handleInstallRclone}
                                                disabled={isInstallingRclone}
                                            >
                                                {isInstallingRclone ? (
                                                    <>
                                                        <Loader2 size={16} className="animate-spin" />
                                                        Installing...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Download size={16} />
                                                        Install Rclone
                                                    </>
                                                )}
                                            </button>
                                        )}

                                        {/* Always show Copy Config button when local remotes exist */}
                                        {localRemotes.length > 0 && (
                                            <button
                                                className="btn btn-primary"
                                                onClick={handleCopyConfigToServer}
                                                disabled={isCopyingConfig}
                                            >
                                                {isCopyingConfig ? (
                                                    <>
                                                        <Loader2 size={16} className="animate-spin" />
                                                        Copying...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Copy size={16} />
                                                        Copy Config to Server
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </div>

                                    {serverRcloneStatus.installed && (
                                        <>
                                            <div className="status-item">
                                                <span>Config Exists:</span>
                                                {serverRcloneStatus.hasConfig ? (
                                                    <span className="status-yes"><Check size={14} /> Yes</span>
                                                ) : (
                                                    <span className="status-no"><AlertCircle size={14} /> No</span>
                                                )}
                                            </div>

                                            {serverRcloneStatus.remotes.length > 0 && (
                                                <div className="server-remotes">
                                                    <span>Server Remotes:</span>
                                                    <div className="remotes-list small">
                                                        {serverRcloneStatus.remotes.map((remote, idx) => (
                                                            <span key={idx} className="remote-tag">
                                                                {remote.name} ({remote.type})
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            ) : (
                                <div className="loading-state">
                                    <Loader2 size={20} className="animate-spin" />
                                    <span>Checking server status...</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RcloneConfigModal;
