import { describe, it, expect } from '@ohos/hypium'
import { OfflineProfile, offlineTabIds } from '../main/ets/models/OfflineModels'

export default function offlinePrivacyTest(): void {
  describe('OfflinePrivacy', () => {
    it('contains only four local sections', 0, () => { expect(offlineTabIds().join(',')).assertEqual('today,diary,health,profile') })
    it('keeps health tools opt in', 0, () => {
      let profile = new OfflineProfile(); expect(profile.periodEnabled).assertFalse(); expect(profile.smokingEnabled).assertFalse()
    })
  })
}
