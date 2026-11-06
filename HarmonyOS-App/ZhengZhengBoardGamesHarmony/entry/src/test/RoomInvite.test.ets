import { describe, it, expect } from '@ohos/hypium'
import { createRoomInvite, parseRoomInvite, roomWebUrl, roomAppUrl } from '../main/ets/model/RoomInvite'

export default function roomInviteTest() {
  describe('roomInvite', () => {
    it('normalizes and serializes room invite', 0, () => {
      const invite = createRoomInvite('native-gobang', ' 12<>34 ', 'token', 1900000000000)
      expect(invite.game).assertEqual('gobang')
      expect(invite.room).assertEqual('1234')
      expect(roomWebUrl(invite)).assertEqual(
        'https://zhengzhengstudio.cn/boardgames/gobang.html?v=1&purpose=continue&room=1234&autojoin=1&invite=token&expires=1900000000000')
      expect(roomAppUrl(invite)).assertEqual(
        'zhengzhengboardgames-hmos://join?v=1&purpose=continue&game=gobang&room=1234&invite=token&expires=1900000000000')
    })

    it('parses app and web links', 0, () => {
      const invite = parseRoomInvite(
        'zhengzhengboardgames-hmos://join?game=rummy&room=654321&invite=abc&expires=1900000000000')
      expect(invite?.game).assertEqual('rummy')
      expect(invite?.room).assertEqual('654321')
      expect(parseRoomInvite('https://example.com/?room=1234')).assertNull()
    })
  })
}
