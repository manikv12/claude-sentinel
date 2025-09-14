import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawn, exec } from 'child_process'
import { app } from 'electron'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface PythonEnvironment {
  pythonPath: string
  venvPath: string
  specKitPath: string
  isInitialized: boolean
}

class PythonManager {
  private environment: PythonEnvironment | null = null
  private isInitializing = false
  private readonly userDataPath = app.getPath('userData')
  private readonly pythonDir = path.join(this.userDataPath, 'ai-tools', 'python')
  private readonly venvDir = path.join(this.userDataPath, 'ai-tools', 'spec-env')

  constructor() {
    this.ensureDirectories()
  }

  private ensureDirectories(): void {
    const aiToolsDir = path.join(this.userDataPath, 'ai-tools')
    if (!fs.existsSync(aiToolsDir)) {
      fs.mkdirSync(aiToolsDir, { recursive: true })
    }
  }

  async initialize(): Promise<PythonEnvironment> {
    if (this.environment?.isInitialized) {
      return this.environment
    }

    if (this.isInitializing) {
      // Wait for ongoing initialization
      return this.waitForInitialization()
    }

    this.isInitializing = true

    try {
      console.log('Initializing AI specification environment...')

      // Step 1: Ensure Python is available
      const pythonPath = await this.ensurePython()

      // Step 2: Create virtual environment
      const venvPath = await this.ensureVirtualEnvironment(pythonPath)

      // Step 3: Install spec-kit
      const specKitPath = await this.ensureSpecKit(venvPath)

      this.environment = {
        pythonPath,
        venvPath,
        specKitPath,
        isInitialized: true
      }

      console.log('AI specification environment initialized successfully')
      return this.environment

    } catch (error) {
      console.error('Failed to initialize AI environment:', error)
      throw new Error('Failed to initialize AI specification features')
    } finally {
      this.isInitializing = false
    }
  }

  private async waitForInitialization(): Promise<PythonEnvironment> {
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

  private async ensurePython(): Promise<string> {
    // First, try to use system Python 3.11+
    try {
      const { stdout } = await execAsync('python3 --version')
      const version = stdout.trim()
      const versionMatch = version.match(/Python (\d+)\.(\d+)/)

      if (versionMatch) {
        const major = parseInt(versionMatch[1])
        const minor = parseInt(versionMatch[2])

        if (major >= 3 && minor >= 11) {
          console.log(`Using system Python: ${version}`)
          return 'python3'
        }
      }
    } catch (error) {
      // System Python not available or wrong version
    }

    // Try regular 'python' command
    try {
      const { stdout } = await execAsync('python --version')
      const version = stdout.trim()
      const versionMatch = version.match(/Python (\d+)\.(\d+)/)

      if (versionMatch) {
        const major = parseInt(versionMatch[1])
        const minor = parseInt(versionMatch[2])

        if (major >= 3 && minor >= 11) {
          console.log(`Using system Python: ${version}`)
          return 'python'
        }
      }
    } catch (error) {
      // Python not available
    }

    // TODO: In production, we would bundle a portable Python
    // For now, we'll install via system package managers
    throw new Error('Python 3.11+ is required. Please install Python and try again.')
  }

  private async ensureVirtualEnvironment(pythonPath: string): Promise<string> {
    if (fs.existsSync(this.venvDir)) {
      console.log('Virtual environment already exists')
      return this.venvDir
    }

    console.log('Creating virtual environment...')

    try {
      await execAsync(`${pythonPath} -m venv "${this.venvDir}"`)
      console.log('Virtual environment created successfully')
      return this.venvDir
    } catch (error) {
      console.error('Failed to create virtual environment:', error)
      throw new Error('Failed to set up AI environment')
    }
  }

  private async ensureSpecKit(venvPath: string): Promise<string> {
    const isWindows = os.platform() === 'win32'
    const binDir = isWindows ? 'Scripts' : 'bin'
    const pythonExe = isWindows ? 'python.exe' : 'python'
    const specifyExe = isWindows ? 'specify.exe' : 'specify'

    const venvPython = path.join(venvPath, binDir, pythonExe)
    const specKitPath = path.join(venvPath, binDir, specifyExe)

    // Check if spec-kit is already installed
    if (fs.existsSync(specKitPath)) {
      try {
        // Verify it works
        await execAsync(`"${specKitPath}" --version`)
        console.log('spec-kit already installed and working')
        return specKitPath
      } catch (error) {
        console.log('spec-kit exists but not working, reinstalling...')
      }
    }

    console.log('Installing spec-kit...')

    try {
      // Upgrade pip first
      await execAsync(`"${venvPython}" -m pip install --upgrade pip`)

      // Install spec-kit (quietly to avoid cluttering logs)
      await execAsync(`"${venvPython}" -m pip install -q spec-kit`)

      // Verify installation
      await execAsync(`"${specKitPath}" --version`)

      console.log('spec-kit installed successfully')
      return specKitPath
    } catch (error) {
      console.error('Failed to install spec-kit:', error)
      throw new Error('Failed to install AI specification tools')
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

    return new Promise((resolve, reject) => {
      let output = ''
      let errorOutput = ''

      // Map user-friendly commands to spec-kit commands
      const specKitCommand = this.mapCommand(command)

      console.log(`Executing: ${this.environment!.specKitPath} ${specKitCommand}`)

      const process = spawn(this.environment!.specKitPath, [specKitCommand, content], {
        cwd: projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH: `${path.dirname(this.environment!.specKitPath)}:${process.env.PATH}`
        }
      })

      process.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        output += chunk
        onOutput?.(chunk)
      })

      process.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        errorOutput += chunk
        onError?.(chunk)
      })

