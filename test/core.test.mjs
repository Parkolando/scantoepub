import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { createRequire } from "node:module";
import { makeSections, createEpub } from "../src/epub.mjs";
import { runPool } from "../src/pool.mjs";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const { analyzePage, endpoint, parseJson, validateAnalysis } = require("../src/openai.cjs");

const image = {
  id: "full-page-3",
  name: "full-page-3.jpg",
  mediaType: "image/jpeg",
  width: 1200,
  height: 1600,
  dataUrl: "data:image/jpeg;base64,/9j/2Q=="
};

test("normalizes OpenAI-compatible chat completion endpoints", () => {
  assert.equal(endpoint("https://example.com/v1"), "https://example.com/v1/chat/completions");
  assert.equal(endpoint("http://localhost:1234/v1/"), "http://localhost:1234/v1/chat/completions");
  assert.equal(endpoint("https://example.com/v1/chat/completions"), "https://example.com/v1/chat/completions");
  assert.throws(() => endpoint("file:///tmp/api"), /HTTP/);
});

test("parses fenced JSON and validates page analysis", () => {
  const value = validateAnalysis(parseJson('```json\n{"mode":"reflow","confidence":2,"blocks":[{"type":"paragraph","bbox":[-1,0,1001,900],"text":"본문"}]}\n```'));
  assert.equal(value.confidence, 1);
  assert.deepEqual(value.blocks[0].bbox, [0, 0, 1000, 900]);
  assert.throws(() => validateAnalysis({ mode: "unknown" }), /mode/);
});

test("falls back to Responses API when chat rejects data URLs", async () => {
  const requests = [];
  let responseAttempts = 0;
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => body += chunk);
    request.on("end", () => {
      requests.push({ url: request.url, body: JSON.parse(body) });
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/v1/chat/completions") {
        response.writeHead(400).end(JSON.stringify({
          error: { message: "URL scheme must be http or https, got data:" }
        }));
        return;
      }
      responseAttempts += 1;
      if (responseAttempts === 1) {
        response.writeHead(500).end(JSON.stringify({
          error: { message: "temporary failure" }
        }));
        return;
      }
      response.end(JSON.stringify({
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: JSON.stringify({
              mode: "reflow",
              reason: "linear text",
              confidence: 0.9,
              blocks: [{ type: "paragraph", bbox: [0, 0, 1000, 1000], text: "본문" }]
            })
          }]
        }]
      }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const result = await analyzePage({
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      apiKey: "test",
      model: "vision",
      imageDataUrl: "data:image/jpeg;base64,AA==",
      pageNumber: 1,
      totalPages: 1,
      previousTail: ""
    });
    assert.equal(result.blocks[0].text, "본문");
    assert.deepEqual(requests.map((request) => request.url), [
      "/v1/chat/completions",
      "/v1/responses",
      "/v1/responses"
    ]);
    assert.equal(requests[2].body.input[0].content[1].type, "input_image");
  } finally {
    server.close();
  }
});

test("limits parallel work and returns results in input order", async () => {
  let active = 0;
  let maximum = 0;
  const results = await runPool([1, 2, 3, 4, 5], 3, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, (6 - value) * 5));
    active -= 1;
    return value * 2;
  });
  assert.equal(maximum, 3);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});

test("removes source page boundaries but preserves designed full pages", () => {
  const pages = [
    {
      analysis: { mode: "reflow" },
      blocks: [{ type: "paragraph", text: "앞 문장", continuesToNext: true }]
    },
    {
      analysis: { mode: "reflow" },
      blocks: [{ type: "paragraph", text: "뒷 문장", continuesFromPrevious: true, joinWithPrevious: "space" }]
    },
    {
      analysis: { mode: "full_page_image", altText: "장식 페이지" },
      fullImage: image,
      blocks: []
    },
    {
      analysis: { mode: "reflow" },
      blocks: [{ type: "paragraph", text: "다음 장" }]
    }
  ];
  const sections = makeSections(pages);
  assert.equal(sections.length, 3);
  assert.equal(sections[0].blocks.length, 1);
  assert.equal(sections[0].blocks[0].text, "앞 문장 뒷 문장");
  assert.equal(sections[1].kind, "fixed");
  assert.equal(sections[2].blocks[0].text, "다음 장");
});

test("creates a valid EPUB-shaped archive with mixed-layout spine", async () => {
  const pages = [
    {
      number: 1,
      analysis: { mode: "reflow" },
      blocks: [
        { type: "heading", text: "첫 장", level: 1 },
        { type: "paragraph", text: "안전한 & 본문" },
        { type: "table", rows: [["<script>", "값"]], headerRows: 1 }
      ],
      coverImage: { ...image, id: "cover-page-1", name: "cover-page-1.jpg" }
    },
    {
      number: 2,
      analysis: { mode: "reflow" },
      blocks: [{ type: "paragraph", text: "연속 본문" }]
    },
    {
      number: 3,
      analysis: { mode: "full_page_image", altText: "검은 배경 장식 페이지" },
      fullImage: image,
      blocks: []
    }
  ];
  const bytes = await createEpub(JSZip, pages, {
    title: "테스트 책",
    author: "테스터",
    language: "ko",
    useFirstPageAsCover: true,
    modified: "2026-01-01T00:00:00Z"
  });

  assert.equal(new TextDecoder().decode(bytes.slice(30, 38)), "mimetype");
  assert.equal(bytes[8], 0);
  assert.equal(bytes[9], 0);

  const zip = await JSZip.loadAsync(bytes);
  assert.ok(zip.file("META-INF/container.xml"));
  assert.ok(zip.file("EPUB/package.opf"));
  assert.ok(zip.file("EPUB/nav.xhtml"));
  assert.ok(zip.file("EPUB/text/section-001.xhtml"));
  assert.ok(zip.file("EPUB/text/section-002.xhtml"));
  assert.equal(zip.file("EPUB/text/section-003.xhtml"), null);

  const opf = await zip.file("EPUB/package.opf").async("string");
  assert.match(opf, /rendition:layout-pre-paginated/);
  assert.match(opf, /media-type="application\/xhtml\+xml" properties="svg"/);
  assert.match(opf, /properties="cover-image"/);
  const flow = await zip.file("EPUB/text/section-001.xhtml").async("string");
  assert.match(flow, /안전한 &amp; 본문/);
  assert.match(flow, /&lt;script&gt;/);
  assert.doesNotMatch(flow, /<script>/);
});
