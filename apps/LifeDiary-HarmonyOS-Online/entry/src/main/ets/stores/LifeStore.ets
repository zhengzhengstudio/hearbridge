import { common } from '@kit.AbilityKit'
import { preferences } from '@kit.ArkData'
import { DiaryEntry } from '../models/LifeModels'
import { LifeApi } from '../services/LifeApiService'

export interface LifePersistence { load(): Promise<DiaryEntry[]>; save(entries: DiaryEntry[]): Promise<void> }

export class PreferencesLifePersistence implements LifePersistence {
  private readonly context: common.UIAbilityContext
  constructor(context: common.UIAbilityContext) { this.context = context }
  async load(): Promise<DiaryEntry[]> {
    let store = await preferences.getPreferences(this.context, 'life_native_records')
    let values = JSON.parse(await store.get('diaries', '[]') as string) as DiaryEntry[]
    return values
  }
  async save(entries: DiaryEntry[]): Promise<void> {
    let store = await preferences.getPreferences(this.context, 'life_native_records')
    await store.put('diaries', JSON.stringify(entries)); await store.flush()
  }
}

export class LifeStore {
  diaries: DiaryEntry[] = []
  pendingSyncCount: number = 0
  private readonly persistence: LifePersistence
  private readonly api: LifeApi
  constructor(persistence: LifePersistence, api: LifeApi) { this.persistence = persistence; this.api = api }
  async load(): Promise<void> { this.diaries = await this.persistence.load() }
  async saveDiary(entry: DiaryEntry, token: string = ''): Promise<void> {
    this.diaries = [entry].concat(this.diaries.filter((value: DiaryEntry): boolean => value.id !== entry.id))
    await this.persistence.save(this.diaries); this.pendingSyncCount++
    if (token.length === 0) return
    try { await this.api.sync([entry], token); this.pendingSyncCount-- } catch (_) {}
  }
}
