# RClone Plus Project Documentation

## 1. Project Overview
**Name:** RClone Plus
**Version:** 1.0.0
**Description:** A desktop application built with Electron, React, and TypeScript to facilitate server-to-server data transfers using Rclone (specifically Google Drive as intermediate storage).

**Core Features:**
- SSH into multiple servers (Source/Destination)
- Configure Rclone (Google Drive) on local and remote servers
- Transfer files: Source -> Zip -> Google Drive -> Destination(s) -> Download -> Unzip
- 3-Panel Transfer Interface: Source Configuration, Queue Status, Destination Configuration
- Real-time progress tracking with step-by-step logging
- Session Management: Save/Load open tabs and configurations
- Cross-platform support (Primary focus: Windows, adaptable to Linux/macOS)

## 2. Technology Stack
- **Runtime:** Electron v32.x (Main Process + Renderer Process)
- **Frontend:** React 19, TypeScript 5.x, Vite 7.x, Zustand (State Management), Lucide React (Icons)
- **Backend (Main Process):** TypeScript, SSH2 (SSH client), Node.js `child_process` (Rclone execution), Electron Store (Persistence)
- **Styling:** Vanilla CSS with CSS Variables for theming (dark mode default)
- **Build:** electron-builder for packaging

## 3. Architecture
- **Main Process:** Handles low-level operations (SSH connecting, executing Rclone commands, File System access, Config persistence). Exposes API via `contextBridge`.
- **Renderer Process:** React UI. Uses `zustand` stores to manage application state (Servers, Transfers, Tabs, Logs). Calls Main process via `window.electron` API.
- **Communication:** IPC (Inter-Process Communication) via `ipcMain` and `ipcRenderer`.

## 4. File Structure
```
rclone-plus/
├── src/
│   ├── main/                 # Electron Main Process
│   │   ├── index.ts          # Entry point, BrowserWindow creation
│   │   ├── preload.ts        # Context Bridge (API definition)
│   │   ├── ipc/              # IPC Handlers
│   │   │   ├── config.ipc.ts # Config/persistence handlers
│   │   │   ├── ssh.ipc.ts    # SSH operation handlers
│   │   │   ├── rclone.ipc.ts # Rclone operation handlers
│   │   │   └── transfer.ipc.ts # Transfer job handlers
│   │   └── services/         # Business Logic
│   │       ├── ssh.service.ts    # SSH connections, SFTP
│   │       ├── rclone.service.ts # Rclone operations
│   │       ├── transfer.service.ts # Transfer job orchestration
│   │       ├── config.service.ts # Configuration persistence
│   │       └── logger.service.ts # Logging service
│   ├── renderer/             # React Renderer Process
│   │   ├── App.tsx           # Root Component
│   │   ├── main.tsx          # Entry
│   │   ├── components/       # UI Components
│   │   │   ├── SSH/          # Server Management (ServerModal, ServerList)
│   │   │   ├── Transfer/     # Transfer Panel (Core UI, ProgressBar)
│   │   │   ├── RcloneConfig/ # Rclone Setup Modal
│   │   │   ├── PathBrowser/  # Remote File Browser Modal
│   │   │   ├── Tabs/         # Tab System
│   │   │   └── Logs/         # Log Viewer
│   │   └── stores/           # Zustand Stores (index.ts)
│   └── shared/               # Shared Types and Constants
│       └── types.ts          # TypeScript interfaces, IPC channels
├── package.json
├── tsconfig.json             # Base TypeScript config
├── tsconfig.main.json        # Main process TypeScript config
├── vite.config.ts            # Vite configuration
└── electron-builder.yml      # Electron Builder config
```

## 5. Key Services

### `src/main/services/ssh.service.ts`
Handles SSH connections using `ssh2`.
- Connection pooling (Map of `id` -> `Client`)
- `connect(config)`: Establishes and keeps connection alive
- `exec(id, cmd)`: Executes commands on remote server
- `execWithProgress(id, cmd, onData)`: Executes with real-time output
- `listDirectory(id, path)`: SFTP directory listing with pagination
- `generateKeyPair(name)`: Generates SSH keys locally

