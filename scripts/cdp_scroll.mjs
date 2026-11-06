// 滚动页面/iframe 内容并截图：node cdp_scroll.mjs <deltaY> <waitMs> <outPng>
const [, , dyStr = '600', waitMs = '1500', outPng = '/tmp/cdp-scroll.png'] = process.argv;
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

  // 优先滚动 iframe 内部滚动容器
  const which = await evaluate(`(() => {
    const dy = ${Number(dyStr)};
    const cands = [];
    for (const f of document.querySelectorAll('iframe')) {
      try {
        const d = f.contentDocument;
        if (!d) continue;
        for (const el of d.querySelectorAll('*')) {
          if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 300) cands.push(el);
        }
        if (cands.length) { cands[cands.length - 1].scrollBy(0, dy); return 'iframe:' + cands.length; }
        d.scrollingElement.scrollBy(0, dy); return 'iframe-doc';
      } catch (e) { return 'iframe-err:' + e.message; }
    }
    document.scrollingElement.scrollBy(0, dy); return 'main';
  })()`);
  console.log('scrolled:', which);
  await sleep(Number(waitMs));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync(outPng, Buffer.from(shot.data, 'base64'));
  console.log('screenshot ->', outPng);
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
