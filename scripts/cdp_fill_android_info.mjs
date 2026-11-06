// 填 AGC 安卓应用「应用信息」的文字项：应用介绍 / 一句话简介 / 新版本特性
const INTRO = `电池收纳器单机版是一款本地使用的电池库存管理工具，适合记录家中、办公室或设备抽屉里的常用电池。
你可以按 5 号、7 号、9V、CR2025、CR2032 等规格整理电池，记录品牌、数量、收纳位置、低库存提醒和备注。应用内置南孚、金霸王等常用预设，添加电池时可以一键填入，减少重复输入。
本版本为单机版，数据仅保存在当前设备，不包含账号登录、云同步、反馈上传或联网更新功能，适合希望离线记录和本地管理的用户。`;
const TAGLINE = '本地电池库存管理工具，记录、提醒、盘点常用电池';
const NOTES = `首次发布电池收纳器单机版 Android。新增数据导出与导入：可只导出电池库存或个人预设，导入前显示备份内容，导入时只补充本机没有的条目，现有数据不会被覆盖。导出与导入全程在系统文件管理器里完成，不联网、不上传。同时修复编辑电池时累计充电次数、上次充电日期被清零，以及数量、容量、电压填非数字被静默改成默认值的问题；退役电池改为明确显示「已退役，不计入库存」；删除电池时同时清理本机照片，清空数据需二次确认。`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('chrome://'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      const onMessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === mid) {
          ws.removeEventListener('message', onMessage);
          resolve(msg.result);
        }
      };
      ws.addEventListener('message', onMessage);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

  const result = await evaluate(`(() => {
    const INTRO = ${JSON.stringify(INTRO)};
    const TAGLINE = ${JSON.stringify(TAGLINE)};
    const NOTES = ${JSON.stringify(NOTES)};
    const report = [];
    const setNativeValue = (el, value, proto) => {
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const scan = (doc) => {
      doc.querySelectorAll('textarea').forEach((ta) => {
        const ph = ta.placeholder || '';
        if (ph.includes('应用介绍')) {
          setNativeValue(ta, INTRO, HTMLTextAreaElement.prototype);
          report.push('intro:' + ta.value.length);
        } else if (ph.includes('新版本特性')) {
          setNativeValue(ta, NOTES, HTMLTextAreaElement.prototype);
          report.push('notes:' + ta.value.length);
        }
      });
      doc.querySelectorAll('input[type=text],input:not([type])').forEach((inp) => {
        const ph = inp.placeholder || '';
        const label = (inp.closest('.el-form-item, [class*=form]') || {}).innerText || '';
        if ((ph.includes('一句话') || label.includes('一句话')) && !inp.value) {
          setNativeValue(inp, TAGLINE, HTMLInputElement.prototype);
          report.push('tagline:' + inp.value.length);
        }
      });
      for (const f of doc.querySelectorAll('iframe')) {
        try { if (f.contentDocument) scan(f.contentDocument); } catch (e) {}
      }
    };
    scan(document);
    return report.join(', ');
  })()`);
  console.log('fill ->', result);
  await sleep(600);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync('/tmp/agc-filled.png', Buffer.from(shot.data, 'base64'));
  console.log('shot -> /tmp/agc-filled.png');
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
