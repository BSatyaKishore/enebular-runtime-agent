/* @flow */

import fs from 'fs'
import request from 'request'
import progress from 'request-progress'
import type DeviceStateManager from './device-state-manager'
import type AgentManagerMediator from './agent-manager-mediator'
import type { Logger } from 'winston'
import { delay } from './utils'
import util from 'util'

// todo: validate config

const moduleName = 'asset-man'

/**
 * Asset states:
 *   - notDeployed | deployed
 *   - deploying | deployFail
 *   - removing | removeFail
 */

/**
 * Reported asset states:
 *   - deployPending | deploying | deployed | deployFail
 *   - updatePending | updating | update-fail (todo)
 *   - removePending | removing | removeFail
 */

class Asset {
  _assetMan: AssetManager
  _type: string
  _id: string
  updateId: string
  config: {}
  state: string
  changeTs: string
  pendingUpdateId: string
  pendingChange: string // (deploy|remove)
  pendingConfig: {}
  //  todo:
  //   - failCount

  constructor(
    type: string,
    id: string,
    updateId: string,
    config: {},
    state: string,
    assetMan: AssetManager
  ) {
    this._type = type
    this._id = id
    this.updateId = updateId
    this.config = config
    this.state = state
    this._assetMan = assetMan
    this.changeTs = Date.now()
  }

  _debug(msg: string, ...args: Array<mixed>) {
    this._assetMan._log.debug(msg, ...args)
  }

  _destDirPath() {
    return [this._assetMan._dataDir, this.config.destPath].join('/')
  }

  type() {
    return this._type
  }

  id() {
    return this._id
  }

  serialize(): {} {
    return {
      type: this._type,
      id: this._id,
      updateId: this.updateId,
      state: this.state,
      changeTs: this.changeTs,
      config: this.config
    }
  }

  // todo: split deploy into: acquire, verify, install and exec
  // todo: hooks exec

  async deploy(): boolean {
    throw new Error('Called an abstract function')
  }

  async remove(): boolean {
    throw new Error('Called an abstract function')
  }
}

class FileAsset extends Asset {
  _filePath() {
    return [this._destDirPath(), this.config.fileTypeConfig.filename].join('/')
  }

  _key() {
    return this.config.fileTypeConfig.internalSrcConfig.key
  }

  // Override
  async deploy() {
    this._debug('Deploying...')
    try {
      const destDir = this._destDirPath()
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir)
      }
      this._debug('Getting file download url...')
      const url = await this._assetMan._agentMan.getInternalFileAssetDataUrl(
        this._key()
      )
      this._debug('Got file download url')
      const path = this._filePath()
      const onProgress = state => {
        this._debug(
          util.format(
            'progress: %f%% @ %fB/s, %fsec',
            state.percent ? state.percent.toPrecision(1) : 0,
            state.speed ? state.speed.toPrecision(1) : 0,
            state.time.elapsed ? state.time.elapsed.toPrecision(1) : 0
          )
        )
      }
      this._debug(`Dowloading ${url} to ${path} ...`)
      await new Promise(function(resolve, reject) {
        progress(request(url), {})
          .on('progress', onProgress)
          .on('error', err => {
            reject(err)
          })
          .on('end', () => {
            resolve()
          })
          .pipe(fs.createWriteStream(path))
      })
      this._debug('Deploy done')
    } catch (err) {
      this._debug('Deploy failed: ' + err.message)
      return false
    }
    return true
  }

  // Override
  async remove() {
    this._debug('Removing...')
    const path = this._filePath()
    this._debug(`Deleting ${path}...`)
    try {
      fs.unlinkSync(path)
    } catch (err) {
      this._debug('Failed to remove file: ' + path)
      return false
    }
    return true
  }
}

export default class AssetManager {
  _deviceStateMan: DeviceStateManager
  _agentMan: AgentManagerMediator
  _log: Logger
  _assets: Array<Asset> = []
  _processingAssetState: boolean = false
  _inited: boolean = false
  _dataDir: string = 'asset-data' // tmp
  _stateFilePath: string = 'asset-state'

