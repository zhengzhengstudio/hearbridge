# 磁盘与 iCloud（最高优先级）

2026-10-11/12 各发生一次 iCloud 优化存储批量卸载，导致源码丢失。
**每次大批量写文件/构建/同步/恢复前先 `df -h /`，低于 20Gi 先清理。**
`mv` 到回收站不释放空间，必须 `rm -rf ~/.Trash/xxx`。

### 🚫 用户红线
- **`~/Downloads` 不许动**（2026-10-12）。其他删除也先列清单确认
- 可自动清理：`~/Library/Caches`、`~/.npm/_cacache`

### 恢复优先级
1. **git 分支 tree**（零网络）：`git ls-tree -r --name-only <branch>` → `git cat-file -p <ref>:<path> > <path>`
   ⚠️ 中文路径是八进制转义，须用 `ls-tree -z`
2. **git stash/autostash**：`git log --all --format='%h %ci %s' -- <file>` 找快照
3. 访达右键「下载现在」（人工）；`brctl download` / AppleScript / `fileproviderctl` 在沙箱内均无效

**黄金快照**：`19c4e285`(10-11 22:45 tracked) / `4752d91a`(stash untracked) / `53c7b00d`(SpaceFight 分支)
⚠️ 根 `.gitignore` 不存在，HEAD(main) 只跟踪 18 个 docs —— 要查**分支**不是 HEAD

### 🚨 恢复时只判存在不判版本 = 隐性数据损坏
`[ -e "$f" ] || 恢复` 会保留磁盘残留旧版。**必须逐文件 `Buffer.equals` 与最新 ref 比对**，
未匹配则标 STALE 重取。恢复过滤规则**不要按文件名前缀排**（曾误伤 `build.gradle.kts`、
`libs.versions.toml`、`mipmap/*.png`）；只排 `build/` `.gradle/` `node_modules/` 等目录。
从 git 恢复的脚本需 `chmod +x`。

### 哪些占位符值得下载
❌ `build`/`build 2`(2328) `node_modules` `dist` `.build` `.worktrees` `temp` `library`
`website/api/apps`(546，已发布包可 curl 回补)
✅ `SpaceFight-Cocos/assets/spacefight-high`(模型) / `native-build/artifacts`(历史包)
