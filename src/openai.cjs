const SYSTEM_PROMPT = `You reconstruct scanned book pages into accessible EPUB 3 content.
Return JSON only. Preserve the source language and wording exactly.

First choose mode:
- "reflow": mostly linear content that should join the continuous ebook text flow.
- "full_page_image": fidelity would be materially lost by rebuilding the page. Use this for
  decorative tables of contents, chapter/title interstitials, ornamental compositions,
  reversed white-on-black designs, text integrated with artwork, or uncertain reading order.

Source PDF page boundaries are not ebook page boundaries. For reflow pages:
- Ignore running headers, footers, and printed page numbers.
- Return blocks in reading order.
- Use normalized bbox coordinates [left, top, right, bottom] from 0 to 1000.
- Mark photographs, illustrations, equations, charts, and complex tables as "image".
- Represent only simple tables as "table" with rows. Never emit HTML.
- If a paragraph continues across a scan-page boundary, set continuesFromPrevious,
  joinWithPrevious ("space" or "none"), and/or continuesToNext accurately.

Schema:
{
  "mode": "reflow" | "full_page_image",
  "reason": "short reason",
  "confidence": 0.0-1.0,
  "altText": "page summary for full_page_image, otherwise empty",
  "blocks": [
    {
      "type": "heading" | "paragraph" | "list_item" | "table" | "image" | "page_number",
      "bbox": [0, 0, 1000, 1000],
      "text": "exact text when applicable",
      "level": 1-6,
      "ordered": false,
      "rows": [["cell"]],
      "headerRows": 0,
      "alt": "image description",
      "continuesFromPrevious": false,
      "continuesToNext": false,
      "joinWithPrevious": "space" | "none"
    }
  ]
}`;

function endpoint(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("API 주소가 올바른 URL이 아닙니다.");
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("API 주소는 HTTP 또는 HTTPS여야 합니다.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/chat/completions")) {
    url.pathname += "/chat/completions";
  }
  return url.toString();
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || "").join("");
  }
  return "";
}

function parseJson(content) {
  const text = contentText(content).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("모델이 JSON 형식으로 응답하지 않았습니다.");
  }
}

function validateAnalysis(value) {
  if (!value || !["reflow", "full_page_image"].includes(value.mode)) {
    throw new Error("응답의 mode가 올바르지 않습니다.");
  }
  value.reason = String(value.reason || "");
  value.altText = String(value.altText || "");
  value.confidence = Math.max(0, Math.min(1, Number(value.confidence) || 0));
  if (value.mode === "full_page_image") {
    value.blocks = [];
    return value;
  }
  if (!Array.isArray(value.blocks)) throw new Error("응답에 blocks 배열이 없습니다.");

  const types = new Set(["heading", "paragraph", "list_item", "table", "image", "page_number"]);
  value.blocks = value.blocks.filter((block) => {
    if (!block || !types.has(block.type) || !Array.isArray(block.bbox) || block.bbox.length !== 4) {
      return false;
    }
    block.bbox = block.bbox.map((number) => Math.max(0, Math.min(1000, Number(number) || 0)));
    if (block.bbox[2] <= block.bbox[0] || block.bbox[3] <= block.bbox[1]) return false;
    block.text = String(block.text || "");
    block.alt = String(block.alt || "");
    block.level = Math.max(1, Math.min(6, Number(block.level) || 2));
    block.ordered = Boolean(block.ordered);
    block.headerRows = Math.max(0, Number(block.headerRows) || 0);
    block.continuesFromPrevious = Boolean(block.continuesFromPrevious);
    block.continuesToNext = Boolean(block.continuesToNext);
    block.joinWithPrevious = block.joinWithPrevious === "none" ? "none" : "space";
    if (block.type === "table") {
      block.rows = Array.isArray(block.rows)
        ? block.rows.map((row) => Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : [])
        : [];
    }
    return true;
  });
  return value;
}

async function requestAnalysis(url, apiKey, body) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `${response.status} ${response.statusText}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function analyzePage({ baseUrl, apiKey, model, imageDataUrl, pageNumber, totalPages, previousTail }) {
  if (!model || !imageDataUrl) throw new Error("모델과 페이지 이미지가 필요합니다.");
  const url = endpoint(baseUrl);
  const body = {
    model,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Scan page ${pageNumber} of ${totalPages}. Previous extracted tail for continuity:\n${previousTail || "(none)"}`
          },
          { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } }
        ]
      }
    ],
    response_format: { type: "json_object" }
  };

  let payload;
  try {
    payload = await requestAnalysis(url, apiKey, body);
  } catch (error) {
    if (error.status !== 400) throw error;
    delete body.response_format;
    payload = await requestAnalysis(url, apiKey, body);
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("모델 응답에 content가 없습니다.");
  return validateAnalysis(parseJson(content));
}

module.exports = { analyzePage, endpoint, parseJson, validateAnalysis };
