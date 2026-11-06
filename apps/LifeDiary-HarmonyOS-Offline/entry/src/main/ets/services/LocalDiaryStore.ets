import { common } from '@kit.AbilityKit'
import { fileIo, picker } from '@kit.CoreFileKit'
import { preferences } from '@kit.ArkData'
import { OfflineData, OfflineDiaryEntry, OfflineProfile, PeriodRecord, SmokingRecord } from '../models/OfflineModels'

interface BackupEnvelope { schema: number; exportedAt: number; data: OfflineData }

export class LocalDiaryStore {
  private readonly context: common.UIAbilityContext
  constructor(context: common.UIAbilityContext) { this.context = context }
  private empty(): OfflineData { return { schema: 2, diaries: [], periods: [], smoking: [], profile: new OfflineProfile() } }
  async load(): Promise<OfflineData> {
    let store = await preferences.getPreferences(this.context, 'life_offline_records')
    let source = await store.get('data', '') as string
    if (source.length === 0) return this.empty()
    try { let data = JSON.parse(source) as OfflineData; return data.schema === 2 ? data : this.empty() } catch (_) { return this.empty() }
  }
  async save(data: OfflineData): Promise<void> {
    let store = await preferences.getPreferences(this.context, 'life_offline_records')
    await store.put('data', JSON.stringify(data)); await store.flush()
  }
  async addDiary(entry: OfflineDiaryEntry): Promise<OfflineData> { let data = await this.load(); data.diaries.unshift(entry); await this.save(data); return data }
  async removeDiary(id: string): Promise<OfflineData> { let data = await this.load(); data.diaries = data.diaries.filter((item: OfflineDiaryEntry) => item.id !== id); await this.save(data); return data }
  async addPeriod(record: PeriodRecord): Promise<OfflineData> { let data = await this.load(); data.periods.unshift(record); await this.save(data); return data }
  async addSmoking(record: SmokingRecord): Promise<OfflineData> { let data = await this.load(); data.smoking.unshift(record); await this.save(data); return data }
  async saveProfile(profile: OfflineProfile): Promise<OfflineData> { let data = await this.load(); data.profile = profile; await this.save(data); return data }
  async exportBackup(): Promise<void> {
    let view = new picker.DocumentViewPicker(this.context); let options = new picker.DocumentSaveOptions(); options.newFileNames = [`生活日记备份-${Date.now()}.json`]
    let uris = await view.save(options); if (uris.length === 0) return
    let envelope: BackupEnvelope = { schema: 2, exportedAt: Date.now(), data: await this.load() }
    let file = fileIo.openSync(uris[0], fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC)
    try { fileIo.writeSync(file.fd, JSON.stringify(envelope)) } finally { fileIo.closeSync(file) }
  }
  async importBackup(): Promise<OfflineData> {
    let view = new picker.DocumentViewPicker(this.context); let options = new picker.DocumentSelectOptions(); options.maxSelectNumber = 1
    let uris = await view.select(options); if (uris.length === 0) return this.load()
    let envelope = JSON.parse(fileIo.readTextSync(uris[0])) as BackupEnvelope
    if (envelope.schema !== 2 || !envelope.data || envelope.data.schema !== 2 || !Array.isArray(envelope.data.diaries)) throw new Error('不支持的备份格式')
    await this.save(envelope.data); return envelope.data
  }
}
