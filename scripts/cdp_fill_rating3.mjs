// 内容分级问卷：带展开状态检测的稳健版
const CATEGORIES = [
  '暴力内容',
  '令人恐惧的内容',
  '性相关的内容',
  '不良语言',
  '受管制物品与活动',
  '模拟赌博、真实赌博或法定货币支付',
  '法律与道德',
  '用户间交互',
  '用户信息收集',
  '其他',
  '金融类'
];
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
  const clickAt = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
    }
  };
  const findHeader = (cat) => evaluate(`(() => {
    let hit = null;
    const scan = (doc, ox, oy) => {
      for (const el of doc.querySelectorAll('.el-modal-dialog *, [class*=dialog] *')) {
        if (el.children.length === 0 && (el.innerText || '').trim() === ${JSON.stringify(cat)}) {
          const r0 = el.getBoundingClientRect();
          if (r0.width > 0) {
            el.scrollIntoView({ block: 'center' });
            const r = el.getBoundingClientRect();
            hit = { x: ox + r.left + 30, y: oy + r.top + r.height / 2 };
            return;
          }
        }
      }
      for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentDocument) { const fr = f.getBoundingClientRect(); scan(f.contentDocument, ox + fr.left, oy + fr.top); } } catch (e) {} }
    };
    scan(document, 0, 0);
    return JSON.stringify(hit || { error: 'nf' });
  })()`);
  const findNoRadio = () => evaluate(`(() => {
    let hit = null;
    const scan = (doc, ox, oy) => {
      for (const label of doc.querySelectorAll('.el-modal-dialog .el-radio, [class*=dialog] .el-radio')) {
        const r = label.getBoundingClientRect();
        if ((label.innerText || '').trim() === '否' && r.width > 0 && r.height > 0) {
          hit = { x: ox + r.left + 12, y: oy + r.top + r.height / 2, checked: label.className.includes('is-checked') };
          return;
        }
      }
      for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentDocument) { const fr = f.getBoundingClientRect(); scan(f.contentDocument, ox + fr.left, oy + fr.top); } } catch (e) {} }
    };
    scan(document, 0, 0);
    return JSON.stringify(hit || { error: 'nf' });
  })()`);

  for (const cat of CATEGORIES) {
    let ok = false;
    for (let expandTry = 0; expandTry < 4 && !ok; expandTry++) {
      const head = JSON.parse(await findHeader(cat));
      if (head.error) {
        console.log(cat, ': header not found');
        break;
      }
      await clickAt(head.x, head.y);
      await sleep(1100);
      for (let radioTry = 0; radioTry < 3 && !ok; radioTry++) {
        const no = JSON.parse(await findNoRadio());
        if (no.error) break;
        if (no.checked) {
          ok = true;
          break;
        }
        await clickAt(no.x, no.y);
        await sleep(1000);
        const after = JSON.parse(await findNoRadio());
        if (after.checked) ok = true;
      }
    }
    console.log(cat, ok ? 'OK' : 'FAIL');
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync('/tmp/agc-rating-v3.png', Buffer.from(shot.data, 'base64'));
  console.log('shot -> /tmp/agc-rating-v3.png');
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
