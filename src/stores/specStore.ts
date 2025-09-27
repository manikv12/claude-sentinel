import { create } from 'zustand'

export interface ChatMessage {
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

export interface Specification {
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

export interface SpecProject {
  id: string
  name: string
  description: string
  path: string
  createdAt: Date
  specs: string[]
  isActive: boolean
  isUserProject?: boolean
  hasSpecKit?: boolean
}

interface SpecStore {
  // Chat state
  messages: ChatMessage[]
  isStreaming: boolean
  currentCommand: string | null
  streamingContent: string

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

  // Actions
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void
  clearMessages: () => void
  appendToLastMessage: (content: string) => void

  // Spec actions
  createSpec: (spec: Omit<Specification, 'id' | 'createdAt' | 'updatedAt' | 'version'>) => void
  updateSpec: (id: string, updates: Partial<Specification>) => void
  appendToCurrentSpec: (content: string) => void
  approveSpec: (id: string) => void
  rejectSpec: (id: string) => void
  deleteSpec: (id: string) => void
  setCurrentSpec: (spec: Specification | null) => void

  // Project actions
  createProject: (project: Omit<SpecProject, 'id' | 'createdAt' | 'specs'>) => Promise<SpecProject>
  createUserProject: (path: string, name: string, description: string) => Promise<SpecProject>
  setActiveProject: (project: SpecProject | null) => void
  updateProject: (id: string, updates: Partial<SpecProject>) => void

  // UI actions
  setIsGenerating: (generating: boolean) => void
  setIsStreaming: (streaming: boolean) => void
  setStreamingContent: (content: string) => void
  setShowApprovalDialog: (show: boolean) => void
  setSelectedSpecId: (id: string | null) => void
  setViewMode: (mode: 'chat' | 'split' | 'preview') => void

  // Command handling
  executeCommand: (command: string, content: string) => Promise<void>

