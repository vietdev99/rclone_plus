import './Transfer.css';

interface ProgressBarProps {
    value: number;
    status: string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ value, status }) => {
    const getColor = () => {
        switch (status) {
            case 'completed': return 'var(--success)';
            case 'failed': return 'var(--error)';
            case 'uploading': return 'var(--accent-primary)';
            case 'downloading': return 'var(--accent-secondary)';
            case 'zipping':
            case 'extracting': return 'var(--warning)';
            default: return 'var(--text-muted)';
        }
    };

    const isAnimated = ['zipping', 'uploading', 'downloading', 'extracting'].includes(status);

    return (
        <div className="progress-bar-container">
            <div className="progress-bar-track">
                <div
                    className={`progress-bar-fill ${isAnimated ? 'animated' : ''}`}
                    style={{
                        width: `${value}%`,
                        background: getColor(),
                    }}
                />
            </div>
            <span className="progress-bar-text">{value}%</span>
        </div>
    );
};

export default ProgressBar;
