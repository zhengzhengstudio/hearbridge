import { minorsProtection } from '@kit.AccountKit'
import { common } from '@kit.AbilityKit'
import { preferences } from '@kit.ArkData'

export class MinorModeService {
  private readonly context: common.UIAbilityContext
  private store: preferences.Preferences | null = null
  private systemMinor: boolean = false
  private readonly sevenDays: number = 7 * 24 * 60 * 60 * 1000

  constructor(context: common.UIAbilityContext) { this.context = context }

  async initialize(): Promise<void> {
    this.store = await preferences.getPreferences(this.context, 'life_minor_reminder')
    this.refreshSystemMode()
  }

  refreshSystemMode(): boolean {
    this.systemMinor = false
    try {
      if (canIUse('SystemCapability.AuthenticationServices.HuaweiID.MinorsProtection') &&
          minorsProtection.supportMinorsMode()) {
        let info: minorsProtection.MinorsProtectionInfo = minorsProtection.getMinorsProtectionInfoSync()
        this.systemMinor = info.minorsProtectionMode
      }
    } catch (_) { this.systemMinor = false }
    return this.systemMinor
  }

  async shouldPromptAfterAuthentication(profileMinor: boolean): Promise<boolean> {
    if (!profileMinor && !this.refreshSystemMode()) return false
    if (!this.store) await this.initialize()
    let neverPrompt = await this.store!.get('neverPrompt', false) as boolean
    let suppressUntil = await this.store!.get('suppressUntil', 0) as number
    return !neverPrompt && Date.now() >= suppressUntil
  }

  async suppressSevenDays(): Promise<void> {
    if (!this.store) await this.initialize()
    await this.store!.put('suppressUntil', Date.now() + this.sevenDays)
    await this.store!.put('neverPrompt', false)
    await this.store!.flush()
  }

  async setNeverPrompt(value: boolean): Promise<void> {
    if (!this.store) await this.initialize()
    await this.store!.put('neverPrompt', value)
    await this.store!.put('suppressUntil', 0)
    await this.store!.flush()
  }
}
