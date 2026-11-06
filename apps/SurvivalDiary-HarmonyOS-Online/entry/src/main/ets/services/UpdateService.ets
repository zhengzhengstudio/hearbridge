import { common } from '@kit.AbilityKit';
import { ManifestApp, SurvivalOnlineClient } from './SurvivalOnlineClient';

export class UpdateService {
  private readonly context: common.UIAbilityContext;
  private readonly client: SurvivalOnlineClient;
  readonly currentVersion: string = '0.6.2';
  readonly currentBuild: number = 60204;

  constructor(context: common.UIAbilityContext, client: SurvivalOnlineClient = new SurvivalOnlineClient()) {
    this.context = context;
    this.client = client;
  }

  async checkAndOpen(): Promise<boolean> {
    const release: ManifestApp | null = await this.client.latestHarmonyRelease();
    if (release === null) return false;
    const releaseBuild = release.versionCode ?? release.build;
    if (releaseBuild <= this.currentBuild && this.compare(release.version, this.currentVersion) <= 0) return false;
    const raw = release.downloadURL !== undefined && release.downloadURL.length > 0 ? release.downloadURL : release.url;
    if (raw.length === 0) return false;
    const url = raw.startsWith('http') ? raw : `https://zhengzhengstudio.cn${raw}`;
    await this.context.openLink(url);
    return true;
  }

  private compare(left: string, right: string): number {
    const a = left.split('.').map((item: string) => Number(item));
    const b = right.split('.').map((item: string) => Number(item));
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      const av = index < a.length ? a[index] : 0;
      const bv = index < b.length ? b[index] : 0;
      if (av !== bv) return av > bv ? 1 : -1;
    }
    return 0;
  }
}
