# Spec Development Feature

## Overview

The Spec Development feature integrates GitHub's spec-kit methodology with Claude Code to provide AI-powered specification generation directly within Claude Sentinel. This feature enables users to create, refine, and manage project specifications through an interactive chat interface with real-time markdown preview and approval workflows.

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Getting Started](#getting-started)
4. [User Interface](#user-interface)
5. [Commands](#commands)
6. [Project Management](#project-management)
7. [Specification Workflow](#specification-workflow)
8. [File Structure](#file-structure)
9. [API Reference](#api-reference)
10. [Contributing](#contributing)

## Features

### Core Features

- **Interactive Chat Interface**: Claude Code-powered chat for specification generation
- **Real-time Markdown Preview**: Live preview of generated specifications with syntax highlighting
- **Approval Workflow**: Review, approve, or reject specifications before implementation
- **Project Management**: Organize specifications into projects with proper file structure
- **Export Capabilities**: Export specifications to markdown, HTML, or PDF formats
- **Version Control**: Track specification versions and changes over time
- **Template System**: Reusable specification templates for common patterns

### Integration Features

- **Claude Code Integration**: Direct integration with Claude Code session for AI-powered generation
- **File System Management**: Automatic file organization and storage
- **Search and Filter**: Find specifications quickly across projects
- **Tag System**: Organize specifications with custom tags
- **Statistics Dashboard**: Track specification creation and project progress

## Architecture

The Spec Development feature follows a layered architecture:

```
┌─────────────────────────────────────────────────────┐
│                 Frontend (React)                    │
├─────────────────────────────────────────────────────┤
│  SpecDevelopment │ SpecChat │ MarkdownViewer │ ... │
├─────────────────────────────────────────────────────┤
│              Zustand Store (specStore)              │
├─────────────────────────────────────────────────────┤
│                 IPC Communication                   │
├─────────────────────────────────────────────────────┤
│            Electron Main Process                    │
├─────────────────────────────────────────────────────┤
│              Spec Service Backend                   │
├─────────────────────────────────────────────────────┤
│         File System │ Claude Code Integration       │
└─────────────────────────────────────────────────────┘
```

### Component Architecture

- **Frontend Components**: React components for UI interaction
- **State Management**: Zustand store for application state
- **Backend Service**: Electron main process service for file operations
- **IPC Layer**: Communication between renderer and main processes
- **File Management**: Organized file structure for specifications and projects

## Getting Started

### Prerequisites

- Node.js 18+
- Claude Code installed and configured
- Electron development environment

### Installation

The Spec Development feature is built into Claude Sentinel. To use it:

1. Open Claude Sentinel
2. Navigate to the "Spec Development" section in the sidebar
3. Create your first project to get started

### First Project

1. Click "New Project" in the header
2. Enter a project name (e.g., "My Web App")
3. The system will create a project structure
4. Start chatting to generate your first specification

## User Interface

### Main Layout

The Spec Development interface uses a flexible layout system:

- **Header**: Project selection, view mode controls, and actions
- **Chat Panel**: Interactive conversation with Claude Code
- **Preview Panel**: Live markdown preview of specifications
- **Approval Dialog**: Review and approve specifications

### View Modes

1. **Chat View**: Focus on conversation with Claude Code
2. **Split View**: Chat and preview side-by-side (default)
3. **Preview View**: Focus on specification preview

### Project Information

- Active project name and description
- Specification count and status
- Project file path for organization

## Commands

The system supports spec-kit style commands for different specification tasks:

### `/specify [description]`
Generate a new comprehensive specification.

**Example:**
```
/specify Build a photo organization application
```

**Output:**
- Complete specification document
- Requirements breakdown
- User stories
- Technical considerations
- Success criteria

### `/plan [requirements]`
Create a technical implementation plan.

**Example:**
```
/plan Use React with TypeScript and modern tooling
```

**Output:**
- Technical architecture
- Technology stack recommendations
- Development phases
- Risk assessment
- Timeline estimates

### `/tasks [specification]`
Break down implementation into actionable tasks.

**Example:**
```
/tasks Create user authentication system
```

**Output:**
- Detailed task breakdown
- Prerequisites and dependencies
- Acceptance criteria
- Effort estimates
- Implementation order

### `/refine [existing specification]`
Improve and refine existing specifications.

**Example:**
```
/refine Add mobile responsiveness requirements
```

**Output:**
- Enhanced specification
- Clarity improvements
- Completeness review
- Best practice recommendations

## Project Management

### Project Structure

Each project creates an organized file structure:

```
~/.claude-sentinel/specs/
├── projects/
│   └── [project-id]/
│       ├── project.json          # Project metadata
│       ├── specs/                # Specification files
│       │   ├── [spec-id].json   # Spec metadata
│       │   └── [spec-id].md     # Spec content
│       └── templates/           # Custom templates
└── config.json                 # Global configuration
```

### Project Operations

- **Create Project**: Initialize new specification project
- **Switch Projects**: Change active project context
- **Project Settings**: Configure project-specific options
- **Project Statistics**: View project progress and metrics

## Specification Workflow

### 1. Creation
- Use commands to generate specifications
- Real-time preview updates as content is generated
- Interactive refinement through follow-up questions

### 2. Review
- Preview generated specification
- Check completeness and accuracy
- Make inline edits if needed

### 3. Approval
- Open approval dialog
- Rate specification quality (1-5 stars)
- Add tags for organization
- Provide feedback comments
- Approve or reject specification

### 4. Storage
- Approved specifications saved to file system
- Version tracking with changelog
- Searchable metadata storage

## File Structure

### Frontend Components

```
src/components/spec-development/
├── SpecDevelopment.tsx      # Main container
├── SpecChat.tsx            # Chat interface
├── MarkdownViewer.tsx      # Specification preview
├── SpecApproval.tsx        # Approval workflow
└── SpecBrowser.tsx         # File management (future)
```

### Backend Services

```
electron/services/
└── spec-service.ts         # Core specification service
```

### State Management

```
src/stores/
└── specStore.ts           # Zustand store for state
```

### Type Definitions

```
electron/preload.d.ts      # IPC method types
```

## API Reference

### Frontend Store (specStore)

#### State Interface
```typescript
interface SpecStore {
  // Chat state
  messages: ChatMessage[]
  isStreaming: boolean
  currentCommand: string | null

  // Specification state
  specifications: Specification[]
  currentSpec: Specification | null
  activeProject: SpecProject | null

  // Projects state
  projects: SpecProject[]

  // UI state
  isGenerating: boolean
  showApprovalDialog: boolean
  selectedSpecId: string | null
  viewMode: 'chat' | 'split' | 'preview'
}
```

#### Key Methods
```typescript
// Chat actions
addMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): void
executeCommand(command: string, content: string): Promise<void>

// Specification actions
createSpec(spec: Omit<Specification, 'id' | 'createdAt' | 'updatedAt' | 'version'>): void
updateSpec(id: string, updates: Partial<Specification>): void
approveSpec(id: string): void
rejectSpec(id: string): void

// Project actions
createProject(project: Omit<SpecProject, 'id' | 'createdAt' | 'specs'>): Promise<SpecProject>
setActiveProject(project: SpecProject | null): void

// Backend integration
loadProjectsFromBackend(): Promise<void>
saveSpecToBackend(projectId: string, spec: Specification): Promise<void>
loadSpecsFromBackend(projectId: string): Promise<void>
```

### Backend Service (spec-service)

#### Core Methods
```typescript
class SpecService {
  // Project management
  createProject(projectData: Omit<SpecProject, 'id' | 'createdAt' | 'specs'>): Promise<SpecProject>
  getProjects(): Promise<SpecProject[]>

  // Specification management
  saveSpecification(projectId: string, spec: Specification): Promise<void>
  loadSpecifications(projectId: string): Promise<Specification[]>
  deleteSpecification(projectId: string, specId: string): Promise<void>

  // Claude Code integration
  executeClaudeCodeCommand(command: string, content: string, projectPath: string): Promise<string>

  // Export functionality
  exportSpecification(specId: string, projectId: string, format: 'md' | 'pdf' | 'html'): Promise<string>

  // Utilities
  getStats(): Promise<{projects: number, specs: number, totalSize: number}>
  getSpecDirectory(): Promise<string>
}
```

### IPC API

#### Available Methods
```typescript
// Project operations
window.electronAPI.specCreateProject(projectData: any): Promise<any>
window.electronAPI.specGetProjects(): Promise<any>

// Specification operations
window.electronAPI.specSaveSpecification(projectId: string, spec: any): Promise<any>
window.electronAPI.specLoadSpecifications(projectId: string): Promise<any>
window.electronAPI.specDeleteSpecification(projectId: string, specId: string): Promise<any>

// Command execution
window.electronAPI.specExecuteCommand(command: string, content: string, projectPath: string): Promise<any>

// Export and utilities
window.electronAPI.specExportSpecification(specId: string, projectId: string, format?: string): Promise<any>
window.electronAPI.specGetStats(): Promise<any>
window.electronAPI.specGetDirectory(): Promise<any>
```

## Data Models

### ChatMessage
```typescript
interface ChatMessage {
  id: string
  type: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  metadata?: {
    command?: string
    isStreaming?: boolean
    tokens?: number
  }
}
```

### Specification
```typescript
interface Specification {
  id: string
  title: string
  description: string
  content: string
  status: 'draft' | 'approved' | 'rejected' | 'in_review'
  createdAt: Date
  updatedAt: Date
  projectPath?: string
  tags: string[]
  version: number
  parentId?: string
}
```

### SpecProject
```typescript
interface SpecProject {
  id: string
  name: string
  description: string
  path: string
  createdAt: Date
  specs: string[]
  isActive: boolean
}
```

## Dependencies

### Added Dependencies
- `react-markdown`: Markdown rendering
- `remark-gfm`: GitHub Flavored Markdown support
- `react-syntax-highlighter`: Code syntax highlighting
- `@types/react-syntax-highlighter`: TypeScript definitions
- `@uiw/react-md-editor`: Markdown editing capabilities

### Existing Dependencies Used
- `zustand`: State management
- `lucide-react`: Icons
- `tailwindcss`: Styling
- `electron`: Desktop application framework

## Contributing

### Development Setup

1. Install dependencies: `npm install`
2. Run development server: `npm run dev`
3. Run type checking: `npm run typecheck`
4. Build application: `npm run build`

### Code Organization

- Follow existing component patterns
- Use TypeScript for type safety
- Maintain separation between UI and business logic
- Add comprehensive error handling
- Document new features and APIs

### Testing

- Test all command types (`/specify`, `/plan`, `/tasks`, `/refine`)
- Verify file system operations
- Ensure proper state management
- Test approval workflow
- Validate export functionality

## Future Enhancements

### Planned Features

1. **Advanced Templates**: Custom specification templates
2. **Collaboration**: Multi-user specification editing
3. **Integration**: Connect with GitHub, Jira, etc.
4. **AI Improvements**: Enhanced Claude Code integration
5. **Analytics**: Detailed specification metrics
6. **Mobile Support**: Responsive design improvements

### Extension Points

- Custom command handlers
- Plugin system for integrations
- Themeable UI components
- Custom export formats
- Advanced search capabilities

## Troubleshooting

### Common Issues

1. **Commands not working**: Ensure Claude Code is properly integrated
2. **Files not saving**: Check file permissions and directory structure
3. **Preview not updating**: Verify markdown parsing dependencies
4. **Performance issues**: Monitor specification size and complexity

### Debug Information

- Check Electron console for backend errors
- Review browser console for frontend issues
- Examine file system structure in `~/.claude-sentinel/specs/`
- Verify IPC communication between processes

For more detailed information, see the individual documentation files in this directory.