  // Backend integration
  loadProjectsFromBackend: () => Promise<void>
  saveSpecToBackend: (projectId: string, spec: Specification) => Promise<void>
  loadSpecsFromBackend: (projectId: string) => Promise<void>
}

export const useSpecStore = create<SpecStore>((set, get) => ({
  // Initial state
  messages: [],
  isStreaming: false,
  currentCommand: null,
  streamingContent: '',

  specifications: [],
  currentSpec: null,
  activeProject: null,

  projects: [],

  isGenerating: false,
  showApprovalDialog: false,
  selectedSpecId: null,
  viewMode: 'split',

  // Chat actions
  addMessage: (message) => {
    const newMessage: ChatMessage = {
      ...message,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    }
    set(state => ({ messages: [...state.messages, newMessage] }))
  },

  updateMessage: (id, updates) => {
    set(state => ({
      messages: state.messages.map(msg =>
        msg.id === id ? { ...msg, ...updates } : msg
      )
    }))
  },

  clearMessages: () => set({ messages: [] }),

  appendToLastMessage: (content: string) => {
    set(state => ({
      messages: state.messages.map((msg, index) => {
        if (index === state.messages.length - 1 && msg.type === 'assistant') {
          return { ...msg, content: msg.content + content }
        }
        return msg
      })
    }))
  },

  // Spec actions
  createSpec: (specData) => {
    const newSpec: Specification = {
      ...specData,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    }

    set(state => ({
      specifications: [...state.specifications, newSpec],
      currentSpec: newSpec,
    }))

    // Add to active project if one exists
    const { activeProject } = get()
    if (activeProject) {
      get().updateProject(activeProject.id, {
        specs: [...activeProject.specs, newSpec.id]
      })
    }
  },

  updateSpec: (id, updates) => {
    set(state => ({
      specifications: state.specifications.map(spec =>
        spec.id === id
          ? { ...spec, ...updates, updatedAt: new Date(), version: spec.version + 1 }
          : spec
      ),
      currentSpec: state.currentSpec?.id === id
        ? { ...state.currentSpec, ...updates, updatedAt: new Date(), version: state.currentSpec.version + 1 }
        : state.currentSpec
    }))
  },

  approveSpec: (id) => {
    get().updateSpec(id, { status: 'approved' })
    set({ showApprovalDialog: false })
  },

  rejectSpec: (id) => {
    get().updateSpec(id, { status: 'rejected' })
    set({ showApprovalDialog: false })
  },

  deleteSpec: (id) => {
    set(state => ({
      specifications: state.specifications.filter(spec => spec.id !== id),
      currentSpec: state.currentSpec?.id === id ? null : state.currentSpec
    }))
  },

  setCurrentSpec: (spec) => set({ currentSpec: spec }),

  appendToCurrentSpec: (content: string) => {
    set(state => ({
      currentSpec: state.currentSpec
        ? { ...state.currentSpec, content: state.currentSpec.content + content, updatedAt: new Date() }
        : null
    }))
  },

  // Project actions
  createProject: async (projectData) => {
    try {
      const newProject = await window.electronAPI.specCreateProject(projectData)
      set(state => ({
        projects: [...state.projects, newProject],
        activeProject: newProject
      }))
      return newProject
    } catch (error) {
      console.error('Failed to create project:', error)
      throw error
    }
  },

  createUserProject: async (selectedPath: string, projectName: string, description: string) => {
    try {
      const newProject = await window.electronAPI.specCreateUserProject(selectedPath, projectName, description)
      set(state => ({
        projects: [...state.projects, newProject],
        activeProject: newProject
      }))
      return newProject
    } catch (error) {
      console.error('Failed to create user project:', error)
      throw error
    }
  },

  setActiveProject: (project) => set({ activeProject: project }),

  updateProject: (id, updates) => {
    set(state => ({
      projects: state.projects.map(project =>
        project.id === id ? { ...project, ...updates } : project
      ),
      activeProject: state.activeProject?.id === id
        ? { ...state.activeProject, ...updates }
        : state.activeProject
    }))
  },

  // UI actions
  setIsGenerating: (generating) => set({ isGenerating: generating }),
  setIsStreaming: (streaming) => set({ isStreaming: streaming }),
  setStreamingContent: (content) => set({ streamingContent: content }),
  setShowApprovalDialog: (show) => set({ showApprovalDialog: show }),
  setSelectedSpecId: (id) => set({ selectedSpecId: id }),
  setViewMode: (mode) => set({ viewMode: mode }),

  // Command handling
  executeCommand: async (command, content) => {
    set({ isGenerating: true, currentCommand: command })

    try {
      // Add user message
      get().addMessage({
        type: 'user',
        content: `${command} ${content}`,
        metadata: { command }
      })

      const { activeProject } = get()
      const projectPath = activeProject?.path || './specs'

      // Call the backend service for Claude Code integration
      const response = await window.electronAPI.specExecuteCommand(command, content, projectPath)

      if (command === '/specify') {
        // Create new specification with the response content
        const newSpec = {
          title: `Specification: ${content}`,
          description: content,
          content: response,
          status: 'draft' as const,
          tags: ['auto-generated'],
        }

        get().createSpec(newSpec)

        // Save to backend if we have an active project
        if (activeProject) {
          const createdSpec = get().currentSpec
          if (createdSpec) {
            await get().saveSpecToBackend(activeProject.id, createdSpec)
          }
        }

        get().addMessage({
          type: 'assistant',
          content: `I've created a comprehensive specification for "${content}". Please review it in the preview panel and approve it when ready.`,
        })
      } else {
        // For other commands, just add the response as a message
        get().addMessage({
          type: 'assistant',
          content: response,
        })
      }

    } catch (error) {
      get().addMessage({
        type: 'system',
        content: `Error executing command: ${error instanceof Error ? error.message : 'Unknown error'}`,
      })
    } finally {
      set({ isGenerating: false, currentCommand: null })
    }
  },

  // Backend integration methods
  loadProjectsFromBackend: async () => {
    try {
      const projects = await window.electronAPI.specGetProjects()
      set({ projects })

      // Set the first project as active if none is set
      const { activeProject } = get()
      if (!activeProject && projects.length > 0) {
        set({ activeProject: projects[0] })
      }
    } catch (error) {
      console.error('Failed to load projects:', error)
    }
  },

  saveSpecToBackend: async (projectId, spec) => {
    try {
      await window.electronAPI.specSaveSpecification(projectId, spec)
    } catch (error) {
      console.error('Failed to save specification:', error)
      throw error
    }
  },

  loadSpecsFromBackend: async (projectId) => {
    try {
      const specs = await window.electronAPI.specLoadSpecifications(projectId)
      set({ specifications: specs })
    } catch (error) {
      console.error('Failed to load specifications:', error)
    }
  },
}))