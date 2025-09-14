# Spec Development API Reference

## Overview

This document provides a comprehensive reference for the Spec Development feature APIs, including frontend store methods, backend service APIs, and IPC communication interfaces.

## Table of Contents

1. [Frontend Store API (Zustand)](#frontend-store-api-zustand)
2. [Backend Service API](#backend-service-api)
3. [IPC Communication API](#ipc-communication-api)
4. [Data Models](#data-models)
5. [Error Handling](#error-handling)
6. [Usage Examples](#usage-examples)

## Frontend Store API (Zustand)

### Store State Interface

```typescript
interface SpecStore {
  // Chat State
  messages: ChatMessage[]
  isStreaming: boolean
  currentCommand: string | null

  // Specification State
  specifications: Specification[]
  currentSpec: Specification | null
  activeProject: SpecProject | null

  // Projects State
  projects: SpecProject[]

  // UI State
  isGenerating: boolean
  showApprovalDialog: boolean
  selectedSpecId: string | null
  viewMode: 'chat' | 'split' | 'preview'

  // Actions (methods listed below)
}
```

### Chat Actions

#### `addMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): void`

Adds a new message to the chat history.

**Parameters:**
- `message`: Message object without id and timestamp (auto-generated)
  - `type`: 'user' | 'assistant' | 'system'
  - `content`: string
  - `metadata?`: Optional metadata object

**Example:**
```typescript
const { addMessage } = useSpecStore()

addMessage({
  type: 'user',
  content: '/specify Build a photo gallery app',
  metadata: { command: '/specify' }
})
```

#### `updateMessage(id: string, updates: Partial<ChatMessage>): void`

Updates an existing message by ID.

**Parameters:**
- `id`: Message ID to update
- `updates`: Partial message object with updates

**Example:**
```typescript
updateMessage('msg-123', {
  content: 'Updated message content',
  metadata: { ...existingMetadata, tokens: 150 }
})
```

#### `clearMessages(): void`

Clears all chat messages.

**Example:**
```typescript
const { clearMessages } = useSpecStore()
clearMessages()
```

#### `executeCommand(command: string, content: string): Promise<void>`

Executes a spec-kit command and handles the response.

**Parameters:**
- `command`: The command to execute ('/specify', '/plan', '/tasks', '/refine')
- `content`: The content/context for the command

**Example:**
```typescript
await executeCommand('/specify', 'Build a task management application')
```

**Process:**
1. Sets generating state to true
2. Adds user message to chat
3. Calls backend service via IPC
4. Processes response and creates specification (for /specify)
5. Adds assistant response message
6. Updates UI state

### Specification Actions

#### `createSpec(spec: Omit<Specification, 'id' | 'createdAt' | 'updatedAt' | 'version'>): void`

Creates a new specification and adds it to the current project.

**Parameters:**
- `spec`: Specification data without auto-generated fields

**Example:**
```typescript
createSpec({
  title: 'User Authentication System',
  description: 'Complete authentication flow',
  content: '# Authentication Spec\n\n...',
  status: 'draft',
  tags: ['auth', 'security']
})
```

#### `updateSpec(id: string, updates: Partial<Specification>): void`

Updates an existing specification.

**Parameters:**
- `id`: Specification ID
- `updates`: Partial specification object with updates

**Example:**
```typescript
updateSpec('spec-123', {
  status: 'approved',
  tags: [...existingTags, 'reviewed']
})
```

#### `approveSpec(id: string): void`

Approves a specification and closes the approval dialog.

**Parameters:**
- `id`: Specification ID to approve

**Example:**
```typescript
approveSpec('spec-123')
```

#### `rejectSpec(id: string): void`

Rejects a specification and closes the approval dialog.

**Parameters:**
- `id`: Specification ID to reject

**Example:**
```typescript
rejectSpec('spec-123')
```

#### `deleteSpec(id: string): void`

Deletes a specification from the store.

**Parameters:**
- `id`: Specification ID to delete

**Example:**
```typescript
deleteSpec('spec-123')
```

#### `setCurrentSpec(spec: Specification | null): void`

Sets the currently active specification.

**Parameters:**
- `spec`: Specification object or null to clear

**Example:**
```typescript
setCurrentSpec(selectedSpec)
```

### Project Actions

#### `createProject(project: Omit<SpecProject, 'id' | 'createdAt' | 'specs'>): Promise<SpecProject>`

Creates a new project via backend service.

**Parameters:**
- `project`: Project data without auto-generated fields

**Returns:**
- `Promise<SpecProject>`: Created project object

**Example:**
```typescript
const newProject = await createProject({
  name: 'My Web App',
  description: 'A modern web application',
  path: './specs/my-web-app',
  isActive: true
})
```

#### `setActiveProject(project: SpecProject | null): void`

Sets the currently active project.

**Parameters:**
- `project`: Project object or null to clear

**Example:**
```typescript
setActiveProject(selectedProject)
```

#### `updateProject(id: string, updates: Partial<SpecProject>): void`

Updates an existing project.

**Parameters:**
- `id`: Project ID
- `updates`: Partial project object with updates

**Example:**
```typescript
updateProject('proj-123', {
  description: 'Updated project description',
  specs: [...existingSpecs, 'new-spec-id']
})
```

### UI Actions

#### `setIsGenerating(generating: boolean): void`

Sets the generating state for UI feedback.

#### `setShowApprovalDialog(show: boolean): void`

Controls the visibility of the approval dialog.

#### `setSelectedSpecId(id: string | null): void`

Sets the ID of the spec selected for approval.

#### `setViewMode(mode: 'chat' | 'split' | 'preview'): void`

Changes the current view mode.

### Backend Integration Actions

#### `loadProjectsFromBackend(): Promise<void>`

Loads all projects from the backend service.

**Example:**
```typescript
await loadProjectsFromBackend()
```

#### `saveSpecToBackend(projectId: string, spec: Specification): Promise<void>`

Saves a specification to the backend storage.

**Parameters:**
- `projectId`: Target project ID
- `spec`: Specification to save

**Example:**
```typescript
await saveSpecToBackend('proj-123', specification)
```

#### `loadSpecsFromBackend(projectId: string): Promise<void>`

Loads all specifications for a project from backend.

**Parameters:**
- `projectId`: Project ID to load specs from

**Example:**
```typescript
await loadSpecsFromBackend('proj-123')
```

## Backend Service API

### SpecService Class

The core backend service providing all specification-related operations.

#### Project Management

##### `createProject(projectData: Omit<SpecProject, 'id' | 'createdAt' | 'specs'>): Promise<SpecProject>`

Creates a new project with file system structure.

**Process:**
1. Generates unique project ID
2. Creates project directory structure
3. Initializes project metadata file
4. Attempts spec-kit initialization (if available)
5. Returns project object

**Error Handling:**
- Throws error if directory creation fails
- Warns if spec-kit initialization fails but continues

##### `getProjects(): Promise<SpecProject[]>`

Retrieves all projects from the file system.

**Returns:**
- `Promise<SpecProject[]>`: Array of project objects sorted by creation date

**Process:**
1. Scans projects directory
2. Reads project metadata files
3. Parses and validates project data
4. Returns sorted array

##### `updateProject(id: string, updates: Partial<SpecProject>): Promise<void>`

Updates project metadata (future implementation).

#### Specification Management

##### `saveSpecification(projectId: string, spec: Specification): Promise<void>`

Saves a specification to both JSON and Markdown files.

**Parameters:**
- `projectId`: Target project ID
- `spec`: Complete specification object

**Process:**
1. Creates specs directory if needed
2. Saves metadata to JSON file
3. Saves content to Markdown file
4. Updates project specs list

**Error Handling:**
- Throws error if project doesn't exist
- Throws error if file write fails

##### `loadSpecifications(projectId: string): Promise<Specification[]>`

Loads all specifications for a project.

**Returns:**
- `Promise<Specification[]>`: Array of specifications sorted by update date

**Process:**
1. Reads specs directory
2. Parses JSON metadata files
3. Reconstructs specification objects
4. Returns sorted array

##### `deleteSpecification(projectId: string, specId: string): Promise<void>`

Deletes a specification and its associated files.

**Parameters:**
- `projectId`: Project containing the specification
- `specId`: Specification ID to delete

**Process:**
1. Removes JSON metadata file
2. Removes Markdown content file
3. Updates project specs list

#### Claude Code Integration

##### `executeClaudeCodeCommand(command: string, content: string, projectPath: string, window?: BrowserWindow): Promise<string>`

Executes a spec-kit style command and returns the response.

**Parameters:**
- `command`: The command to execute
- `content`: Command context/content
- `projectPath`: Target project path
- `window`: Optional browser window for UI feedback

**Returns:**
- `Promise<string>`: Generated specification or response content

**Current Implementation:**
- Builds structured prompts for each command type
- Returns mock responses for development
- Simulates processing time

**Future Implementation:**
- Direct integration with Claude Code session
- Real-time streaming responses
- Context awareness and conversation history

#### Export and Utilities

##### `exportSpecification(specId: string, projectId: string, format: 'md' | 'pdf' | 'html' = 'md'): Promise<string>`

Exports a specification in the requested format.

**Parameters:**
- `specId`: Specification to export
- `projectId`: Source project
- `format`: Export format (markdown, PDF, or HTML)

**Returns:**
- `Promise<string>`: Exported content or file path

**Supported Formats:**
- `md`: Raw markdown content
- `html`: Basic HTML conversion (basic implementation)
- `pdf`: PDF generation (planned feature)

##### `getStats(): Promise<{projects: number, specs: number, totalSize: number}>`

Returns usage statistics for the spec development feature.

**Returns:**
- `projects`: Total number of projects
- `specs`: Total number of specifications
- `totalSize`: Approximate total content size in bytes

##### `getSpecDirectory(): Promise<string>`

Returns the base directory path for spec storage.

**Returns:**
- `Promise<string>`: Absolute path to specs directory

### File System Structure

The service manages this file structure:

```
~/.claude-sentinel/specs/
├── config.json                 # Global configuration
├── projects/                   # Project storage
│   └── [project-id]/
│       ├── project.json        # Project metadata
│       ├── specs/              # Specification files
│       │   ├── [spec-id].json # Spec metadata
│       │   └── [spec-id].md   # Spec content
│       └── templates/          # Project templates (future)
└── templates/                  # Global templates (future)
```

## IPC Communication API

### Available Methods

All IPC methods are exposed through `window.electronAPI` in the renderer process.

#### Project Operations

##### `specCreateProject(projectData: any): Promise<any>`

Creates a new project via IPC.

**Example:**
```typescript
const project = await window.electronAPI.specCreateProject({
  name: 'My Project',
  description: 'Project description',
  path: './specs/my-project',
  isActive: true
})
```

##### `specGetProjects(): Promise<any>`

Retrieves all projects via IPC.

**Example:**
```typescript
const projects = await window.electronAPI.specGetProjects()
```

#### Specification Operations

##### `specSaveSpecification(projectId: string, spec: any): Promise<any>`

Saves a specification via IPC.

**Example:**
```typescript
await window.electronAPI.specSaveSpecification('proj-123', specification)
```

##### `specLoadSpecifications(projectId: string): Promise<any>`

Loads specifications for a project via IPC.

**Example:**
```typescript
const specs = await window.electronAPI.specLoadSpecifications('proj-123')
```

##### `specDeleteSpecification(projectId: string, specId: string): Promise<any>`

Deletes a specification via IPC.

**Example:**
```typescript
await window.electronAPI.specDeleteSpecification('proj-123', 'spec-456')
```

#### Command Execution

##### `specExecuteCommand(command: string, content: string, projectPath: string): Promise<any>`

Executes a spec-kit command via IPC.

**Example:**
```typescript
const response = await window.electronAPI.specExecuteCommand(
  '/specify',
  'Build a user authentication system',
  './specs/my-project'
)
```

#### Export and Utilities

##### `specExportSpecification(specId: string, projectId: string, format?: string): Promise<any>`

Exports a specification via IPC.

**Example:**
```typescript
const content = await window.electronAPI.specExportSpecification(
  'spec-123',
  'proj-456',
  'md'
)
```

##### `specGetStats(): Promise<any>`

Gets usage statistics via IPC.

**Example:**
```typescript
const stats = await window.electronAPI.specGetStats()
console.log(`${stats.projects} projects, ${stats.specs} specs`)
```

##### `specGetDirectory(): Promise<any>`

Gets the spec storage directory via IPC.

**Example:**
```typescript
const directory = await window.electronAPI.specGetDirectory()
```

## Data Models

### ChatMessage

```typescript
interface ChatMessage {
  id: string                    // Unique message identifier
  type: 'user' | 'assistant' | 'system'  // Message type
  content: string              // Message content
  timestamp: Date              // Creation timestamp
  metadata?: {                 // Optional metadata
    command?: string           // Associated command
    isStreaming?: boolean      // Streaming status
    tokens?: number            // Token count
  }
}
```

### Specification

```typescript
interface Specification {
  id: string                   // Unique specification identifier
  title: string               // Specification title
  description: string         // Brief description
  content: string             // Full markdown content
  status: 'draft' | 'approved' | 'rejected' | 'in_review'  // Current status
  createdAt: Date             // Creation timestamp
  updatedAt: Date             // Last update timestamp
  projectPath?: string        // Associated project path
  tags: string[]              // Organization tags
  version: number             // Version number
  parentId?: string           // Parent spec for versioning
}
```

### SpecProject

```typescript
interface SpecProject {
  id: string                  // Unique project identifier
  name: string               // Project name
  description: string        // Project description
  path: string               // File system path
  createdAt: Date            // Creation timestamp
  specs: string[]            // Array of spec IDs
  isActive: boolean          // Active project flag
}
```

## Error Handling

### Error Categories

1. **Validation Errors**: Invalid input data
2. **File System Errors**: Read/write operations
3. **IPC Errors**: Communication failures
4. **Service Errors**: Business logic failures

### Error Response Format

```typescript
interface ApiError {
  message: string              // Human-readable error message
  code?: string               // Error code for programmatic handling
  details?: any               // Additional error details
}
```

### Common Error Scenarios

#### Project Creation Errors

```typescript
try {
  const project = await createProject(projectData)
} catch (error) {
  if (error.message.includes('already exists')) {
    // Handle duplicate project
  } else if (error.message.includes('permission')) {
    // Handle permission errors
  } else {
    // Handle general errors
  }
}
```

#### Specification Save Errors

```typescript
try {
  await saveSpecToBackend(projectId, spec)
} catch (error) {
  // Show user-friendly error message
  addMessage({
    type: 'system',
    content: `Failed to save specification: ${error.message}`
  })
}
```

## Usage Examples

### Complete Specification Creation Flow

```typescript
// 1. Create a new project
const project = await createProject({
  name: 'E-commerce Platform',
  description: 'Online shopping platform',
  path: './specs/ecommerce',
  isActive: true
})

// 2. Execute a specification command
await executeCommand('/specify', 'Build a user authentication system with OAuth support')

// 3. Review and approve the generated specification
const currentSpec = useSpecStore.getState().currentSpec
if (currentSpec) {
  // Show approval dialog
  setSelectedSpecId(currentSpec.id)
  setShowApprovalDialog(true)
}

// 4. Approve the specification
approveSpec(currentSpec.id)

// 5. Save to backend (automatic in approval process)
await saveSpecToBackend(project.id, currentSpec)
```

### Bulk Operations

```typescript
// Load multiple projects and their specifications
const projects = await window.electronAPI.specGetProjects()
for (const project of projects) {
  const specs = await window.electronAPI.specLoadSpecifications(project.id)
  console.log(`Project ${project.name}: ${specs.length} specifications`)
}
```

### Export All Specifications

```typescript
const { projects } = useSpecStore.getState()
for (const project of projects) {
  const specs = await window.electronAPI.specLoadSpecifications(project.id)
  for (const spec of specs) {
    const content = await window.electronAPI.specExportSpecification(
      spec.id,
      project.id,
      'md'
    )
    // Save to file or send to external system
  }
}
```

This API reference provides comprehensive documentation for integrating with and extending the Spec Development feature.