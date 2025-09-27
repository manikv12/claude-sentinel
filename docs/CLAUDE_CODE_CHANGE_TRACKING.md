# Claude Code Change Tracking & Rollback System

## Overview
This document outlines the design and implementation strategy for tracking changes made by Claude Code CLI and providing rollback functionality within the Claude Sentinel application.

## Problem Statement
Claude Code is a standalone CLI tool that operates independently from Claude Sentinel. We need a way to:
- Track all file changes made during Claude Code sessions
- Associate changes with specific Claude Code messages/prompts
- Provide easy rollback functionality for unwanted changes
- Maintain a history of all changes without affecting the main git repository

## Solution Architecture

### Core Concept: Shadow Git Repository
We'll use a parallel git repository (shadow repo) to track all changes made by Claude Code without interfering with the main project's git history.

```
Project Structure:
├── your-project/           (main project with its own .git)
└── .claude-sentinel/
    ├── tracking-repo/      (shadow git repository)
    ├── sessions.json       (session metadata)
    └── config.json         (tracking configuration)
```

## Integration Strategies

### Option 1: File System Watcher + Auto-Commit (Recommended)

#### How It Works
1. **File System Monitoring**: Use `chokidar` or Node's `fs.watch()` to monitor the project directory
2. **Change Detection**: Detect file modifications in real-time
3. **Debouncing**: Group rapid changes together (3-5 second window)
4. **Auto-Commit**: Automatically commit changes to shadow repository
5. **Session Management**: Use heuristics or manual controls to define session boundaries

#### Implementation Components

##### 1. File Watcher Service (`electron/services/claude-watcher-service.ts`)
```typescript
interface WatcherConfig {
  projectPath: string;
  shadowRepoPath: string;
  debounceMs: number;
  ignoredPaths: string[];
}

class ClaudeWatcherService {
  - startWatching(config: WatcherConfig)
  - stopWatching()
  - createSnapshot()
  - autoCommit(changedFiles: string[])
}
```

##### 2. Git Tracking Service (`electron/services/git-tracking-service.ts`)
```typescript
class GitTrackingService {
  - initShadowRepo(path: string)
  - copyFilesToShadow(files: string[])
  - createCommit(message: string, metadata: object)
  - createBranch(sessionId: string)
  - tagSession(sessionId: string)
  - rollback(commitHash: string)
  - cherryPick(commitHash: string)
  - getDiff(fromCommit: string, toCommit: string)
}
```

### Option 2: Claude Code Wrapper Script

#### Create a wrapper script that users run instead of `claude`
```bash
#!/bin/bash
# claude-tracked

# Start session tracking
SESSION_ID=$(uuidgen)
echo "SESSION_START:$SESSION_ID:$(date +%s)" >> ~/.claude-sentinel/sessions.log

# Create git branch for this session
git checkout -b "claude-session-$SESSION_ID"

# Run Claude Code with all arguments
claude "$@"

# Capture changes
git add -A
git commit -m "[Claude Session $SESSION_ID] Completed at $(date)"

# End session tracking
echo "SESSION_END:$SESSION_ID:$(date +%s)" >> ~/.claude-sentinel/sessions.log
```

### Option 3: Hybrid Approach (Most Robust)

Combines multiple strategies for maximum reliability:

1. **File System Watcher**: Core change detection
2. **Session Markers**: Manual or automatic session boundaries
3. **Git Integration**: Shadow repository for version control
4. **Metadata Tracking**: Rich session information

## Data Models

### Session Model
```typescript
interface ClaudeSession {
  id: string;
  startTime: Date;
  endTime?: Date;
  status: 'active' | 'completed' | 'aborted';
  branches: string[];
  commits: string[];
  filesChanged: string[];
  metadata: {
    userPrompt?: string;
    totalChanges: number;
    linesAdded: number;
    linesDeleted: number;
  };
}
```

### Change Event Model
```typescript
interface ChangeEvent {
  id: string;
  sessionId: string;
  timestamp: Date;
  type: 'create' | 'modify' | 'delete' | 'rename';
  filePath: string;
  previousPath?: string; // for renames
  diff?: string;
  commitHash?: string;
}
```

## UI Components

### 1. Change Tracker Component (`src/components/ChangeTracker.tsx`)
- **Session Timeline**: Visual timeline of all Claude sessions
- **Change List**: Files modified in each session
- **Diff Viewer**: Side-by-side or unified diff view
- **Rollback Controls**: One-click rollback buttons

### 2. Session Manager Component (`src/components/SessionManager.tsx`)
- **Start/Stop Tracking**: Manual session control
- **Session Status**: Current tracking status
- **Auto-detect Toggle**: Enable/disable automatic session detection

### 3. Git History Viewer (`src/components/GitHistory.tsx`)
- **Commit Log**: List of all tracked changes
- **Branch Visualization**: See session branches
- **Tag Management**: View and manage session tags

## Implementation Workflow

### Phase 1: Core Infrastructure
1. Create shadow git repository structure
2. Implement file watcher service
3. Set up git command execution layer
4. Create basic commit functionality

### Phase 2: Session Management
1. Implement session detection logic
2. Add session metadata storage
3. Create branch/tag management
4. Build session correlation system

### Phase 3: UI Integration
1. Build change tracker component
2. Add diff viewer
3. Implement rollback UI
4. Create session timeline

