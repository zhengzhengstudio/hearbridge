# Android 原生包构建（SpaceFight 已跑通）

Cocos 头less 需 wrapper 加 `--use-gl=swiftshader --use-angle=swiftshader
--enable-unsafe-swiftshader --no-sandbox`，且 `env -u ELECTRON_RUN_AS_NODE`，
JDK 用 `/Applications/Android Studio.app/Contents/jbr`（系统 Java 8 不够）。
gradle 必须显式 `-PNATIVE_DIR`；drawable 放 `native/engine/android/app/res/`（不是 engine 根）。

安卓密码在钥匙串，条目名 `cn.zhengzhengstudio.<app>.android.release`。
