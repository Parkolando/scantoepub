const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { writeFile, mkdtemp, rm } = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

function samplePdf() {
  const stream = "BT /F1 28 Tf 72 700 Td (Scan to EPUB) Tj 0 -45 Td /F1 16 Tf (Continuous paragraph.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  return `${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

async function freePort() {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

async function waitFor(fn, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError || new Error("Timed out");
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const promise = pending.get(message.id);
    pending.delete(message.id);
    message.error ? promise.reject(message.error) : promise.resolve(message.result);
  };
  return {
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        pending.set(requestId, { resolve, reject });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
    close: () => socket.close()
  };
}

async function main() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "scan-to-epub-"));
  const pdfPath = path.join(temp, "sample.pdf");
  await writeFile(pdfPath, samplePdf(), "binary");

  let authorization;
  let activeRequests = 0;
  let maximumRequests = 0;
  const attemptsByPage = new Map();
  const api = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    authorization = request.headers.authorization;
    let requestBody = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => requestBody += chunk);
    request.on("end", () => {
      const body = JSON.parse(requestBody);
      const prompt = body.messages[1].content[0].text;
      const page = Number(prompt.match(/Scan page (\d+)/)?.[1] || 0);
      const attempt = (attemptsByPage.get(page) || 0) + 1;
      attemptsByPage.set(page, attempt);
      const delay = { 1: 300, 2: 50, 3: 150 }[page] || 0;
      activeRequests += 1;
      maximumRequests = Math.max(maximumRequests, activeRequests);
      setTimeout(() => {
        if (page === 2 && attempt <= 3) {
          response.writeHead(500, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: { message: "temporary failure" } }));
          activeRequests -= 1;
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                mode: "reflow",
                reason: "linear text",
                confidence: 0.99,
                altText: "",
                blocks: [
                  { type: "heading", bbox: [100, 80, 700, 180], text: `Page ${page}`, level: 1 },
                  { type: "paragraph", bbox: [100, 180, 900, 280], text: `Paragraph ${page}` }
                ]
              })
            }
          }]
        }));
        activeRequests -= 1;
      }, delay);
    });
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const apiPort = api.address().port;
  const debugPort = await freePort();
  const electron = spawn(require("electron"), [`--remote-debugging-port=${debugPort}`, "."], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "ignore"
  });

  let cdp;
  try {
    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
      const targets = await response.json();
      return targets.find((item) => item.type === "page");
    });
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.call("DOM.enable");
    await waitFor(async () => {
      const result = await cdp.call("Runtime.evaluate", {
        expression: "document.documentElement.dataset.appReady === 'true'",
        returnByValue: true
      });
      return result.result.value;
    });
    const language = await cdp.call("Runtime.evaluate", {
      expression: `(() => {
        const select = document.querySelector('#ui-language');
        select.value = 'en';
        select.dispatchEvent(new Event('change'));
        const translated = {
          lang: document.documentElement.lang,
          analyze: document.querySelector('#analyze').textContent,
          bookLanguage: document.querySelector('[data-i18n="bookLanguage"]').textContent
        };
        select.value = 'ko';
        select.dispatchEvent(new Event('change'));
        return translated;
      })()`,
      returnByValue: true
    });
    assert.deepEqual(language.result.value, {
      lang: "en",
      analyze: "Start / resume analysis",
      bookLanguage: "Book language (BCP 47)"
    });
    const document = await cdp.call("DOM.getDocument");
    const input = await cdp.call("DOM.querySelector", {
      nodeId: document.root.nodeId,
      selector: "#pdf-input"
    });
    await cdp.call("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [pdfPath] });
    await cdp.call("Runtime.evaluate", {
      expression: "document.querySelector('#pdf-input').dispatchEvent(new Event('change', { bubbles: true }))"
    });

    let loadState;
    try {
      await waitFor(async () => {
      const result = await cdp.call("Runtime.evaluate", {
        expression: `({
          disabled: document.querySelector('#analyze').disabled,
          files: document.querySelector('#pdf-input').files.length,
          status: document.querySelector('#status').textContent,
          summary: document.querySelector('#pdf-summary').textContent
        })`,
        returnByValue: true
      });
        loadState = result.result.value;
        return !loadState.disabled;
      });
    } catch (error) {
      throw new Error(`${error.message}: ${JSON.stringify(loadState)}`);
    }
    await cdp.call("Runtime.evaluate", {
      expression: `(() => {
        document.querySelector('#base-url').value = 'http://127.0.0.1:${apiPort}/v1';
        document.querySelector('#model').value = 'mock-vision';
        document.querySelector('#concurrency').value = '2';
        document.querySelector('#analyze').click();
      })()`
    });
    let firstRun;
    try {
      firstRun = await waitFor(async () => {
      const evaluation = await cdp.call("Runtime.evaluate", {
        expression: `(() => {
          const status = document.querySelector('#status')?.textContent;
          return status.includes('실패한 페이지부터 이어집니다') && {
            order: [...document.querySelector('#results').children].map(item => item.dataset.page),
            cards: [...document.querySelectorAll('.page-card')].map(card => card.dataset.page),
            errors: [...document.querySelectorAll('.error-card')].map(card => card.dataset.page),
            status
          };
        })()`,
        returnByValue: true
      });
      return evaluation.result.value;
      }, 30000);
    } catch (error) {
      const diagnostic = await cdp.call("Runtime.evaluate", {
        expression: `({
          status: document.querySelector('#status')?.textContent,
          summary: document.querySelector('#pdf-summary')?.textContent,
          cards: [...document.querySelectorAll('.page-card')].map(card => card.dataset.page),
          errors: [...document.querySelectorAll('.error-card')].map(card => card.textContent)
        })`,
        returnByValue: true
      });
      throw new Error(`${error.message}: ${JSON.stringify(diagnostic.result.value)}`);
    }
    assert.deepEqual(firstRun, {
      order: ["1", "2", "3"],
      cards: ["1", "3"],
      errors: ["2"],
      status: "2페이지 완료 · 1페이지 실패. 다시 누르면 실패한 페이지부터 이어집니다."
    });

    await cdp.call("Runtime.evaluate", {
      expression: "document.querySelector('#analyze').click()"
    });
    const result = await waitFor(async () => {
      const evaluation = await cdp.call("Runtime.evaluate", {
        expression: `(() => {
          const cards = [...document.querySelectorAll('.page-card')];
          return cards.length === 3 && {
            order: cards.map(card => card.dataset.page),
            headings: cards.map(card => card.querySelector('.preview h1')?.textContent),
            status: document.querySelector('#status')?.textContent
          };
        })()`,
        returnByValue: true
      });
      return evaluation.result.value;
    }, 30000);
    assert.deepEqual(result, {
      order: ["1", "2", "3"],
      headings: ["Page 1", "Page 2", "Page 3"],
      status: "선택한 범위의 분석이 끝났습니다."
    });
    assert.equal(maximumRequests, 2);
    assert.deepEqual(Object.fromEntries(attemptsByPage), { 1: 1, 2: 4, 3: 1 });
    assert.equal(authorization, undefined);
    console.log("Electron smoke test passed");
  } finally {
    cdp?.close();
    electron.kill();
    api.close();
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
