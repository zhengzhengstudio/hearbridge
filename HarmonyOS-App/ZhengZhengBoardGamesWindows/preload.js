// 把 package.json 里的版本号与运行环境暴露给渲染进程
// contextIsolation 下走 contextBridge，界面上的 vX.Y.Z 始终与 package.json 保持一致
const { contextBridge } = require('electron')

const pkg = require('./package.json')

contextBridge.exposeInMainWorld('ZZDesktop', {
  version: pkg.version,
  name: pkg.productName || pkg.name,
  platform: process.platform,
  arch: process.arch
})
