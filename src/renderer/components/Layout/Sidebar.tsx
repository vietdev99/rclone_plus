import { useState } from 'react';
import { Plus, Cloud } from 'lucide-react';
import { useServerStore } from '../../stores';
import ServerModal from '../SSH/ServerModal';
import RcloneConfigModal from '../RcloneConfig/RcloneConfigModal';
import './Layout.css';

const Sidebar = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingServer, setEditingServer] = useState<string | null>(null);
    const [isRcloneConfigOpen, setIsRcloneConfigOpen] = useState(false);
    const servers = useServerStore(state => state.servers);
    const connectionStatus = useServerStore(state => state.connectionStatus);

    const handleEditServer = (serverId: string) => {
        setEditingServer(serverId);
        setIsModalOpen(true);
    };

    const handleAddServer = () => {
        setEditingServer(null);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingServer(null);
    };

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="sidebar-logo">
                    <div className="sidebar-logo-icon">
                        <img src="/icon.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                    <h1>RClone Plus</h1>
                </div>
            </div>

            <div className="sidebar-section">
                <div className="sidebar-section-title">Servers</div>
                <div className="server-list">
                    {servers.map(server => {
                        const status = connectionStatus[server.id];
                        const isConnected = status?.connected || false;
                        const hasError = status?.error;

                        return (
                            <div
                                key={server.id}
                                className={`server-item ${isConnected ? 'connected' : ''}`}
                                onClick={() => handleEditServer(server.id)}
                            >
                                <div className={`server-status ${isConnected ? 'connected' : hasError ? 'error' : ''}`} />
                                <div className="server-info">
                                    <div className="server-name">{server.name}</div>
                                    <div className="server-host">{server.host}:{server.port}</div>
                                </div>
                            </div>
                        );
                    })}

                    <button className="add-server-btn" onClick={handleAddServer}>
                        <Plus size={18} />
                        Add Server
                    </button>
                </div>
            </div>

            <div className="sidebar-section" style={{ marginTop: 'auto' }}>
                <div className="server-list">
                    <div className="server-item" onClick={() => setIsRcloneConfigOpen(true)}>
                        <Cloud size={18} />
                        <div className="server-info">
                            <div className="server-name">Rclone Config</div>
                        </div>
                    </div>
                </div>
            </div>

            {isModalOpen && (
                <ServerModal
                    serverId={editingServer}
                    onClose={handleCloseModal}
                />
            )}

            <RcloneConfigModal
                isOpen={isRcloneConfigOpen}
                onClose={() => setIsRcloneConfigOpen(false)}
            />
        </aside>
    );
};

export default Sidebar;
