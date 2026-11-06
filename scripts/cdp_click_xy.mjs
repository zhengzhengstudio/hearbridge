// 用鼠标事件在指定坐标点击（绕过 SPA/iframe 里 click() 无效的情况）
const [, , xStr, yStr, waitMs = '2500', outPng = '/tmp/cdp-clickxy.png'] = process.argv;
const x = Number(xStr);
const y = Number(yStr);
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

  console.log('element@point:', await evaluate(`(() => { const el = document.elementFromPoint(${x}, ${y}); return el ? (el.innerText || el.className || el.tagName).toString().slice(0, 60) : 'none'; })()`));
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0
    });
  }
  await sleep(Number(waitMs));
  console.log('URL:', await evaluate('location.href'));
  console.log('--- TEXT(head 3000) ---');
  console.log(await evaluate('document.body ? document.body.innerText.slice(0, 3000) : ""'));
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
