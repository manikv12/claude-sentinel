# Claude Sentinel

A cross-platform desktop application that combines Claude usage monitoring and auto-renewal functionality in a modern, intuitive interface.

## Features

- **Usage Monitoring**: Real-time tracking of Claude token usage and costs
- **Auto-Renewal**: Automatic session management to prevent timeouts  
- **Cross-Platform**: Native apps for macOS and Windows
- **System Tray**: Minimize to system tray for background monitoring
- **Beautiful UI**: Modern interface built with React and Tailwind CSS

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
- **Backend**: Electron main process
- **State Management**: Zustand
- **Build Tool**: Vite + electron-builder
- **Integration**: ccusage (usage analysis) + ClaudeCodeAutoRenew (renewal service)

## Usage

1. Launch Claude Sentinel
2. View your usage statistics on the Dashboard
3. Enable/disable auto-renewal as needed
4. Monitor progress from the system tray
5. Access detailed reports and settings

## License

MIT