# ZhengZhengGlasses

铮铮眼镜 Android 应用。当前版本使用原生首页承载账号、临时配镜用户、版本检查和主要流程入口，线上站点继续负责 MediaPipe 采集、实时试戴、报告、心愿单和商家沟通。

## 当前功能

- 原生登录、注册和临时配镜用户入口
- 原生流程导航：开始配镜、顾客工作台、聊天、商家中心、PPT
- 打开线上 MediaPipe 采集、实时试戴、报告和商家沟通页面
- 读取下载中心 manifest 并提示新版本
- 使用 HTTPS 线上地址

## 开发说明

- Android Studio 打开本目录即可构建
- 包名：`com.zzsys.zhengzhengglasses`
- 最低系统版本：Android 7.0
- 线上采集页需要相机权限
