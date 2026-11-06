export interface RoomInvite {
  version: number
  purpose: string
  game: string
  room: string
  token: string
  expiresAt: number
}

export function cleanRoomId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)
}

export function normalizeGameId(value: string): string {
  let game = value.toLowerCase()
  if (game === 'native-gobang') game = 'gobang'
  if (game === 'native-reversi') game = 'reversi'
  if (game === 'native-tictactoe') game = 'tictactoe'
  if (game === 'chess') game = 'chinese-chess'
  switch (game) {
    case 'gobang':
    case 'reversi':
    case 'tictactoe':
    case 'go':
    case 'chinese-chess':
    case 'checkers':
    case 'ludo':
    case 'rummy':
    case 'monopoly':
    case 'landlord':
    case 'mahjong':
    case 'spy':
    case 'werewolf':
    case 'poker':
      return game
    default:
      return 'gobang'
  }
}

function cleanToken(value: string): string {
  return value.replace(/[^A-Za-z0-9._~-]/g, '').slice(0, 160)
}

function gamePage(game: string): string {
  switch (normalizeGameId(game)) {
    case 'reversi': return 'reversi.html'
    case 'tictactoe': return 'tictactoe.html'
    case 'go': return 'go.html'
    case 'chinese-chess': return 'chess.html'
    case 'checkers': return 'checkers.html'
    case 'ludo': return 'ludo.html'
    case 'rummy': return 'rummy.html'
    case 'monopoly': return 'monopoly.html'
    case 'landlord': return 'landlord.html'
    case 'mahjong': return 'mahjong.html'
    case 'spy': return 'spy.html'
    case 'werewolf': return 'werewolf.html'
    case 'poker': return 'poker.html'
    default: return 'gobang.html'
  }
}

export function createRoomInvite(game: string, room: string, token: string = '', expiresAt: number = 0,
  purpose: string = 'continue'): RoomInvite {
  let safeToken = cleanToken(token)
  if (safeToken.length === 0) {
    safeToken = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000000000).toString(36)}`
  }
  return {
    version: 1,
    purpose: purpose === 'challenge' ? 'challenge' : 'continue',
    game: normalizeGameId(game),
    room: cleanRoomId(room),
    token: safeToken,
    expiresAt: expiresAt > 0 ? expiresAt : Date.now() + 10 * 60 * 1000
  }
}

export function roomAppUrl(invite: RoomInvite): string {
  return `zhengzhengboardgames-hmos://join?v=${invite.version}&purpose=${encodeURIComponent(invite.purpose)}` +
    `&game=${encodeURIComponent(invite.game)}` +
    `&room=${encodeURIComponent(invite.room)}&invite=${encodeURIComponent(invite.token)}` +
    `&expires=${invite.expiresAt}`
}

export function roomWebUrl(invite: RoomInvite): string {
  return `https://zhengzhengstudio.cn/boardgames/${gamePage(invite.game)}` +
    `?v=${invite.version}&purpose=${encodeURIComponent(invite.purpose)}` +
    `&room=${encodeURIComponent(invite.room)}&autojoin=1&invite=${encodeURIComponent(invite.token)}` +
    `&expires=${invite.expiresAt}`
}

function queryValue(value: string, key: string): string {
  const queryStart = value.indexOf('?')
  if (queryStart < 0) return ''
  const pairs = value.substring(queryStart + 1).split('&')
  for (let pair of pairs) {
    const separator = pair.indexOf('=')
    const name = separator >= 0 ? pair.substring(0, separator) : pair
    if (name === key) {
      const raw = separator >= 0 ? pair.substring(separator + 1) : ''
      return decodeURIComponent(raw.replace(/\+/g, ' '))
    }
  }
  return ''
}

function gameFromWebPath(value: string): string {
  const cleanPath = value.split('?')[0]
  const file = cleanPath.substring(cleanPath.lastIndexOf('/') + 1)
  if (file === 'chess.html') return 'chinese-chess'
  if (file.endsWith('.html')) return file.substring(0, file.length - 5)
  return 'gobang'
}

export function parseRoomInvite(value: string): RoomInvite | null {
  const isApp = value.startsWith('zhengzhengboardgames-hmos://join') ||
    value.startsWith('zhengzhengboardgames://join')
  const isWeb = value.startsWith('https://zhengzhengstudio.cn/boardgames/')
  if (!isApp && !isWeb) return null
  const room = cleanRoomId(queryValue(value, 'room'))
  if (room.length === 0) return null
  const versionValue = Number(queryValue(value, 'v') || '1')
  if (versionValue !== 1) return null
  const gameValue = queryValue(value, 'game')
  const expires = Number(queryValue(value, 'expires'))
  const safeToken = cleanToken(queryValue(value, 'invite'))
  if (safeToken.length === 0) return null
  return {
    version: 1,
    purpose: queryValue(value, 'purpose') === 'challenge' ? 'challenge' : 'continue',
    game: normalizeGameId(gameValue.length > 0 ? gameValue : gameFromWebPath(value)),
    room: room,
    token: safeToken,
    expiresAt: Number.isFinite(expires) ? expires : 0
  }
}
