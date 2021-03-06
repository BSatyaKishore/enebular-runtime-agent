/* @flow */
import fs from 'fs'
import EventEmitter from 'events'
import path from 'path'
import { spawn, type ChildProcess, exec } from 'child_process'
import ProcessUtil from './process-util'
import fetch from 'isomorphic-fetch'
import type { Logger } from 'winston'
import type LogManager from './log-manager'

export type NodeREDConfig = {
  dir: string,
  dataDir: string,
  command: string,
  killSignal: string,
  pidFile: string,
  assetsDataPath: string
}

const moduleName = 'node-red'
const maxRetryCount = 5
const maxRetryCountResetInterval = 5

type NodeRedFlowPackage = {
  flows: Object[],
  creds: Object,
  packages: Object,
  editSession?: EditSession
}

type EditSession = {
  ipAddress: string,
  sessionToken: string
}

export default class NodeREDController {
  _dir: string
  _dataDir: string
  _command: string
  _killSignal: string
  _pidFile: string
  _assetsDataPath: string
  _cproc: ?ChildProcess = null
  _actions: Array<() => Promise<any>> = []
  _isProcessing: ?Promise<void> = null
  _log: Logger
  _logManager: LogManager
  _nodeRedLog: Logger
  _exceptionRetryCount: number = 0
  _lastRetryTimestamp: number = Date.now()
  _allowEditSessions: boolean = false

  constructor(
    emitter: EventEmitter,
    log: Logger,
    logManager: LogManager,
    config: NodeREDConfig
  ) {
    this._dir = config.dir
    this._dataDir = config.dataDir
    this._command = config.command
    this._killSignal = config.killSignal
    this._pidFile = config.pidFile
    this._assetsDataPath = config.assetsDataPath
    this._allowEditSessions = config.allowEditSessions

    if (!fs.existsSync(this._dir)) {
      throw new Error(`The Node-RED directory was not found: ${this._dir}`)
    }
    if (!fs.existsSync(this._getDataDir())) {
      throw new Error(
        `The Node-RED data directory was not found: ${this._getDataDir()}`
      )
    }

    this._registerHandler(emitter)

    this._log = log
    this._logManager = logManager
    this._nodeRedLog = logManager.addLogger('service.node-red', [
      'console',
      'enebular',
      'file',
      'syslog'
    ])
  }

  debug(msg: string, ...args: Array<mixed>) {
    args.push({ module: moduleName })
    this._log.debug(msg, ...args)
  }

  info(msg: string, ...args: Array<mixed>) {
    args.push({ module: moduleName })
    this._log.info(msg, ...args)
  }

  _getDataDir() {
    return this._dataDir
  }

  _registerHandler(emitter: EventEmitter) {
    emitter.on('update-flow', params => this.fetchAndUpdateFlow(params))
    emitter.on('deploy', params => this.fetchAndUpdateFlow(params))
    emitter.on('start', () => this.startService())
    emitter.on('restart', () => this.restartService())
    emitter.on('shutdown', () => {
      this.shutdownService()
    })
  }

  async _queueAction(fn: () => Promise<any>) {
    this.debug('Queuing action')
    this._actions.push(fn)
    if (this._isProcessing) {
      await this._isProcessing
    } else {
      await this._processActions()
    }
  }

  async _processActions() {
    this.debug('Processing actions:', this._actions.length)
    this._isProcessing = (async () => {
      while (this._actions.length > 0) {
        const action = this._actions.shift()
        await action()
      }
    })()
    await this._isProcessing
    this._isProcessing = null
  }

  async fetchAndUpdateFlow(params: { downloadUrl: string }) {
    return this._queueAction(() => this._fetchAndUpdateFlow(params))
  }

  async _fetchAndUpdateFlow(params: { downloadUrl: string }) {
    this.info('Updating flow')

    const flowPackage = await this._downloadPackage(params.downloadUrl)
    let editSessionRequested = this._flowPackageContainsEditSession(flowPackage)
    if (editSessionRequested && !this._allowEditSessions) {
      this.info('Edit session flow deploy requested but not allowed')
      this.info('Start agent in --dev-mode to allow edit session.')
      return
    }

    await this._updatePackage(flowPackage)
    if (editSessionRequested) {
      await this._restartInEditorMode(flowPackage.editSession)
    } else {
      await this._restartService()
    }
  }

  _flowPackageContainsEditSession(flowPackage: NodeRedFlowPackage) {
    if (
      flowPackage &&
      flowPackage.editSession &&
      flowPackage.editSession.ipAddress &&
      flowPackage.editSession.sessionToken
    ) {
      return true
    }
    return false
  }

  async _downloadPackage(downloadUrl: string): NodeRedFlowPackage {
    this.info('Downloading flow:', downloadUrl)
    const res = await fetch(downloadUrl)
    if (res.status >= 400) {
      throw new Error('invalid url')
    }
    return res.json()
  }

  async _updatePackage(flowPackage: NodeRedFlowPackage) {
    this.info('Updating package', flowPackage)
    const updates = []
    if (flowPackage.flow || flowPackage.flows) {
      const flows = flowPackage.flow || flowPackage.flows
      updates.push(
        new Promise((resolve, reject) => {
          const flowFilePath = path.join(this._getDataDir(), 'flows.json')
          fs.writeFile(
            flowFilePath,
            JSON.stringify(flows),
            err => (err ? reject(err) : resolve())
          )
        })
      )
    }
    if (flowPackage.cred || flowPackage.creds) {
      const creds = flowPackage.cred || flowPackage.creds
      updates.push(
        new Promise((resolve, reject) => {
          const credFilePath = path.join(this._getDataDir(), 'flows_cred.json')
          fs.writeFile(
            credFilePath,
            JSON.stringify(creds),
            err => (err ? reject(err) : resolve())
          )
        })
      )
    }
    if (flowPackage.packages) {
      updates.push(
        new Promise((resolve, reject) => {
          const packageJSONFilePath = path.join(
            this._getDataDir(),
            'enebular-agent-dynamic-deps',
            'package.json'
          )
          const packageJSON = JSON.stringify(
            {
              name: 'enebular-agent-dynamic-deps',
              version: '0.0.1',
              dependencies: flowPackage.packages
            },
            null,
            2
          )
          fs.writeFile(
            packageJSONFilePath,
            packageJSON,
            err => (err ? reject(err) : resolve())
          )
        })
      )
    }
    await Promise.all(updates)
    await this._resolveDependency()
  }

