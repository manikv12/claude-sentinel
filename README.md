# Claude Sentinel

Claude Sentinel is a cross-platform Electron desktop application that monitors usage of the Claude assistant, provides token and cost analytics, and automates session renewal to avoid interruptions. It runs in the background, exposes a system-tray interface for quick access, and includes detailed reporting and configuration options for managing auto-renewal behavior.

## What it does

- **Real-time usage monitoring** — tracks Claude token usage, request counts, and estimated costs so you can see consumption trends at a glance.
- **Auto-renewal** — optionally renews sessions or credentials automatically to prevent timeouts and keep long-running workflows active.
- **Background operation & system tray** — minimize to the tray and let the app run unobtrusively while still receiving notifications.
- **Reporting & history** — view past usage, export reports, and inspect per-session details.
- **Integrations** — connects to usage analysis and renewal services (e.g., `ccusage` and the built-in renewal service) for automated workflows.

## Features

- **Usage Monitoring**: Real-time tracking of Claude token usage and cost estimates
- **Auto-Renewal**: Automatic session management to prevent expirations
- **Cross-Platform**: Native builds for macOS and Windows
- **System Tray**: Background monitoring with quick access from the tray
- **Modern UI**: Built with React, TypeScript and Tailwind CSS for a responsive interface

## Quick Start

### Prerequisites

- Node.js 16+
- npm or yarn

### Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Build platform-specific distributables
npm run build:mac    # macOS DMG
npm run build:win    # Windows installer
```

### Architecture

- **Frontend**: React + TypeScript + Tailwind CSS
- **Main process**: Electron (app lifecycle, native integrations)
- **State Management**: Zustand
- **Build Tool**: Vite + electron-builder
- **Integrations**: `ccusage` (usage analysis) + internal renewal service

## Usage

1. Launch Claude Sentinel
2. View usage statistics on the Dashboard
3. Configure auto-renewal and notification preferences in Settings
4. Let the app run in the system tray and monitor reports from the Reports view

## License

MIT