  constructor(
    deviceStateMan: DeviceStateManager,
    agentMan: AgentManagerMediator,
    log: Logger
  ) {
    this._deviceStateMan = deviceStateMan
    this._agentMan = agentMan
    this._log = log
    this._deviceStateMan.on('stateChange', params =>
      this._handleDeviceStateChange(params)
    )
  }

  _debug(msg: string, ...args: Array<mixed>) {
    args.push({ module: moduleName })
    this._log.debug(msg, ...args)
  }

  _info(msg: string, ...args: Array<mixed>) {
    args.push({ module: moduleName })
    this._log.info(msg, ...args)
  }

  _error(msg: string, ...args: Array<mixed>) {
    args.push({ module: moduleName })
    this._log.error(msg, ...args)
  }

  async setup() {
    if (this._inited) {
      return
    }

    if (!fs.existsSync(this._dataDir)) {
      fs.mkdirSync(this._dataDir)
    }

    await this._initAssets()

    this._inited = true
  }

  async _initAssets() {
    this._loadAssetState()

    // todo get desired state & apply if it exists
    // this._processPendingAssets()
  }

  _loadAssetState() {
    if (!fs.existsSync(this._stateFilePath)) {
      return
    }

    this._info('Loading asset state: ' + this._stateFilePath)

    const data = fs.readFileSync(this._stateFilePath, 'utf8')
    let serializedAssets = JSON.parse(data)
    for (let serializedAsset of serializedAssets) {
      let asset = this._deserializeAsset(serializedAsset)
      this._assets.push(asset)
    }
  }

  _deserializeAsset(serializedAsset): Asset {
    switch (serializedAsset.type) {
      case 'file':
        break
      default:
        throw new Error('Unsupported asset type: ' + serializedAsset.type)
    }

    let asset = new FileAsset(
      serializedAsset.type,
      serializedAsset.id,
      serializedAsset.updateId,
      serializedAsset.config,
      serializedAsset.state,
      this
    )
    asset.changeTs = serializedAsset.changeTs

    return asset
  }

  _saveAssetState() {
    this._debug('Saving asset state...')

    let serializedAssets = []
    for (let asset of this._assets) {
      switch (asset.state) {
        case 'deployed':
        case 'deployFail':
        case 'removeFail':
          serializedAssets.push(asset.serialize())
          break
        default:
          break
      }
    }
    this._debug('Asset state: ' + JSON.stringify(serializedAssets, null, '\t'))
    try {
      fs.writeFileSync(
        this._stateFilePath,
        JSON.stringify(serializedAssets),
        'utf8'
      )
    } catch (err) {
      this._error('Failed to save asset state: ' + err.message)
    }
  }

  async _handleDeviceStateChange(params) {
    const { type, path } = params
    if (type !== 'desired' || (path && !path.startsWith('assets'))) {
      return
    }

    if (!this._inited) {
      return
    }

    const desiredState = this._deviceStateMan.getState('desired', 'assets')
    this._debug(
      'Assets state change: ' + JSON.stringify(desiredState, null, '\t')
    )
    if (!desiredState || !desiredState.assets) {
      return
    }

    // Determine 'deploy' and 'update' assets
    let newAssets = []
    for (const desiredAssetId in desiredState.assets) {
      if (!desiredState.assets.hasOwnProperty(desiredAssetId)) {
        continue
      }
      let desiredAsset = desiredState.assets[desiredAssetId]

      let found = false
      for (let asset of this._assets) {
        if (asset.id() === desiredAssetId) {
          if (asset.updateId !== desiredAsset.updateId) {
            asset.pendingUpdateId = desiredAsset.updateId
            asset.pendingChange = 'deploy'
            asset.pendingConfig = desiredAsset.config
            asset.changeTs = Date.now()
          }
          found = true
          break
        }
      }

      if (!found) {
        let asset = null
        switch (desiredAsset.config.type) {
          case 'file':
            asset = new FileAsset(
              desiredAsset.config.type,
              desiredAssetId,
              null,
              null,
              'notDeployed',
              this
            )
            asset.pendingUpdateId = desiredAsset.updateId
            asset.pendingChange = 'deploy'
            asset.pendingConfig = desiredAsset.config
            break
          default:
            this._error('Unsupported asset type: ' + desiredAsset.config.type)
            break
        }
        if (asset) {
          newAssets.push(asset)
        }
      }
    }

    // Determine 'remove' assets
    for (let asset of this._assets) {
      if (!desiredState.assets.hasOwnProperty(asset.id())) {
        asset.pendingChange = 'remove'
        asset.changeTs = Date.now()
      }
    }

    // Append 'added' assets
    this._assets = this._assets.concat(newAssets)

    // this._debug('assets: ' + inspect(this._assets))

    this._updateReportedAssetsState()
    this._processPendingAssets()
  }

