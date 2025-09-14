# Spec Development Integration Guide

## Overview

This guide covers how the Spec Development feature integrates with Claude Code, the file system, and other components of Claude Sentinel. It also provides information for developers who want to extend or integrate with the feature.

## Table of Contents

1. [Claude Code Integration](#claude-code-integration)
2. [File System Integration](#file-system-integration)
3. [Electron IPC Integration](#electron-ipc-integration)
4. [State Management Integration](#state-management-integration)
5. [UI Component Integration](#ui-component-integration)
6. [External Tool Integration](#external-tool-integration)
7. [Extension Points](#extension-points)
8. [Custom Integrations](#custom-integrations)

## Claude Code Integration

### Current Implementation

The Spec Development feature integrates with Claude Code through a service-based approach that simulates the spec-kit methodology:

```typescript
class SpecService {
  async executeClaudeCodeCommand(
    command: string,
    content: string,
    projectPath: string,
    window?: BrowserWindow
  ): Promise<string> {
    const fullPrompt = this.buildSpecKitPrompt(command, content)

    // Current: Mock response for development
    return this.generateMockResponse(command, content)

    // Future: Direct Claude Code integration
    // return await this.callClaudeCodeAPI(fullPrompt, projectPath)
  }
}
```

### Spec-Kit Command Mapping

The system translates spec-kit commands into structured prompts:

#### `/specify` Command
Converts to a comprehensive specification prompt:
```
I need you to create a detailed specification for: {content}

Please structure your response as a comprehensive specification document that includes:

1. **Overview**: Brief description of what we're building
2. **Requirements**: Detailed functional and non-functional requirements
3. **User Stories**: Key user scenarios and use cases
4. **Technical Considerations**: Architecture, technology choices, constraints
5. **Success Criteria**: How we'll know this is complete and successful
6. **Implementation Notes**: Any specific guidance for development

Focus on the "what" and "why" rather than the "how". Be specific and actionable.
```

#### `/plan` Command
Converts to a technical planning prompt:
```
Create a technical implementation plan for: {content}

Please provide:

1. **Technical Architecture**: High-level system design
2. **Technology Stack**: Recommended tools, frameworks, libraries
3. **Development Phases**: Logical breakdown of implementation stages
4. **Dependencies**: External services, APIs, or systems needed
5. **Risks and Mitigation**: Potential challenges and solutions
6. **Timeline Estimates**: Rough effort estimates for each phase

Focus on the technical "how" while considering the broader context.
```

### Future Integration Options

#### Option 1: Direct API Integration
```typescript
class ClaudeCodeAPIIntegration {
  async executeCommand(prompt: string, context: SpecContext): Promise<string> {
    const response = await fetch('/api/claude-code/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        context: {
          projectPath: context.projectPath,
          previousConversation: context.chatHistory,
          specificationContext: context.existingSpecs
        }
      })
    })

    return await response.text()
  }
}
```

#### Option 2: Session Sharing
```typescript
class ClaudeCodeSessionIntegration {
  private sharedSession: ClaudeCodeSession

  async initializeSession(projectPath: string): Promise<void> {
    this.sharedSession = await ClaudeCode.createSession({
      workingDirectory: projectPath,
      context: 'spec-development',
      tools: ['file-operations', 'analysis']
    })
  }

  async executeInSession(prompt: string): Promise<string> {
    return await this.sharedSession.execute(prompt)
  }
}
```

#### Option 3: Plugin Architecture
```typescript
// Claude Code Plugin Definition
export class SpecKitPlugin implements ClaudeCodePlugin {
  name = 'spec-kit'
  version = '1.0.0'

  commands = {
    '/specify': this.handleSpecify,
    '/plan': this.handlePlan,
    '/tasks': this.handleTasks,
    '/refine': this.handleRefine
  }

  async handleSpecify(content: string, context: CommandContext): Promise<string> {
    // Plugin implementation
  }
}
```

### Integration Configuration

Configuration for Claude Code integration:

```json
{
  "claudeCode": {
    "integrationMode": "mock", // "mock" | "api" | "session" | "plugin"
    "apiEndpoint": "http://localhost:3001/api/claude-code",
    "sessionTimeout": 300000,
    "contextWindow": 100000,
    "retryAttempts": 3,
    "streamingEnabled": true
  }
}
```

## File System Integration

### Directory Structure

The feature manages a hierarchical file structure:

```
~/.claude-sentinel/specs/
├── config.json                 # Global configuration
├── templates/                  # Global templates
│   ├── specification.md       # Default spec template
│   ├── technical-plan.md      # Technical plan template
│   └── task-breakdown.md      # Task breakdown template
├── projects/                  # Project storage
│   └── [project-id]/
│       ├── project.json       # Project metadata
│       ├── .spec-kit/         # Spec-kit configuration (if available)
│       ├── specs/             # Specification files
│       │   ├── [spec-id].json # Specification metadata
│       │   └── [spec-id].md   # Specification content
│       ├── templates/         # Project-specific templates
│       └── exports/           # Generated exports
└── cache/                     # Temporary files and cache
```

### File Operations

#### Project Creation
```typescript
async createProject(projectData: ProjectData): Promise<SpecProject> {
  // 1. Generate unique ID and create directory
  const projectId = this.generateId()
  const projectPath = path.join(this.specDir, 'projects', projectId)
  await fs.mkdir(projectPath, { recursive: true })

  // 2. Create project metadata
  const project: SpecProject = {
    ...projectData,
    id: projectId,
    createdAt: new Date(),
    specs: []
  }

  // 3. Save project file
  await fs.writeFile(
    path.join(projectPath, 'project.json'),
    JSON.stringify(project, null, 2)
  )

  // 4. Initialize spec-kit if available
  try {
    await this.initializeSpecKit(projectPath, project.name)
  } catch (error) {
    console.warn('Spec-kit initialization failed:', error)
  }

  return project
}
```

#### Specification Storage
```typescript
async saveSpecification(projectId: string, spec: Specification): Promise<void> {
  const projectPath = path.join(this.specDir, 'projects', projectId)
  const specsPath = path.join(projectPath, 'specs')

  // Ensure specs directory exists
  await fs.mkdir(specsPath, { recursive: true })

  // Save metadata and content separately
  await Promise.all([
    fs.writeFile(
      path.join(specsPath, `${spec.id}.json`),
      JSON.stringify(spec, null, 2)
    ),
    fs.writeFile(
      path.join(specsPath, `${spec.id}.md`),
      spec.content
    )
  ])
}
```

### Backup and Recovery

#### Automatic Backups
```typescript
class BackupService {
  async createBackup(projectId?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(this.specDir, 'backups', timestamp)

    if (projectId) {
      // Backup specific project
      const sourcePath = path.join(this.specDir, 'projects', projectId)
      await this.copyDirectory(sourcePath, backupPath)
    } else {
      // Backup entire specs directory
      await this.copyDirectory(this.specDir, backupPath)
    }

    return backupPath
  }

  async restoreBackup(backupPath: string, targetPath?: string): Promise<void> {
    const target = targetPath || this.specDir
    await this.copyDirectory(backupPath, target)
  }
}
```

### File Watching

Monitor file system changes for external edits:

```typescript
class FileWatchService {
  private watchers: Map<string, fs.FSWatcher> = new Map()

  watchProject(projectId: string, callback: (event: FileEvent) => void): void {
    const projectPath = path.join(this.specDir, 'projects', projectId)

    const watcher = fs.watch(projectPath, { recursive: true }, (eventType, filename) => {
      if (filename && filename.endsWith('.md')) {
        callback({
          type: eventType,
          path: path.join(projectPath, filename),
          projectId,
          specId: this.extractSpecId(filename)
        })
      }
    })

    this.watchers.set(projectId, watcher)
  }

  unwatchProject(projectId: string): void {
    const watcher = this.watchers.get(projectId)
    if (watcher) {
      watcher.close()
      this.watchers.delete(projectId)
    }
  }
}
```

## Electron IPC Integration

### IPC Handler Registration

The main process registers IPC handlers for spec development operations:

```typescript
// Main process IPC handlers
export function registerSpecDevelopmentHandlers(): void {
  ipcMain.handle('spec-create-project', async (_, projectData) => {
    try {
      return await specService.createProject(projectData)
    } catch (error) {
      console.error('Error creating project:', error)
      throw error
    }
  })

  ipcMain.handle('spec-execute-command', async (_, command, content, projectPath) => {
    try {
      return await specService.executeClaudeCodeCommand(command, content, projectPath, mainWindow)
    } catch (error) {
      console.error('Error executing command:', error)
      throw error
    }
  })

  // Additional handlers...
}
```

### Preload Script API

The preload script exposes secure APIs to the renderer:

```typescript
// Preload script API definition
const specDevelopmentAPI = {
  // Project operations
  createProject: (projectData: any) =>
    ipcRenderer.invoke('spec-create-project', projectData),
  getProjects: () =>
    ipcRenderer.invoke('spec-get-projects'),

  // Specification operations
  saveSpecification: (projectId: string, spec: any) =>
    ipcRenderer.invoke('spec-save-specification', projectId, spec),
  loadSpecifications: (projectId: string) =>
    ipcRenderer.invoke('spec-load-specifications', projectId),

  // Command execution
  executeCommand: (command: string, content: string, projectPath: string) =>
    ipcRenderer.invoke('spec-execute-command', command, content, projectPath),

  // Export operations
  exportSpecification: (specId: string, projectId: string, format?: string) =>
    ipcRenderer.invoke('spec-export-specification', specId, projectId, format)
}
```

### Error Handling Across IPC

Standardized error handling for IPC operations:

```typescript
// Renderer side error handling
async function safeIpcCall<T>(
  operation: () => Promise<T>,
  fallback: T,
  errorMessage: string
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    console.error(errorMessage, error)

    // Show user-friendly error
    useSpecStore.getState().addMessage({
      type: 'system',
      content: `${errorMessage}: ${error instanceof Error ? error.message : 'Unknown error'}`
    })

    return fallback
  }
}

// Usage example
const projects = await safeIpcCall(
  () => window.electronAPI.specGetProjects(),
  [],
  'Failed to load projects'
)
```

## State Management Integration

### Zustand Store Architecture

The spec development feature uses a dedicated Zustand store:

```typescript
interface SpecStore {
  // State sections
  chat: ChatState
  specifications: SpecificationState
  projects: ProjectState
  ui: UIState

  // Action categories
  chatActions: ChatActions
  specActions: SpecificationActions
  projectActions: ProjectActions
  uiActions: UIActions
  integrationActions: IntegrationActions
}
```

### Store Integration with Components

Components subscribe to specific store slices:

```typescript
// Component subscribing to specific state
function SpecChat() {
  const {
    messages,
    isGenerating,
    executeCommand
  } = useSpecStore(state => ({
    messages: state.messages,
    isGenerating: state.isGenerating,
    executeCommand: state.executeCommand
  }))

  // Component implementation...
}
```

### Store Persistence

Persist important state across app sessions:

```typescript
const persistedSpecStore = create<SpecStore>()(
  persist(
    (set, get) => ({
      // Store implementation
    }),
    {
      name: 'spec-development-storage',
      partialize: (state) => ({
        // Only persist certain parts of state
        activeProject: state.activeProject,
        viewMode: state.viewMode,
        recentProjects: state.projects.slice(-5)
      })
    }
  )
)
```

## UI Component Integration

### Component Hierarchy

```
SpecDevelopment (Container)
├── SpecHeader (Navigation & Controls)
├── SpecChat (Chat Interface)
│   ├── MessageList
│   ├── CommandInput
│   └── CommandSuggestions
├── MarkdownViewer (Preview Panel)
│   ├── MarkdownRenderer
│   ├── ExportControls
│   └── EditingTools
└── SpecApproval (Modal Dialog)
    ├── SpecPreview
    ├── QualityRating
    ├── TagManager
    └── ApprovalActions
```

### Shared Component Integration

Reuse existing Claude Sentinel components:

```typescript
// Import shared components
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'

// Use in spec development components
function SpecApproval() {
  return (
    <Dialog open={showApprovalDialog} onOpenChange={setShowApprovalDialog}>
      <DialogContent className="max-w-2xl glass-card">
        <Card className="p-4 glass-card">
          {/* Approval content */}
        </Card>
      </DialogContent>
    </Dialog>
  )
}
```

### Theme Integration

Maintain consistency with Claude Sentinel's design system:

```typescript
// Use consistent styling classes
const specChatStyles = {
  container: "h-full flex flex-col",
  header: "p-4 border-b border-white/10 bg-white/5",
  messages: "flex-1 overflow-y-auto p-4 space-y-4",
  input: "p-4 border-t border-white/10",
  glassCard: "glass-card border border-white/20",
  glassButton: "glass-button hover:bg-white/10"
}
```

## External Tool Integration

### Version Control Integration

#### Git Integration
```typescript
class GitIntegration {
  async initializeRepository(projectPath: string): Promise<void> {
    await this.exec('git init', { cwd: projectPath })
    await this.exec('git add .', { cwd: projectPath })
    await this.exec('git commit -m "Initial specification commit"', { cwd: projectPath })
  }

  async commitSpecification(projectPath: string, spec: Specification): Promise<void> {
    const message = `Add specification: ${spec.title}`
    await this.exec(`git add specs/${spec.id}.*`, { cwd: projectPath })
    await this.exec(`git commit -m "${message}"`, { cwd: projectPath })
  }
}
```

#### GitHub Integration
```typescript
class GitHubIntegration {
  async createRepository(project: SpecProject): Promise<string> {
    const response = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        'Authorization': `token ${this.githubToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: project.name.toLowerCase().replace(/\s+/g, '-'),
        description: project.description,
        private: false
      })
    })

    const repo = await response.json()
    return repo.clone_url
  }

  async syncSpecifications(projectId: string): Promise<void> {
    // Implementation for syncing specs to GitHub
  }
}
```

### Project Management Integration

#### Jira Integration
```typescript
class JiraIntegration {
  async createEpicFromSpec(spec: Specification): Promise<string> {
    const issue = await this.jiraClient.post('/rest/api/3/issue', {
      fields: {
        project: { key: this.projectKey },
        issuetype: { name: 'Epic' },
        summary: spec.title,
        description: this.convertMarkdownToJiraFormat(spec.content),
        labels: spec.tags
      }
    })

    return issue.key
  }
}
```

#### Linear Integration
```typescript
class LinearIntegration {
  async createProjectFromSpec(spec: Specification): Promise<string> {
    const mutation = `
      mutation CreateProject($input: ProjectCreateInput!) {
        projectCreate(input: $input) {
          project { id name }
        }
      }
    `

    const result = await this.linearClient.request(mutation, {
      input: {
        name: spec.title,
        description: spec.description,
        teamId: this.teamId
      }
    })

    return result.projectCreate.project.id
  }
}
```

### Documentation Integration

#### Confluence Integration
```typescript
class ConfluenceIntegration {
  async publishSpecification(spec: Specification, spaceKey: string): Promise<string> {
    const page = await this.confluenceClient.post('/rest/api/content', {
      type: 'page',
      title: spec.title,
      space: { key: spaceKey },
      body: {
        storage: {
          value: this.convertMarkdownToConfluence(spec.content),
          representation: 'storage'
        }
      }
    })

    return page._links.webui
  }
}
```

#### Notion Integration
```typescript
class NotionIntegration {
  async createSpecPage(spec: Specification, databaseId: string): Promise<string> {
    const response = await this.notionClient.pages.create({
      parent: { database_id: databaseId },
      properties: {
        'Name': {
          title: [{ text: { content: spec.title } }]
        },
        'Status': {
          select: { name: spec.status }
        },
        'Tags': {
          multi_select: spec.tags.map(tag => ({ name: tag }))
        }
      },
      children: this.convertMarkdownToNotionBlocks(spec.content)
    })

    return response.url
  }
}
```

## Extension Points

### Custom Commands

Add new command types to the system:

```typescript
interface CustomCommand {
  command: string
  description: string
  handler: (content: string, context: CommandContext) => Promise<string>
  autocomplete?: (partial: string) => Promise<string[]>
}

class CommandRegistry {
  private commands: Map<string, CustomCommand> = new Map()

  registerCommand(command: CustomCommand): void {
    this.commands.set(command.command, command)
  }

  async executeCommand(command: string, content: string, context: CommandContext): Promise<string> {
    const handler = this.commands.get(command)
    if (!handler) {
      throw new Error(`Unknown command: ${command}`)
    }

    return await handler.handler(content, context)
  }
}

// Usage example
commandRegistry.registerCommand({
  command: '/analyze',
  description: 'Analyze existing codebase and generate specifications',
  handler: async (content, context) => {
    // Custom analysis logic
    return `Analysis results for: ${content}`
  }
})
```

### Custom Export Formats

Add new export formats:

```typescript
interface ExportFormatter {
  format: string
  extension: string
  mimeType: string
  formatter: (spec: Specification) => Promise<Buffer | string>
}

class ExportService {
  private formatters: Map<string, ExportFormatter> = new Map()

  registerFormatter(formatter: ExportFormatter): void {
    this.formatters.set(formatter.format, formatter)
  }

  async export(spec: Specification, format: string): Promise<{ content: Buffer | string; filename: string }> {
    const formatter = this.formatters.get(format)
    if (!formatter) {
      throw new Error(`Unsupported format: ${format}`)
    }

    const content = await formatter.formatter(spec)
    const filename = `${spec.title.replace(/[^a-z0-9]/gi, '_')}.${formatter.extension}`

    return { content, filename }
  }
}

// Usage example - Word document export
exportService.registerFormatter({
  format: 'docx',
  extension: 'docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  formatter: async (spec) => {
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            text: spec.title,
            heading: HeadingLevel.TITLE
          }),
          // Convert markdown to Word format
          ...this.convertMarkdownToWordElements(spec.content)
        ]
      }]
    })

    return await Packer.toBuffer(doc)
  }
})
```

### Plugin System

Framework for third-party plugins:

```typescript
interface SpecDevelopmentPlugin {
  name: string
  version: string
  author: string

