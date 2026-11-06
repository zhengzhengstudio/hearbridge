#!/usr/bin/env node
/**
 * 生成本地可用的 hvigor 签名材料目录，绕开 DevEco「自动签名」依赖。
 *
 * 背景：hvigor 在 SignHap 阶段会调用 DecipherUtil.decryptPwd() 把 build-profile.json5 里的
 * storePassword / keyPassword 解密后再传给 hap-sign-tool，校验条件是：
 *   1) 密码字符串长度 >= 32
 *   2) 长度必须是偶数（因为它要按 hex 解码）
 *   3) 用 <p12 所在目录>/material 派生出的密钥做 AES-128-GCM 解密
 * DevEco 的「自动签名」会生成这套 material，但本机没有。由于密钥派生完全是自洽的
 * （material 文件 -> pbkdf2 根密钥 -> 解出工作密钥 -> 解出密码），我们可以自己造一套。
 *
 * 用法: node harmony_make_signing_material.mjs <outDir> <plainPassword> [plainKeyPassword]
 * 输出: 在 <outDir>/material 下生成 fd/ ac/ ce/，并把加密后的密码以 hex 打印到 stdout（最后一行）
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const outDir = process.argv[2]
const plainStorePwd = process.argv[3]
const plainKeyPwd = process.argv[4] ?? plainStorePwd
if (!outDir || !plainStorePwd) {
  console.error('用法: node harmony_make_signing_material.mjs <outDir> <plainPassword> [plainKeyPassword]')
  process.exit(2)
}

// 与 hvigor DecipherUtil 保持一致的常量
const COMPONENT = new Int8Array([49, 243, 9, 115, 214, 175, 91, 184, 211, 190, 177, 88, 101, 131, 192, 119])
const IV_LENGTH = 12

function xor (a, b) {
  if (a.length !== b.length) throw new Error('xor 长度不一致')
  const out = new Int8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i]
  return out
}

/** 复刻 DecipherUtil.decrypt 的二进制布局： [int32be(密文长度+16)] + IV + 密文 + GCM tag */
function encryptBlob (key, plain) {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-128-gcm', Buffer.from(key), iv)
  const enc = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()])
  const tag = cipher.getAuthTag()
  const prefix = Buffer.alloc(4)
  prefix.writeInt32BE(enc.length + 16)
  return Buffer.concat([prefix, iv, enc, tag])
}

function decryptBlob (key, blob) {
  const r = new Int8Array(blob)
  const declared = ((r[0] & 255) << 24) | ((r[1] & 255) << 16) | ((r[2] & 255) << 8) | (r[3] & 255)
  const ivLen = r.length - 4 - declared
  const iv = Buffer.from(r.slice(4, 4 + ivLen))
  const dec = crypto.createDecipheriv('aes-128-gcm', Buffer.from(key), iv)
  dec.setAuthTag(Buffer.from(r.slice(r.length - 16)))
  return Buffer.concat([dec.update(Buffer.from(r.subarray(4 + ivLen, r.length - 16))), dec.final()])
}

const materialDir = path.join(outDir, 'material')
fs.rmSync(materialDir, { recursive: true, force: true })
for (const sub of ['fd', 'ac', 'ce']) fs.mkdirSync(path.join(materialDir, sub), { recursive: true })

// hvigor 对三组材料的形状要求不一样，踩过坑，别改：
//   fd/ -> 3 个「目录」，每个目录里恰好 1 个文件（readFd 会对每一项再调 readDirBytes）
//   ac/ -> 恰好 1 个文件（readSalt 直接对 ac 调 readDirBytes）
//   ce/ -> 恰好 1 个文件（readWorkMaterial 直接对 ce 调 readDirBytes）
function writeFdItem (name, bytes) {
  const dir = path.join(materialDir, 'fd', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${name}.dat`), bytes)
}

// fd: 3 个 16 字节文件，与 component 依次异或得到根密钥素材
const fdParts = []
for (let i = 0; i < 3; i++) {
  const bytes = crypto.randomBytes(16)
  fdParts.push(new Int8Array(bytes))
  writeFdItem(`part-${i + 1}`, bytes)
}

// ac: pbkdf2 的盐
const salt = crypto.randomBytes(16)
fs.writeFileSync(path.join(materialDir, 'ac', 'salt.bin'), salt)

let acc = xor(fdParts[0], fdParts[1])
for (let i = 2; i < fdParts.length; i++) acc = xor(acc, fdParts[i])
acc = xor(acc, COMPONENT)
const rootKey = crypto.pbkdf2Sync(Buffer.from(acc).toString(), Buffer.from(new Int8Array(salt)), 10000, 16, 'sha256')

const workKey = crypto.randomBytes(16)
fs.writeFileSync(path.join(materialDir, 'ce', 'work.bin'), encryptBlob(new Int8Array(rootKey), workKey))

const encStorePwd = encryptBlob(new Int8Array(workKey), Buffer.from(plainStorePwd, 'utf8')).toString('hex')
const encKeyPwd = encryptBlob(new Int8Array(workKey), Buffer.from(plainKeyPwd, 'utf8')).toString('hex')

// 自检：按 hvigor 的流程反解，确认能还原出明文密码
const checkStore = decryptBlob(new Int8Array(workKey), Buffer.from(encStorePwd, 'hex')).toString('utf8')
const checkKey = decryptBlob(new Int8Array(workKey), Buffer.from(encKeyPwd, 'hex')).toString('utf8')
if (checkStore !== plainStorePwd || checkKey !== plainKeyPwd) {
  console.error(`自检失败: 还原出 "${checkStore}" / "${checkKey}"`)
  process.exit(1)
}
for (const hex of [encStorePwd, encKeyPwd]) {
  if (hex.length < 32 || hex.length % 2 !== 0) {
    console.error(`加密后密码不符合 hvigor 校验（长度 ${hex.length}）`)
    process.exit(1)
  }
}

console.error(`已生成签名材料: ${materialDir}`)
console.log(JSON.stringify({ storePassword: encStorePwd, keyPassword: encKeyPwd }))
