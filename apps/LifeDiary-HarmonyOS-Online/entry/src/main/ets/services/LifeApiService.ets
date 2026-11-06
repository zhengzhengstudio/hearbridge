import http from '@ohos.net.http'
import { CommunityPost, DiaryEntry, FriendItem } from '../models/LifeModels'
import { LedgerEntry } from '../models/LedgerModels'

export interface LifeApi { sync(entries: DiaryEntry[], token: string): Promise<void> }
interface DiaryPayload { id: string; title: string; body: string; mood: number; createdAt: number; revision: number }
interface SyncOperation { id: string; domain: string; type: string; baseRevision: number; payload: DiaryPayload }
interface SyncRequest { operations: SyncOperation[] }
interface PostAuthor { nickname: string }
interface PostResponse { id: string; body: string; author: PostAuthor; likeCount: number }
interface PostsResponse { posts: PostResponse[] }
interface PublishRequest { id: string; body: string; anonymous: boolean; minorConfirmed: boolean }
interface FriendResponse { uid: string; id: string; nickname: string; username: string; status: string }
interface FriendsResponse { users: FriendResponse[]; friends: FriendResponse[] }
interface FriendRequest { targetUid: string }
interface CompanionRequest { message: string; style: string; selectedEntryIds: string[] }
interface CompanionResponse { answer: string }
interface LedgerPayload { id: string; type: string; amount: number; category: string; note: string; occurredAt: string; revision: number; updatedAt: string }
interface LedgerOperation { id: string; domain: string; type: string; baseRevision: number; payload: LedgerPayload }
interface LedgerSyncRequest { operations: LedgerOperation[] }
interface LedgerDomains { ledger: Record<string, LedgerEntry> }
interface LedgerRecord { domains: LedgerDomains }
interface LedgerSyncResponse { record: LedgerRecord }
interface LifeHeaders { Accept: string; Authorization?: string; 'Content-Type'?: string }

export class LifeApiService implements LifeApi {
  private readonly base: string = 'https://life.zhengzhengstudio.cn'
  async sync(entries: DiaryEntry[], token: string): Promise<void> {
    let operations: SyncOperation[] = entries.map((entry: DiaryEntry): SyncOperation => {
      let payload: DiaryPayload = { id: entry.id, title: entry.title, body: entry.body, mood: entry.mood,
        createdAt: entry.createdAt, revision: entry.revision + 1 }
      return { id: `hmos-${entry.id}-${entry.createdAt}`, domain: 'diary', type: 'upsert', baseRevision: entry.revision, payload: payload }
    })
    let request: SyncRequest = { operations: operations }
    await this.request('/api/life/sync', http.RequestMethod.POST, token, JSON.stringify(request))
  }
  async posts(): Promise<CommunityPost[]> {
    let payload = JSON.parse(await this.request('/api/life/community/posts', http.RequestMethod.GET)) as PostsResponse
    return (payload.posts || []).map((value: PostResponse): CommunityPost => {
      let post = new CommunityPost(); post.id = value.id; post.body = value.body
      post.authorName = value.author ? value.author.nickname : '生活记录者'; post.likeCount = value.likeCount || 0; return post
    })
  }
  async publish(entry: DiaryEntry, token: string, minorConfirmed: boolean): Promise<void> {
    let request: PublishRequest = { id: `hmos-${entry.id}`, body: entry.body, anonymous: false, minorConfirmed: minorConfirmed }
    await this.request('/api/life/community/posts', http.RequestMethod.POST, token, JSON.stringify(request))
  }
  async friends(token: string, query: string = ''): Promise<FriendItem[]> {
    let path = query.length > 0 ? `/api/life/friends/search?q=${encodeURIComponent(query)}` : '/api/life/friends'
    let payload = JSON.parse(await this.request(path, http.RequestMethod.GET, token)) as FriendsResponse
    let values = query.length > 0 ? (payload.users || []) : (payload.friends || [])
    return values.map((value: FriendResponse): FriendItem => {
      let item = new FriendItem(); item.uid = value.uid || value.id
      item.name = value.nickname || value.username || item.uid; item.status = value.status || (query.length > 0 ? '可申请' : 'friend'); return item
    })
  }
  async requestFriend(token: string, uid: string): Promise<void> {
    let request: FriendRequest = { targetUid: uid }
    await this.request('/api/life/friends/requests', http.RequestMethod.POST, token, JSON.stringify(request))
  }
  async companion(token: string, message: string): Promise<string> {
    let request: CompanionRequest = { message: message, style: 'gentle', selectedEntryIds: [] }
    let result = JSON.parse(await this.request('/api/life/companion/chat', http.RequestMethod.POST, token, JSON.stringify(request))) as CompanionResponse
    return result.answer || '我在这里。'
  }
  async syncLedger(entries: LedgerEntry[], token: string): Promise<LedgerEntry[]> {
    let operations: LedgerOperation[] = entries.map((entry: LedgerEntry): LedgerOperation => ({
      id: `hmos-ledger-${entry.id}-${entry.revision}`, domain: 'ledger', type: 'upsert', baseRevision: Math.max(0, entry.revision - 1),
      payload: { id: entry.id, type: entry.type, amount: entry.amount, category: entry.category, note: entry.note,
        occurredAt: entry.occurredAt, revision: entry.revision, updatedAt: entry.updatedAt }
    }))
    let request: LedgerSyncRequest = { operations: operations }
    let result = JSON.parse(await this.request('/api/life/sync', http.RequestMethod.POST, token, JSON.stringify(request))) as LedgerSyncResponse
    let merged: LedgerEntry[] = []
    let ledger = result.record.domains.ledger || {}
    Object.keys(ledger).forEach((key: string) => merged.push(ledger[key]))
    return merged
  }
  private async request(path: string, method: http.RequestMethod, token: string = '', body: string = ''): Promise<string> {
    let client = http.createHttp()
    try {
      let headers: LifeHeaders = token.length > 0 ? { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' }
      let response = await client.request(`${this.base}${path}`, { method: method, header: headers, extraData: body, connectTimeout: 10000, readTimeout: 15000 })
      if (response.responseCode < 200 || response.responseCode >= 300) throw new Error(`请求失败 ${response.responseCode}`)
      return String(response.result)
    } finally { client.destroy() }
  }
}