  // Lifecycle hooks
  onInitialize?(context: PluginContext): Promise<void>
  onProjectCreated?(project: SpecProject): Promise<void>
  onSpecificationCreated?(spec: Specification): Promise<void>
  onSpecificationApproved?(spec: Specification): Promise<void>

  // Custom features
  commands?: CustomCommand[]
  exportFormats?: ExportFormatter[]
  integrations?: Integration[]

  // UI extensions
  uiComponents?: {
    toolbarButtons?: ToolbarButton[]
    sidebarPanels?: SidebarPanel[]
    contextMenuItems?: ContextMenuItem[]
  }
}

class PluginManager {
  private plugins: Map<string, SpecDevelopmentPlugin> = new Map()

  async loadPlugin(plugin: SpecDevelopmentPlugin): Promise<void> {
    // Validate plugin
    this.validatePlugin(plugin)

    // Initialize plugin
    if (plugin.onInitialize) {
      await plugin.onInitialize(this.createPluginContext())
    }

    // Register plugin features
    if (plugin.commands) {
      plugin.commands.forEach(cmd => commandRegistry.registerCommand(cmd))
    }

    if (plugin.exportFormats) {
      plugin.exportFormats.forEach(fmt => exportService.registerFormatter(fmt))
    }

    this.plugins.set(plugin.name, plugin)
  }

