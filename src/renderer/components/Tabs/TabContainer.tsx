import { Plus, X } from 'lucide-react';
import { useTabStore } from '../../stores';
import TransferPanel from '../Transfer/TransferPanel';
import './Tabs.css';

const TabContainer = () => {
    const tabs = useTabStore(state => state.tabs);
    const activeTabId = useTabStore(state => state.activeTabId);
    const addTab = useTabStore(state => state.addTab);
    const removeTab = useTabStore(state => state.removeTab);
    const setActiveTab = useTabStore(state => state.setActiveTab);

    const activeTab = tabs.find(t => t.isActive) || tabs[0];

    return (
        <main className="main-content">
            <div className="tab-bar">
                <div className="tab-list">
                    {tabs.map(tab => (
                        <div
                            key={tab.id}
                            className={`tab ${tab.isActive ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            <span className="tab-name">{tab.name}</span>
                            {tabs.length > 1 && (
                                <button
                                    className="tab-close"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeTab(tab.id);
                                    }}
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
                <button className="tab-add" onClick={addTab}>
                    <Plus size={18} />
                </button>
            </div>

            <div className="tab-content">
                {activeTab && <TransferPanel key={activeTab.id} tabId={activeTab.id} />}
            </div>
        </main>
    );
};

export default TabContainer;
