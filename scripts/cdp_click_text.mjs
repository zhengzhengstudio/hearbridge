// 在带界面 Chrome（127.0.0.1:9222）里按可见文字点击元素，然后等待并导出页面文字
const [, , targetText, waitMs = '2500', outPng = '/tmp/cdp-click.png'] = process.argv;

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

  const clicked = await evaluate(`(() => {
    const nodes = Array.from(document.querySelectorAll('*'));
    const hit = nodes.filter((n) => n.children.length === 0 && (n.innerText || '').trim() === ${JSON.stringify(targetText)});
    if (!hit.length) return 'not-found:' + nodes.length;
    hit[hit.length - 1].click();
    return 'clicked';
  })()`);
  console.log('click ->', clicked);
  await sleep(Number(waitMs));

  console.log('URL:', await evaluate('location.href'));
  console.log('--- TEXT ---');
  console.log(await evaluate('document.body ? document.body.innerText.slice(0, 6000) : ""'));

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
