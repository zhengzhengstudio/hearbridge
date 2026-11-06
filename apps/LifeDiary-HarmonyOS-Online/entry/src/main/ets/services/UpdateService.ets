import http from '@ohos.net.http'
import { common } from '@kit.AbilityKit'
import { fileIo, fileUri } from '@kit.CoreFileKit'

export interface UpdateInfo { version: string; build: number; url: string; fileName: string; sha256: string; notes: string }
interface ByteRange { start: number; end: number }
interface DownloadPart { index: number; data: ArrayBuffer }
interface DownloadMetadata { length: number; acceptsRanges: boolean }

export class UpdateService {
  private readonly context: common.UIAbilityContext
  readonly appBuild: number = 30001
  constructor(context: common.UIAbilityContext) { this.context = context }

  async check(): Promise<UpdateInfo | null> {
    let client = http.createHttp()
    try {
      let response = await client.request('https://zhengzhengstudio.cn/api/apps/manifest.json', {
        method: http.RequestMethod.GET, connectTimeout: 8000, readTimeout: 8000
      })
      let payload = JSON.parse(String(response.result)) as Record<string, Object>
      let apps = payload['apps'] as Array<Record<string, Object>>
      let app = apps.find((item: Record<string, Object>) => String(item['id']) === 'lifediary-harmonyos-online')
      if (!app) return null
      let remoteBuild = Number(app['build'])
      if (remoteBuild > this.appBuild || this.compareVersions(String(app['version']), '0.3.1') > 0) {
        let raw = String(app['downloadURL'] || app['url'] || '')
        let url = raw.startsWith('http') ? raw : `https://zhengzhengstudio.cn${raw}`
        let notes = (app['notes'] as Array<string> || []).join('\n')
        return { version: String(app['version']), build: remoteBuild, url: url,
          fileName: String(app['fileName'] || `LifeDiary-HarmonyOS-${remoteBuild}.hap`),
          sha256: String(app['sha256'] || ''), notes: notes }
      }
      return null
    } finally { client.destroy() }
  }

  async downloadAndInstall(info: UpdateInfo, onProgress: (value: number) => void): Promise<void> {
    onProgress(0)
    let metadata = await this.metadata(info.url)
    let parts: Array<DownloadPart>
    if (metadata.length > 1 && metadata.acceptsRanges) {
      let ranges = this.planRanges(metadata.length, 4)
      let completed = 0
      let jobs = ranges.map((range: ByteRange, index: number) => this.downloadRange(info.url, range, index).then((part: DownloadPart) => {
        completed += 1; onProgress(completed / ranges.length * 0.9); return part
      }))
      parts = await Promise.all(jobs)
      parts.sort((left: DownloadPart, right: DownloadPart) => left.index - right.index)
    } else {
      parts = [{ index: 0, data: await this.downloadWhole(info.url) }]
    }
    let safeName = info.fileName.replace(/[^A-Za-z0-9._-]/g, '_')
    let path = `${this.context.cacheDir}/${safeName}`
    let file = fileIo.openSync(path, fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC)
    try {
      for (let i = 0; i < parts.length; i++) {
        fileIo.writeSync(file.fd, parts[i].data)
      onProgress(0.9 + ((i + 1) / parts.length) * 0.1)
      }
    } finally { fileIo.closeSync(file) }
    await this.context.startAbility({ action: 'ohos.want.action.viewData', uri: fileUri.getUriFromPath(path), type: 'application/vnd.harmonyos.hap' })
  }

  private async metadata(url: string): Promise<DownloadMetadata> {
    let client = http.createHttp()
    try {
      let response = await client.request(url, { method: http.RequestMethod.HEAD, connectTimeout: 10000, readTimeout: 10000 })
      let headers = response.header as Record<string, Object>
      let length = Number(headers['content-length'] || headers['Content-Length'] || 0)
      let accepts = String(headers['accept-ranges'] || headers['Accept-Ranges'] || '').toLowerCase().includes('bytes')
      return { length: length, acceptsRanges: accepts }
    } finally { client.destroy() }
  }

  private async downloadRange(url: string, range: ByteRange, index: number): Promise<DownloadPart> {
    let client = http.createHttp()
    try {
      let response = await client.request(url, { method: http.RequestMethod.GET,
        header: { 'Range': `bytes=${range.start}-${range.end}` }, expectDataType: http.HttpDataType.ARRAY_BUFFER,
        connectTimeout: 12000, readTimeout: 30000 })
      if (Number(response.responseCode) !== 206) throw new Error('服务器没有正确响应分片下载')
      return { index: index, data: response.result as ArrayBuffer }
    } finally { client.destroy() }
  }

  private async downloadWhole(url: string): Promise<ArrayBuffer> {
    let client = http.createHttp()
    try {
      let response = await client.request(url, { method: http.RequestMethod.GET, expectDataType: http.HttpDataType.ARRAY_BUFFER,
        connectTimeout: 12000, readTimeout: 30000 })
      return response.result as ArrayBuffer
    } finally { client.destroy() }
  }

  private planRanges(length: number, requestedParts: number): Array<ByteRange> {
    let count = Math.min(length, requestedParts)
    let base = Math.floor(length / count)
    let remainder = length % count
    let start = 0
    let ranges: Array<ByteRange> = []
    for (let i = 0; i < count; i++) {
      let size = base + (i < remainder ? 1 : 0)
      ranges.push({ start: start, end: start + size - 1 }); start += size
    }
    return ranges
  }

  private compareVersions(left: string, right: string): number {
    let a = left.split('.').map((item: string) => Number(item)); let b = right.split('.').map((item: string) => Number(item))
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      let av = i < a.length ? a[i] : 0; let bv = i < b.length ? b[i] : 0
      if (av !== bv) return av > bv ? 1 : -1
    }
    return 0
  }
}
