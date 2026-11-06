// 用 CDP DOM.setFileInputFiles 给 AGC 的隐藏 file input 直接塞文件（不弹系统选择框）
// 用法：node cdp_upload_files.mjs <inputIndex> <file1> [file2 ...]
const [, , indexStr, ...files] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const index = Number(indexStr);
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('chrome://'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, { resolve });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await send('DOM.enable');
  await send('Runtime.enable');

  const remote = await send('Runtime.evaluate', {
    expression: `(() => {
      const scan = (doc) => {
        const els = doc.querySelectorAll('input[type=file]');
        if (els.length) return els[${index}] || null;
        for (const f of doc.querySelectorAll('iframe')) {
          try { if (f.contentDocument) { const r = scan(f.contentDocument); if (r) return r; } } catch (e) {}
        }
        return null;
      };
      return scan(document);
    })()`
  });
  if (!remote.result || !remote.result.objectId) {
    console.error('找不到 file input:', JSON.stringify(remote.result));
    ws.close();
    return;
  }
  const res = await send('DOM.setFileInputFiles', { files, objectId: remote.result.objectId });
  console.log('setFileInputFiles ->', JSON.stringify(res).slice(0, 120));
  await sleep(2500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync('/tmp/cdp-upload.png', Buffer.from(shot.data, 'base64'));
  console.log('shot -> /tmp/cdp-upload.png');
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
