import http from '@ohos.net.http';

interface Headers {
  Accept: string;
  Authorization?: string;
  'Content-Type': string;
}

export interface TapTokenResponse {
  token: string;
  expiresAt: number;
  kind: string;
}

export interface ManifestApp {
  id: string;
  version: string;
  build: number;
  versionCode?: number;
  url: string;
  downloadURL?: string;
  sha256: string;
  available?: boolean;
  updateEligible?: boolean;
}

interface ManifestPayload { apps: ManifestApp[] }
interface SessionPayload { sessionToken: string }

export interface PublicIsland { id: string; name: string; members: string[] }
interface PublicIslandsPayload { islands: PublicIsland[] }
export interface NpcDialogueReply { reply: string; source: string; reason?: string }

export class SurvivalOnlineClient {
  private readonly base: string = 'https://survival-diary.zhengzhengstudio.cn';

  async createGuestSession(localId: string): Promise<string> {
    const payload = await this.request('/session', http.RequestMethod.POST, '', JSON.stringify({ mode: 'local', deviceId: localId }));
    return (JSON.parse(payload) as SessionPayload).sessionToken;
  }

  async friends(sessionToken: string): Promise<string> {
    return this.request('/friends', http.RequestMethod.GET, sessionToken);
  }

  async createTapToken(sessionToken: string, kind: string, islandId: string = ''): Promise<TapTokenResponse> {
    const body = kind === 'island'
      ? JSON.stringify({ kind: kind, islandId: islandId, permissions: ['visit', 'use'] })
      : JSON.stringify({ kind: kind });
    const payload = await this.request('/tap-tokens', http.RequestMethod.POST, sessionToken, body);
    return JSON.parse(payload) as TapTokenResponse;
  }

  async listPublicIslands(): Promise<PublicIsland[]> {
    const payload = await this.request('/islands/public', http.RequestMethod.GET);
    return (JSON.parse(payload) as PublicIslandsPayload).islands;
  }

  async ensurePublicIsland(sessionToken: string, seed: string): Promise<PublicIsland> {
    const payload = await this.request('/islands/mine/public', http.RequestMethod.PUT, sessionToken, JSON.stringify({ seed: seed }));
    return JSON.parse(payload) as PublicIsland;
  }

  async visitIsland(sessionToken: string, islandId: string): Promise<void> {
    await this.request(`/islands/${encodeURIComponent(islandId)}/visit`, http.RequestMethod.POST, sessionToken, '{}');
  }

  async talkToVillager(sessionToken: string, payload: string): Promise<NpcDialogueReply> {
    const response = await this.request('/npc-dialogue', http.RequestMethod.POST, sessionToken, payload, 2600);
    return JSON.parse(response) as NpcDialogueReply;
  }

  async latestHarmonyRelease(): Promise<ManifestApp | null> {
    const client = http.createHttp();
    try {
      const response = await client.request('https://zhengzhengstudio.cn/api/apps/manifest.json', {
        method: http.RequestMethod.GET,
        connectTimeout: 8000,
        readTimeout: 10000
      });
      if (response.responseCode < 200 || response.responseCode >= 300) return null;
      const payload = JSON.parse(String(response.result)) as ManifestPayload;
      const found = payload.apps.find((item: ManifestApp) => item.id === 'survival-diary-harmony-online');
      if (found === undefined || found.available === false || found.updateEligible === false) return null;
      const download = found.downloadURL ?? '';
      if (download.length === 0 && found.url.length === 0) return null;
      return found;
    } finally {
      client.destroy();
    }
  }

  private async request(path: string, method: http.RequestMethod, sessionToken: string = '', body: string = '', readTimeout: number = 12000): Promise<string> {
    const client = http.createHttp();
    try {
      const headers: Headers = sessionToken.length > 0
        ? { Accept: 'application/json', Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' };
      const response = await client.request(`${this.base}${path}`, {
        method: method,
        header: headers,
        extraData: body,
        connectTimeout: 8000,
        readTimeout: readTimeout
      });
      if (response.responseCode < 200 || response.responseCode >= 300) {
        throw new Error(`请求失败 ${response.responseCode}`);
      }
      return String(response.result);
    } finally {
      client.destroy();
    }
  }
}
