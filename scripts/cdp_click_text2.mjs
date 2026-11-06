// 在带界面 Chrome 里按可见文字点击（含同源 iframe 内的元素），先定位再发鼠标事件
const [, , targetText, waitMs = '3000', outPng = '/tmp/cdp-click2.png'] = process.argv;
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

  const found = await evaluate(`(() => {
    const target = ${JSON.stringify(targetText)};
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const search = (doc, ox, oy) => {
      const hits = [];
      for (const el of doc.querySelectorAll('*')) {
        const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim() === target);
        if (own && visible(el)) {
          const r = el.getBoundingClientRect();
          hits.push({ x: ox + r.left + r.width / 2, y: oy + r.top + r.height / 2, text: (el.innerText || '').trim().slice(0, 30) });
        }
        for (const f of el.querySelectorAll('iframe')) {
          try {
            const fdoc = f.contentDocument;
            if (fdoc) {
              const fr = f.getBoundingClientRect();
              hits.push(...search(fdoc, ox + fr.left, oy + fr.top));
            }
          } catch (e) {}
        }
      }
      return hits;
    };
    const hits = search(document, 0, 0);
    return JSON.stringify(hits);
  })()`);
  const hits = JSON.parse(found);
  if (!hits.length) {
    console.log('not found:', targetText);
    ws.close();
    return;
  }
  const hit = hits[hits.length - 1];
  console.log('click at', hit.x, hit.y, '->', hit.text);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      x: hit.x,
      y: hit.y,
      button: 'left',
      clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0
    });
  }
  await sleep(Number(waitMs));
  console.log('--- TEXT(head 5000) ---');
  console.log(await evaluate('document.body ? document.body.innerText.slice(0, 5000) : ""'));
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
