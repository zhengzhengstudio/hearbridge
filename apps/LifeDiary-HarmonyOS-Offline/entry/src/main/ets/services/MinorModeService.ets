import { minorsProtection } from '@kit.AccountKit'
import { common } from '@kit.AbilityKit'
import { preferences } from '@kit.ArkData'

export class MinorModeService {
  private readonly context: common.UIAbilityContext
  private store: preferences.Preferences | null = null
  private readonly sevenDays: number = 7 * 24 * 60 * 60 * 1000

  constructor(context: common.UIAbilityContext) { this.context = context }

  private async ensureStore(): Promise<preferences.Preferences> {
    if (!this.store) this.store = await preferences.getPreferences(this.context, 'life_offline_minor_reminder')
    return this.store
  }

  private isSystemMinor(): boolean {
    try {
      return canIUse('SystemCapability.AuthenticationServices.HuaweiID.MinorsProtection') &&
        minorsProtection.supportMinorsMode() && minorsProtection.getMinorsProtectionInfoSync().minorsProtectionMode
    } catch (_) { return false }
  }

  async shouldPromptAfterProfile(profileMinor: boolean): Promise<boolean> {
    if (!profileMinor && !this.isSystemMinor()) return false
    let store = await this.ensureStore()
    let neverPrompt = await store.get('neverPrompt', false) as boolean
    let suppressUntil = await store.get('suppressUntil', 0) as number
    return !neverPrompt && Date.now() >= suppressUntil
  }

  async suppressSevenDays(): Promise<void> {
    let store = await this.ensureStore()
    await store.put('suppressUntil', Date.now() + this.sevenDays)
    await store.put('neverPrompt', false)
    await store.flush()
  }

  async setNeverPrompt(value: boolean): Promise<void> {
    let store = await this.ensureStore()
    await store.put('neverPrompt', value)
    await store.put('suppressUntil', 0)
    await store.flush()
  }
}
