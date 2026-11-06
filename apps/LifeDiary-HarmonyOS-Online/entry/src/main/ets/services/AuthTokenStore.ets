import { common } from '@kit.AbilityKit'
import { preferences } from '@kit.ArkData'
import { huks } from '@kit.UniversalKeystoreKit'
import { cryptoFramework } from '@kit.CryptoArchitectureKit'
import { util } from '@kit.ArkTS'

interface CipherBlob { data: string; nonce: string }

export class AuthTokenStore {
  private readonly context: common.UIAbilityContext
  private readonly alias: string = 'life_diary_passport_aes'
  constructor(context: common.UIAbilityContext) { this.context = context }

  async put(token: string): Promise<void> {
    let blob = await this.encryptToken(token)
    let store = await preferences.getPreferences(this.context, 'life_passport_secure')
    await store.put('ciphertext', JSON.stringify(blob)); await store.flush()
  }

  async get(): Promise<string> {
    let store = await preferences.getPreferences(this.context, 'life_passport_secure')
    let value = await store.get('ciphertext', '') as string
    if (value.length === 0) return ''
    try { return await this.decrypt(JSON.parse(value) as CipherBlob) } catch (_) { return '' }
  }

  async clear(): Promise<void> {
    let store = await preferences.getPreferences(this.context, 'life_passport_secure')
    await store.delete('ciphertext'); await store.flush()
  }

  private keyProperties(): huks.HuksParam[] {
    return [
      { tag: huks.HuksTag.HUKS_TAG_ALGORITHM, value: huks.HuksKeyAlg.HUKS_ALG_AES },
      { tag: huks.HuksTag.HUKS_TAG_PURPOSE, value: huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT | huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT },
      { tag: huks.HuksTag.HUKS_TAG_KEY_SIZE, value: huks.HuksKeySize.HUKS_AES_KEY_SIZE_256 },
      { tag: huks.HuksTag.HUKS_TAG_PADDING, value: huks.HuksKeyPadding.HUKS_PADDING_NONE },
      { tag: huks.HuksTag.HUKS_TAG_BLOCK_MODE, value: huks.HuksCipherMode.HUKS_MODE_GCM }
    ]
  }

  private async ensureKey(): Promise<void> {
    let options: huks.HuksOptions = { properties: this.keyProperties() }
    if (!(await huks.hasKeyItem(this.alias, options))) await huks.generateKeyItem(this.alias, options)
  }

  private async encryptToken(value: string): Promise<CipherBlob> {
    await this.ensureKey()
    let nonce = cryptoFramework.createRandom().generateRandomSync(12).data
    let properties = this.keyProperties().concat([
      { tag: huks.HuksTag.HUKS_TAG_PURPOSE, value: huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT },
      { tag: huks.HuksTag.HUKS_TAG_NONCE, value: nonce }
    ])
    let session = await huks.initSession(this.alias, { properties: properties })
    let result = await huks.finishSession(session.handle, { properties: properties, inData: new util.TextEncoder().encodeInto(value) })
    let base64 = new util.Base64Helper()
    return { data: base64.encodeToStringSync(result.outData || new Uint8Array()), nonce: base64.encodeToStringSync(nonce) }
  }

  private async decrypt(blob: CipherBlob): Promise<string> {
    await this.ensureKey(); let base64 = new util.Base64Helper(); let nonce = base64.decodeSync(blob.nonce)
    let properties = this.keyProperties().concat([
      { tag: huks.HuksTag.HUKS_TAG_PURPOSE, value: huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT },
      { tag: huks.HuksTag.HUKS_TAG_NONCE, value: nonce }
    ])
    let session = await huks.initSession(this.alias, { properties: properties })
    let result = await huks.finishSession(session.handle, { properties: properties, inData: base64.decodeSync(blob.data) })
    return new util.TextDecoder().decodeToString(result.outData || new Uint8Array())
  }
}
