import { useState, useEffect, useRef } from 'react';
import { X, Folder, FolderOpen, File, ChevronRight, ChevronLeft, Home, Loader2, AlertCircle, RefreshCw, MoreHorizontal, FolderPlus } from 'lucide-react';
import { useServerStore } from '../../stores';
import './PathBrowser.css';

interface PathBrowserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (path: string) => void;
    serverId: string;
    serverName: string;
    initialPath?: string;
}

interface DirItem {
    name: string;
    type: 'file' | 'directory';
    size: number;
}

const ITEMS_PER_PAGE = 50;

// Directory cache - persists across modal opens for the same server
const directoryCache = new Map<string, { items: DirItem[], total: number, timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const PathBrowserModal: React.FC<PathBrowserModalProps> = ({
    isOpen,
    onClose,
    onSelect,
    serverId,
    serverName,
    initialPath = '~',
}) => {
    const servers = useServerStore(state => state.servers);
    const server = servers.find(s => s.id === serverId);
    // Get the setConnectionStatus function to update sidebar
    const connectionStatus = useServerStore(state => state.connectionStatus);

    const [currentPath, setCurrentPath] = useState(initialPath);
    const [items, setItems] = useState<DirItem[]>([]);
    const [totalItems, setTotalItems] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isCached, setIsCached] = useState(false);

    // New folder state
    const [showNewFolderInput, setShowNewFolderInput] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);

    // Ref to track current loading request (for cancellation)
    const loadingRequestRef = useRef<number>(0);
    // Track previous serverId to detect changes
    const prevServerIdRef = useRef<string | null>(null);

    // Reset state when serverId changes
    useEffect(() => {
        if (isOpen && serverId && serverId !== prevServerIdRef.current) {
            // Server changed, reset everything
            setItems([]);
            setTotalItems(0);
            setHasMore(false);
            setError(null);
            setSelectedPath(null);
            setIsConnected(false);
            setCurrentPath(initialPath);
            prevServerIdRef.current = serverId;

            // Connect to new server
            connectAndLoad();
        }
    }, [isOpen, serverId]);

    // Initial load when modal opens
    useEffect(() => {
        if (isOpen && serverId && server && !prevServerIdRef.current) {
            prevServerIdRef.current = serverId;
            connectAndLoad();
        }
        // Cleanup on close
        if (!isOpen) {
            prevServerIdRef.current = null;
            setIsConnected(false);
            setItems([]);
            setTotalItems(0);
            setHasMore(false);
            setError(null);
            // Cancel any pending requests
            loadingRequestRef.current++;
        }
    }, [isOpen]);

    // Load directory when path changes
    useEffect(() => {
        if (isConnected && serverId) {
            // Cancel previous request
            loadingRequestRef.current++;
            loadDirectory(currentPath);
        }
    }, [currentPath, isConnected]);

    const connectAndLoad = async () => {
        if (!server) {
            setError('Server configuration not found');
            return;
        }

        setIsConnecting(true);
        setError(null);
        try {
            // Connect to server first
            const connectResult = await window.electron.ssh.connect(server);
            if (!connectResult.success) {
                setError(`Connection failed: ${connectResult.error || 'Unknown error'}`);
                // Update store to reflect failed connection
                useServerStore.setState(state => ({
                    connectionStatus: {
                        ...state.connectionStatus,
                        [serverId]: { connected: false, error: connectResult.error }
                    }
                }));
                return;
            }
            setIsConnected(true);
            // Update store to reflect successful connection (sync with sidebar)
            useServerStore.setState(state => ({
                connectionStatus: {
                    ...state.connectionStatus,
                    [serverId]: { connected: true }
                }
            }));
            // loadDirectory will be called by the useEffect
        } catch (err) {
            setError('Failed to connect to server');
        } finally {
            setIsConnecting(false);
        }
    };

    const handleCreateFolder = async () => {
        if (!newFolderName.trim() || !isConnected) return;

        setIsCreatingFolder(true);
        try {
            const newFolderPath = currentPath === '/'
                ? `/${newFolderName}`
                : `${currentPath}/${newFolderName}`;

            // Create folder via SSH exec
            await window.electron.ssh.exec(serverId, `mkdir -p "${newFolderPath}"`);

            // Clear cache for this directory
            const cacheKey = getCacheKey(serverId, currentPath);
            directoryCache.delete(cacheKey);

            // Refresh directory listing
            await loadDirectory(currentPath, true);

            // Reset input
            setNewFolderName('');
            setShowNewFolderInput(false);
        } catch (err) {
            setError('Failed to create folder');
        } finally {
            setIsCreatingFolder(false);
        }
    };

    const getCacheKey = (serverIdKey: string, pathKey: string) => `${serverIdKey}:${pathKey}`;

    const loadDirectory = async (path: string, forceRefresh = false, append = false) => {
        if (!isConnected) return;

        const requestId = loadingRequestRef.current;
        const cacheKey = getCacheKey(serverId, path);
        const cached = directoryCache.get(cacheKey);

        // Use cache if available and not expired and not forcing refresh and not appending
        if (!forceRefresh && !append && cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
            setItems(cached.items);
            setTotalItems(cached.total);
            setHasMore(cached.items.length < cached.total);
            setSelectedPath(null);
            setIsCached(true);
            return;
        }

        if (append) {
            setIsLoadingMore(true);
        } else {
            setIsLoading(true);
            setItems([]);
        }
        setError(null);
        setIsCached(false);

        try {
            const offset = append ? items.length : 0;
            const result = await window.electron.ssh.listDir(serverId, path, ITEMS_PER_PAGE, offset);

            // Check if this request is still valid (not cancelled)
            if (requestId !== loadingRequestRef.current) {
                return; // Request was cancelled
            }

            const newItems = append ? [...items, ...result.items] : result.items;
            setItems(newItems);
            setTotalItems(result.total);
            setHasMore(result.hasMore);
            setSelectedPath(null);

            // Save to cache (full list)
            if (!append) {
                directoryCache.set(cacheKey, {
                    items: result.items,
                    total: result.total,
                    timestamp: Date.now()
                });
            } else {
                // Update cache with more items
                directoryCache.set(cacheKey, {
                    items: newItems,
                    total: result.total,
                    timestamp: Date.now()
                });
            }
        } catch (err) {
            if (requestId === loadingRequestRef.current) {
                setError('Failed to load directory');
                if (!append) setItems([]);
            }
        } finally {
            if (requestId === loadingRequestRef.current) {
                setIsLoading(false);
                setIsLoadingMore(false);
            }
        }
    };

    const handleRefresh = () => {
        loadDirectory(currentPath, true);
    };

    const handleLoadMore = () => {
        loadDirectory(currentPath, false, true);
    };

    const handleNavigate = (item: DirItem) => {
        if (item.type === 'directory') {
            // Cancel current loading
            loadingRequestRef.current++;

            const newPath = currentPath === '/'
                ? `/${item.name}`
                : `${currentPath}/${item.name}`;
            setCurrentPath(newPath);
        }
    };

    const handleGoUp = () => {
        // Cancel current loading
        loadingRequestRef.current++;

        const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
        setCurrentPath(parentPath);
    };

    const handleGoHome = () => {
        // Cancel current loading
        loadingRequestRef.current++;

        setCurrentPath('~');
    };

    const handleSelect = (item: DirItem) => {
        const fullPath = currentPath === '/'
            ? `/${item.name}`
            : `${currentPath}/${item.name}`;
        setSelectedPath(fullPath);
    };

    const handleConfirm = () => {
        if (selectedPath) {
            onSelect(selectedPath);
            onClose();
        } else {
            onSelect(currentPath);
            onClose();
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="path-browser-modal glass animate-slideUp" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Browse: {serverName}</h2>
                    <button className="modal-close" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="path-browser-content">
                    {/* Navigation Bar */}
                    <div className="path-nav">
                        <button
                            className="nav-btn"
                            onClick={handleGoHome}
                            title="Home (~)"
                            disabled={!isConnected}
                        >
                            <Home size={18} />
                        </button>
                        <button
                            className="nav-btn"
                            onClick={handleGoUp}
                            disabled={currentPath === '/' || currentPath === '~' || !isConnected}
                            title="Go Up"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <button
                            className={`nav-btn ${isLoading ? 'loading' : ''}`}
                            onClick={handleRefresh}
                            title="Refresh (force reload)"
                            disabled={!isConnected || isLoading}
                        >
                            <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                        </button>
                        <button
                            className="nav-btn"
                            onClick={() => setShowNewFolderInput(!showNewFolderInput)}
                            title="New Folder"
                            disabled={!isConnected || isLoading}
                        >
                            <FolderPlus size={18} />
                        </button>
                        {isCached && !isLoading && (
                            <span className="cache-indicator" title="Loaded from cache">cached</span>
                        )}
                        <div className="path-display">
                            <Folder size={16} />
                            <span>{currentPath}</span>
                            {totalItems > 0 && (
                                <span className="items-count">({items.length}/{totalItems})</span>
                            )}
                        </div>
                    </div>

                    {/* New Folder Input */}
                    {showNewFolderInput && (
                        <div className="new-folder-input">
                            <FolderPlus size={16} />
                            <input
                                type="text"
                                placeholder="Enter folder name..."
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleCreateFolder();
                                    if (e.key === 'Escape') {
                                        setShowNewFolderInput(false);
                                        setNewFolderName('');
                                    }
                                }}
                                autoFocus
                                disabled={isCreatingFolder}
                            />
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={handleCreateFolder}
                                disabled={!newFolderName.trim() || isCreatingFolder}
                            >
                                {isCreatingFolder ? <Loader2 size={14} className="animate-spin" /> : 'Create'}
                            </button>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    setShowNewFolderInput(false);
                                    setNewFolderName('');
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    )}

                    {/* Directory Contents */}
                    <div className="path-list">
                        {isConnecting ? (
                            <div className="path-loading">
                                <Loader2 size={24} className="animate-spin" />
                                <span>Connecting to server...</span>
                            </div>
                        ) : isLoading ? (
                            <div className="path-loading">
                                <Loader2 size={24} className="animate-spin" />
                                <span>Loading directory...</span>
                            </div>
                        ) : error ? (
                            <div className="path-error">
                                <AlertCircle size={24} />
                                <p>{error}</p>
                                <button className="btn btn-secondary" onClick={connectAndLoad}>
                                    <RefreshCw size={14} />
                                    Retry
                                </button>
                            </div>
                        ) : items.length === 0 ? (
                            <div className="path-empty">
                                <FolderOpen size={32} />
                                <p>Empty directory</p>
                            </div>
                        ) : (
                            <>
                                {items.map((item, idx) => (
                                    <div
                                        key={idx}
                                        className={`path-item ${selectedPath === `${currentPath}/${item.name}` ||
                                                selectedPath === `/${item.name}` ? 'selected' : ''
                                            }`}
                                        onClick={() => handleSelect(item)}
                                        onDoubleClick={() => handleNavigate(item)}
                                    >
                                        {item.type === 'directory' ? (
                                            <Folder size={18} className="item-icon folder" />
                                        ) : (
                                            <File size={18} className="item-icon file" />
                                        )}
                                        <span className="item-name">{item.name}</span>
                                        {item.type === 'file' && (
                                            <span className="item-size">{formatSize(item.size)}</span>
                                        )}
                                        {item.type === 'directory' && (
                                            <ChevronRight size={16} className="item-arrow" />
                                        )}
                                    </div>
                                ))}

                                {/* Load More Button */}
                                {hasMore && (
                                    <button
                                        className="load-more-btn"
                                        onClick={handleLoadMore}
                                        disabled={isLoadingMore}
                                    >
                                        {isLoadingMore ? (
                                            <>
                                                <Loader2 size={16} className="animate-spin" />
                                                Loading...
                                            </>
                                        ) : (
                                            <>
                                                <MoreHorizontal size={16} />
                                                Load more ({totalItems - items.length} remaining)
                                            </>
                                        )}
                                    </button>
                                )}
                            </>
                        )}
                    </div>

                    {/* Selected Path */}
                    <div className="path-selected">
                        <label>Selected:</label>
                        <input
                            type="text"
                            value={selectedPath || currentPath}
                            readOnly
                        />
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button className="btn btn-primary" onClick={handleConfirm}>
                        Select Path
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PathBrowserModal;
