/* @flow */

import fs from 'fs'
import path from 'path'
import util from 'util'
import crypto from 'crypto'
import { spawn } from 'child_process'
import request from 'request'
import progress from 'request-progress'
import diskusage from 'diskusage'
import Asset from './asset'

export default class FileAsset extends Asset {
  _fileName(): string {
    return this.config.fileTypeConfig.filename
  }

  _size(): string {
    return this.config.fileTypeConfig.size
  }

  _fileSubPath(): string {
    if (!this.config.destPath) {
      return this.config.fileTypeConfig.filename
    }
    return path.join(this.config.destPath, this.config.fileTypeConfig.filename)
  }

  _filePath(): string {
    return path.join(this._destDirPath(), this.config.fileTypeConfig.filename)
  }

  _key(): string {
    return this.config.fileTypeConfig.internalSrcConfig.key
  }

  _execArgs(): string {
    return this.config.fileTypeConfig.execConfig.args
  }

  _execEnvs() {
    return this.config.fileTypeConfig.execConfig.envs
  }

  _execMaxTime() {
    return this.config.fileTypeConfig.execConfig.maxTime
  }

  async _getIntegrity(path: string) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256')
      const file = fs.createReadStream(path)
      file.on('data', data => {
        hash.update(data)
      })
      file.on('end', () => {
        const digest = hash.digest('base64')
        resolve(digest)
      })
      file.on('error', err => {
        reject(err)
      })
    })
  }

  async _acquire() {
    // Check FS free space
    this._debug('Checking free space...')
    let usageInfo
    try {
      usageInfo = diskusage.checkSync(this._destDirPath())
    } catch (err) {
      throw new Error('Failed to get free space: ' + err.message)
    }
    if (usageInfo.free < this._size()) {
      throw new Error(
        `Not enough storage space (available: ${
          usageInfo.free
        }B, required: ${this._size()}B)`
      )
    }

    // Get asset file data download URL
    this._debug('Getting file download URL...')
    const url = await this._assetMan.agentMan.getInternalFileAssetDataUrl(
      this._key()
    )
    this._debug('Got file download URL')

    // Donwload asset file data
    const path = this._filePath()
    const onProgress = state => {
      this._info(
        util.format(
          'Download progress: %f%% @ %fKB/s, %fsec',
          state.percent ? Math.round(state.percent * 100) : 0,
          state.speed ? Math.round(state.speed / 1024) : 0,
          state.time.elapsed ? Math.round(state.time.elapsed) : 0
        )
      )
    }
    this._debug(`Downloading ${url} to ${path} ...`)
    const that = this
    await new Promise(function(resolve, reject) {
      const fileStream = fs.createWriteStream(path)
      fileStream.on('error', err => {
        reject(err)
      })
      progress(request(url), {
        delay: 5000,
        throttle: 5000
      })
        .on('response', response => {
          that._debug(
            `Response: ${response.statusCode}: ${response.statusMessage}`
          )
          if (response.statusCode >= 400) {
            reject(
              new Error(
                `Error response: ${response.statusCode}: ${
                  response.statusMessage
                }`
              )
            )
          }
        })
        .on('progress', onProgress)
        .on('error', err => {
          reject(err)
        })
        .on('end', () => {
          resolve()
        })
        .pipe(fileStream)
    })
  }

  async _verify() {
    this._debug('Checking file integrity...')
    const integrity = await this._getIntegrity(this._filePath())
    if (integrity !== this.config.fileTypeConfig.integrity) {
      throw new Error(
        'File integrity mismatch: expected:' +
          this.config.fileTypeConfig.integrity +
          ', calculated:' +
          integrity
      )
    }
    this._info('File integrity matched: ' + integrity)
  }

  async _install() {
    const mode = this.config.fileTypeConfig.exec ? 0o740 : 0o640
    fs.chmodSync(this._filePath(), mode)
    this._info('File installed to: ' + this._fileSubPath())
  }

  async _execFile() {
    this._info('Executing file...')
    this._info(
      'File command: ' +
        this._execInCmdForm(
          this._fileSubPath(),
          this._execArgs(),
          this._execEnvs()
        )
    )

    const args = this._execArgsArray(this._execArgs())
    const env = this._execEnvObj(this._execEnvs())
    const cwd = this._destDirPath()
    const that = this
    await new Promise((resolve, reject) => {
      const cproc = spawn(that._filePath(), args, {
        stdio: 'pipe',
        env: env,
        cwd: cwd
      })
      const timeoutID = setTimeout(() => {
        that._info('Execution went over time limit')
        cproc.kill()
      }, that._execMaxTime() * 1000)
      cproc.stdout.on('data', data => {
        let str = data.toString().replace(/(\n|\r)+$/, '')
        that._info('Asset: ' + str)
      })
      cproc.stderr.on('data', data => {
        let str = data.toString().replace(/(\n|\r)+$/, '')
        that._info('Asset: ' + str)
      })
      cproc.on('error', err => {
        clearTimeout(timeoutID)
        reject(err)
      })
      cproc.once('exit', (code, signal) => {
        clearTimeout(timeoutID)
        if (code !== null) {
          if (code === 0) {
            resolve()
          } else {
            reject(new Error('Execution ended with failure exit code: ' + code))
          }
        } else {
          reject(new Error('Execution ended with signal: ' + signal))
        }
      })
    })

    this._debug('Executed file')
  }

  async _runPostInstallOps() {
    if (this.config.fileTypeConfig.exec) {
      await this._execFile()
    }
  }

  async _delete() {
    const path = this._filePath()
    if (fs.existsSync(path)) {
      this._debug(`Deleting ${path}...`)
      fs.unlinkSync(path)
    }
  }
}
