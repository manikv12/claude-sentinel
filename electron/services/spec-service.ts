import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawn, ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'
import { specKitManager } from './speckit-manager'

export interface SpecProject {
  id: string
  name: string
  description: string
  path: string
  createdAt: Date
  specs: string[]
  isActive: boolean
  isUserProject: boolean // true if user selected their own folder
  hasSpecKit: boolean // true if spec-kit is initialized in this project
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

export interface SpecKitProcess {
  process: ChildProcess | null
  isRunning: boolean
  workingDirectory: string
}

class SpecService {
  private specKitProcess: SpecKitProcess = {
    process: null,
    isRunning: false,
    workingDirectory: ''
  }

  private readonly specDir = path.join(os.homedir(), '.claude-sentinel', 'specs')
  private readonly configFile = path.join(this.specDir, 'config.json')

  constructor() {
    this.ensureSpecDirectory()
  }

  private ensureSpecDirectory() {
    // Create main spec directory
    if (!fs.existsSync(this.specDir)) {
      fs.mkdirSync(this.specDir, { recursive: true })
    }

    // Create subdirectories
    const userProjectsDir = path.join(this.specDir, 'user-projects')
    if (!fs.existsSync(userProjectsDir)) {
      fs.mkdirSync(userProjectsDir, { recursive: true })
    }

    // Create default config if it doesn't exist
    if (!fs.existsSync(this.configFile)) {
      const defaultConfig = {
        projects: [],
        settings: {
          aiToolsPath: 'auto',
          defaultTemplate: 'standard',
          autoSave: true,
          streamingEnabled: true
        }
      }
      fs.writeFileSync(this.configFile, JSON.stringify(defaultConfig, null, 2))
    }
  }