  async _resolveDependency() {
    return new Promise((resolve, reject) => {
      const cproc = spawn('npm', ['install', 'enebular-agent-dynamic-deps'], {
        stdio: 'inherit',
        cwd: this._getDataDir()
      })
      cproc.on('error', reject)
      cproc.once('exit', resolve)
    })
  }

  _createPIDFile(pid: string) {
    try {
      fs.writeFileSync(this._pidFile, pid, 'utf8')
    } catch (err) {
      this._log.error(err)
    }
  }

  _removePIDFile() {
    if (!fs.existsSync(this._pidFile)) return

    try {
      fs.unlinkSync(this._pidFile)
    } catch (err) {
      this._log.error(err)
    }
  }

  async startService(editSession: EditSession) {
    return this._queueAction(() => this._startService(editSession))
  }

  async _startService(editSession: EditSession) {
    if (editSession) {
      this.info('Starting service (editor mode)...')
    } else {
      this.info('Starting service...')
    }

    let executedLoadURL = false
    return new Promise((resolve, reject) => {
      if (fs.existsSync(this._pidFile)) {
        ProcessUtil.killProcessByPIDFile(this._pidFile)
      }
      let [command, ...args] = this._command.split(/\s+/)
      let env = Object.assign(process.env, {
        ENEBULAR_ASSETS_DATA_PATH: this._assetsDataPath
      })
      if (editSession) {
        args = ['-s', '.node-red-config/enebular-editor-settings.js']
        env['ENEBULAR_EDITOR_URL'] = `http://${editSession.ipAddress}:9017`
        env['ENEBULAR_EDITOR_SESSION_TOKEN'] = editSession.sessionToken
      }
      const cproc = spawn(command, args, {
        stdio: 'pipe',
        cwd: this._dir,
        env: env
      })
      cproc.stdout.on('data', data => {
        let str = data.toString().replace(/(\n|\r)+$/, '')
        this._nodeRedLog.info(str)
        if (editSession && !executedLoadURL && str.includes('Started flows')) {
          this._nodeRedLog.info('Pinging enebular editor...')
          this._sendEditorAgentIPAddress(editSession)
          executedLoadURL = true
        }
      })
      cproc.stderr.on('data', data => {
        let str = data.toString().replace(/(\n|\r)+$/, '')
        this._nodeRedLog.error(str)
      })
      cproc.once('exit', (code, signal) => {
        this.info(`Service exited (${code !== null ? code : signal})`)
        this._cproc = null
        /* Restart automatically on an abnormal exit. */
        if (code !== 0) {
          const now = Date.now()
          /* Detect continuous crashes (exceptions happen within 5 seconds). */
          this._exceptionRetryCount =
            this._lastRetryTimestamp + maxRetryCountResetInterval * 1000 > now
              ? this._exceptionRetryCount + 1
              : 0
          this._lastRetryTimestamp = now
          if (this._exceptionRetryCount < maxRetryCount) {
            this.info(
              'Unexpected exit, restarting service in 1 second. Retry count:' +
                this._exceptionRetryCount
            )
            setTimeout(() => {
              this._startService(editSession)
            }, 1000)
          } else {
            this.info(
              `Unexpected exit, but retry count(${
                this._exceptionRetryCount
              }) exceed max.`
            )
            /* Other restart strategies (change port, etc.) could be tried here. */
          }
        }
        this._removePIDFile()
      })
      cproc.once('error', err => {
        this._cproc = null
        reject(err)
      })
      this._cproc = cproc
      if (this._cproc.pid) this._createPIDFile(this._cproc.pid.toString())
      setTimeout(() => resolve(), 1000)
    })
  }

  async shutdownService() {
    return this._queueAction(() => this._shutdownService())
  }

  async _shutdownService() {
    return new Promise((resolve, reject) => {
      const cproc = this._cproc
      if (cproc) {
        this.info('Shutting down service...')
        cproc.once('exit', () => {
          this.info('Service ended')
          this._cproc = null
          resolve()
        })
        cproc.kill(this._killSignal)
      } else {
        this.info('Service already shutdown')
        resolve()
      }
    })
  }

  async _sendEditorAgentIPAddress(editSession: EditSession) {
    const { ipAddress, sessionToken } = editSession
    try {
      fetch(`http://${ipAddress}:9017/api/v1/agent-editor/ping`, {
        method: 'POST',
        headers: {
          'x-ee-session': sessionToken
        }
      })
    } catch (err) {
      console.error('send editor error', err)
    }
  }

  async restartService() {
    return this._queueAction(() => this._restartService())
  }

  async _restartInEditorMode(editSession: EditSession) {
    this.info('Restarting service (editor mode)...')
    this.info(`enebular editor IP Address: ${editSession.ipAddress}`)
    await this._shutdownService()
    await this._startService(editSession)
  }

  async _restartService() {
    this.info('Restarting service...')
    await this._shutdownService()
    await this._startService()
  }

  getStatus() {
    if (this._cproc) {
      return 'connected'
    } else {
      return 'disconnected'
    }
  }
}
