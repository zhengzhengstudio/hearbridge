# 电池收纳器单机版设计

日期：2026-07-20

## 目标

为 HarmonyOS、Android、iOS/iPadOS 和 macOS 提供可与联网版共存的“电池收纳器单机版”。单机版不包含网页端，不连接公共互联网，不依赖账号或服务器，符合应用市场对单机应用的实际定义。

## 应用身份

- 应用名称：电池收纳器单机版
- HarmonyOS 包名：`cn.zhengzhengstudio.batteryorganizeroffline.hmos`
- Android 包名：`cn.zhengzhengstudio.batteryorganizer.offline`
- Apple Bundle ID：`cn.zhengzhengstudio.batteryorganizer.offline`

联网版和单机版拥有独立应用身份、图标名称、数据容器和版本号，可同时安装。

## 共享与隔离

两版共享以下源码：

- 电池模型
- 本地库存数据库
- 系统预设和自定义预设
- 库存、预设、添加/编辑和设置界面
- 深浅色主题与多语言
- 本地导入导出格式

单机版在构建阶段排除以下能力：

- 网络权限
- 铮铮通行证登录和注册
- 云同步及同步状态
- 在线反馈
- Push Kit
- App Linking
- 在线更新检查和下载安装
- 任何指向 `zhengzhengstudio.cn` 的运行时请求

仅隐藏按钮不算完成；单机包中不得包含可执行的网络请求路径。

## 导航

单机版沿用已确认的原生导航：

1. 库存
2. 我的预设
3. 设置

新增电池仍为库存页的命令按钮。设置页包含：

- 本地备份
- 从备份恢复
- 导入 JSON
- 导出 JSON
- 外观
- 隐私政策
- 儿童隐私保护声明
- 版本号

设置页不显示登录、注册、退出登录、云同步、在线反馈或在线更新。

## 本地数据

- 新增、编辑、增减和删除在本地事务中立即完成。
- 自定义预设可无限添加、编辑和删除。
- 数据在进程退出、设备重启和系统升级后保留。
- 删除记录保留墓碑，供本地备份与恢复正确表达删除状态。
- 单机版不会读取联网版私有容器，也不会自动迁移联网版数据。

## 导入导出

统一 JSON 格式：

```json
{
  "format": "cn.zhengzhengstudio.battery-organizer",
  "schemaVersion": 2,
  "exportedAt": "2026-07-20T00:00:00.000Z",
  "batteries": [],
  "presets": [],
  "tombstones": []
}
```

- 导出通过系统文件选择器保存。
- 导入通过系统文件选择器读取。
- 导入前显示记录数量和来源时间。
- 用户选择“合并”或“替换本机数据”。
- 替换操作必须二次确认。
- 格式错误、版本过高或字段无效时不得改变现有数据。
- 联网版也支持同一格式，用户可主动导出后导入单机版。

## 平台构建

### HarmonyOS

使用独立 product/module 配置生成单机 HAP/APP，`module.json5` 不声明 `ohos.permission.INTERNET`。不集成 Push Kit 和 App Linking。

### Android

使用 `online` 和 `offline` product flavor。`offline` 使用独立 `applicationId`，通过独立 Manifest 移除 `INTERNET` 权限，并在依赖与源码集中排除联网实现。

### Apple

使用独立 target 或构建配置，设置独立 Bundle ID、显示名称和数据容器。单机 target 不链接联网服务实现，网络客户端不进入单机 target membership。

## 图标

沿用电池收纳器品牌图形，单机版使用同一纯色背景并增加低调的设备内存储标记。标记不能影响主电池图形辨识度，也不能使用透明背景。

## 验收标准

- 两个版本能够同时安装。
- 单机版四端均无登录、同步、反馈、Push、App Linking 和更新下载。
- HarmonyOS 与 Android 单机包不声明网络权限。
- 静态扫描找不到单机构建中对 `zhengzhengstudio.cn` 的运行时请求。
- 飞行模式下全部库存、预设、导入和导出功能正常。
- 数据修改后列表和统计立即更新。
- 联网版导出的 JSON 可被单机版合并导入。
- 深浅色、手机、平板、2in1 和桌面布局符合全端 UI 设计。

