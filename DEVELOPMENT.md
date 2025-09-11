# Claude Sentinel - Development Guide

## 🚀 Quick Start

### Prerequisites

- **Node.js** 20+ (with npm)
- **Git**
- **macOS/Windows/Linux** development environment

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd claude-sentinel

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will open automatically with hot reload enabled.

## 🏗️ Architecture

### Project Structure

```
claude-sentinel/
├── electron/           # Electron main process files
│   ├── main.ts        # Main process entry point
│   ├── preload.ts     # Preload script for IPC
│   ├── utils.ts       # Electron utilities
│   └── services/      # Backend services
├── src/               # React renderer process
│   ├── components/    # React components
│   ├── stores/        # Zustand state management
│   ├── lib/           # Utilities and integrations
│   └── types/         # TypeScript type definitions
├── build/             # Build resources (icons, etc.)
└── release/           # Built distributables
```

### Technology Stack

- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **Backend**: Electron + Node.js
- **State Management**: Zustand
- **Build Tools**: Vite + electron-builder
- **UI Components**: Radix UI + shadcn/ui
- **Linting**: ESLint + TypeScript

## 🔧 Development Scripts

```bash
# Development
npm run dev              # Start dev server with hot reload
npm run dev:vite         # Start only Vite dev server
npm run dev:electron     # Start only Electron (requires Vite)

# Building
npm run build            # Build for current platform
npm run build:mac        # Build macOS DMG
npm run build:win        # Build Windows installer
npm run build:dir        # Build without packaging

# Code Quality
npm run lint             # Run ESLint
npm run typecheck        # Run TypeScript compiler
```

## 🔌 Core Integrations

### ccusage Integration

Located in `src/lib/ccusage-integration.ts`:

- Reads Claude usage data from `~/.claude/projects/*/usage.jsonl`
- Parses JSONL format and aggregates by date
- Provides usage statistics and cost calculations

### Auto-Renewal Service

Located in `src/lib/auto-renewal-integration.ts`:

- Monitors Claude billing cycles using ccusage
- Automatically starts new sessions before timeouts
- Configurable scheduling and logging

### IPC Communication

The app uses Electron's IPC for main/renderer communication:

- **Main Process**: `electron/main.ts` - handles system operations
- **Preload Script**: `electron/preload.ts` - exposes safe APIs to renderer
- **Renderer Process**: `src/` - React UI components

## 🎨 UI Development

### Component Guidelines

- Use TypeScript for all components
- Follow functional component patterns with hooks
- Implement proper error boundaries
- Use Tailwind for styling with design system tokens

### State Management

Using Zustand for simple, type-safe state management:

```typescript
// Example store
const useMyStore = create<MyState>((set, get) => ({
  data: [],
  loading: false,
  setData: (data) => set({ data }),
  // ...
}))
```

### Adding New Features

1. **Backend Logic**: Add service in `electron/services/`
2. **IPC Handlers**: Register in `electron/main.ts`
3. **Frontend State**: Create/update Zustand store
4. **UI Components**: Build React components
5. **Integration**: Connect via IPC calls

## 📦 Building & Distribution

### Local Development Builds

```bash
# Quick test build
npm run build:dir

# Platform-specific builds
npm run build:mac        # Creates .dmg for macOS
npm run build:win        # Creates .exe installer for Windows
```

### Production Builds

The GitHub Actions workflow automatically builds for all platforms:

- **macOS**: DMG and ZIP archives (x64 + ARM64)
- **Windows**: NSIS installer and portable EXE (x64 + x86)
- **Linux**: AppImage and DEB packages (x64)

### Code Signing

For production releases:

1. **macOS**: Set up Apple Developer certificates
2. **Windows**: Configure code signing certificates
3. **Update**: `electron-builder` configuration in `package.json`

## 🐛 Debugging

### Development Tools

- **React DevTools**: Available in development
- **Electron DevTools**: F12 or `Cmd+Opt+I`
- **Main Process**: Use `console.log()` (visible in terminal)
- **Renderer Process**: Use browser DevTools

### Common Issues

1. **IPC Errors**: Check preload script exposure
2. **Build Failures**: Verify TypeScript compilation
3. **File Access**: Ensure proper permissions for Claude data
4. **Auto-renewal**: Check ccusage installation and Claude CLI

### Logging

- **Main Process**: Console output in terminal
- **Renderer Process**: Browser console
- **Auto-renewal**: Check `~/.claude-sentinel-renewal.log`

## 🤝 Contributing

### Code Style

- Use TypeScript strict mode
- Follow ESLint configuration
- Use conventional commit messages
- Add JSDoc comments for public APIs

### Pull Request Process

1. Fork the repository
2. Create feature branch from `main`
3. Implement changes with tests
4. Ensure all checks pass
5. Submit pull request

### Testing

```bash
# Run type checking
npm run typecheck

# Run linting
npm run lint

# Build test
npm run build:dir
```

## 📖 Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [React Documentation](https://react.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [Zustand State Management](https://zustand-demo.pmnd.rs)
- [electron-builder](https://www.electron.build)

## 📝 License

MIT License - see LICENSE file for details.