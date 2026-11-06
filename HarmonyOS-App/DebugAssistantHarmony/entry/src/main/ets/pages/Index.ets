import { macClient, Entry, BuildStatus } from '../common/MacClient';
import common from '@ohos.app.ability.common';

/**
 * 铮铮调试助手 · 鸿蒙端（骨架）
 * 视图状态机：server（服务配置）→ projects（项目列表）→ files（文件浏览）→ editor（编辑器）
 * 构建闭环：触发构建 → 轮询状态 → 下载产物到沙箱。
 *
 * ⚠️ 系统权限说明：三方应用无法静默安装 .hap（安装 Bundle 需要系统级权限）。
 * 产物下载到沙箱后，可通过 hdc / DevEco 安装；后续版本可接「分享给文件管理器」。
 */
@Entry
@Component
struct Index {
  @State view: string = 'server';
  @State host: string = '';
  @State port: string = '8124';
  @State token: string = 'zhengzheng-debug-2026';
  @State message: string = '';
  @State projects: string[] = [];
  @State project: string = '';
  @State currentPath: string = '';
  @State entries: Entry[] = [];
  @State fileContent: string = '';
  @State filePath: string = '';
  @State building: boolean = false;
  @State buildLog: string = '';
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;

  aboutToAppear(): void {
    const cfg = macClient.getConfig();
    this.host = cfg[0];
    this.port = cfg[1];
    this.token = cfg[2];
  }

