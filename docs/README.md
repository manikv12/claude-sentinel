# Claude Sentinel Documentation

Welcome to the Claude Sentinel documentation. This documentation covers all features and components of the Claude Sentinel desktop application.

## Table of Contents

1. [Overview](#overview)
2. [Core Features](#core-features)
3. [Feature Documentation](#feature-documentation)
4. [Development](#development)
5. [Contributing](#contributing)

## Overview

Claude Sentinel is a desktop application for monitoring Claude usage, managing auto-renewal, and developing project specifications with AI assistance. Built with Electron, React, and TypeScript, it provides a comprehensive toolkit for Claude users to track their usage and streamline their development workflow.

## Core Features

### Usage Monitoring
- Real-time Claude usage tracking
- Usage statistics and charts
- Token usage breakdown
- Cost tracking and reporting

### Auto-Renewal Management
- Automated session renewal
- Configurable renewal schedules
- Renewal history and logs
- Smart renewal strategies

### Spec Development (New)
- AI-powered specification generation
- Interactive chat interface with Claude Code
- Real-time markdown preview
- Approval workflow for specifications
- Project organization and management

## Feature Documentation

### [Spec Development](./spec-development/README.md)
Complete documentation for the AI-powered specification development feature:

- **[User Guide](./spec-development/USER_GUIDE.md)**: How to use the spec development features
- **[API Reference](./spec-development/API_REFERENCE.md)**: Technical API documentation
- **[Architecture](./spec-development/ARCHITECTURE.md)**: System architecture and design
- **[Integration Guide](./spec-development/INTEGRATION.md)**: Integration with external tools
- **[Implementation Details](./spec-development/IMPLEMENTATION_DETAILS.md)**: Technical implementation details

### Usage Monitoring
Documentation for usage tracking and monitoring features (coming soon).

### Auto-Renewal
Documentation for automated renewal management (coming soon).

## Development

### Getting Started

1. **Prerequisites**:
   - Node.js 18+
   - npm or yarn
   - Git

2. **Installation**:
   ```bash
   git clone <repository-url>
   cd claude-sentinel
   npm install
   ```

3. **Development**:
   ```bash
   npm run dev
   ```

4. **Building**:
   ```bash
   npm run build
   ```

### Project Structure

```
claude-sentinel/
├── src/                          # Frontend source code
│   ├── components/              # React components
│   │   ├── spec-development/   # Spec development components
│   │   └── ui/                 # Shared UI components
│   ├── stores/                 # State management
│   └── lib/                    # Utilities
├── electron/                    # Electron main process
│   ├── services/               # Backend services
│   └── main.ts                # Main process entry
├── docs/                       # Documentation
│   └── spec-development/      # Spec development docs
├── build/                      # Build assets
└── dist/                       # Build output
```

### Architecture

Claude Sentinel follows a layered architecture:

- **Frontend**: React with TypeScript and Tailwind CSS
- **State Management**: Zustand for reactive state management
- **Backend**: Electron main process with service layer
- **IPC**: Secure communication between renderer and main processes
- **Storage**: File-based storage with JSON and Markdown files

### Key Technologies

- **Electron**: Desktop application framework
- **React**: Frontend UI framework
- **TypeScript**: Type-safe JavaScript
- **Tailwind CSS**: Utility-first CSS framework
- **Zustand**: Lightweight state management
- **React Markdown**: Markdown rendering
- **Recharts**: Data visualization

## Contributing

### Development Workflow

1. **Fork** the repository
2. **Create** a feature branch
3. **Implement** your changes
4. **Test** thoroughly
5. **Submit** a pull request

### Code Standards

- **TypeScript**: All new code must be written in TypeScript
- **Testing**: Include unit tests for new features
- **Documentation**: Update documentation for new features
- **Linting**: Follow ESLint rules
- **Formatting**: Use Prettier for code formatting

### Pull Request Process

1. Ensure all tests pass
2. Update documentation if needed
3. Follow conventional commit messages
4. Request review from maintainers

### Testing

```bash
# Run unit tests
npm test

# Run type checking
npm run typecheck

# Run linting
npm run lint
```

### Feature Development

When adding new features:

1. **Plan**: Document the feature design and architecture
2. **Implement**: Follow existing patterns and conventions
3. **Test**: Add comprehensive tests
4. **Document**: Create user and technical documentation
5. **Review**: Submit for code review

### Documentation Guidelines

- **User Documentation**: Focus on how to use features
- **Technical Documentation**: Explain architecture and implementation
- **API Documentation**: Document all APIs and interfaces
- **Code Comments**: Explain complex logic and business rules

## Support

### Getting Help

1. **Documentation**: Check this documentation first
2. **Issues**: Search existing GitHub issues
3. **Community**: Join community discussions
4. **Support**: Contact support for critical issues

### Reporting Issues

When reporting issues, please include:

- **Environment**: OS, Node.js version, app version
- **Steps to Reproduce**: Clear reproduction steps
- **Expected Behavior**: What should happen
- **Actual Behavior**: What actually happens
- **Screenshots**: If applicable
- **Logs**: Relevant console or application logs

### Feature Requests

Feature requests should include:

- **Use Case**: Why is this feature needed?
- **Description**: Detailed feature description
- **Implementation**: Suggested implementation approach
- **Alternatives**: Alternative solutions considered

## Roadmap

### Planned Features

- **Enhanced AI Integration**: Better Claude Code integration
- **Team Collaboration**: Multi-user specification editing
- **Template System**: Reusable specification templates
- **Integration Ecosystem**: More external tool integrations
- **Mobile Companion**: Mobile app for monitoring
- **Cloud Sync**: Optional cloud synchronization

### Version History

- **v1.0.0**: Initial release with usage monitoring and auto-renewal
- **v1.1.0**: Added spec development feature
- **v1.2.0**: Enhanced UI and performance improvements (planned)

## License

Claude Sentinel is licensed under the MIT License. See the LICENSE file for details.

## Acknowledgments

Special thanks to:

- **Anthropic**: For Claude AI and Claude Code
- **GitHub**: For the spec-kit methodology and tools
- **Open Source Community**: For the amazing tools and libraries

---

For specific feature documentation, please see the individual documentation files in the respective feature directories.