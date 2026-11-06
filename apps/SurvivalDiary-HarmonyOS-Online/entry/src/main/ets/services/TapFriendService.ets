import { common } from '@kit.AbilityKit';
import { uniformTypeDescriptor as utd } from '@kit.ArkData';
import { systemShare } from '@kit.ShareKit';
import { SurvivalOnlineClient } from './SurvivalOnlineClient';

export class TapFriendService {
  private readonly context: common.UIAbilityContext;
  private readonly client: SurvivalOnlineClient;

  constructor(context: common.UIAbilityContext, client: SurvivalOnlineClient = new SurvivalOnlineClient()) {
    this.context = context;
    this.client = client;
  }

  async shareFriendRequest(sessionToken: string): Promise<void> {
    const token = await this.client.createTapToken(sessionToken, 'friend');
    const link = `https://survival-diary.zhengzhengstudio.cn/?tap=${encodeURIComponent(token.token)}`;
    await this.share(link, '碰一下，加为生存好友', '对方确认后才会发送好友申请；令牌 60 秒后失效。');
  }

  async sharePublicIsland(sessionToken: string, islandId: string): Promise<void> {
    if (islandId.length === 0) throw new Error('只有公共且非个人的岛屿可以邀请');
    const token = await this.client.createTapToken(sessionToken, 'island', islandId);
    const link = `https://survival-diary.zhengzhengstudio.cn/?tap=${encodeURIComponent(token.token)}`;
    await this.share(link, '碰一下，来我的公共岛', '只授予访问和互动权限，不会传输个人日记。');
  }

  private async share(link: string, title: string, description: string): Promise<void> {
    const data = new systemShare.SharedData({
      utd: utd.UniformDataType.HYPERLINK,
      content: link,
      title: title,
      description: description
    });
    const controller = new systemShare.ShareController(data);
    await controller.show(this.context, {
      previewMode: systemShare.SharePreviewMode.DEFAULT,
      selectionMode: systemShare.SelectionMode.SINGLE
    });
  }
}

