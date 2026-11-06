# Android release signing material

本目录存放 **SpaceFight** 的本地 Android 发布签名材料。私有 PKCS#12 文件被 Git 忽略。
密码只存在于已登录的 macOS 用户钥匙串中，**绝不能提交进仓库、写入源码或打印到构建日志**。

> 目录内另有 `BoardGames-*`、`SurvivalDiary-*` 属于各自应用，请勿混用。

## SpaceFight 公开身份

- Android 包名：`cn.zhengzhengstudio.spacefight`
- 密钥库文件：`SpaceFight-Android-Release.p12`
- 密钥库格式：PKCS#12
- 别名：`spacefight-release`
- 密钥算法：RSA, 3072 位
- 证书签名算法：SHA256withRSA
- 证书主体：`CN=ZhengZheng Studio SpaceFight, OU=ZhengZheng Lab, O=ZhengZheng Studio, L=Guangzhou, ST=Guangdong, C=CN`
- 序列号：`77ebb5d7`
- 有效期：10,000 天（2026-10-11 至 2054-02-26）
- SHA-256 证书指纹：`32:B7:30:D3:F8:F0:F0:3C:CA:AD:5F:06:96:33:FD:A6:90:75:CA:6C:36:CC:B8:44:17:D8:62:47:24:25:63:AA`

## 密码保管

- macOS Keychain service：`cn.zhengzhengstudio.spacefight.android.release`
- macOS Keychain account：`$USER`（执行发布构建的账户）

取值只放进本地临时 shell 变量。不要 echo、不要写进 Gradle properties、不要提交、不要经过 CI 日志：

```bash
PW=$(security find-generic-password -s "cn.zhengzhengstudio.spacefight.android.release" -w)
# …使用 $PW 完成签名…
unset PW
```

## 签名变更历史（重要）

| 版本区间 | 证书 | 说明 |
|---|---|---|
| ≤ 0.11.18 / build 62 | `CN=CocosCreator, O=cocos2d`（Cocos 默认自签名） | 已发布在官网下载中心 |
| ≥ 0.12.0 / build 63 | 本目录 `SpaceFight-Android-Release.p12` | 首次使用自有证书 |

**切换证书导致 0.11.18 及更早版本的用户无法覆盖安装**：
系统会以 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` 拒绝新包，必须先卸载旧版。
面向老用户发布时需要在更新说明中明确提示「请先卸载旧版再安装」。

从 0.12.0 起，后续所有更新**必须**继续使用本证书签名，否则同样会中断升级链路。

## 备份与升级连续性

丢失或替换本私钥会导致同包名的已安装版本**再也无法收到升级**。
请对 `.p12` 与对应钥匙串密码各保留一份加密离线备份，限制授权发布人员访问。
机器迁移后，务必用上面的别名与 SHA-256 指纹复核。
应用仍在分发期间，**不要重新生成或覆盖**本证书。
