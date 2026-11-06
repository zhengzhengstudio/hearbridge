// 通用小工具：node cdp_form_action.mjs <动作> [参数...]
//  clickText <text>         —— 按文字点击（含 iframe）
//  clickInItem <label> <text> —— 在包含 label 的表单项里点击含 text 的元素
//  openInItem <label>       —— 点击表单项里的下拉/级联控件，并列出可见选项
//  dump <selector>          —— 列出匹配元素文本
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [action, a1, a2] = process.argv.slice(2);

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

  if (action === 'openInItem') {
    const point = JSON.parse(await evaluate(`(() => {
      const label = ${JSON.stringify(a1)};
      const scan = (doc, ox, oy) => {
        for (const item of doc.querySelectorAll('.el-form-item,[class*=form-item]')) {
          if ((item.innerText || '').includes(label)) {
            const cands = Array.from(item.querySelectorAll('input,.el-cascader,.el-select,[class*=cascader],[class*=select]'))
              .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 10; });
            if (cands.length) {
              const r = cands[0].getBoundingClientRect();
              return JSON.stringify({ x: ox + r.left + r.width / 2, y: oy + r.top + r.height / 2, cls: cands[0].className.toString().slice(0, 60) });
            }
          }
        }
        for (const f of doc.querySelectorAll('iframe')) {
          try { if (f.contentDocument) { const fr = f.getBoundingClientRect(); const res = scan(f.contentDocument, ox + fr.left, oy + fr.top); if (res) return res; } } catch (e) {}
        }
        return null;
      };
      return scan(document, 0, 0) || JSON.stringify({ error: 'not-found' });
    })()`));
    console.log('open ->', JSON.stringify(point));
    if (point.x) {
      await clickAt(point.x, point.y);
      await sleep(1200);
      const opts = await evaluate(`(() => {
        const out = [];
        const scan = (doc, ox, oy) => {
          for (const el of doc.querySelectorAll('.el-cascader-node,.el-select-dropdown__item,.el-cascader-menu__wrap li,[class*=option]')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const t = (el.innerText || '').trim();
            if (t) out.push({ text: t.slice(0, 30), x: ox + r.left + r.width / 2, y: oy + r.top + r.height / 2 });
          }
          for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentDocument) { const fr = f.getBoundingClientRect(); scan(f.contentDocument, ox + fr.left, oy + fr.top); } } catch (e) {} }
        };
        scan(document, 0, 0);
        return JSON.stringify(out.slice(0, 40));
      })()`);
      console.log('options ->', opts);
    }
  }

  if (action === 'clickText') {
    const point = JSON.parse(await evaluate(`(() => {
      const target = ${JSON.stringify(a1)};
      const scan = (doc, ox, oy) => {
        for (const el of doc.querySelectorAll('*')) {
          const t = (el.innerText || '').trim();
          if (t === target && el.children.length <= 1) {
            const r = el.getBoundingClientRect();
            if (r.width > 0) return JSON.stringify({ x: ox + r.left + r.width / 2, y: oy + r.top + r.height / 2 });
          }
        }
        for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentDocument) { const fr = f.getBoundingClientRect(); const res = scan(f.contentDocument, ox + fr.left, oy + fr.top); if (res) return res; } } catch (e) {} }
        return null;
      };
      return scan(document, 0, 0) || JSON.stringify({ error: 'not-found' });
    })()`));
    console.log('click ->', JSON.stringify(point));
    if (point.x) await clickAt(point.x, point.y);
    await sleep(1200);
  }

  if (action === 'dump') {
    console.log(await evaluate(`(() => {
      const out = [];
      const scan = (doc) => {
        doc.querySelectorAll(${JSON.stringify(a1)}).forEach((el) => {
          const t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
          if (t && t.length < 90) out.push(t);
        });
        for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentDocument) scan(f.contentDocument); } catch (e) {} }
      };
      scan(document);
      return out.slice(0, 40).join('\\n');
    })()`));
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync(a2 && a2.endsWith('.png') ? a2 : '/tmp/cdp-action.png', Buffer.from(shot.data, 'base64'));
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