  // todo: full 'asset' path set on startup

  _updateReportedAssetState(asset) {
    let state
    if (asset.pendingChange) {
      switch (asset.pendingChange) {
        case 'deploy':
          state = 'deployPending'
          break
        case 'remove':
          state = 'removePending'
          break
        default:
          state = 'unknown'
          break
      }
    } else {
      state = asset.state
    }
    this._deviceStateMan.updateState(
      'reported',
      'set',
      'assets.assets.' + asset.id(),
      {
        updateId: asset.updateId,
        ts: asset.changeTs,
        state: state
      }
    )
  }

  _updateReportedAssetsState() {
    for (let asset of this._assets) {
      if (!asset.pendingChange) {
        continue
      }
      this._updateReportedAssetState(asset)
    }
  }

  // Note: this path 'update' approach needs improvement as if
  // an update is missed at some point, its contents will never
  // be sent to agent-man.

  _getFirstPendingChangeAsset(): Asset {
    if (this._assets.length < 1) {
      return null
    }
    for (let asset of this._assets) {
      if (asset.pendingChange) {
        return asset
      }
    }
    return null
  }

  _pendingChangeAssetExists(): boolean {
    return this._getFirstPendingChangeAsset() !== null
  }

  async _processPendingAssets() {
    if (this._processingAssetState) {
      return
    }
    this._processingAssetState = true

    while (this._pendingChangeAssetExists()) {
      // Process simple removes
      let removeAssets = []
      for (let asset of this._assets) {
        if (
          asset.pendingChange &&
          asset.pendingChange === 'remove' &&
          asset.state === 'notDeployed'
        ) {
          this._deviceStateMan.updateState(
            'reported',
            'remove',
            'assets.assets.' + asset.id()
          )
          removeAssets.push(asset)
        }
      }
      this._assets = this._assets.filter(asset => {
        return !removeAssets.includes(asset)
      })

      let asset = this._getFirstPendingChangeAsset()
      if (!asset) {
        continue
      }

      let pendingChange = asset.pendingChange
      asset.pendingChange = null

      switch (pendingChange) {
        case 'deploy':
          if (asset.state === 'deployed') {
            asset.state = 'removing'
            this._updateReportedAssetState(asset)
            let success = await asset.remove()
            if (!success) {
              asset.state = 'removeFail'
              break
            }
          }
          // todo: neeed to think carefully about this order
          asset.updateId = asset.pendingUpdateId
          asset.config = asset.pendingConfig
          asset.pendingConfig = null
          asset.state = 'deploying'
          this._updateReportedAssetState(asset)
          let success = await asset.deploy()
          asset.state = success ? 'deployed' : 'deployFail'
          this._updateReportedAssetState(asset)
          break

        case 'remove':
          if (asset.state === 'deployed') {
            asset.state = 'removing'
            this._updateReportedAssetState(asset)
            let success = await asset.remove()
            if (!success) {
              asset.state = 'removeFail'
              break
            }
          }
          this._deviceStateMan.updateState(
            'reported',
            'remove',
            'assets.assets.' + asset.id()
          )
          this._assets = this._assets.filter(a => {
            return a !== asset
          })
          break

        default:
          this._error('Unsupported pending change: ' + pendingChange)
          break
      }

      this._saveAssetState()

      await delay(2 * 1000)
    }

    this._processingAssetState = false
  }
}
