import http from '@ohos.net.http';
import fileIo from '@ohos.file.fs';
import common from '@ohos.app.ability.common';

/**
 * Mac 构建服务客户端（鸿蒙端）。
 * 服务端见 ZhengZhengDebugAssistant/mac-service/server.mjs。
 */
export interface Entry {
  name: string;
  dir: boolean;
  size: number;
}
export interface BuildStatus {
  status: string;
  exitCode: number | null;
  artifact: string | null;
  elapsed: number;
  logTail: string;
}

const PREF_HOST = 'zzda_host';
const PREF_PORT = 'zzda_port';
const PREF_TOKEN = 'zzda_token';

export class MacClient {
  private host: string = '';
  private port: string = '8124';
  private token: string = 'zhengzheng-debug-2026';

  setConfig(host: string, port: string, token: string): void {
    this.host = host.trim();
    this.port = port.trim() || '8124';
    this.token = token.trim() || 'zhengzheng-debug-2026';
  }

  getConfig(): [string, string, string] {
    return [this.host, this.port, this.token];
  }

  private base(): string {
    return `http://${this.host}:${this.port}`;
  }

  private req(method: string, path: string, body?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = http.createHttp();
      const header: Record<string, string> = { 'X-Debug-Token': this.token };
      if (body) {
        header['Content-Type'] = 'application/json';
      }
      const options: http.HttpRequestOptions = {
        method: method === 'GET' ? http.RequestMethod.GET : http.RequestMethod.POST,
        header: header,
        extraData: body,
        connectTimeout: 5000,
        readTimeout: 30000,
      };
      client.request(this.base() + path, options, (err, resp) => {
        if (err) {
          reject(new Error(err.message));
        } else {
          const code = resp.responseCode;
          const text = typeof resp.result === 'string' ? resp.result : JSON.stringify(resp.result);
          if (code >= 200 && code < 300) {
            resolve(text);
          } else {
            reject(new Error(`HTTP ${code}: ${text}`));
          }
        }
        client.destroy();
      });
    });
  }

  async ping(): Promise<string> {
    if (!this.host) {
      throw new Error('请先填写 Mac 服务地址');
    }
    return this.req('GET', '/api/ping');
  }

  async projects(): Promise<string[]> {
    const resp = JSON.parse(await this.req('GET', '/api/projects')) as Record<string, Object>;
    const arr = resp.projects as Array<string>;
    return arr;
  }

  async tree(project: string, path: string): Promise<Entry[]> {
    const p = encodeURIComponent(project);
    const f = encodeURIComponent(path);
    const resp = JSON.parse(await this.req('GET', `/api/tree?project=${p}&path=${f}`)) as Record<string, Object>;
    return resp.entries as Array<Entry>;
  }

  async readFile(project: string, path: string): Promise<string> {
    const p = encodeURIComponent(project);
    const f = encodeURIComponent(path);
    const resp = JSON.parse(await this.req('GET', `/api/file?project=${p}&path=${f}`)) as Record<string, Object>;
    return resp.content as string;
  }

  async writeFile(project: string, path: string, content: string): Promise<void> {
    const payload = JSON.stringify({ project: project, path: path, content: content });
    await this.req('POST', '/api/file', payload);
  }

  async build(project: string): Promise<string> {
    const payload = JSON.stringify({ project: project });
    const resp = JSON.parse(await this.req('POST', '/api/build', payload)) as Record<string, Object>;
    return resp.buildId as string;
  }

  async buildStatus(buildId: string): Promise<BuildStatus> {
    const r = JSON.parse(await this.req('GET', `/api/build/${buildId}`)) as Record<string, Object>;
    const st: BuildStatus = {
      status: r.status as string,
      exitCode: r.exitCode === null || r.exitCode === undefined ? -1 : r.exitCode as number,
      artifact: r.artifact === null || r.artifact === undefined ? '' : r.artifact as string,
      elapsed: r.elapsed === undefined ? 0 : r.elapsed as number,
      logTail: r.logTail === undefined ? '' : r.logTail as string,
    };
    return st;
  }

  /** 下载产物到应用沙箱 cache 目录，返回本地文件路径（在调用线程执行） */
  async downloadArtifact(buildId: string, ctx: common.UIAbilityContext): Promise<string> {
    const client = http.createHttp();
    try {
      const header: Record<string, string> = { 'X-Debug-Token': this.token };
      const options: http.HttpRequestOptions = {
        method: http.RequestMethod.GET,
        header: header,
        connectTimeout: 5000,
        readTimeout: 120000,
        expectDataType: http.HttpDataType.ARRAY_BUFFER,
      };
      const resp = await client.request(this.base() + `/api/build/${buildId}/artifact`, options);
      const buf = resp.result as ArrayBuffer;
      let name = 'artifact.bin';
      const headers = resp.header as Record<string, string>;
      const rawName = headers['x-artifact-name'];
      if (rawName !== undefined && rawName !== null) {
        name = decodeURIComponent(rawName);
      }
      const dir = ctx.cacheDir + '/installs';
      if (!fileIo.accessSync(dir)) {
        fileIo.mkdirSync(dir, true);
      }
      const dest = `${dir}/${name}`;
      const file = fileIo.openSync(dest, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
      fileIo.writeSync(file.fd, buf);
      fileIo.closeSync(file);
      return dest;
    } finally {
      client.destroy();
    }
  }
}

/** 全局单例 */
export const macClient = new MacClient();
