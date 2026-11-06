// 在 AGC 的 iframe 内探测表单控件：textarea 与 radio/checkbox
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

  const report = await evaluate(`(() => {
    const out = { textareas: [], radios: [], checked: [] };
    const scan = (doc, tag) => {
      doc.querySelectorAll('textarea').forEach((t, i) => {
        const r = t.getBoundingClientRect();
        out.textareas.push({ tag, i, ph: (t.placeholder || '').slice(0, 40), value: (t.value || '').slice(0, 60), visible: r.width > 0, top: Math.round(r.top) });
      });
      doc.querySelectorAll('input[type=radio],input[type=checkbox]').forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0) return;
        const label = (el.closest('label') || el.parentElement).innerText.trim().slice(0, 40);
        (el.type === 'radio' ? out.radios : out.checked).push({ tag, i, name: el.name, value: el.value, checked: el.checked, label, top: Math.round(r.top) });
      });
      for (const f of doc.querySelectorAll('iframe')) {
        try { if (f.contentDocument) scan(f.contentDocument, tag + (f.name || 'iframe') + '/'); } catch (e) {}
      }
    };
    scan(document, '');
    return JSON.stringify(out);
  })()`);
  console.log(JSON.stringify(JSON.parse(report), null, 1));
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