  build() {
    Column() {
      Row() {
        if (this.view !== 'server') {
          Text('←')
            .fontSize(24)
            .onClick(() => this.back())
            .margin({ right: 12 })
        }
        Text(this.title()).fontSize(20).fontWeight(FontWeight.Bold)
      }
      .width('100%')
      .padding(16)

      if (this.view === 'server') {
        this.serverView()
      } else if (this.view === 'projects') {
        this.projectsView()
      } else if (this.view === 'files') {
        this.filesView()
      } else if (this.view === 'editor') {
        this.editorView()
      }

      if (this.message !== '') {
        Text(this.message)
          .fontSize(12)
          .fontColor('#B26A00')
          .padding(12)
          .width('100%')
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F5F6F8')
  }

  title(): string {
    if (this.view === 'server') {
      return '铮铮调试助手 v0.1.0';
    }
    if (this.view === 'projects') {
      return '项目';
    }
    if (this.view === 'files') {
      return `📁 ${this.project}/`;
    }
    return `✏️ ${this.filePath}`;
  }

  back(): void {
    if (this.view === 'editor') {
      this.view = 'files';
    } else if (this.view === 'files') {
      this.view = 'projects';
    } else if (this.view === 'projects') {
      this.view = 'server';
    }
  }

  // ---------- 服务配置 ----------
  @Builder
  serverView() {
    Column() {
      TextInput({ text: this.host, placeholder: 'Mac 服务地址，如 192.168.1.10' })
        .onChange((v: string) => { this.host = v; })
        .margin({ bottom: 8 })
      TextInput({ text: this.port, placeholder: '端口' })
        .onChange((v: string) => { this.port = v; })
        .margin({ bottom: 8 })
      TextInput({ text: this.token, placeholder: 'Token' })
        .onChange((v: string) => { this.token = v; })
        .margin({ bottom: 12 })
      Button('保存并连接', { type: ButtonType.Capsule })
        .width('100%')
        .onClick(() => this.connect())
      Text('Mac 侧先启动：ZhengZhengDebugAssistant/mac-service → node server.mjs')
        .fontSize(11)
        .fontColor('#888')
        .margin({ top: 16 })
    }
    .padding(16)
  }

  async connect(): Promise<void> {
    this.message = '连接中…';
    macClient.setConfig(this.host, this.port, this.token);
    try {
      const resp = await macClient.ping();
      this.message = `✓ 已连接 ${resp}`;
      await this.loadProjects();
    } catch (e) {
      this.message = `✗ 连接失败：${(e as Error).message}`;
    }
  }

  async loadProjects(): Promise<void> {
    try {
      this.projects = await macClient.projects();
      this.message = '';
      this.view = 'projects';
    } catch (e) {
      this.message = `获取项目失败：${(e as Error).message}`;
    }
  }

  // ---------- 项目列表 ----------
  @Builder
  projectsView() {
    List() {
      ForEach(this.projects, (p: string) => {
        ListItem() {
          Text(`📁 ${p}`)
            .fontSize(16)
            .padding(16)
            .width('100%')
            .onClick(() => {
              this.project = p;
              this.openDir('');
            })
        }
      }, (p: string) => p)
    }
    .width('100%')
  }

  // ---------- 文件浏览 ----------
  @Builder
  filesView() {
    Column() {
      Row() {
        Button('⬆ 上一级').onClick(() => {
          this.openDir(this.dirName(this.currentPath));
        }).margin({ right: 8 })
        Button('🔨 构建并取包').onClick(() => this.triggerBuild())
      }
      .padding({ left: 16, right: 16 })

      List() {
        ForEach(this.entries, (e: Entry) => {
          ListItem() {
            Text(`${e.dir ? '📁' : '📄'} ${e.name}`)
              .fontSize(15)
              .padding({ left: 16, right: 16, top: 10, bottom: 10 })
              .width('100%')
              .onClick(() => this.onEntryTap(e))
          }
        }, (e: Entry) => `${e.name}${e.dir ? 'd' : 'f'}`)
      }
      .layoutWeight(1)

      if (this.buildLog !== '') {
        Text(this.buildLog)
          .fontSize(10)
          .maxLines(12)
          .padding(12)
          .backgroundColor('#111')
          .fontColor('#9f9')
          .width('100%')
      }
    }
    .height('100%')
  }

  onEntryTap(e: Entry): void {
    const child = this.currentPath === '' ? e.name : `${this.currentPath}/${e.name}`;
    if (e.dir) {
      this.openDir(child);
    } else {
      this.openFile(child);
    }
  }

  async openDir(path: string): Promise<void> {
    try {
      this.currentPath = path;
      this.entries = await macClient.tree(this.project, path);
      this.view = 'files';
    } catch (e) {
      this.message = `读取目录失败：${(e as Error).message}`;
    }
  }

  async openFile(path: string): Promise<void> {
    try {
      this.filePath = path;
      this.fileContent = await macClient.readFile(this.project, path);
      this.view = 'editor';
    } catch (e) {
      this.message = `读取文件失败：${(e as Error).message}`;
    }
  }

  // ---------- 编辑器 ----------
  @Builder
  editorView() {
    Column() {
      TextArea({ text: this.fileContent })
        .onChange((v: string) => { this.fileContent = v; })
        .fontSize(13)
        .layoutWeight(1)
        .width('100%')
      Row() {
        Button('💾 保存到 Mac').onClick(() => this.saveFile()).margin({ right: 8 })
        Button('关闭').onClick(() => { this.view = 'files'; })
      }
      .padding(12)
    }
    .height('100%')
  }

  async saveFile(): Promise<void> {
    try {
      await macClient.writeFile(this.project, this.filePath, this.fileContent);
      this.message = '✓ 已保存到 Mac';
    } catch (e) {
      this.message = `保存失败：${(e as Error).message}`;
    }
  }

  // ---------- 构建闭环 ----------
  async triggerBuild(): Promise<void> {
    if (this.building) {
      return;
    }
    this.building = true;
    this.buildLog = '构建请求已发送…';
    try {
      const buildId = await macClient.build(this.project);
      await this.pollBuild(buildId, 0);
    } catch (e) {
      this.buildLog = `构建触发失败：${(e as Error).message}`;
    }
    this.building = false;
  }

  async pollBuild(buildId: string, round: number): Promise<void> {
    if (round > 600) {
      this.buildLog = '构建超时（10 分钟）';
      return;
    }
    const st: BuildStatus = await macClient.buildStatus(buildId);
    if (st.status === 'running') {
      this.buildLog = `构建中… ${Math.round(st.elapsed / 1000)}s`;
      await this.sleep(1000);
      await this.pollBuild(buildId, round + 1);
    } else if (st.status === 'success') {
      if (st.artifact) {
        this.buildLog = `✓ 构建成功：${st.artifact.substring(st.artifact.lastIndexOf('/') + 1)}，下载中…`;
        const localPath = await macClient.downloadArtifact(buildId, this.context);
        this.buildLog = `✓ 产物已下载到沙箱：${localPath}\n三方应用无权限静默安装 .hap，请用 hdc app install 或 DevEco 安装。`;
      } else {
        this.buildLog = '⚠ 构建退出码 0 但没找到产物文件';
      }
    } else {
      this.buildLog = `✗ 构建失败（exit ${st.exitCode}）：\n${st.logTail}`;
    }
  }

  sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  /** 取父目录（ArkTS 没有 substringBeforeLast） */
  dirName(path: string): string {
    const idx = path.lastIndexOf('/');
    return idx < 0 ? '' : path.substring(0, idx);
  }
}