  // Project Management
  async createProject(projectData: Omit<SpecProject, 'id' | 'createdAt' | 'specs' | 'isUserProject' | 'hasSpecKit'>): Promise<SpecProject> {
    const project: SpecProject = {
      ...projectData,
      id: this.generateId(),
      createdAt: new Date(),
      specs: [],
      isUserProject: false, // Internal project by default
      hasSpecKit: false
    }

    const projectPath = path.join(this.specDir, 'projects', project.id)

    // Create project directory
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true })
    }

    // Save project metadata
    const projectFile = path.join(projectPath, 'project.json')
    fs.writeFileSync(projectFile, JSON.stringify(project, null, 2))

    return project
  }

  // Create project from user-selected folder
  async createUserProject(selectedPath: string, projectName: string, description: string): Promise<SpecProject> {
    const project: SpecProject = {
      id: this.generateId(),
      name: projectName,
      description,
      path: selectedPath, // Use the actual user path
      createdAt: new Date(),
      specs: [],
      isActive: true,
      isUserProject: true,
      hasSpecKit: false
    }

    try {
      // Initialize spec-kit in user's project directory
      await specKitManager.initialize()
      await specKitManager.initializeProject(selectedPath, projectName)
      project.hasSpecKit = true
      console.log('AI specification tools initialized in user project')
    } catch (error) {
      console.warn('Failed to initialize AI tools in user project:', error)
      // Continue without spec-kit - will use simulation mode
    }

    // Save project metadata in our internal storage for quick access
    const internalPath = path.join(this.specDir, 'user-projects', project.id)
    if (!fs.existsSync(internalPath)) {
      fs.mkdirSync(internalPath, { recursive: true })
    }

    const projectFile = path.join(internalPath, 'project.json')
    fs.writeFileSync(projectFile, JSON.stringify(project, null, 2))

    return project
  }

  // Create new project directory and initialize with spec-kit
  async createNewProject(parentPath: string, projectName: string, description: string): Promise<SpecProject> {
    const projectPath = path.join(parentPath, projectName)

    const project: SpecProject = {
      id: this.generateId(),
      name: projectName,
      description,
      path: projectPath,
      createdAt: new Date(),
      specs: [],
      isActive: true,
      isUserProject: true,
      hasSpecKit: false
    }

    try {
      // Use spec-kit to create the new project (this handles directory creation and initialization)
      await specKitManager.initialize()
      await specKitManager.createNewProject(parentPath, projectName)

      project.hasSpecKit = true
      console.log('✅ Spec-kit project created successfully')
    } catch (error) {
      console.warn('Failed to create spec-kit project:', error)

      // Fallback: Create basic project directory without spec-kit
      if (!fs.existsSync(projectPath)) {
        fs.mkdirSync(projectPath, { recursive: true })
        console.log('Created basic project directory as fallback')
      }
    }

    // Save project metadata in our internal storage
    const internalPath = path.join(this.specDir, 'user-projects', project.id)
    if (!fs.existsSync(internalPath)) {
      fs.mkdirSync(internalPath, { recursive: true })
    }

    const projectFile = path.join(internalPath, 'project.json')
    fs.writeFileSync(projectFile, JSON.stringify(project, null, 2))

    return project
  }

  async getProjects(): Promise<SpecProject[]> {
    const projects: SpecProject[] = []

    // Load internal projects
    const internalProjectsDir = path.join(this.specDir, 'projects')
    if (fs.existsSync(internalProjectsDir)) {
      const projectDirs = fs.readdirSync(internalProjectsDir)
      for (const projectDir of projectDirs) {
        const projectFile = path.join(internalProjectsDir, projectDir, 'project.json')
        if (fs.existsSync(projectFile)) {
          try {
            const projectData = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
            // Check if spec-kit is initialized in internal project
            const projectPath = path.join(internalProjectsDir, projectDir)
            const hasSpecKit = specKitManager.isProjectInitialized(projectPath)

            projects.push({
              ...projectData,
              createdAt: new Date(projectData.createdAt),
              isUserProject: false,
              hasSpecKit: hasSpecKit
            })
          } catch (error) {
            console.error(`Failed to read internal project ${projectDir}:`, error)
          }
        }
      }
    }

    // Load user projects
    const userProjectsDir = path.join(this.specDir, 'user-projects')
    if (fs.existsSync(userProjectsDir)) {
      const projectDirs = fs.readdirSync(userProjectsDir)
      for (const projectDir of projectDirs) {
        const projectFile = path.join(userProjectsDir, projectDir, 'project.json')
        if (fs.existsSync(projectFile)) {
          try {
            const projectData = JSON.parse(fs.readFileSync(projectFile, 'utf8'))

            // Validate that user project path still exists
            if (fs.existsSync(projectData.path)) {
              // Check if spec-kit is actually initialized in this project
              const hasSpecKit = specKitManager.isProjectInitialized(projectData.path)

              projects.push({
                ...projectData,
                createdAt: new Date(projectData.createdAt),
                hasSpecKit: hasSpecKit
              })
            }
          } catch (error) {
            console.error(`Failed to read user project ${projectDir}:`, error)
          }
        }
      }
    }

    return projects.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  // Specification Management
  async saveSpecification(projectId: string, spec: Specification): Promise<void> {
    const project = await this.findProject(projectId)
    if (!project) {
      throw new Error('Project not found')
    }

    let specsPath: string

    if (project.isUserProject) {
      // For user projects, save in their actual project folder
      specsPath = path.join(project.path, '.claude-sentinel', 'specs')
    } else {
      // For internal projects, use our storage
      const projectPath = path.join(this.specDir, 'projects', projectId)
      specsPath = path.join(projectPath, 'specs')
    }

    if (!fs.existsSync(specsPath)) {
      fs.mkdirSync(specsPath, { recursive: true })
    }

    // Save as both JSON (for metadata) and MD (for content)
    const specFile = path.join(specsPath, `${spec.id}.json`)
    const markdownFile = path.join(specsPath, `${spec.id}.md`)

    fs.writeFileSync(specFile, JSON.stringify(spec, null, 2))
    fs.writeFileSync(markdownFile, spec.content)
  }

  private async findProject(projectId: string): Promise<SpecProject | null> {
    const projects = await this.getProjects()
    return projects.find(p => p.id === projectId) || null
  }

  private isUserProject(projectPath: string): boolean {
    // Check if this is a user project (not in our internal storage)
    return !projectPath.startsWith(this.specDir)
  }

  async loadSpecifications(projectId: string): Promise<Specification[]> {
    const project = await this.findProject(projectId)
    if (!project) {
      return []
    }

    let specsPath: string

    if (project.isUserProject) {
      specsPath = path.join(project.path, '.claude-sentinel', 'specs')
    } else {
      specsPath = path.join(this.specDir, 'projects', projectId, 'specs')
    }

    if (!fs.existsSync(specsPath)) {
      return []
    }

    const specs: Specification[] = []
    const specFiles = fs.readdirSync(specsPath).filter(f => f.endsWith('.json'))

    for (const specFile of specFiles) {
      try {
        const specData = JSON.parse(fs.readFileSync(path.join(specsPath, specFile), 'utf8'))
        specs.push({
          ...specData,
          createdAt: new Date(specData.createdAt),
          updatedAt: new Date(specData.updatedAt)
        })
      } catch (error) {
        console.error(`Failed to read spec ${specFile}:`, error)
      }
    }

    return specs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  async deleteSpecification(projectId: string, specId: string): Promise<void> {
    const specsPath = path.join(this.specDir, 'projects', projectId, 'specs')
    const specFile = path.join(specsPath, `${specId}.json`)
    const markdownFile = path.join(specsPath, `${specId}.md`)

    if (fs.existsSync(specFile)) {
      fs.unlinkSync(specFile)
    }
    if (fs.existsSync(markdownFile)) {
      fs.unlinkSync(markdownFile)
    }
  }

  // AI Specification Generation Integration
  async executeClaudeCodeCommand(
    command: string,
    content: string,
    projectPath: string,
    window?: BrowserWindow,
    onStream?: (chunk: string) => void
  ): Promise<string> {
    try {
      // Check if the project has spec-kit initialized
      if (specKitManager.isProjectInitialized(projectPath)) {
        console.log('Using real GitHub spec-kit scripts')
        return await this.executeRealSpecKit(command, content, projectPath, onStream)
      }

      // Fall back to simulation if spec-kit is not initialized in project
      console.log('spec-kit not initialized in project, using simulation mode')
      return await this.executeSimulatedCommand(command, content, onStream)
    } catch (error) {
      console.error('Error executing AI specification command:', error)
      // Fall back to simulation if spec-kit fails
      return await this.executeSimulatedCommand(command, content, onStream)
    }
  }

  private async executeRealSpecKit(
    command: string,
    content: string,
    projectPath: string,
    onStream?: (chunk: string) => void
  ): Promise<string> {
    // Initialize spec-kit environment only when we need to execute real spec-kit commands
    await specKitManager.initialize()

    return new Promise((resolve, reject) => {
      let fullOutput = ''

      specKitManager.executeSpecKitCommand(
        command,
        content,
        projectPath,
        (chunk) => {
          fullOutput += chunk
          onStream?.(chunk)
        },
        (error) => {
          console.error('spec-kit error:', error)
        }
      ).then(output => {
        resolve(fullOutput || output)
      }).catch(error => {
        console.error('spec-kit execution failed:', error)
        // Fall back to simulation
        this.executeSimulatedCommand(command, content, onStream)
          .then(resolve)
          .catch(reject)
      })
    })
  }

  private async executeSimulatedCommand(
    command: string,
    content: string,
    onStream?: (chunk: string) => void
  ): Promise<string> {
    return new Promise((resolve) => {
      const response = this.generateMockResponse(command, content)

      // Simulate streaming for consistent UX
      if (onStream) {
        const words = response.split(' ')
        let currentIndex = 0

        const streamInterval = setInterval(() => {
          if (currentIndex < words.length) {
            const chunk = words[currentIndex] + ' '
            onStream(chunk)
            currentIndex++
          } else {
            clearInterval(streamInterval)
            resolve(response)
          }
        }, 50) // Stream words every 50ms
      } else {
        setTimeout(() => resolve(response), 2000)
      }
    })
  }

  private buildSpecKitPrompt(command: string, content: string): string {
    switch (command) {
      case '/specify':
      case 'generate-spec':
        return `I need you to create a detailed specification for: ${content}

Please structure your response as a comprehensive specification document that includes:

1. **Overview**: Brief description of what we're building
2. **Requirements**: Detailed functional and non-functional requirements
3. **User Stories**: Key user scenarios and use cases
4. **Technical Considerations**: Architecture, technology choices, constraints
5. **Success Criteria**: How we'll know this is complete and successful
6. **Implementation Notes**: Any specific guidance for development

Focus on the "what" and "why" rather than the "how". Be specific and actionable.`

      case '/plan':
      case 'create-plan':
        return `Create a technical implementation plan for: ${content}

Please provide:

1. **Technical Architecture**: High-level system design
2. **Technology Stack**: Recommended tools, frameworks, libraries
3. **Development Phases**: Logical breakdown of implementation stages
4. **Dependencies**: External services, APIs, or systems needed
5. **Risks and Mitigation**: Potential challenges and solutions
6. **Timeline Estimates**: Rough effort estimates for each phase

Focus on the technical "how" while considering the broader context.`

      case '/tasks':
      case 'breakdown-tasks':
        return `Break down the implementation into actionable tasks for: ${content}

Please provide:

1. **Task Breakdown**: Specific, actionable development tasks
2. **Prerequisites**: What needs to be done before each task
3. **Acceptance Criteria**: How to know each task is complete
4. **Effort Estimates**: Rough time estimates for each task
5. **Dependencies**: Which tasks depend on others
6. **Priority Order**: Suggested sequence for implementation

Make tasks concrete and specific enough for immediate development work.`

      case '/refine':
      case 'refine-spec':
        return `Please refine and improve the following specification: ${content}

Focus on:

1. **Clarity**: Make requirements clearer and more specific
2. **Completeness**: Add any missing requirements or considerations
3. **Consistency**: Ensure all parts work together logically
4. **Feasibility**: Flag any unrealistic or problematic requirements
5. **Best Practices**: Apply industry standards and best practices

Provide the refined specification with explanations for major changes.`

      default:
        return content
    }
  }

  private generateMockResponse(command: string, content: string): string {
    // This is a mock response - in real implementation, this would come from Claude Code
    switch (command) {
      case '/specify':
        return `# Specification: ${content}

## Overview

This specification outlines the requirements for building ${content.toLowerCase()}. The system should provide a comprehensive solution that meets user needs while maintaining high performance and usability standards.

## Requirements

### Functional Requirements
1. **Core Functionality**: The system must provide the primary features needed for ${content.toLowerCase()}
2. **User Interface**: Intuitive and responsive user interface that works across devices
3. **Data Management**: Secure and efficient data storage and retrieval
4. **Integration**: Ability to integrate with existing systems and workflows

### Non-Functional Requirements
1. **Performance**: Response times under 200ms for core operations
2. **Security**: Industry-standard security practices and data protection
3. **Scalability**: Support for growing user base and data volume
4. **Reliability**: 99.9% uptime with proper error handling

## User Stories

### Primary Users
- **As a user**, I want to easily access the main features so that I can accomplish my tasks efficiently
- **As a user**, I want the system to be reliable so that I can depend on it for important work
- **As a user**, I want clear feedback on my actions so that I understand what's happening

### Secondary Users
- **As an administrator**, I want to manage user access so that I can maintain security
- **As a developer**, I want clear APIs so that I can integrate with the system

## Technical Considerations

### Architecture
- Modern web application architecture with separation of concerns
- RESTful API design with proper HTTP methods and status codes
- Database design following normalization principles

### Technology Choices
- Frontend: Modern JavaScript framework (React, Vue, or similar)
- Backend: Node.js, Python, or similar server-side technology
- Database: PostgreSQL or similar relational database
- Hosting: Cloud-based solution with CI/CD pipeline

### Constraints
- Must work in modern web browsers
- Should be mobile-responsive
- Must comply with relevant data protection regulations

## Success Criteria

1. **User Adoption**: Successful onboarding of target users within first month
2. **Performance**: Meeting all performance requirements under load
3. **Quality**: Less than 1% error rate in production
4. **User Satisfaction**: Positive feedback from user testing and surveys

## Implementation Notes

1. Start with core functionality and iterate based on user feedback
2. Implement proper logging and monitoring from the beginning
3. Use test-driven development practices
4. Plan for regular security audits and updates
5. Document all APIs and user-facing features

## Next Steps

1. Review and approve this specification
2. Create detailed technical plan using \`/plan\`
3. Break down into actionable tasks using \`/tasks\`
4. Begin implementation following the defined approach`

      case '/plan':
        return `# Technical Implementation Plan: ${content}

## Technical Architecture

### High-Level Design
The system will follow a modern three-tier architecture:
- **Presentation Layer**: React-based frontend with responsive design
- **Application Layer**: Node.js/Express API server with business logic
- **Data Layer**: PostgreSQL database with proper indexing and relationships

### System Components
1. **Frontend Application**: Single-page application with routing
2. **API Gateway**: Centralized API management and authentication
3. **Business Logic Services**: Modular services for different functionality
4. **Database Layer**: Optimized database schema with migrations
5. **External Integrations**: Third-party service connections

## Technology Stack

### Frontend
- **Framework**: React 18+ with TypeScript
- **State Management**: Zustand or Redux Toolkit
- **UI Components**: Tailwind CSS with Headless UI
- **Build Tool**: Vite for fast development and building
- **Testing**: Jest and React Testing Library

### Backend
- **Runtime**: Node.js 18+ with Express.js
- **Language**: TypeScript for type safety
- **Authentication**: JWT with refresh tokens
- **Validation**: Zod for runtime type checking
- **ORM**: Prisma for database operations
- **Testing**: Jest with supertest for API testing

### Database
- **Primary Database**: PostgreSQL 14+
- **Caching**: Redis for session and frequently accessed data
- **Search**: Elasticsearch for full-text search (if needed)

### Infrastructure
- **Hosting**: Docker containers on cloud platform
- **CI/CD**: GitHub Actions for automated testing and deployment
- **Monitoring**: Application and infrastructure monitoring
- **Logging**: Structured logging with log aggregation

## Development Phases

### Phase 1: Foundation (2-3 weeks)
- Set up development environment and tooling
- Create basic project structure and configuration
- Implement authentication and authorization
- Set up database schema and basic migrations
- Create CI/CD pipeline

### Phase 2: Core Features (4-6 weeks)
- Implement primary user functionality
- Create main user interfaces
- Add data validation and error handling
- Implement basic testing suite
- Set up monitoring and logging

### Phase 3: Advanced Features (3-4 weeks)
- Add secondary functionality and integrations
- Implement advanced user interface features
- Add comprehensive testing coverage
- Performance optimization and security hardening
- Documentation and user guides

### Phase 4: Launch Preparation (1-2 weeks)
- Final testing and bug fixes
- Production deployment setup
- User acceptance testing
- Performance testing under load
- Launch preparation and monitoring setup

## Dependencies

### External Services
- **Authentication Provider**: OAuth integration if needed
- **Email Service**: For notifications and communications
- **Payment Processing**: If monetization is required
- **Analytics**: For user behavior tracking
- **Error Tracking**: For production error monitoring

### Internal Dependencies
- Development environment setup
- Access to target deployment infrastructure
- Design assets and branding materials
- Content and copy for user interfaces
- Test data and scenarios

## Risks and Mitigation

### Technical Risks
1. **Performance Issues**: Mitigate with proper caching and optimization
2. **Security Vulnerabilities**: Regular security audits and updates
3. **Scalability Challenges**: Design with scaling in mind from start
4. **Integration Failures**: Thorough testing of all integrations

### Project Risks
1. **Scope Creep**: Clear requirements and change management process
2. **Resource Constraints**: Realistic timeline and resource planning
3. **User Adoption**: User research and feedback integration
4. **Maintenance Burden**: Good documentation and code quality

## Timeline Estimates

### Overall Timeline: 10-15 weeks

- **Phase 1**: 2-3 weeks (Foundation)
- **Phase 2**: 4-6 weeks (Core Features)
- **Phase 3**: 3-4 weeks (Advanced Features)
- **Phase 4**: 1-2 weeks (Launch Preparation)

### Key Milestones
- Week 3: Basic authentication and database setup
- Week 6: Core functionality working end-to-end
- Week 10: Feature-complete alpha version
- Week 12: Production-ready beta version
- Week 15: Launch ready with monitoring and support

## Next Steps

1. Review and approve this technical plan
2. Set up development environment and tools
3. Create detailed task breakdown using \`/tasks\`
4. Begin Phase 1 implementation
5. Regular check-ins and progress reviews`

      case '/tasks':
        return `# Implementation Tasks: ${content}

## Development Setup and Infrastructure

### Task 1: Development Environment Setup
**Description**: Set up local development environment and tooling
**Prerequisites**: None
**Effort**: 4-6 hours
**Acceptance Criteria**:
- [ ] Node.js and npm/yarn installed and configured
- [ ] Code editor with appropriate extensions
- [ ] Git repository initialized with proper .gitignore
- [ ] ESLint and Prettier configured
- [ ] TypeScript configuration in place

### Task 2: Project Structure and Build Setup
**Description**: Create project structure and build configuration
**Prerequisites**: Task 1 completed
**Effort**: 6-8 hours
**Acceptance Criteria**:
- [ ] Frontend and backend project structure created
- [ ] Vite configuration for frontend build
- [ ] TypeScript compilation setup for backend
- [ ] Package.json scripts for development and build
- [ ] Basic Docker setup for deployment

### Task 3: Database Setup and Schema
**Description**: Set up database and create initial schema
**Prerequisites**: Task 2 completed
**Effort**: 8-12 hours
**Acceptance Criteria**:
- [ ] PostgreSQL database running locally
- [ ] Prisma ORM configured and connected
- [ ] Initial database schema defined
- [ ] Database migration system working
- [ ] Seed data for development environment

## Authentication and Security

### Task 4: Authentication System
**Description**: Implement user authentication and authorization
**Prerequisites**: Task 3 completed
**Effort**: 12-16 hours
**Acceptance Criteria**:
- [ ] User registration and login endpoints
- [ ] JWT token generation and validation
- [ ] Password hashing and security measures
- [ ] Protected route middleware
- [ ] Frontend authentication state management

### Task 5: Security Hardening
**Description**: Implement security best practices
**Prerequisites**: Task 4 completed
**Effort**: 6-8 hours
**Acceptance Criteria**:
- [ ] Rate limiting on API endpoints
- [ ] Input validation and sanitization
- [ ] CORS configuration
- [ ] Security headers implementation
- [ ] Environment variable security

## Core Functionality

### Task 6: Core API Development
**Description**: Implement main API endpoints for core features
**Prerequisites**: Task 5 completed
**Effort**: 20-24 hours
**Acceptance Criteria**:
- [ ] RESTful API endpoints for main entities
- [ ] Proper HTTP status codes and error handling
- [ ] Request/response validation
- [ ] API documentation with OpenAPI/Swagger
- [ ] Unit tests for API endpoints

### Task 7: Frontend Core Components
**Description**: Create main user interface components
**Prerequisites**: Task 4 completed
**Effort**: 24-30 hours
**Acceptance Criteria**:
- [ ] Main application layout and navigation
- [ ] Forms for data input and editing
- [ ] Data display components and lists
- [ ] Responsive design implementation
- [ ] Component testing with React Testing Library

### Task 8: State Management and Data Flow
**Description**: Implement frontend state management
**Prerequisites**: Task 7 completed
**Effort**: 12-16 hours
**Acceptance Criteria**:
- [ ] State management solution implemented (Zustand/Redux)
- [ ] API integration and data fetching
- [ ] Loading and error states handled
- [ ] Optimistic updates where appropriate
- [ ] Caching strategy for frequently accessed data

## User Interface and Experience

### Task 9: UI/UX Polish and Accessibility
**Description**: Improve user interface and ensure accessibility
**Prerequisites**: Task 8 completed
**Effort**: 16-20 hours
**Acceptance Criteria**:
- [ ] Consistent design system implementation
- [ ] Accessibility features (ARIA labels, keyboard navigation)
- [ ] Loading indicators and user feedback
- [ ] Error messages and validation feedback
- [ ] Mobile responsiveness testing

### Task 10: Advanced UI Features
**Description**: Implement advanced user interface features
**Prerequisites**: Task 9 completed
**Effort**: 20-24 hours
**Acceptance Criteria**:
- [ ] Search and filtering functionality
- [ ] Sorting and pagination
- [ ] Bulk operations and selection
- [ ] Drag and drop if applicable
- [ ] Keyboard shortcuts and power user features

## Testing and Quality Assurance

### Task 11: Comprehensive Testing Suite
**Description**: Create thorough testing coverage
**Prerequisites**: Task 10 completed
**Effort**: 24-30 hours
**Acceptance Criteria**:
- [ ] Unit tests for all business logic (90%+ coverage)
- [ ] Integration tests for API endpoints
- [ ] End-to-end tests for critical user flows
- [ ] Performance testing and optimization
- [ ] Security testing and vulnerability assessment

### Task 12: Bug Fixes and Performance Optimization
**Description**: Address issues and optimize performance
**Prerequisites**: Task 11 completed
**Effort**: 16-20 hours
**Acceptance Criteria**:
- [ ] All critical and high-priority bugs fixed
- [ ] Performance benchmarks met
- [ ] Memory leaks and performance issues resolved
- [ ] Browser compatibility testing completed
- [ ] Accessibility compliance verified

## Deployment and Launch

### Task 13: Production Deployment Setup
**Description**: Set up production environment and deployment
**Prerequisites**: Task 12 completed
**Effort**: 12-16 hours
**Acceptance Criteria**:
- [ ] Production database and infrastructure setup
- [ ] CI/CD pipeline configured and tested
- [ ] Environment variables and secrets management
- [ ] Monitoring and logging in place
- [ ] Backup and disaster recovery procedures

### Task 14: Launch Preparation and Documentation
**Description**: Final launch preparation and documentation
**Prerequisites**: Task 13 completed
**Effort**: 8-12 hours
**Acceptance Criteria**:
- [ ] User documentation and help guides created
- [ ] API documentation complete and published
- [ ] Deployment runbook and operational procedures
- [ ] Launch checklist completed
- [ ] Support processes and escalation procedures

## Priority Order and Dependencies

### High Priority (Must Have)
1. Tasks 1-3: Foundation and setup
2. Tasks 4-6: Core security and functionality
3. Task 7: Basic user interface
4. Task 11: Essential testing
5. Task 13: Basic deployment

### Medium Priority (Should Have)
6. Task 8: State management
7. Task 9: UI polish
8. Task 12: Performance optimization
9. Task 14: Documentation

### Lower Priority (Nice to Have)
10. Task 5: Advanced security features
11. Task 10: Advanced UI features

## Estimated Total Effort: 200-280 hours (5-7 weeks for single developer)

## Next Steps

1. Review task breakdown and effort estimates
2. Assign tasks to team members (if applicable)
3. Set up project management and tracking system
4. Begin with Task 1: Development Environment Setup
5. Regular progress reviews and adjustment of estimates`

      case '/refine':
        return `# Refined Specification: ${content}

## Summary of Refinements

The following improvements have been made to enhance clarity, completeness, and feasibility:

1. **Enhanced Clarity**: Simplified technical language and added concrete examples
2. **Improved Completeness**: Added missing requirements and edge cases
3. **Better Structure**: Reorganized content for logical flow
4. **Feasibility Review**: Adjusted unrealistic expectations and added practical considerations
5. **Best Practices**: Incorporated industry standards and proven approaches

## Major Changes Made

### Requirements Clarification
- Specified exact performance metrics instead of vague terms
- Added explicit security requirements with industry standards
- Defined clear success criteria with measurable outcomes
- Separated functional and non-functional requirements clearly

### Technical Improvements
- Updated technology recommendations based on current best practices
- Added scalability considerations and architectural patterns
- Included modern development practices (CI/CD, testing, monitoring)
- Specified integration requirements and API design principles

### User Experience Enhancements
- Added detailed user stories covering edge cases
- Included accessibility requirements (WCAG 2.1 AA compliance)
- Specified mobile-first design approach
- Added internationalization considerations

### Risk Mitigation
- Identified potential technical and business risks
- Added contingency planning for common failure scenarios
- Included security threat modeling and mitigation strategies
- Specified disaster recovery and backup procedures

## Implementation Recommendations

### Immediate Actions
1. **Stakeholder Review**: Have key stakeholders review refined requirements
2. **Technical Validation**: Validate technical approaches with development team
3. **Resource Planning**: Confirm available resources match refined scope
4. **Timeline Adjustment**: Update project timeline based on refined requirements

### Quality Assurance
- Implement code review processes from project start
- Set up automated testing pipelines early in development
- Plan for regular security audits throughout development
- Establish performance monitoring from day one

### Change Management
- Document all requirement changes with justifications
- Establish clear approval process for future modifications
- Regular stakeholder check-ins to prevent scope creep
- Version control for specification documents

## Conclusion

The refined specification provides a more realistic and actionable foundation for implementation. The changes focus on practical considerations while maintaining the original vision and goals. Regular reviews and updates will ensure the specification remains relevant throughout the development process.

## Next Steps

1. **Final Review**: Stakeholder approval of refined specification
2. **Technical Planning**: Create detailed technical plan using \`/plan\`
3. **Task Breakdown**: Generate actionable tasks using \`/tasks\`
4. **Implementation**: Begin development following refined requirements
5. **Continuous Improvement**: Regular specification updates based on learnings`

      default:
        return `I understand you're working on: ${content}

This appears to be a general request. For better assistance with AI-powered specification development, please use one of these commands:

- **Generate Specification**: Create a comprehensive project specification
- **Create Technical Plan**: Generate a detailed implementation plan
- **Break Down Tasks**: Convert specifications into actionable development tasks
- **Refine Specification**: Improve and enhance existing specifications

Each command uses advanced AI to help with different stages of your development process.`
    }
  }

  // AI Tools Status
  async getAIToolsStatus(): Promise<{ available: boolean, version?: string, error?: string }> {
    try {
      const env = specKitManager.getEnvironmentInfo()
      if (env?.isInitialized) {
        return { available: true, version: 'Spec-Kit Ready' }
      } else {
        await specKitManager.initialize()
        return { available: true, version: 'Spec-Kit Initialized' }
      }
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // Utility Methods
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2)
  }

  // Export/Import Functions
  async exportSpecification(specId: string, projectId: string, format: 'md' | 'pdf' | 'html' = 'md'): Promise<string> {
    const specsPath = path.join(this.specDir, 'projects', projectId, 'specs')
    const specFile = path.join(specsPath, `${specId}.json`)

    if (!fs.existsSync(specFile)) {
      throw new Error('Specification not found')
    }

    const spec: Specification = JSON.parse(fs.readFileSync(specFile, 'utf8'))

    switch (format) {
      case 'md':
        return spec.content
      case 'html':
        // Would need markdown-to-html converter
        return `<html><body><pre>${spec.content}</pre></body></html>`
      case 'pdf':
        // Would need PDF generation library
        throw new Error('PDF export not yet implemented')
      default:
        return spec.content
    }
  }

  async getSpecDirectory(): Promise<string> {
    return this.specDir
  }

  async getStats(): Promise<{ projects: number; specs: number; totalSize: number }> {
    const projects = await this.getProjects()
    let totalSpecs = 0
    let totalSize = 0

    for (const project of projects) {
      const specs = await this.loadSpecifications(project.id)
      totalSpecs += specs.length

      // Calculate approximate size
      for (const spec of specs) {
        totalSize += Buffer.byteLength(spec.content, 'utf8')
      }
    }

    return {
      projects: projects.length,
      specs: totalSpecs,
      totalSize
    }
  }
}

export const specService = new SpecService()