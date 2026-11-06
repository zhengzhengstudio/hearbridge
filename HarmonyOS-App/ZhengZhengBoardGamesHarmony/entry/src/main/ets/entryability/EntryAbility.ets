import { AbilityConstant, Configuration, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';

const DOMAIN = 0x0000;

export default class EntryAbility extends UIAbility {
  private syncSystemAppearance(configuration?: Configuration): void {
    const mode = configuration?.colorMode ?? this.context.config.colorMode;
    AppStorage.setOrCreate('systemDark', mode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK);
  }

  private storeInvite(want: Want): void {
    AppStorage.setOrCreate('pendingRoomInvite', want.uri || '')
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    PersistentStorage.persistProp('settingTheme', 'system')
    PersistentStorage.persistProp('settingPlayerName', '鸿蒙玩家')
    PersistentStorage.persistProp('settingAiDifficulty', '标准')
    PersistentStorage.persistProp('settingConfirmPlacement', true)
    PersistentStorage.persistProp('settingLocalAi', true)
    PersistentStorage.persistProp('savedBoardSnapshot', '')
    this.storeInvite(want)
    this.syncSystemAppearance()
    try {
      this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    } catch (err) {
      hilog.error(DOMAIN, 'testTag', 'Failed to set colorMode. Cause: %{public}s', JSON.stringify(err));
    }
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onCreate');
  }

  onDestroy(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // Main window is created, set main page for this ability
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageCreate');

    AppStorage.setOrCreate('mainWindowId', windowStage.getMainWindowSync().getWindowProperties().id)
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, 'testTag', 'Failed to load the content. Cause: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(DOMAIN, 'testTag', 'Succeeded in loading the content.');
    });
  }

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.storeInvite(want)
  }

  onConfigurationUpdate(newConfig: Configuration): void {
    this.syncSystemAppearance(newConfig)
  }

  onWindowStageDestroy(): void {
    // Main window is destroyed, release UI related resources
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    // Ability has brought to foreground
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onForeground');
  }

  onBackground(): void {
    // Ability has back to background
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onBackground');
  }
}
