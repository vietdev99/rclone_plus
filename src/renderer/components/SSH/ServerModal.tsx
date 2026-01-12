import { useState, useEffect } from 'react';
import { X, Eye, EyeOff, Key, FileKey, Loader2, Check, AlertCircle, Server } from 'lucide-react';
import { useServerStore } from '../../stores';
import { SSHConfig, SSHAuthType } from '../../../shared/types';
import './SSH.css';

interface ServerModalProps {
    serverId: string | null;
    onClose: () => void;
}

interface SSHHostConfig {
    name: string;
    host: string;
    user: string;
    port?: number;
    identityFile?: string;
}

const generateId = () => `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const ServerModal: React.FC<ServerModalProps> = ({ serverId, onClose }) => {
    const servers = useServerStore(state => state.servers);
    const addServer = useServerStore(state => state.addServer);
    const updateServer = useServerStore(state => state.updateServer);
    const deleteServer = useServerStore(state => state.deleteServer);
    const testConnection = useServerStore(state => state.testConnection);

    // SSH Config import state
    const [sshConfigs, setSSHConfigs] = useState<SSHHostConfig[]>([]);
    const [isLoadingConfigs, setIsLoadingConfigs] = useState(false);
    const [selectedConfigName, setSelectedConfigName] = useState<string | null>(null);

    const [formData, setFormData] = useState<SSHConfig>({
        id: generateId(),
        name: '',
        host: '',
        port: 22,
        username: '',
        authType: 'key',
        password: '',
        privateKeyPath: '~/.ssh/id_rsa',
        passphrase: '',
    });

    const [showPassword, setShowPassword] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
    const [isGeneratingKey, setIsGeneratingKey] = useState(false);

    // Load SSH configs on mount (for new server only)
    useEffect(() => {
        if (!serverId) {
            loadSSHConfigs();
        }
    }, [serverId]);

    // Load existing server data when editing
    useEffect(() => {
        if (serverId) {
            const server = servers.find(s => s.id === serverId);
            if (server) {
                setFormData(server);
            }
        }
    }, [serverId, servers]);

    const loadSSHConfigs = async () => {
        setIsLoadingConfigs(true);
        try {
            const configs = await window.electron.ssh.listConfigs();
            setSSHConfigs(configs as SSHHostConfig[]);
        } catch (error) {
            console.error('Failed to load SSH configs:', error);
        } finally {
            setIsLoadingConfigs(false);
        }
    };

    const handleImportConfig = (config: SSHHostConfig) => {
        setFormData({
            id: formData.id,
            name: config.name,
            host: config.host,
            port: config.port || 22,
            username: config.user,
            authType: 'key',
            privateKeyPath: config.identityFile || '~/.ssh/id_rsa',
            configName: config.name,
        });
        setSelectedConfigName(config.name);
        setTestResult(null);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: name === 'port' ? parseInt(value) || 22 : value,
        }));
        setTestResult(null);
    };

    const handleAuthTypeChange = (authType: SSHAuthType) => {
        setFormData(prev => ({ ...prev, authType }));
        setTestResult(null);
    };

    const handleTest = async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
            const result = await testConnection(formData);
            setTestResult(result);
        } catch (error) {
            setTestResult({ success: false, error: 'Connection test failed' });
        } finally {
            setIsTesting(false);
        }
    };

    const handleGenerateKey = async () => {
        setIsGeneratingKey(true);
        try {
            const result = await window.electron.ssh.generateKey(formData.name || 'rclone-plus');
            setFormData(prev => ({
                ...prev,
                authType: 'key',
                privateKeyPath: result.privateKeyPath,
            }));

            if (formData.password) {
                await window.electron.ssh.copyKey(formData, result.publicKey);
                await window.electron.notification.show(
                    'SSH Key Generated',
                    'Key has been generated and copied to the server.'
                );
            } else {
                await window.electron.notification.show(
                    'SSH Key Generated',
                    'Key has been generated. Please enter password to copy to server.'
                );
            }
        } catch (error) {
            console.error('Failed to generate key:', error);
        } finally {
            setIsGeneratingKey(false);
        }
    };

    const handleSave = async () => {
        if (serverId) {
            await updateServer(formData);
        } else {
            await addServer(formData);
        }
        onClose();
    };

    const handleDelete = async () => {
        if (serverId && confirm('Are you sure you want to delete this server?')) {
            await deleteServer(serverId);
            onClose();
        }
    };

    const isEditing = !!serverId;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className={`modal glass animate-slideUp ${!isEditing && sshConfigs.length > 0 ? 'modal-wide' : ''}`} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{isEditing ? 'Edit Server' : 'Add Server'}</h2>
                    <button className="modal-close" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className={`modal-body ${!isEditing && sshConfigs.length > 0 ? 'modal-body-split' : ''}`}>
                    {/* Left Panel: SSH Config List */}
                    {!isEditing && sshConfigs.length > 0 && (
                        <div className="modal-panel-left">
                            <div className="panel-header">
                                <Server size={16} />
                                <span>SSH Configs</span>
                            </div>
                            <div className="ssh-config-list">
                                {isLoadingConfigs ? (
                                    <div className="loading-configs">
                                        <Loader2 size={18} className="animate-spin" />
                                    </div>
                                ) : (
                                    sshConfigs.map((config, idx) => (
                                        <button
                                            key={idx}
                                            className={`ssh-config-item ${selectedConfigName === config.name ? 'selected' : ''}`}
                                            onClick={() => handleImportConfig(config)}
                                        >
                                            <div className="config-info">
                                                <span className="config-name">{config.name}</span>
                                                <span className="config-host">
                                                    {config.user}@{config.host}
                                                    {config.port && config.port !== 22 ? `:${config.port}` : ''}
                                                </span>
                                            </div>
                                            {selectedConfigName === config.name && <Check size={14} />}
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    )}

                    {/* Right Panel: Server Form */}
                    <div className="modal-panel-right">
                        <div className="form-group">
                            <label>Server Name</label>
                            <input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                placeholder="My Server"
                            />
                        </div>

                        <div className="form-row">
                            <div className="form-group flex-1">
                                <label>Host</label>
                                <input
                                    type="text"
                                    name="host"
                                    value={formData.host}
                                    onChange={handleChange}
                                    placeholder="192.168.1.100"
                                />
                            </div>
                            <div className="form-group" style={{ width: 100 }}>
                                <label>Port</label>
                                <input
                                    type="number"
                                    name="port"
                                    value={formData.port}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Username</label>
                            <input
                                type="text"
                                name="username"
                                value={formData.username}
                                onChange={handleChange}
                                placeholder="root"
                            />
                        </div>

                        <div className="form-group">
                            <label>Authentication Method</label>
                            <div className="auth-type-buttons">
                                <button
                                    className={`auth-type-btn ${formData.authType === 'password' ? 'active' : ''}`}
                                    onClick={() => handleAuthTypeChange('password')}
                                >
                                    <Key size={16} />
                                    Password
                                </button>
                                <button
                                    className={`auth-type-btn ${formData.authType === 'key' ? 'active' : ''}`}
                                    onClick={() => handleAuthTypeChange('key')}
                                >
                                    <FileKey size={16} />
                                    SSH Key
                                </button>
                            </div>
                        </div>

                        {formData.authType === 'password' && (
                            <div className="form-group">
                                <label>Password</label>
                                <div className="password-input">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        name="password"
                                        value={formData.password || ''}
                                        onChange={handleChange}
                                        placeholder="••••••••"
                                    />
                                    <button
                                        type="button"
                                        className="password-toggle"
                                        onClick={() => setShowPassword(!showPassword)}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>
                        )}

                        {formData.authType === 'key' && (
                            <>
                                <div className="form-group">
                                    <label>Private Key Path</label>
                                    <input
                                        type="text"
                                        name="privateKeyPath"
                                        value={formData.privateKeyPath || ''}
                                        onChange={handleChange}
                                        placeholder="~/.ssh/id_rsa"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Passphrase (optional)</label>
                                    <input
                                        type="password"
                                        name="passphrase"
                                        value={formData.passphrase || ''}
                                        onChange={handleChange}
                                        placeholder="Key passphrase"
                                    />
                                </div>
                            </>
                        )}

                        <button
                            className="btn btn-secondary generate-key-btn"
                            onClick={handleGenerateKey}
                            disabled={isGeneratingKey || !formData.name}
                        >
                            {isGeneratingKey ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <Key size={16} />
                                    Generate SSH Key & Copy to Server
                                </>
                            )}
                        </button>

                        {testResult && (
                            <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                                {testResult.success ? (
                                    <>
                                        <Check size={18} />
                                        Connection successful!
                                    </>
                                ) : (
                                    <>
                                        <AlertCircle size={18} />
                                        {testResult.error || 'Connection failed'}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="modal-footer">
                    {isEditing && (
                        <button className="btn btn-danger" onClick={handleDelete}>
                            Delete
                        </button>
                    )}
                    <div className="modal-footer-right">
                        <button className="btn btn-secondary" onClick={handleTest} disabled={isTesting}>
                            {isTesting ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Testing...
                                </>
                            ) : (
                                'Test Connection'
                            )}
                        </button>
                        <button className="btn btn-primary" onClick={handleSave}>
                            {isEditing ? 'Save Changes' : 'Add Server'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ServerModal;
