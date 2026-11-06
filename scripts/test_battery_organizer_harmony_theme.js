const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const project = path.join(root, 'HarmonyOS-App', 'BatteryOrganizerHarmony', 'entry', 'src', 'main')
const indexPath = path.join(project, 'ets', 'pages', 'Index.ets')
const basePath = path.join(project, 'resources', 'base', 'element', 'color.json')
const darkPath = path.join(project, 'resources', 'dark', 'element', 'color.json')

function colorMap(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  return new Map(data.color.map((item) => [item.name, item.value]))
}

const requiredTokens = [
  'page_background',
  'surface_background',
  'subtle_background',
  'field_background',
  'text_primary',
  'text_secondary',
  'text_muted',
  'field_border',
  'primary_soft_background',
  'danger_soft_background',
  'success_soft_background'
]

const base = colorMap(basePath)
const dark = colorMap(darkPath)
for (const token of requiredTokens) {
  if (!base.has(token)) throw new Error(`浅色主题缺少颜色令牌：${token}`)
  if (!dark.has(token)) throw new Error(`深色主题缺少颜色令牌：${token}`)
  if (base.get(token) === dark.get(token)) throw new Error(`深浅色令牌没有区分：${token}`)
}

const source = fs.readFileSync(indexPath, 'utf8')
for (const token of ['page_background', 'surface_background', 'field_background', 'text_primary', 'field_border']) {
  if (!source.includes(`$r('app.color.${token}')`)) {
    throw new Error(`Index.ets 未使用主题颜色：${token}`)
  }
}

const forbiddenBackgrounds = [".backgroundColor('#FFFFFF')", ".backgroundColor('#F4F7FB')"]
for (const value of forbiddenBackgrounds) {
  if (source.includes(value)) throw new Error(`仍存在写死的浅色背景：${value}`)
}

console.log('PASS: HarmonyOS 深浅色主题令牌和核心页面引用完整')
