import { common } from '@kit.AbilityKit'
import { preferences } from '@kit.ArkData'
import { cryptoFramework } from '@kit.CryptoArchitectureKit'
import { util } from '@kit.ArkTS'
import http from '@ohos.net.http'
import { PassportSession } from '../models/LifeModels'
import { AuthTokenStore } from './AuthTokenStore'

interface ExchangePayload { access_token: string; account_id: string; is_minor: boolean; nonce: string }

export class PassportService {
  private readonly context: common.UIAbilityContext
  private readonly tokens: AuthTokenStore
  constructor(context: common.UIAbilityContext) { this.context = context; this.tokens = new AuthTokenStore(context) }

  async signIn(): Promise<void> {
    let state = this.randomValue(32); let nonce = this.randomValue(32); let verifier = this.randomValue(64)
    let digest = cryptoFramework.createMd('SHA256'); digest.update({ data: new util.TextEncoder().encodeInto(verifier) })
    let challenge = this.urlBase64(digest.digestSync().data)
    let store = await preferences.getPreferences(this.context, 'life_passport_attempt')
    await store.put('state', state); await store.put('nonce', nonce); await store.put('verifier', verifier); await store.flush()
    let url = `https://zhengzhengstudio.cn/api/zz-pass/native/authorize?app_id=lifediary-hmos&redirect_uri=${encodeURIComponent('lifediary://passport/callback')}&state=${state}&nonce=${nonce}&code_challenge=${challenge}&code_challenge_method=S256`
    await this.context.openLink(url)
  }

  async completeCallback(uri: string): Promise<PassportSession> {
    if (uri.split('?')[0] !== 'lifediary://passport/callback') throw new Error('通行证回调来源不正确')
    let query = uri.split('?')[1] || ''; let values: Record<string, string> = {}
    query.split('&').forEach((pair: string) => { let parts = pair.split('='); values[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1] || '') })
    let store = await preferences.getPreferences(this.context, 'life_passport_attempt')
    let state = await store.get('state', '') as string; let nonce = await store.get('nonce', '') as string; let verifier = await store.get('verifier', '') as string
    if (values['state'] !== state || state.length < 16 || !values['code']) throw new Error('通行证回调校验失败')
    await store.clear(); await store.flush()
    let body = JSON.stringify({ code: values['code'], app_id: 'lifediary-hmos', redirect_uri: 'lifediary://passport/callback', code_verifier: verifier })
    let client = http.createHttp()
    try {
      let response = await client.request('https://zhengzhengstudio.cn/api/zz-pass/native/exchange', { method: http.RequestMethod.POST,
        header: { 'Content-Type': 'application/json' }, extraData: body, connectTimeout: 10000, readTimeout: 10000 })
      if (response.responseCode < 200 || response.responseCode >= 300) throw new Error('通行证交换失败')
      let payload = JSON.parse(String(response.result)) as ExchangePayload
      if (payload.nonce !== nonce) throw new Error('通行证 nonce 校验失败')
      await this.tokens.put(payload.access_token)
      return { authenticated: true, token: payload.access_token, accountId: payload.account_id, isMinor: payload.is_minor }
    } finally { client.destroy() }
  }

  async token(): Promise<string> { return this.tokens.get() }
  async signOut(): Promise<void> { await this.tokens.clear() }
  private randomValue(size: number): string { return this.urlBase64(cryptoFramework.createRandom().generateRandomSync(size).data) }
  private urlBase64(value: Uint8Array): string { return new util.Base64Helper().encodeToStringSync(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '') }
}
