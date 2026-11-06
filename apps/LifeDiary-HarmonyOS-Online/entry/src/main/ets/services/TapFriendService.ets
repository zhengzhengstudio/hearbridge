import http from '@ohos.net.http'
import { systemShare } from '@kit.ShareKit'
import { uniformTypeDescriptor as utd } from '@kit.ArkData'
import { common } from '@kit.AbilityKit'

interface TapTokenResponse { token: string; expiresAt: string }
export interface IslandInvite { id: string; title: string; visibility: string; isPersonal: boolean }

export class TapFriendService {
  private readonly context: common.UIAbilityContext
  constructor(context: common.UIAbilityContext) { this.context = context }

  async shareFriendRequest(passportToken: string): Promise<void> {
    let token = await this.issueTapToken(passportToken)
    let link = `https://life.zhengzhengstudio.cn/friends.html?tap=${encodeURIComponent(token.token)}`
    await this.shareLink(link, '碰一下，向我发送好友申请', '接收后仍需由你确认，不会自动成为好友。')
  }

  async shareIslandInvite(invite: IslandInvite): Promise<void> {
    if (invite.visibility === 'public' && !invite.isPersonal) {
      let link = `https://life.zhengzhengstudio.cn/island.html?invite=${encodeURIComponent(invite.id)}`
      await this.shareLink(link, invite.title, '这是公共岛邀请，不包含个人日记内容。')
    } else {
      throw new Error('只有公共且非个人的岛可以发送邀请')
    }
  }

  private async issueTapToken(passportToken: string): Promise<TapTokenResponse> {
    let client = http.createHttp()
    try {
      let response = await client.request('https://life.zhengzhengstudio.cn/api/life/friends/tap-tokens', {
        method: http.RequestMethod.POST,
        header: { 'Authorization': `Bearer ${passportToken}`, 'Content-Type': 'application/json' },
        extraData: '{}', connectTimeout: 8000, readTimeout: 8000
      })
      return JSON.parse(String(response.result)) as TapTokenResponse
    } finally { client.destroy() }
  }

  private async shareLink(link: string, title: string, description: string): Promise<void> {
    let data: systemShare.SharedData = new systemShare.SharedData({
      utd: utd.UniformDataType.HYPERLINK, content: link, title: title, description: description
    })
    let controller: systemShare.ShareController = new systemShare.ShareController(data)
    await controller.show(this.context, {
      previewMode: systemShare.SharePreviewMode.DEFAULT,
      selectionMode: systemShare.SelectionMode.SINGLE
    })
  }
}