  private createPluginContext(): PluginContext {
    return {
      store: useSpecStore,
      api: window.electronAPI,
      utils: {
        showNotification: this.showNotification,
        openDialog: this.openDialog
      }
    }
  }
}
```

## Custom Integrations

### Building Custom Integrations

#### Integration Interface
```typescript
interface Integration {
  name: string
  type: 'version-control' | 'project-management' | 'documentation' | 'communication'

  // Configuration
  configure(config: IntegrationConfig): Promise<void>

  // Operations
  sync(data: SyncData): Promise<SyncResult>
  export(spec: Specification): Promise<ExportResult>
  import?(source: ImportSource): Promise<Specification[]>

  // Event handlers
  onSpecificationChange?(spec: Specification): Promise<void>
  onProjectChange?(project: SpecProject): Promise<void>
}
```

#### Example: Slack Integration
```typescript
class SlackIntegration implements Integration {
  name = 'slack'
  type = 'communication' as const
  private webhookUrl: string

  async configure(config: IntegrationConfig): Promise<void> {
    this.webhookUrl = config.webhookUrl
    // Validate webhook
    await this.testConnection()
  }

  async onSpecificationApproved(spec: Specification): Promise<void> {
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `📋 New specification approved: *${spec.title}*`,
        attachments: [{
          color: 'good',
          fields: [{
            title: 'Description',
            value: spec.description,
            short: false
          }, {
            title: 'Tags',
            value: spec.tags.join(', '),
            short: true
          }]
        }]
      })
    })
  }

  async sync(data: SyncData): Promise<SyncResult> {
    // Implementation for syncing data to Slack
    return { success: true, message: 'Synced to Slack' }
  }

  async export(spec: Specification): Promise<ExportResult> {
    // Export specification as Slack message
    return {
      success: true,
      url: `https://slack.com/channels/${this.channelId}`
    }
  }
}
```

### Integration Testing

#### Unit Tests for Integrations
```typescript
describe('SlackIntegration', () => {
  let slackIntegration: SlackIntegration
  let mockFetch: jest.Mock

  beforeEach(() => {
    mockFetch = jest.fn()
    global.fetch = mockFetch
    slackIntegration = new SlackIntegration()
  })

  test('should send notification on specification approval', async () => {
    const spec: Specification = {
      id: 'spec-1',
      title: 'Test Spec',
      description: 'Test description',
      // ... other properties
    }

    mockFetch.mockResolvedValueOnce({ ok: true })

    await slackIntegration.onSpecificationApproved(spec)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Test Spec')
      })
    )
  })
})
```

#### Integration Tests
```typescript
describe('SpecDevelopment Integration Tests', () => {
  test('complete workflow with external integrations', async () => {
    // 1. Create project
    const project = await createProject({
      name: 'Integration Test',
      description: 'Test project'
    })

    // 2. Generate specification
    await executeCommand('/specify', 'Build a test application')

    // 3. Approve specification
    const spec = getCurrentSpecification()
    await approveSpecification(spec.id)

    // 4. Verify external integrations were triggered
    expect(mockSlackIntegration.onSpecificationApproved).toHaveBeenCalledWith(spec)
    expect(mockGitIntegration.commitSpecification).toHaveBeenCalledWith(
      project.path,
      spec
    )
  })
})
```

This integration guide provides comprehensive information for developers working with or extending the Spec Development feature. The modular architecture and well-defined extension points make it easy to add new capabilities and integrate with external tools.