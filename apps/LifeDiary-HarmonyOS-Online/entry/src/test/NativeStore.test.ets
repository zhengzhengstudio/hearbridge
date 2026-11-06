import { describe, it, expect } from '@ohos/hypium'
import { DiaryEntry } from '../main/ets/models/LifeModels'
import { LifeApi } from '../main/ets/services/LifeApiService'
import { LifePersistence, LifeStore } from '../main/ets/stores/LifeStore'

class MemoryPersistence implements LifePersistence {
  values: DiaryEntry[] = []
  async load(): Promise<DiaryEntry[]> { return this.values }
  async save(entries: DiaryEntry[]): Promise<void> { this.values = entries }
}
class OfflineLifeApi implements LifeApi { async sync(entries: DiaryEntry[], token: string): Promise<void> { throw new Error('offline') } }

export default function nativeStoreTest(): void {
  describe('NativeStore', () => {
    it('keeps a diary entry when transfer is unavailable', 0, async () => {
      let store = new LifeStore(new MemoryPersistence(), new OfflineLifeApi())
      await store.saveDiary(new DiaryEntry('entry-1', '今天', '正文', 3), 'token')
      expect(store.diaries.length).assertEqual(1)
      expect(store.pendingSyncCount).assertEqual(1)
    })
  })
}
