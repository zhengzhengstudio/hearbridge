// 往「新版本特性」textarea（iframe 内第 2 个）填入 1.0.17 的更新说明
const NOTES = `本次解决了开启系统未成年人模式后应用无法打开的问题：已按华为规范声明接入未成年人模式，安装后可直接启动使用，进入模式后涉及库存变动等敏感操作会要求二次确认。同时修复了退役电池在库存列表中仍显示"新电池"徽标和数量的问题，退役后统一显示"已退役，不计入库存"，与统计数字保持一致；页面顶部提示文字改为四秒后自动消失，不再长期停留、跨页面误导操作。数据导出导入功能延续上一版本，可选择只导出电池库存或自定义预设，导入时只补充本机没有的条目，现有数据不会被覆盖；全部数据仍只保存在本机，不联网、不需要账号。`;
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
    const NOTES = ${JSON.stringify(NOTES)};
    const find = (doc) => {
      const list = doc.querySelectorAll('textarea');
      if (list.length >= 2) return list[1];
      for (const f of doc.querySelectorAll('iframe')) {
        try { if (f.contentDocument) { const r = find(f.contentDocument); if (r) return r; } } catch (e) {}
      }
      return null;
    };
    const ta = find(document);
    if (!ta) return 'textarea-not-found';
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, NOTES);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    return 'filled:' + ta.value.length;
  })()`);
  console.log('fill ->', result);
  await sleep(800);

  // 顺带确认版本选取区域当前选中的包
  const ver = await evaluate(`(() => {
    const scan = (doc, out) => {
      for (const el of doc.querySelectorAll('*')) {
        const t = (el.textContent || '').trim();
        if (t === '1.0.17' || t === '1.0.14') {
          const r = el.getBoundingClientRect();
          if (r.width > 0) out.push(el.tagName + '|' + t + '|top' + Math.round(r.top));
        }
        for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentDocument) scan(f.contentDocument, out); } catch (e) {} }
        return out;
      }
      return out;
    };
    const out = [];
    scan(document, out);
    return JSON.stringify(out.slice(0, 10));
  })()`);
  console.log('versions ->', ver);
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
