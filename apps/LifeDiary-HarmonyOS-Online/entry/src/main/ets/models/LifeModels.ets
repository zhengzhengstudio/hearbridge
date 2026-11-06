export enum LifeTab { Today, Diary, Community, Companion, Profile }

export class DiaryEntry {
  id: string
  title: string
  body: string
  mood: number
  createdAt: number
  revision: number
  constructor(id: string, title: string, body: string, mood: number = 3, createdAt: number = Date.now(), revision: number = 0) {
    this.id = id; this.title = title; this.body = body; this.mood = mood; this.createdAt = createdAt; this.revision = revision
  }
}

export class CommunityPost {
  id: string = ''
  body: string = ''
  authorName: string = '生活记录者'
  likeCount: number = 0
}

export class FriendItem {
  uid: string = ''
  name: string = '朋友'
  status: string = 'friend'
}

export interface PassportSession { authenticated: boolean; token: string; accountId: string; isMinor: boolean }