### `src/main/services/rclone.service.ts`
Wraps Rclone binary execution.
- `installLocalRclone()`: Downloads Rclone binary if missing (Windows)
- `install(connectionId)`: Installs Rclone on remote server via SSH
- `upload(id, source, remote, path)`: Uses `rclone copyto` for file upload
- `download(id, remote, path, dest)`: Uses `rclone copyto` for file download
- `delete(id, remote, path)`: Uses `rclone deletefile` to remove files
- `copyConfigToServer(id)`: Deploys local config to remote server

### `src/main/services/transfer.service.ts`
Orchestrates the transfer workflow (6 steps):
1. Connect to source server
2. Check/install rclone on source
3. Deploy rclone config to source
4. Prepare source files (zip)
5. Upload to Google Drive
6. Download to destination(s), extract, cleanup

### `src/renderer/stores/index.ts`
Zustand stores for state management:
- `useServerStore`: SSH server configurations and connection status
- `useTransferStore`: Transfer jobs and progress
- `useTabStore`: Tab management and session persistence
- `useConfigStore`: Application configuration
- `useLogStore`: Activity logs
- `useRcloneConfigStore`: Rclone configurations CRUD

## 6. Transfer Workflow
```
[Source Server]
    │
    ├─ 1. SSH Connect
    ├─ 2. Check/Install Rclone
    ├─ 3. Deploy Rclone Config
    ├─ 4. Zip source folder
    ├─ 5. Upload zip to Google Drive (rclone copyto)
    │
[Google Drive] (Intermediate Storage)
    │
    ├─ 6. For each destination:
    │      ├─ SSH Connect
    │      ├─ Check/Install Rclone
    │      ├─ Deploy Rclone Config
    │      ├─ Download zip (rclone copyto)
    │      ├─ Extract zip
    │      ├─ Cleanup local zip
    │      └─ Delete from Drive (if configured)
    │
[Destination Server(s)]
```

## 7. Configuration
- **Config File:** `%APPDATA%/rclone-plus/config.json` (managed by `electron-store`)
- **Rclone Configs:** `%APPDATA%/rclone-plus/rclone-configs.json`
- **SSH Keys:** Uses `~/.ssh/` for keys
- **Rclone Binary:** `%APPDATA%/rclone-plus/bin/rclone.exe` (Windows) or system path

## 8. Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Commands
```bash
# Install dependencies
npm install

# Development mode (Vite + Electron hot reload)
npm run dev

# Build for production
npm run build

# Package application
npm run dist
```

## 9. Recent Updates (Jan 12, 2026)

### UI/UX Improvements
- Fixed white screen flash on app startup (delayed window show)
- Start/Stop button toggle during transfer
- Overall progress bar with percentage (based on 6 steps)
- Auto-scroll activity log with smart user scroll detection
- Finished state display instead of "Preparing" when job completes
- Create folder button in Path Browser

### Rclone Fixes
- Fixed: ZIP files appearing as folders on Drive (changed `rclone copy` to `rclone copyto`)
- Fixed: Files not deleted from Drive (changed `rclone delete` to `rclone deletefile`)
- Fixed: Delete now uses destination server connection instead of source

### Transfer System
- Detailed step-by-step logging with prefixes: `[Step X/6]`, `[Zip]`, `[Upload]`, `[Download]`, `[Extract]`, `[Cleanup]`, `[Complete]`, `[Error]`
- Real-time progress updates via IPC broadcast
- Connection status sync between Path Browser and sidebar

## 10. Known Limitations
- Rclone auto-download is Windows-only
- Queue layout uses fixed ratio (may need responsive adjustments)
- Single Google Drive remote name hardcoded as 'gdrive'