      process.on('close', (code: number) => {
        if (code === 0) {
          resolve(output)
        } else {
          reject(new Error(`Command failed with code ${code}: ${errorOutput}`))
        }
      })

      process.on('error', (error) => {
        reject(error)
      })

      // Handle timeout (30 seconds)
      setTimeout(() => {
        process.kill('SIGKILL')
        reject(new Error('Command timeout'))
      }, 30000)
    })
  }

  private mapCommand(userCommand: string): string {
    // Map user-friendly commands to actual spec-kit commands
    const commandMap: Record<string, string> = {
      'generate-spec': '/specify',
      'create-plan': '/plan',
      'breakdown-tasks': '/tasks',
      'refine-spec': '/refine',
      // Support direct spec-kit commands too
      '/specify': '/specify',
      '/plan': '/plan',
      '/tasks': '/tasks',
      '/refine': '/refine'
    }

    return commandMap[userCommand] || '/specify'
  }

  async initializeProject(projectPath: string, projectName: string): Promise<void> {
    if (!this.environment?.isInitialized) {
      await this.initialize()
    }

    // Check if project is already initialized
    const specKitDir = path.join(projectPath, '.spec-kit')
    if (fs.existsSync(specKitDir)) {
      console.log('Project already initialized with spec-kit')
      return
    }

    console.log(`Initializing project: ${projectName}`)

    try {
      await execAsync(`"${this.environment!.specKitPath}" init "${projectName}"`, {
        cwd: projectPath
      })
      console.log('Project initialized successfully')
    } catch (error) {
      console.error('Failed to initialize project:', error)
      throw new Error('Failed to initialize project for AI specifications')
    }
  }

  isReady(): boolean {
    return this.environment?.isInitialized ?? false
  }

  getEnvironmentInfo(): PythonEnvironment | null {
    return this.environment
  }

  async cleanup(): Promise<void> {
    if (this.environment?.isInitialized) {
      console.log('Cleaning up AI environment...')
      // Could implement cleanup logic here if needed
      this.environment.isInitialized = false
    }
  }
}

export const pythonManager = new PythonManager()