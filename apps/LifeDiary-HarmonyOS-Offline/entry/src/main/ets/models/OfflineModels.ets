export function offlineTabIds(): string[] { return ['today', 'diary', 'health', 'profile'] }

export class OfflineDiaryEntry {
  id: string; title: string; body: string; mood: number; createdAt: number
  constructor(id: string, title: string, body: string, mood: number, createdAt: number = Date.now()) {
    this.id = id; this.title = title; this.body = body; this.mood = mood; this.createdAt = createdAt
  }
}
export class PeriodRecord {
  id: string; startedAt: number; pain: number; note: string
  constructor(id: string, startedAt: number, pain: number, note: string) { this.id = id; this.startedAt = startedAt; this.pain = pain; this.note = note }
}
export class SmokingRecord {
  id: string; recordedAt: number; smoked: boolean; note: string
  constructor(id: string, recordedAt: number, smoked: boolean, note: string) { this.id = id; this.recordedAt = recordedAt; this.smoked = smoked; this.note = note }
}
export class OfflineProfile {
  periodEnabled: boolean = false
  smokingEnabled: boolean = false
  minorEnabled: boolean = false
  appLockEnabled: boolean = false
}
export interface OfflineData {
  schema: number
  diaries: OfflineDiaryEntry[]
  periods: PeriodRecord[]
  smoking: SmokingRecord[]
  profile: OfflineProfile
}
