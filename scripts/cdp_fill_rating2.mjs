// 逐分类展开内容分级问卷并选「否」，带校验重试
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

  for (const cat of CATEGORIES) {
    // 已完成的分类标题旁有「已完成」，跳过
    const done = await evaluate(`(() => {
      let hit = false;
      const scan = (doc) => {
        for (const el of doc.querySelectorAll('.el-modal-dialog *, [class*=dialog] *')) {
          if (el.children.length === 0 && (el.innerText || '').trim() === ${JSON.stringify(cat)}) {
            const row = el.closest('div[class*=row], li, [class*=item]') || el.parentElement;
            const txt = (row && row.innerText) || '';
            hit = txt.includes('已完成');
            return;
          }
        }
        for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentDocument) { scan(f.contentDocument); } } catch (e) {} }
      };
      scan(document);
      return hit;
    })()`);
    if (done) {
      console.log(cat, ': 已完成，跳过');
      continue;
    }
    // 展开分类
    const head = JSON.parse(await evaluate(`(() => {
      let hit = null;
      const scan = (doc, ox, oy) => {
        for (const el of doc.querySelectorAll('.el-modal-dialog *, [class*=dialog] *')) {
          if (el.children.length === 0 && (el.innerText || '').trim() === ${JSON.stringify(cat)}) {
            const r = el.getBoundingClientRect();
            if (r.width > 0) { hit = { x: ox + r.left + 30, y: oy + r.top + r.height / 2 }; return; }
          }
        }
        for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentDocument) { const fr = f.getBoundingClientRect(); scan(f.contentDocument, ox + fr.left, oy + fr.top); } } catch (e) {} }
      };
      scan(document, 0, 0);
      return JSON.stringify(hit || { error: 'nf' });
    })()`));
    if (head.error) {
      console.log(cat, ': header not found');
      continue;
    }
    await clickAt(head.x, head.y);
    await sleep(1000);

    // 展开后点击可见的「否」并校验
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      const res = JSON.parse(await evaluate(`(() => {
        let hit = null;
        const scan = (doc, ox, oy) => {
          for (const label of doc.querySelectorAll('.el-modal-dialog .el-radio, [class*=dialog] .el-radio')) {
            const r = label.getBoundingClientRect();
            if ((label.innerText || '').trim() === '否' && r.width > 0 && r.height > 0) {
              hit = { x: ox + r.left + r.width / 2, y: oy + r.top + r.height / 2, checked: label.className.includes('is-checked'), idx: -1 };
              return;
            }
          }
          for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentDocument) { const fr = f.getBoundingClientRect(); scan(f.contentDocument, ox + fr.left, oy + fr.top); } } catch (e) {} }
        };
        scan(document, 0, 0);
        return JSON.stringify(hit || { error: 'nf' });
      })()`));
      if (res.error) {
        await sleep(800);
        continue;
      }
      if (res.checked) {
        ok = true;
        break;
      }
      await clickAt(res.x, res.y);
      await sleep(900);
      const check = await evaluate(`(() => {
        let found = null;
        const scan = (doc) => {
          for (const label of doc.querySelectorAll('.el-modal-dialog .el-radio, [class*=dialog] .el-radio')) {
            const r = label.getBoundingClientRect();
            if ((label.innerText || '').trim() === '否' && r.width > 0 && r.height > 0) { found = label.className.includes('is-checked'); return; }
          }
          for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentDocument) { scan(f.contentDocument); } } catch (e) {} }
        };
        scan(document);
        return found;
      })()`);
      ok = check === true;
    }
    console.log(cat, ok ? ': 否 已选中' : ': 未能确认');
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync('/tmp/agc-rating-final.png', Buffer.from(shot.data, 'base64'));
  console.log('shot -> /tmp/agc-rating-final.png');
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
