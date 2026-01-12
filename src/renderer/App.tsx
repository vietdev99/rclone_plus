import { useState, useEffect } from 'react';
import { useServerStore, useTransferStore, useTabStore, useConfigStore, useLogStore } from './stores';
import Layout from './components/Layout/Layout';
import Sidebar from './components/Layout/Sidebar';
import TabContainer from './components/Tabs/TabContainer';
import './styles/globals.css';

function App() {
    const [isLoading, setIsLoading] = useState(true);
    const loadServers = useServerStore(state => state.loadServers);
    const loadJobs = useTransferStore(state => state.loadJobs);
    const loadConfig = useConfigStore(state => state.loadConfig);
    const loadLogs = useLogStore(state => state.loadLogs);
    const addLog = useLogStore(state => state.addLog);
    const updateItemProgress = useTransferStore(state => state.updateItemProgress);
    const loadSession = useTabStore(state => state.loadSession);
    const saveSession = useTabStore(state => state.saveSession);

    useEffect(() => {
        // Initial data load
        const init = async () => {
            try {
                await Promise.all([
                    loadServers(),
                    loadJobs(),
                    loadConfig(),
                    loadLogs(),
                ]);

                // Load saved session
                const session = await window.electron.config.getSession();
                if (session && Object.keys(session).length > 0) {
                    loadSession(session);
                }
            } catch (error) {
                console.error('Failed to initialize app:', error);
            } finally {
                setIsLoading(false);
            }
        };

        init();

        // Subscribe to progress updates
        const unsubProgress = window.electron.transfer.onProgress((data) => {
            updateItemProgress(data.jobId, data.itemId, data.progress, data.status);
        });

        // Subscribe to log updates
        const unsubLogs = window.electron.logs.onEntry((entry) => {
            addLog({ id: Date.now().toString(), ...entry });
        });

        return () => {
            unsubProgress();
            unsubLogs();
        };
    }, [loadServers, loadJobs, loadConfig, loadLogs, addLog, updateItemProgress, loadSession]);

    // Menu listeners
    useEffect(() => {
        const unsubSaveSession = window.electron.menu.onSaveSession(async () => {
            const sessionData = saveSession();
            try {
                await window.electron.config.saveSession(sessionData);
                window.electron.notification.show('Success', 'Session saved successfully');
            } catch (error) {
                console.error('Failed to save session:', error);
                window.electron.notification.show('Error', 'Failed to save session');
            }
        });

        return () => {
            unsubSaveSession();
        };
    }, [saveSession]);

    if (isLoading) {
        return (
            <div className="loading-screen">
                <div className="loading-spinner">
                    <div className="spinner"></div>
                    <p>Loading RClone Plus...</p>
                </div>
                <style>{`
          .loading-screen {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: var(--bg-primary);
          }
          .loading-spinner {
            text-align: center;
          }
          .spinner {
            width: 48px;
            height: 48px;
            border: 4px solid var(--border-color);
            border-top-color: var(--accent-primary);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
          }
        `}</style>
            </div>
        );
    }

    return (
        <Layout>
            <Sidebar />
            <TabContainer />
        </Layout>
    );
}

export default App;
