// 滚动到包含指定文字的元素并点击其中的目标文字（iframe 内也可用）
// 用法：node cdp_scroll_click.mjs <锚点文字> <目标文字> <等待ms>
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [, , anchor, target, waitMs = '2500'] = process.argv;

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

  const scrolled = await evaluate(`(() => {
    const scan = (doc) => {
      for (const el of doc.querySelectorAll('*')) {
        if ((el.innerText || '').trim().startsWith(${JSON.stringify(anchor)}) && el.offsetHeight > 30 && el.offsetHeight < 2500) {
          el.scrollIntoView({ block: 'center' });
          return 'ok';
        }
      }
      for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentDocument) { const r = scan(f.contentDocument); if (r) return r; } } catch (e) {} }
      return 'nf';
    };
    return scan(document);
  })()`);
  console.log('scroll ->', scrolled);
  await sleep(900);

  const point = JSON.parse(await evaluate(`(() => {
    const tgt = ${JSON.stringify(target)};
    const scan = (doc, ox, oy) => {
      for (const el of doc.querySelectorAll('*')) {
        if (el.children.length === 0 && (el.innerText || '').trim() === tgt) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.top > 0 && r.top < innerHeight - 20) return JSON.stringify({ x: ox + r.left + r.width / 2, y: oy + r.top + r.height / 2 });
        }
      }
      for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentDocument) { const fr = f.getBoundingClientRect(); const res = scan(f.contentDocument, ox + fr.left, oy + fr.top); if (res) return res; } } catch (e) {} }
      return null;
    };
    return scan(document, 0, 0) || JSON.stringify({ error: 'nf' });
  })()`));
  console.log('target ->', JSON.stringify(point));
  if (point.x) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
    }
  }
  await sleep(Number(waitMs));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync('/tmp/cdp-scroll-click.png', Buffer.from(shot.data, 'base64'));
  console.log('shot -> /tmp/cdp-scroll-click.png');
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
