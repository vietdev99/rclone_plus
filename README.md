# RClone Plus

RClone Plus is a powerful, server-to-server data transfer utility built with Electron, React, and TypeScript. It leverages the power of Rclone and SSH to manage high-speed transfers between remote servers (VPS) and cloud storage (Google Drive), with a modern, user-friendly interface.

![RClone Plus](resources/icon.png)

## Features

-   **Server Management**: Easily add and manage SSH connections to remote servers.
-   **Intelligent Setup**: Automatically checks for and installs Rclone on remote servers if missing.
-   **Rclone Config Management**: Deploy and manage Rclone configurations on remote servers directly from the UI.
-   **Multi-Destination Transfer**: Upload to Google Drive once, then download to multiple destination servers in parallel.
-   **Split Archive Support**: Automatically handles large folders by creating split zip archives, uploading parts, and performing bulk extraction on destinations.
-   **Streaming Uploads**: Zips and uploads files in chunks to minimize disk usage on the source server.
-   **Real-time Monitoring**: Track transfer progress, speed, and logs for all connected servers.
-   **Session Management**: Save and load transfer configurations (source, destinations, folders) for quick reuse.
-   **Dark Mode UI**: A sleek, modern interface designed for comfort and efficiency.

## Installation

1.  Download the latest release for your platform (Windows, macOS, Linux).
2.  Run the installer.
3.  Launch RClone Plus.

## Usage

1.  **Add Servers**: Go to the sidebar and click "+" to add your source and destination servers via SSH.
2.  **Configure Transfer**: 
    -   Select a **Source Server** and the folder you want to transfer.
    -   Select one or more **Destination Servers**.
    -   Choose the **Rclone Config** (Google Drive remote) to use as the intermediary.
3.  **Start Transfer**: Click "Start Transfer".
    -   The app will zip files on the source (splitting if necessary).
    -   Upload to the configured Google Drive remote.
    -   Automatically trigger downloads on all destination servers.
    -   Extract files upon completion (if "Auto-extract" is enabled).

## Development

### Prerequisites

-   Node.js (v18 or later)
-   NPM or Yarn

### Setup

```bash
git clone https://github.com/vietdev99/rclone_plus.git
cd rclone_plus
npm install
```

### Run Locally

```bash
npm run dev
```

### Build

```bash
npm run dist
```

## License

MIT License.
