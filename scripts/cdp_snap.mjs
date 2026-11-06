// 用 CDP 读取带界面 Chrome（127.0.0.1:9222）当前标签页的文字与截图
const [, , outPng = '/tmp/cdp-snap.png'] = process.argv;

async function main() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('chrome://'));
  if (!page) throw new Error('没有可用的页面标签');
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

  console.log('URL:', page.url);
  console.log('TITLE:', await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }).then((r) => r.result.value));

  const text = await send('Runtime.evaluate', {
    expression: 'document.body ? document.body.innerText.slice(0, 4000) : ""',
    returnByValue: true
  });
  console.log('--- TEXT ---');
  console.log(text.result.value);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync(outPng, Buffer.from(shot.data, 'base64'));
  console.log('--- screenshot ->', outPng);
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
