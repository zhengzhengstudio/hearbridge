#!/usr/bin/env node
/**
 * 构建前置自检：用 hvigor 自带的 DecipherUtil 验证「自造签名材料 + 加密密码」能被正确解密。
 * 这一步能在几秒内发现问题，省掉一次十几分钟的完整编译。
 *
 * 用法: node harmony_verify_signing_material.cjs <p12 所在目录> <加密后的 hex 密码> <期望的明文密码>
 */
const Module = require('module')
const origLoad = Module._load

// hvigor 的 ohos-logger 依赖 @ohos/hvigor，独立运行时拿不到，这里替换成简易桩。
Module._load = function (request, ...rest) {
  if (String(request).includes('ohos-logger')) {
    return {
      OhosLogger: {
        getLogger: () => ({
          printErrorExit: (...args) => {
            console.error(`❌ hvigor 校验失败: ${args[0]}`)
            process.exit(9)
          }
        })
      }
    }
  }
  return origLoad.call(this, request, ...rest)
}

const [materialDir, encrypted, expected] = process.argv.slice(2)
if (!materialDir || !encrypted || !expected) {
  console.error('用法: node harmony_verify_signing_material.cjs <p12目录> <hex密码> <明文密码>')
  process.exit(2)
}

const DEVECO = process.env.DEVECO_APP || '/Applications/DevEco-Studio.app'
const { DecipherUtil } = require(`${DEVECO}/Contents/tools/hvigor/hvigor-ohos-plugin/src/utils/decipher-util.js`)

const actual = DecipherUtil.decryptPwd(materialDir, encrypted, 'build-profile.json5')
if (actual !== expected) {
  console.error(`❌ 解密结果不符: 期望 "${expected}"，实际 "${actual}"`)
  process.exit(1)
}
console.log('✅ 签名材料可被 hvigor 正确解密')