### Phase 4: Advanced Features
1. Conflict resolution for rollbacks
2. Partial rollback (selected files only)
3. Change merging between sessions
4. Export/import session history

## Git Commands Reference

### Essential Git Operations
```bash
# Initialize shadow repository
git init --bare .claude-sentinel/tracking-repo

# Create session branch
git checkout -b claude-session-$(date +%s)

# Track changes
git add -A
git commit -m "[Claude] Auto-save at $(date)"

# Rollback single file
git checkout <commit-hash> -- <file-path>

# Rollback entire session
git revert <commit-range>

# View changes
git diff <from-commit> <to-commit>

# Cherry-pick specific changes
git cherry-pick <commit-hash>
```

## Configuration Options

### `.claude-sentinel/config.json`
```json
{
  "tracking": {
    "enabled": true,
    "autoDetectSessions": true,
    "sessionIdleTimeout": 300000,
    "debounceMs": 3000,
    "ignoredPaths": [
      "node_modules",
      ".git",
      ".claude-sentinel",
      "*.log"
    ],
    "shadowRepoPath": ".claude-sentinel/tracking-repo",
    "maxHistoryDays": 30,
    "autoCleanup": true
  }
}
```

## IPC Communication

### New IPC Handlers
```typescript
// electron/preload.ts additions
{
  // Change tracking
  startTrackingSession: () => ipcRenderer.invoke('start-tracking-session'),
  stopTrackingSession: () => ipcRenderer.invoke('stop-tracking-session'),
  getTrackingSessions: () => ipcRenderer.invoke('get-tracking-sessions'),
  getSessionChanges: (sessionId: string) => ipcRenderer.invoke('get-session-changes', sessionId),
  
  // Git operations
  rollbackChanges: (commitHash: string) => ipcRenderer.invoke('rollback-changes', commitHash),
  rollbackFile: (filePath: string, commitHash: string) => ipcRenderer.invoke('rollback-file', filePath, commitHash),
  getFileDiff: (filePath: string, fromCommit: string, toCommit: string) => ipcRenderer.invoke('get-file-diff', filePath, fromCommit, toCommit),
  
  // Session management
  createSessionBranch: (sessionId: string) => ipcRenderer.invoke('create-session-branch', sessionId),
  mergeSession: (sessionId: string) => ipcRenderer.invoke('merge-session', sessionId),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('delete-session', sessionId),
}
```

## Store Integration

### New Zustand Store (`src/stores/changeTrackingStore.ts`)
```typescript
interface ChangeTrackingStore {
  // State
  sessions: ClaudeSession[];
  activeSessions: string[];
  currentChanges: ChangeEvent[];
  isTracking: boolean;
  
  // Actions
  startTracking: () => void;
  stopTracking: () => void;
  loadSessions: () => Promise<void>;
  loadSessionChanges: (sessionId: string) => Promise<void>;
  rollbackSession: (sessionId: string) => Promise<void>;
  rollbackFile: (filePath: string, sessionId: string) => Promise<void>;
}
```

## Benefits of This Approach

1. **Non-Intrusive**: Doesn't affect main git repository
2. **Complete History**: Every change is tracked with full context
3. **Efficient Storage**: Git's delta compression minimizes storage
4. **Professional Tools**: Leverages git's proven capabilities
5. **Easy Rollback**: Multiple rollback strategies available
6. **Portable**: Can export/backup the shadow repository
7. **Flexible**: Works with or without user interaction

## Potential Challenges & Solutions

### Challenge 1: Detecting Claude Code Sessions
**Solution**: Use combination of:
- Manual session markers (Start/Stop buttons)
- File change patterns (multiple rapid edits)
- Time-based heuristics (first change starts, 5min idle ends)

### Challenge 2: Large Binary Files
**Solution**: 
- Use `.gitignore` in shadow repo for large files
- Store only metadata for binary files
- Implement size limits for tracked files

### Challenge 3: Performance with Many Changes
**Solution**:
- Debounce file system events
- Batch git operations
- Periodic cleanup of old sessions
- Use git's shallow cloning for UI operations

### Challenge 4: Conflicts During Rollback
**Solution**:
- Show preview before rollback
- Offer merge strategies
- Allow partial rollbacks
- Keep backup before rollback operations

## Future Enhancements

1. **Claude Code Integration**: If Claude Code adds webhook/plugin support
2. **AI-Powered Summaries**: Generate change summaries using AI
3. **Collaborative Features**: Share change sessions with team
4. **Smart Rollback**: AI-assisted conflict resolution
5. **Change Analytics**: Track patterns in Claude Code usage
6. **Integration with IDEs**: VSCode/WebStorm extensions

## Testing Strategy

1. **Unit Tests**: Test individual services (watcher, git operations)
2. **Integration Tests**: Test full workflow (detect → track → rollback)
3. **Performance Tests**: Handle large repositories and many changes
4. **Edge Cases**: Network issues, permission problems, corrupted git repo

## Security Considerations

1. **File Permissions**: Ensure proper permissions for shadow repository
2. **Sensitive Data**: Option to exclude files with secrets
3. **Access Control**: Protect rollback functionality
4. **Audit Trail**: Log all rollback operations

## Conclusion

This system provides comprehensive change tracking for Claude Code without requiring modifications to Claude Code itself. It's flexible, robust, and provides professional-grade version control for AI-assisted coding sessions.