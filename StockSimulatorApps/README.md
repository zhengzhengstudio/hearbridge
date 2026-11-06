# 独立模拟炒股客户端

本目录中的客户端是独立 App 项目，不复用或覆盖原有 `ZhengZhengStudio` App。

- `ZhengZhengStockHarmony`: HarmonyOS ArkUI 原生客户端，包名 `cn.zhengzhengstudio.stock.harmony`
- `ZhengZhengStockAndroid`: Android 原生客户端，包名 `cn.zhengzhengstudio.stock`

HarmonyOS 构建：

```bash
cd ZhengZhengStockHarmony
./build-hap.sh
```

生成的 HAP 位于：

`ZhengZhengStockHarmony/entry/build/default/outputs/default/ZhengZhengStock-HarmonyOS-v1.0.0-unsigned.hap`
