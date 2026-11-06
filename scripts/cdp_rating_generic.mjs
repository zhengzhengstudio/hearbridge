// 通用：滚动问卷、把所有可见未答的是/否题选「否」、需要文本的填「无」
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

  for (let round = 0; round < 40; round++) {
    // 找下一个未选中的「否」单选
    const no = JSON.parse(await evaluate(`(() => {
      let hit = null;
      const scan = (doc, ox, oy) => {
        const dialog = Array.from(doc.querySelectorAll('[class*=dialog]')).find((d) => (d.innerText || '').includes('验证') && (d.innerText || '').includes('应用是否'));
        if (!dialog) return;
        for (const label of dialog.querySelectorAll('.el-radio')) {
          const r = label.getBoundingClientRect();
          if ((label.innerText || '').trim() === '否' && r.width > 0 && r.height > 0 && !label.className.includes('is-checked') && r.top > 40 && r.top < innerHeight - 120) {
            hit = { x: ox + r.left + 12, y: oy + r.top + r.height / 2, checked: false };
            return;
          }
        }
        for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentDocument) { const fr = f.getBoundingClientRect(); scan(f.contentDocument, ox + fr.left, oy + fr.top); } } catch (e) {} }
      };
      scan(document, 0, 0);
      return JSON.stringify(hit || { error: 'nf' });
    })()`));
    if (!no.error && !no.checked) {
      await clickAt(no.x, no.y);
      await sleep(700);
      console.log('round', round, '选否 @', Math.round(no.y));
      continue;
    }
    // 没有可点的否 → 尝试滚动问卷内容
    const scrolled = await evaluate(`(() => {
      const bodies = Array.from(document.querySelectorAll('.el-dialog__body, [class*=dialog] [class*=body]')).filter((el) => el.scrollHeight > el.clientHeight + 40);
      if (bodies.length) {
        const b = bodies[0];
        const before = b.scrollTop;
        b.scrollTop = b.scrollHeight;
        return before < b.scrollTop ? 'scrolled' : 'at-bottom';
      }
      return 'no-body';
    })()`);
    if (scrolled === 'at-bottom' || scrolled === 'no-body') {
      console.log('round', round, '到底/无更多 ->', scrolled);
      break;
    }
    await sleep(500);
  }

  // 填「其他相关内容」等文本框
  const filled = await evaluate(`(() => {
    const out = [];
    const scan = (doc) => {
      const dialog = Array.from(doc.querySelectorAll('[class*=dialog]')).find((d) => (d.innerText || '').includes('验证') && (d.innerText || '').includes('应用是否'));
      if (dialog) {
        dialog.querySelectorAll('textarea, input[type=text]').forEach((el) => {
          if (!el.value && el.getBoundingClientRect().width > 100) {
            const setter = el.tagName === 'TEXTAREA' ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(el, '无');
            el.dispatchEvent(new Event('input', { bubbles: true }));
            out.push('filled:' + (el.placeholder || el.name || 'text').slice(0, 20));
          }
        });
        return true;
      }
      for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentDocument) { const r = scan(f.contentDocument); if (r) return r; } } catch (e) {} }
      return false;
    };
    scan(document);
    return out.join(', ') || 'no-empty-text';
  })()`);
  console.log('text ->', filled);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync('/tmp/agc-rating-generic.png', Buffer.from(shot.data, 'base64'));
  console.log('shot -> /tmp/agc-rating-generic.png');
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
