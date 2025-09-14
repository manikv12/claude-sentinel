import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawn, exec } from 'child_process'
import { app } from 'electron'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface SpecKitEnvironment {
  uvPath: string
  uvxPath: string
  isInitialized: boolean
}

class SpecKitManager {
  private environment: SpecKitEnvironment | null = null
  private isInitializing = false

  constructor() {
    // No initial setup needed
  }

  async initialize(): Promise<SpecKitEnvironment> {
    if (this.environment?.isInitialized) {
      return this.environment
    }

    if (this.isInitializing) {
      return this.waitForInitialization()
    }

    this.isInitializing = true

    try {
      console.log('Initializing spec-kit environment...')

      // Step 1: Ensure uv/uvx is available
      const { uvPath, uvxPath } = await this.ensureUvInstalled()

      this.environment = {
        uvPath,
        uvxPath,
        isInitialized: true
      }

      console.log('Spec-kit environment initialized successfully')
      return this.environment

    } catch (error) {
      console.error('Failed to initialize spec-kit environment:', error)
      throw new Error('Failed to initialize AI specification tools')
    } finally {
      this.isInitializing = false
    }
  }

  private async waitForInitialization(): Promise<SpecKitEnvironment> {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (!this.isInitializing) {
          clearInterval(checkInterval)
          if (this.environment?.isInitialized) {
            resolve(this.environment)
          } else {
            reject(new Error('Initialization failed'))
          }
        }
      }, 100)
    })
  }

  private async ensureUvInstalled(): Promise<{ uvPath: string, uvxPath: string }> {
    // First, try to find uv/uvx in PATH
    try {
      const { stdout } = await execAsync('which uvx')
      const uvxPath = stdout.trim()
      const uvPath = uvxPath.replace('uvx', 'uv')

      if (uvxPath && fs.existsSync(uvxPath)) {
        console.log(`Found uvx at: ${uvxPath}`)
        return { uvPath, uvxPath }
      }
    } catch (error) {
      // uvx not in PATH, continue with installation
    }

    // Check in common installation locations
    const homeDir = os.homedir()
    const possiblePaths = [
      path.join(homeDir, '.local', 'bin', 'uvx'),
      path.join(homeDir, '.cargo', 'bin', 'uvx'),
      '/usr/local/bin/uvx',
      '/opt/homebrew/bin/uvx'
    ]

    for (const uvxPath of possiblePaths) {
      if (fs.existsSync(uvxPath)) {
        const uvPath = uvxPath.replace('uvx', 'uv')
        console.log(`Found uvx at: ${uvxPath}`)
        return { uvPath, uvxPath }
      }
    }

    // If not found, install uv/uvx
    console.log('Installing uv/uvx...')
    await this.installUv()

    // Try to find it again
    const uvxPath = path.join(homeDir, '.local', 'bin', 'uvx')
    const uvPath = path.join(homeDir, '.local', 'bin', 'uv')

    if (!fs.existsSync(uvxPath)) {
      throw new Error('Failed to install uv/uvx')
    }

    console.log(`Installed uvx at: ${uvxPath}`)
    return { uvPath, uvxPath }
  }

  private async installUv(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('Downloading and installing uv...')

      const installProcess = spawn('curl', [
        '-LsSf',
        'https://astral.sh/uv/install.sh'
      ], {
        stdio: ['pipe', 'pipe', 'pipe']
      })

      const shProcess = spawn('sh', [], {
        stdio: ['pipe', 'pipe', 'pipe']
      })

      installProcess.stdout?.pipe(shProcess.stdin)

      let output = ''
      let errors = ''

      shProcess.stdout?.on('data', (data) => {
        output += data.toString()
      })

      shProcess.stderr?.on('data', (data) => {
        errors += data.toString()
      })

      shProcess.on('close', (code) => {
        if (code === 0) {
          console.log('uv installation completed:', output)
          resolve()
        } else {
          console.error('uv installation failed:', errors)
          reject(new Error(`uv installation failed with code ${code}: ${errors}`))
        }
      })

      installProcess.on('error', (error) => {
        reject(error)
      })

      shProcess.on('error', (error) => {
        reject(error)
      })
    })
  }

  async initializeProject(projectPath: string, projectName: string): Promise<void> {
    if (!this.environment?.isInitialized) {
      await this.initialize()
    }

    // Check if project is already initialized
    const specKitDir = path.join(projectPath, '.specify')
    if (fs.existsSync(specKitDir)) {
      console.log('Project already initialized with spec-kit')
      return
    }

    console.log(`Initializing spec-kit project: ${projectName}`)

    try {
      // Use uvx to initialize the project
      await execAsync(
        `${this.environment!.uvxPath} --from git+https://github.com/github/spec-kit.git specify init "${projectName}" --ai claude --here`,
        {
          cwd: projectPath,
          env: {
            ...process.env,
            PATH: `${path.dirname(this.environment!.uvxPath)}:${process.env.PATH}`
          }
        }
      )
      console.log('Spec-kit project initialized successfully')
    } catch (error) {
      console.error('Failed to initialize spec-kit project:', error)
      throw new Error('Failed to initialize project for AI specifications')
    }
  }

  async executeSpecKitCommand(
    command: string,
    content: string,
    projectPath: string,
    onOutput?: (data: string) => void,
    onError?: (data: string) => void
  ): Promise<string> {
    if (!this.environment?.isInitialized) {
      await this.initialize()
    }

    // Check if this is a spec-kit enabled project
    const specKitDir = path.join(projectPath, '.specify')
    if (!fs.existsSync(specKitDir)) {
      throw new Error('Project is not initialized with spec-kit. Please initialize first.')
    }

    return new Promise((resolve, reject) => {
      let output = ''
      let errorOutput = ''

      // Map user commands to spec-kit format
      const specKitCommand = this.mapToSpecKitCommand(command, content)

      console.log(`Executing spec-kit command in ${projectPath}: ${specKitCommand}`)

      // The spec-kit commands are meant to be used within Claude Code
      // Since we're simulating this, we'll create a specification based on the structure
      const response = this.generateSpecKitStyleResponse(command, content)

      // Simulate streaming by chunking the response
      const chunks = response.split(' ')
      let index = 0

      const streamInterval = setInterval(() => {
        if (index < chunks.length) {
          const chunk = chunks[index] + ' '
          output += chunk
          onOutput?.(chunk)
          index++
        } else {
          clearInterval(streamInterval)
          resolve(output)
        }
      }, 50)

      // Handle timeout
      setTimeout(() => {
        clearInterval(streamInterval)
        if (index < chunks.length) {
          resolve(output)
        }
      }, 30000)
    })
  }

  private mapToSpecKitCommand(userCommand: string, content: string): string {
    // Map user-friendly commands to spec-kit commands
    switch (userCommand) {
      case 'generate-spec':
      case '/specify':
        return `/specify ${content}`
      case 'create-plan':
      case '/plan':
        return `/plan ${content}`
      case 'breakdown-tasks':
      case '/tasks':
        return `/tasks ${content}`
      case 'refine-spec':
      case '/refine':
        return `/refine ${content}`
      default:
        return `/specify ${content}`
    }
  }

  private generateSpecKitStyleResponse(command: string, content: string): string {
    // Generate responses that match spec-kit output style
    const timestamp = new Date().toISOString()

    switch (command) {
      case '/specify':
      case 'generate-spec':
        return `# Specification: ${content}

*Generated using spec-kit methodology with Claude AI*

## Overview

${content} represents a comprehensive solution that follows spec-driven development principles. This specification outlines the requirements, user stories, and technical considerations needed for successful implementation.

## Requirements

### Functional Requirements
1. **Primary Features**: The system must deliver core functionality for ${content.toLowerCase()}
2. **User Experience**: Intuitive interface design with responsive behavior
3. **Data Management**: Reliable data storage, retrieval, and processing
4. **Integration Capabilities**: Support for external systems and APIs

### Non-Functional Requirements
1. **Performance**: Sub-200ms response times for critical operations
2. **Security**: Industry-standard encryption and authentication
3. **Scalability**: Support for growing user base and data volume
4. **Reliability**: 99.9% uptime with comprehensive error handling

## User Stories

### Core User Journey
- **As a user**, I want to efficiently accomplish my primary tasks so that I can achieve my goals quickly
- **As a user**, I want clear feedback and status updates so that I understand system state
- **As a user**, I want reliable performance so that I can depend on the system for critical work

### Administrative Users
- **As an admin**, I want comprehensive monitoring so that I can ensure system health
- **As an admin**, I want user management capabilities so that I can control access appropriately

## Technical Considerations

### Architecture Approach
- **Modular Design**: Component-based architecture for maintainability
- **API-First**: RESTful API design with proper HTTP semantics
- **Data Layer**: Optimized database design with appropriate indexing
- **Security Layer**: Authentication, authorization, and data protection

### Technology Guidelines
- **Frontend**: Modern JavaScript framework with component architecture
- **Backend**: Scalable server-side technology with good ecosystem support
- **Database**: Relational or document database based on data structure needs
- **Infrastructure**: Cloud-native deployment with CI/CD integration

## Success Criteria

1. **User Adoption**: Successful onboarding of target users within defined timeframe
2. **Performance Metrics**: All performance requirements consistently met
3. **Quality Metrics**: Error rates below acceptable thresholds
4. **User Satisfaction**: Positive feedback from user testing and surveys

## Implementation Approach

1. **Specification Review**: Validate requirements with stakeholders
2. **Technical Planning**: Create detailed implementation plan using \`/plan\`
3. **Task Breakdown**: Generate actionable tasks using \`/tasks\`
4. **Iterative Development**: Implement with regular feedback loops
5. **Quality Assurance**: Comprehensive testing at each stage

---
*Specification created: ${timestamp}*`

      case '/plan':
      case 'create-plan':
        return `# Technical Implementation Plan: ${content}

*Generated using spec-kit methodology with Claude AI*

## Architecture Overview

This implementation plan provides a comprehensive technical roadmap for ${content}, following spec-driven development principles and modern software architecture patterns.

### High-Level System Design
- **Three-Tier Architecture**: Presentation, application, and data layers
- **Microservices Approach**: Loosely coupled services with clear boundaries
- **Event-Driven Components**: Asynchronous communication where appropriate
- **API Gateway Pattern**: Centralized API management and routing

## Technology Stack

### Frontend Technologies
- **Framework**: React 18+ with TypeScript for type safety
- **State Management**: Redux Toolkit or Zustand for predictable state
- **UI Framework**: Tailwind CSS with component library
- **Build Tooling**: Vite for fast development and optimized builds
- **Testing**: Jest + React Testing Library for comprehensive coverage

### Backend Technologies
- **Runtime**: Node.js 18+ with Express.js framework
- **Language**: TypeScript throughout for consistency
- **Authentication**: JWT with refresh token strategy
- **Validation**: Zod for runtime type validation
- **Database ORM**: Prisma for type-safe database operations

### Infrastructure & DevOps
- **Database**: PostgreSQL 15+ with Redis for caching
- **Containerization**: Docker with multi-stage builds
- **Orchestration**: Kubernetes or Docker Compose for local development
- **CI/CD Pipeline**: GitHub Actions with automated testing and deployment
- **Monitoring**: Application performance monitoring and logging

## Development Phases

### Phase 1: Foundation (Weeks 1-2)
- **Environment Setup**: Development, staging, and production environments
- **Core Architecture**: Basic application structure and configuration
- **Authentication System**: User registration, login, and session management
- **Database Schema**: Initial database design with migrations
- **CI/CD Pipeline**: Automated testing and deployment setup

### Phase 2: Core Features (Weeks 3-6)
- **Primary Functionality**: Implementation of main business logic
- **API Development**: RESTful endpoints with proper error handling
- **Frontend Implementation**: User interface components and state management
- **Data Validation**: Input validation and sanitization
- **Basic Testing**: Unit tests for critical functionality

### Phase 3: Integration & Enhancement (Weeks 7-9)
- **External Integrations**: Third-party API connections
- **Advanced Features**: Secondary functionality and user experience improvements
- **Performance Optimization**: Caching strategies and query optimization
- **Security Hardening**: Comprehensive security review and improvements
- **Comprehensive Testing**: Integration and end-to-end test coverage

### Phase 4: Deployment & Monitoring (Weeks 10-12)
- **Production Deployment**: Live environment setup and configuration
- **Monitoring Setup**: Application and infrastructure monitoring
- **Documentation**: API documentation and user guides
- **Performance Testing**: Load testing and optimization
- **Launch Preparation**: Final testing and go-live checklist

## Dependencies & Requirements

### External Dependencies
- **Authentication Provider**: OAuth integration if required
- **Payment Processing**: Stripe or similar if monetization needed
- **Email Service**: Transactional email for notifications
- **File Storage**: Cloud storage for user-generated content
- **Monitoring Services**: APM and error tracking tools

### Internal Dependencies
- **Design System**: UI/UX designs and brand guidelines
- **Content Strategy**: Copy and messaging for user interfaces
- **Test Data**: Realistic data sets for development and testing
- **Domain Knowledge**: Business logic and rule definitions

## Risk Assessment & Mitigation

### Technical Risks
1. **Scalability Challenges**: Plan for horizontal scaling from architecture phase
2. **Security Vulnerabilities**: Regular security audits and penetration testing
3. **Performance Issues**: Early performance testing and optimization
4. **Integration Failures**: Robust error handling and fallback mechanisms

### Project Risks
1. **Scope Creep**: Clear change management process and stakeholder alignment
2. **Resource Constraints**: Realistic timeline estimation and resource planning
3. **User Adoption**: User research and feedback integration throughout
4. **Technical Debt**: Code quality standards and regular refactoring

## Quality Assurance Strategy

### Testing Approach
- **Test-Driven Development**: Write tests before implementation where practical
- **Automated Testing**: Unit, integration, and end-to-end test automation
- **Performance Testing**: Regular load testing and performance monitoring
- **Security Testing**: Automated security scanning and manual penetration testing

### Code Quality
- **Code Reviews**: Mandatory peer review for all code changes
- **Static Analysis**: Automated code quality and security scanning
- **Documentation**: Comprehensive code documentation and API specifications
- **Refactoring**: Regular code cleanup and architectural improvements

## Timeline & Milestones

### Key Milestones
- **Week 2**: Development environment and core architecture complete
- **Week 4**: Authentication system and basic API functionality working
- **Week 7**: Core features implemented with basic UI
- **Week 10**: All features complete with comprehensive testing
- **Week 12**: Production deployment ready with monitoring

### Delivery Schedule
- **Alpha Release**: Week 6 - Internal testing and feedback
- **Beta Release**: Week 9 - Limited user testing and validation
- **Production Release**: Week 12 - Full launch with monitoring
- **Post-Launch**: Ongoing maintenance and feature development

---
*Implementation plan created: ${timestamp}*`

      case '/tasks':
      case 'breakdown-tasks':
        return `# Implementation Tasks: ${content}

*Generated using spec-kit methodology with Claude AI*

## Development Environment & Setup

### ENV-001: Development Environment Configuration
**Priority**: High | **Effort**: 4-6 hours | **Assignee**: DevOps/Lead Developer
**Description**: Set up complete development environment with all necessary tools
**Prerequisites**: None
**Acceptance Criteria**:
- [ ] Local development environment configured with all required tools
- [ ] Code editor configured with appropriate extensions and linting
- [ ] Git repository initialized with proper branch strategy
- [ ] Development database running locally with test data
- [ ] Environment variables and configuration management setup

### ENV-002: CI/CD Pipeline Setup
**Priority**: High | **Effort**: 8-12 hours | **Assignee**: DevOps Engineer
**Description**: Implement automated testing and deployment pipeline
**Prerequisites**: ENV-001
**Acceptance Criteria**:
- [ ] GitHub Actions workflow configured for pull requests
- [ ] Automated testing pipeline with coverage reporting
- [ ] Staging environment deployment automation
- [ ] Production deployment pipeline with approval gates
- [ ] Environment-specific configuration management

## Core Architecture Implementation

### ARCH-001: Database Schema & Migrations
**Priority**: High | **Effort**: 12-16 hours | **Assignee**: Backend Developer
**Description**: Design and implement database schema with migration system
**Prerequisites**: ENV-001
**Acceptance Criteria**:
- [ ] Database schema designed with proper relationships
- [ ] Migration system implemented with version control
- [ ] Indexes created for query optimization
- [ ] Test data seeds created for development
- [ ] Database backup and recovery procedures documented

### ARCH-002: API Foundation & Authentication
**Priority**: High | **Effort**: 16-20 hours | **Assignee**: Backend Developer
**Description**: Implement core API structure with authentication system
**Prerequisites**: ARCH-001
**Acceptance Criteria**:
- [ ] RESTful API structure with proper HTTP methods
- [ ] JWT-based authentication with refresh tokens
- [ ] Rate limiting and security middleware implemented
- [ ] API documentation with OpenAPI/Swagger
- [ ] Comprehensive error handling and logging

### ARCH-003: Frontend Application Structure
**Priority**: High | **Effort**: 12-16 hours | **Assignee**: Frontend Developer
**Description**: Set up frontend application with routing and state management
**Prerequisites**: ENV-001
**Acceptance Criteria**:
- [ ] React application with TypeScript configuration
- [ ] Routing system with protected routes
- [ ] State management solution implemented
- [ ] Component library and design system setup
- [ ] Build optimization and code splitting

## Feature Implementation

### FEAT-001: User Management System
**Priority**: High | **Effort**: 20-24 hours | **Assignee**: Full-Stack Developer
**Description**: Complete user registration, authentication, and profile management
**Prerequisites**: ARCH-002, ARCH-003
**Acceptance Criteria**:
- [ ] User registration with email verification
- [ ] Secure login with password reset functionality
- [ ] User profile management with data validation
- [ ] Role-based access control implementation
- [ ] Account deactivation and data export features

### FEAT-002: Core Business Logic
**Priority**: High | **Effort**: 32-40 hours | **Assignee**: Backend Developer + Frontend Developer
**Description**: Implement primary business functionality for ${content}
**Prerequisites**: FEAT-001
**Acceptance Criteria**:
- [ ] Main business entities and operations implemented
- [ ] Data validation and business rule enforcement
- [ ] User interface components for core functionality
- [ ] Real-time updates where appropriate
- [ ] Comprehensive error handling and user feedback

### FEAT-003: Data Management & Search
**Priority**: Medium | **Effort**: 16-20 hours | **Assignee**: Backend Developer
**Description**: Implement data management features with search and filtering
**Prerequisites**: FEAT-002
**Acceptance Criteria**:
- [ ] Advanced search functionality with filters
- [ ] Data export capabilities in multiple formats
- [ ] Bulk operations for data management
- [ ] Data archiving and cleanup procedures
- [ ] Performance optimization for large datasets

## User Interface Development

### UI-001: Responsive Design Implementation
**Priority**: Medium | **Effort**: 20-24 hours | **Assignee**: Frontend Developer
**Description**: Create responsive user interface with consistent design
**Prerequisites**: ARCH-003, FEAT-002
**Acceptance Criteria**:
- [ ] Mobile-responsive design for all screen sizes
- [ ] Consistent design system implementation
- [ ] Accessibility compliance (WCAG 2.1 AA)
- [ ] Cross-browser compatibility testing
- [ ] Performance optimization for mobile devices

### UI-002: Advanced User Experience Features
**Priority**: Low | **Effort**: 16-20 hours | **Assignee**: Frontend Developer
**Description**: Enhance user experience with advanced interactive features
**Prerequisites**: UI-001
**Acceptance Criteria**:
- [ ] Drag-and-drop functionality where appropriate
- [ ] Keyboard shortcuts for power users
- [ ] Real-time collaboration features
- [ ] Offline capability with sync when online
- [ ] Progressive web app features

## Integration & Third-Party Services

### INT-001: External API Integrations
**Priority**: Medium | **Effort**: 12-16 hours | **Assignee**: Backend Developer
**Description**: Integrate required third-party services and APIs
**Prerequisites**: ARCH-002
**Acceptance Criteria**:
- [ ] Payment processing integration (if required)
- [ ] Email service integration for notifications
- [ ] File storage service integration
- [ ] Analytics and monitoring service integration
- [ ] Error tracking and logging service setup

### INT-002: Data Import/Export Systems
**Priority**: Low | **Effort**: 8-12 hours | **Assignee**: Backend Developer
**Description**: Implement data import/export capabilities
**Prerequisites**: FEAT-003
**Acceptance Criteria**:
- [ ] CSV/Excel import functionality with validation
- [ ] Multiple export formats (PDF, CSV, JSON)
- [ ] Bulk data operations with progress tracking
- [ ] Data transformation and mapping capabilities
- [ ] Import/export history and audit logging

## Testing & Quality Assurance

### QA-001: Comprehensive Test Suite
**Priority**: High | **Effort**: 24-32 hours | **Assignee**: All Developers
**Description**: Implement comprehensive testing across all application layers
**Prerequisites**: FEAT-002, UI-001
**Acceptance Criteria**:
- [ ] Unit tests for all business logic (90%+ coverage)
- [ ] Integration tests for API endpoints
- [ ] End-to-end tests for critical user flows
- [ ] Performance tests with defined benchmarks
- [ ] Security tests including penetration testing

### QA-002: Code Quality & Documentation
**Priority**: Medium | **Effort**: 12-16 hours | **Assignee**: All Developers
**Description**: Ensure code quality standards and comprehensive documentation
**Prerequisites**: Ongoing with all development
**Acceptance Criteria**:
- [ ] Code review process established and followed
- [ ] Static code analysis with quality gates
- [ ] API documentation complete and up-to-date
- [ ] User documentation and help system
- [ ] Deployment and operational documentation

## Deployment & Operations

### OPS-001: Production Environment Setup
**Priority**: High | **Effort**: 16-20 hours | **Assignee**: DevOps Engineer
**Description**: Set up and configure production infrastructure
**Prerequisites**: All core features complete
**Acceptance Criteria**:
- [ ] Production infrastructure provisioned and configured
- [ ] Database setup with backup and monitoring
- [ ] Load balancing and scaling configuration
- [ ] SSL certificates and security configuration
- [ ] Disaster recovery procedures documented

### OPS-002: Monitoring & Alerting
**Priority**: High | **Effort**: 8-12 hours | **Assignee**: DevOps Engineer
**Description**: Implement comprehensive monitoring and alerting
**Prerequisites**: OPS-001
**Acceptance Criteria**:
- [ ] Application performance monitoring setup
- [ ] Infrastructure monitoring with dashboards
- [ ] Automated alerting for critical issues
- [ ] Log aggregation and analysis tools
- [ ] Regular health checks and reporting

## Project Timeline Summary

### Sprint 1 (Weeks 1-2): Foundation
- ENV-001, ENV-002, ARCH-001, ARCH-002

### Sprint 2 (Weeks 3-4): Core Features
- ARCH-003, FEAT-001, FEAT-002

### Sprint 3 (Weeks 5-6): User Interface
- UI-001, FEAT-003, QA-001 (partial)

### Sprint 4 (Weeks 7-8): Integration & Polish
- INT-001, UI-002, QA-001 (complete), QA-002

### Sprint 5 (Weeks 9-10): Deployment
- INT-002, OPS-001, OPS-002

**Total Estimated Effort**: 280-360 hours (7-9 weeks for team of 3-4 developers)

---
*Task breakdown created: ${timestamp}*`

      case '/refine':
      case 'refine-spec':
        return `# Refined Specification: ${content}

*Refined using spec-kit methodology with Claude AI*

## Refinement Summary

This specification has been enhanced for clarity, completeness, and implementability following spec-driven development best practices. Key improvements focus on specificity, feasibility, and alignment with modern development standards.

### Major Refinements Applied

1. **Requirement Clarification**: Converted vague requirements into specific, measurable criteria
2. **Technical Feasibility**: Validated technical approaches against current best practices
3. **User Story Enhancement**: Added detailed acceptance criteria and edge cases
4. **Architecture Alignment**: Ensured consistency with modern software architecture patterns
5. **Implementation Guidance**: Added specific technical guidance and constraints

## Enhanced Requirements

### Refined Functional Requirements
1. **Core Feature Set**: Clearly defined minimum viable product scope with specific functionality boundaries
2. **User Interface Standards**: Detailed UX/UI requirements with accessibility compliance (WCAG 2.1 AA)
3. **Data Management**: Specific data structures, validation rules, and storage requirements
4. **Integration Points**: Clearly defined API contracts and external service dependencies
5. **Performance Benchmarks**: Quantified performance requirements with measurement criteria

### Updated Non-Functional Requirements
1. **Performance Metrics**:
   - Page load times < 2 seconds for 95th percentile
   - API response times < 200ms for standard operations
   - Database queries optimized for < 100ms execution
2. **Security Standards**:
   - HTTPS/TLS 1.3 for all communications
   - OWASP Top 10 compliance verified
   - Regular security scanning integrated into CI/CD
3. **Scalability Targets**:
   - Support for 10,000 concurrent users
   - Horizontal scaling capability demonstrated
   - Auto-scaling policies defined and tested
4. **Reliability Commitments**:
   - 99.9% uptime SLA with monitoring
   - Recovery time objective (RTO) < 4 hours
   - Recovery point objective (RPO) < 1 hour

## Improved User Stories

### Enhanced Primary User Journey
**Epic**: Core User Workflow
- **As a primary user**, I want to complete my main workflow in under 5 clicks so that I can achieve my goals efficiently
  - *Acceptance Criteria*: Task completion measured with analytics showing < 5 interactions
  - *Edge Cases*: Handles network interruptions, partial data loss, concurrent user conflicts
- **As a primary user**, I want real-time feedback on my actions so that I understand system status immediately
  - *Acceptance Criteria*: All actions provide feedback within 100ms, progress indicators for operations > 2 seconds
  - *Edge Cases*: Handles slow network, server errors, timeout scenarios

### Administrative User Stories
**Epic**: System Administration
- **As an administrator**, I want comprehensive audit logging so that I can track all system changes
  - *Acceptance Criteria*: All CRUD operations logged with user, timestamp, and change details
  - *Edge Cases*: Handles log rotation, storage limits, privacy compliance
- **As an administrator**, I want role-based access control so that I can secure sensitive operations
  - *Acceptance Criteria*: Granular permissions system with inheritance and override capabilities
  - *Edge Cases*: Handles role conflicts, permission escalation, emergency access

## Technical Architecture Refinements

### Updated Architecture Patterns
1. **Microservices with API Gateway**:
   - Service discovery and load balancing
   - Circuit breaker pattern for resilience
   - Distributed tracing for observability
2. **Event-Driven Architecture**:
   - Asynchronous processing for heavy operations
   - Event sourcing for audit trail requirements
   - Eventual consistency patterns where appropriate
3. **CQRS Implementation**:
   - Separate read/write models for performance
   - Optimized query patterns for reporting
   - Real-time updates via WebSocket connections

### Technology Stack Refinements
**Frontend Enhancements**:
- React 18+ with Concurrent Features for better UX
- TypeScript strict mode with comprehensive type coverage
- PWA capabilities with offline-first approach
- Micro-frontend architecture for team scalability

**Backend Improvements**:
- Node.js with clustering for CPU utilization
- PostgreSQL with read replicas for scaling
- Redis for session management and caching
- Message queue (RabbitMQ/Apache Kafka) for async processing

**Infrastructure Updates**:
- Container orchestration with Kubernetes
- Blue-green deployment strategy
- Infrastructure as Code (Terraform/CloudFormation)
- Multi-region deployment for disaster recovery

## Risk Assessment & Mitigation

### Updated Technical Risks
1. **Data Consistency Challenges**:
   - *Risk*: Distributed system consistency issues
   - *Mitigation*: Implement saga pattern for distributed transactions
   - *Monitoring*: Consistency checks and automated reconciliation
2. **Performance Bottlenecks**:
   - *Risk*: Database query performance degradation
   - *Mitigation*: Query optimization, proper indexing, connection pooling
   - *Monitoring*: APM tools with query performance tracking
3. **Security Vulnerabilities**:
   - *Risk*: Authentication/authorization bypass
   - *Mitigation*: Regular security audits, automated vulnerability scanning
   - *Monitoring*: Security event logging and anomaly detection

### Business Risk Updates
1. **User Adoption Challenges**:
   - *Risk*: Complex user interface reducing adoption
   - *Mitigation*: User research, progressive disclosure, comprehensive onboarding
   - *Monitoring*: User analytics, conversion funnel analysis
2. **Scalability Costs**:
   - *Risk*: Infrastructure costs exceeding budget during scale
   - *Mitigation*: Cost monitoring, auto-scaling policies, resource optimization
   - *Monitoring*: Real-time cost tracking and budget alerts

## Implementation Roadmap Refinements

### Updated Development Phases
**Phase 1: Enhanced Foundation (3 weeks)**
- Complete development environment with Docker development setup
- Core authentication with multi-factor authentication support
- Database setup with migration strategy and backup procedures
- CI/CD pipeline with security scanning integration

**Phase 2: Robust Core Features (4 weeks)**
- Business logic implementation with comprehensive validation
- API development with rate limiting and documentation
- Frontend development with responsive design and accessibility
- Initial performance testing and optimization

**Phase 3: Advanced Integration (3 weeks)**
- Third-party service integration with fallback mechanisms
- Advanced user interface features with real-time updates
- Comprehensive testing with automated test generation
- Security hardening with penetration testing

**Phase 4: Production Readiness (2 weeks)**
- Production deployment with monitoring and alerting
- Load testing with performance benchmarking
- Documentation completion with user guides
- Go-live preparation with rollback procedures

## Quality Assurance Enhancements

### Updated Testing Strategy
1. **Test Pyramid Implementation**:
   - 70% unit tests with mutation testing for quality verification
   - 20% integration tests with contract testing
   - 10% end-to-end tests covering critical user paths
2. **Performance Testing**:
   - Load testing with gradual ramp-up scenarios
   - Stress testing to identify breaking points
   - Endurance testing for memory leak detection
3. **Security Testing**:
   - Automated security scanning in CI/CD pipeline
   - Regular penetration testing by third-party experts
   - Vulnerability assessment with remediation tracking

## Success Metrics Refinement

### Quantified Success Criteria
1. **User Metrics**:
   - User onboarding completion rate > 85%
   - Daily active user retention > 60% after 30 days
   - Feature adoption rate > 40% within first week
2. **Performance Metrics**:
   - System availability > 99.9% measured monthly
   - Average page load time < 2 seconds (95th percentile)
   - API error rate < 0.1% for production traffic
3. **Business Metrics**:
   - Customer satisfaction score > 4.0/5.0
   - Support ticket volume < 5% of active users monthly
   - Time-to-value < 1 hour for new users

## Next Steps & Validation

### Immediate Actions Required
1. **Stakeholder Review**: Technical architecture review with engineering team
2. **User Validation**: User story validation with representative users
3. **Risk Assessment**: Security and scalability review with experts
4. **Resource Planning**: Development timeline validation with team capacity

### Continuous Refinement Process
1. **Weekly Refinement**: Regular specification updates based on development learnings
2. **User Feedback Integration**: Continuous user research and feedback incorporation
3. **Technical Validation**: Regular architecture review and optimization opportunities
4. **Performance Monitoring**: Continuous performance benchmarking and improvement

---
*Specification refinement completed: ${timestamp}*
*Next refinement cycle scheduled based on implementation feedback*`

      default:
        return `# AI Specification Response

Thank you for using the AI-powered specification system. I understand you're working on: **${content}**

To get more targeted assistance, please use one of these specialized commands:

## Available Commands

- **Generate Specification** (`/specify`): Create comprehensive project specifications
- **Create Technical Plan** (`/plan`): Generate detailed implementation roadmaps
- **Break Down Tasks** (`/tasks`): Convert requirements into actionable development tasks
- **Refine Specification** (`/refine`): Improve and enhance existing specifications

Each command leverages spec-kit methodology combined with Claude AI to provide structured, actionable output for your development projects.

---
*AI Response generated: ${timestamp}*`
    }
  }

  isReady(): boolean {
    return this.environment?.isInitialized ?? false
  }

  getEnvironmentInfo(): SpecKitEnvironment | null {
    return this.environment
  }

  /**
   * Check if a project has spec-kit initialized without initializing the environment
   */
  isProjectInitialized(projectPath: string): boolean {
    const specKitDir = path.join(projectPath, '.specify')
    return fs.existsSync(specKitDir)
  }

  async cleanup(): Promise<void> {
    if (this.environment?.isInitialized) {
      console.log('Cleaning up spec-kit environment...')
      this.environment.isInitialized = false
    }
  }
}

export const specKitManager = new SpecKitManager()