import * as pdfjs from "../node_modules/pdfjs-dist/build/pdf.mjs";
import { createEpub } from "./epub.mjs";
import { runPool } from "./pool.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "../node_modules/pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).href;

const $ = (selector) => document.querySelector(selector);
const elements = {
  pdfInput: $("#pdf-input"),
  fileLabel: $("#file-label"),
  pdfSummary: $("#pdf-summary"),
  rangeStart: $("#range-start"),
  rangeEnd: $("#range-end"),
  baseUrl: $("#base-url"),
  model: $("#model"),
  apiKey: $("#api-key"),
  concurrency: $("#concurrency"),
  title: $("#book-title"),
  author: $("#book-author"),
  language: $("#book-language"),
  useCover: $("#use-cover"),
  analyze: $("#analyze"),
  cancel: $("#cancel"),
  export: $("#export"),
  progress: $("#progress-bar"),
  status: $("#status"),
  count: $("#result-count"),
  empty: $("#empty-state"),
  results: $("#results"),
  toast: $("#toast")
};

const state = {
  pdf: null,
  fileName: "",
  pages: [],
  running: false,
  canceled: false
};

elements.baseUrl.value = localStorage.getItem("baseUrl") || elements.baseUrl.value;
elements.model.value = localStorage.getItem("model") || "";
elements.concurrency.value = localStorage.getItem("concurrency") || "3";

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2800);
}

function errorText(error) {
  return error?.message || String(error);
}

function safeFileName(name) {
  return (name || "book").replace(/\.pdf$/i, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
}

function updateControls() {
  const analyzed = state.pages.filter((page) => page.analysis).length;
  elements.analyze.disabled = !state.pdf || state.running;
  elements.cancel.disabled = !state.running;
  elements.export.disabled = analyzed === 0 || state.running;
  elements.count.textContent = `${analyzed}개 분석됨`;
  elements.empty.hidden = analyzed > 0 || state.pages.some((page) => page.error);
}

function resizeCanvas(source, maxDimension) {
  const scale = Math.min(1, maxDimension / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext("2d", { alpha: false }).drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function imageAsset(id, canvas, quality = 0.9) {
  return {
    id,
    name: `${id}.jpg`,
    mediaType: "image/jpeg",
    width: canvas.width,
    height: canvas.height,
    dataUrl: canvas.toDataURL("image/jpeg", quality)
  };
}

function cropAsset(canvas, bbox, id) {
  const [left, top, right, bottom] = bbox;
  const x = Math.max(0, Math.floor(canvas.width * left / 1000));
  const y = Math.max(0, Math.floor(canvas.height * top / 1000));
  const width = Math.max(1, Math.min(canvas.width - x, Math.ceil(canvas.width * (right - left) / 1000)));
  const height = Math.max(1, Math.min(canvas.height - y, Math.ceil(canvas.height * (bottom - top) / 1000)));
  const crop = document.createElement("canvas");
  crop.width = width;
  crop.height = height;
  crop.getContext("2d", { alpha: false }).drawImage(canvas, x, y, width, height, 0, 0, width, height);
  return imageAsset(id, crop, 0.92);
}

async function renderPdfPage(number) {
  const page = await state.pdf.getPage(number);
  const viewport = page.getViewport({ scale: 2.35 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  page.cleanup();
  return canvas;
}

function tailFrom(page) {
  return (page?.blocks || [])
    .filter((block) => ["heading", "paragraph", "list_item"].includes(block.type))
    .map((block) => block.text)
    .join("\n")
    .slice(-800);
}

function editableText(element, page, block) {
  element.contentEditable = "true";
  element.spellcheck = false;
  element.addEventListener("input", () => {
    block.text = element.textContent;
    page.edited = true;
  });
}

function renderTable(block) {
  const table = document.createElement("table");
  (block.rows || []).forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    row.forEach((value) => {
      const cell = document.createElement(rowIndex < block.headerRows ? "th" : "td");
      cell.textContent = value;
      tr.append(cell);
    });
    table.append(tr);
  });
  return table;
}

function pageCard(page) {
  const card = document.createElement("article");
  card.className = "page-card";
  card.dataset.page = page.number;

  const head = document.createElement("div");
  head.className = "page-card-head";
  const title = document.createElement("div");
  title.className = "page-title";
  title.append(`스캔 ${page.number}`);
  const badge = document.createElement("span");
  badge.className = `badge ${page.analysis.mode === "full_page_image" ? "fixed" : ""}`;
  badge.textContent = page.analysis.mode === "full_page_image" ? "전체 이미지" : "연속 텍스트";
  title.append(badge);
  const confidence = document.createElement("span");
  confidence.className = "confidence";
  confidence.textContent = `신뢰도 ${Math.round(page.analysis.confidence * 100)}%`;
  const retry = document.createElement("button");
  retry.className = "retry";
  retry.textContent = "다시 분석";
  retry.addEventListener("click", () => retryPage(page.number));
  head.append(title, confidence, retry);

  const grid = document.createElement("div");
  grid.className = "page-grid";
  const source = document.createElement("div");
  source.className = "source";
  const sourceImage = document.createElement("img");
  sourceImage.src = page.thumbnail;
  sourceImage.alt = `원본 스캔 ${page.number}`;
  source.append(sourceImage);

  const preview = document.createElement("div");
  preview.className = "preview";
  const reason = document.createElement("p");
  reason.className = "reason";
  reason.textContent = page.analysis.reason;
  preview.append(reason);

  if (page.analysis.mode === "full_page_image") {
    const image = document.createElement("img");
    image.className = "full-preview";
    image.src = page.fullImage.dataUrl;
    image.alt = page.analysis.altText;
    preview.append(image);
  } else {
    for (const block of page.blocks) {
      let element;
      if (block.type === "heading") {
        element = document.createElement(`h${block.level}`);
        element.textContent = block.text;
        editableText(element, page, block);
      } else if (block.type === "paragraph") {
        element = document.createElement("p");
        element.textContent = block.text;
        editableText(element, page, block);
      } else if (block.type === "list_item") {
        element = document.createElement("li");
        element.textContent = block.text;
        editableText(element, page, block);
      } else if (block.type === "table") {
        element = renderTable(block);
      } else if (block.type === "image" && block.asset) {
        element = document.createElement("figure");
        const image = document.createElement("img");
        image.src = block.asset.dataUrl;
        image.alt = block.alt;
        element.append(image);
      }
      if (element) preview.append(element);
    }
  }

  grid.append(source, preview);
  card.append(head, grid);
  return card;
}

function renderError(page) {
  const card = document.createElement("article");
  card.className = "error-card";
  card.dataset.page = page.number;
  const message = document.createElement("strong");
  message.textContent = `스캔 ${page.number}: ${page.error}`;
  const retry = document.createElement("button");
  retry.className = "retry";
  retry.textContent = "다시 시도";
  retry.addEventListener("click", () => retryPage(page.number));
  card.append(message, " ", retry);
  return card;
}

function replaceResult(page) {
  elements.results.querySelector(`[data-page="${page.number}"]`)?.remove();
  const card = page.analysis ? pageCard(page) : renderError(page);
  const next = [...elements.results.children].find((item) => Number(item.dataset.page) > page.number);
  elements.results.insertBefore(card, next || null);
  updateControls();
}

async function processPage(number, previousTail = "") {
  const pageState = state.pages[number - 1];
  pageState.error = "";
  elements.status.textContent = `${number}페이지를 렌더링하는 중…`;
  const canvas = await renderPdfPage(number);
  const thumbnailCanvas = resizeCanvas(canvas, 320);
  const analysisCanvas = resizeCanvas(canvas, 1800);
  pageState.thumbnail = thumbnailCanvas.toDataURL("image/jpeg", 0.78);

  const analysis = await window.desktop.analyzePage({
    baseUrl: elements.baseUrl.value.trim(),
    apiKey: elements.apiKey.value.trim(),
    model: elements.model.value.trim(),
    imageDataUrl: analysisCanvas.toDataURL("image/jpeg", 0.86),
    pageNumber: number,
    totalPages: state.pages.length,
    previousTail
  });

  pageState.analysis = analysis;
  pageState.blocks = structuredClone(analysis.blocks);
  pageState.fullImage = null;
  pageState.coverImage = number === 1
    ? imageAsset("cover-page-1", canvas, 0.92)
    : null;

  if (analysis.mode === "full_page_image") {
    pageState.fullImage = imageAsset(`full-page-${number}`, canvas, 0.92);
  } else {
    pageState.blocks = pageState.blocks.map((block, index) => {
      if (block.type === "table" && (!block.rows || !block.rows.length)) block.type = "image";
      if (block.type === "image") {
        block.asset = cropAsset(canvas, block.bbox, `page-${number}-image-${index + 1}`);
      }
      return block;
    });
  }
  canvas.width = canvas.height = 1;
  replaceResult(pageState);
  return tailFrom(pageState);
}

async function retryPage(number) {
  if (state.running) return;
  if (!elements.model.value.trim()) {
    toast("모델을 입력하세요.");
    return;
  }
  state.running = true;
  updateControls();
  try {
    const previous = number > 1 ? tailFrom(state.pages[number - 2]) : "";
    await processPage(number, previous);
    elements.status.textContent = `${number}페이지를 다시 분석했습니다.`;
  } catch (error) {
    const page = state.pages[number - 1];
    page.analysis = null;
    page.error = errorText(error);
    replaceResult(page);
    elements.status.textContent = "다시 분석하지 못했습니다.";
  } finally {
    state.running = false;
    updateControls();
  }
}

elements.pdfInput.addEventListener("change", async () => {
  const file = elements.pdfInput.files[0];
  if (!file) return;
  try {
    elements.status.textContent = "PDF를 여는 중…";
    const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    state.pdf = await loading.promise;
    state.fileName = file.name;
    state.pages = Array.from({ length: state.pdf.numPages }, (_, index) => ({
      number: index + 1,
      analysis: null,
      blocks: [],
      error: ""
    }));
    elements.fileLabel.textContent = file.name;
    elements.pdfSummary.textContent = `${state.pdf.numPages.toLocaleString()}쪽 · 원본 페이지 경계는 출력에서 제거됩니다.`;
    elements.rangeStart.max = elements.rangeEnd.max = state.pdf.numPages;
    elements.rangeStart.value = 1;
    elements.rangeEnd.value = state.pdf.numPages;
    elements.title.value = safeFileName(file.name);
    elements.results.replaceChildren();
    elements.progress.style.width = "0%";
    elements.status.textContent = "분석할 범위와 API를 확인하세요.";
    updateControls();
  } catch (error) {
    state.pdf = null;
    elements.status.textContent = `PDF를 열지 못했습니다: ${errorText(error)}`;
    updateControls();
  }
});

elements.analyze.addEventListener("click", async () => {
  const start = Math.max(1, Number(elements.rangeStart.value) || 1);
  const end = Math.min(state.pages.length, Number(elements.rangeEnd.value) || state.pages.length);
  const concurrency = Math.max(1, Math.min(12, Math.floor(Number(elements.concurrency.value) || 1)));
  if (start > end) return toast("페이지 범위를 확인하세요.");
  if (!elements.baseUrl.value.trim() || !elements.model.value.trim()) {
    return toast("API 주소와 모델을 입력하세요.");
  }
  const pending = state.pages
    .slice(start - 1, end)
    .filter((page) => !page.analysis)
    .map((page) => page.number);
  if (!pending.length) {
    elements.status.textContent = "선택한 범위는 이미 모두 분석됐습니다.";
    return toast("실패하거나 미처리된 페이지가 없습니다.");
  }

  localStorage.setItem("baseUrl", elements.baseUrl.value.trim());
  localStorage.setItem("model", elements.model.value.trim());
  localStorage.setItem("concurrency", concurrency);
  elements.concurrency.value = concurrency;
  state.running = true;
  state.canceled = false;
  updateControls();
  let completed = 0;
  let failed = 0;

  await runPool(pending, concurrency, async (number) => {
    // ponytail: parallel pages use prior OCR only when already available; add paired-page context if measured continuity quality needs it.
    const previousTail = number > 1 ? tailFrom(state.pages[number - 2]) : "";
    try {
      await processPage(number, previousTail);
    } catch (error) {
      const page = state.pages[number - 1];
      page.analysis = null;
      page.error = errorText(error);
      replaceResult(page);
      failed += 1;
    } finally {
      completed += 1;
      elements.progress.style.width = `${completed / pending.length * 100}%`;
      elements.status.textContent = `병렬 분석 중… ${completed}/${pending.length} 완료${failed ? ` · 실패 ${failed}` : ""}`;
    }
  }, () => state.canceled);

  state.running = false;
  const remaining = state.pages.slice(start - 1, end).filter((page) => !page.analysis).length;
  if (state.canceled) {
    elements.status.textContent = `분석을 중지했습니다. ${remaining}페이지가 남았습니다. 다시 누르면 이어집니다.`;
  } else if (failed) {
    elements.status.textContent = `${completed - failed}페이지 완료 · ${failed}페이지 실패. 다시 누르면 실패한 페이지부터 이어집니다.`;
  } else {
    elements.status.textContent = "선택한 범위의 분석이 끝났습니다.";
  }
  updateControls();
});

elements.cancel.addEventListener("click", () => {
  state.canceled = true;
  elements.cancel.disabled = true;
  elements.status.textContent = "진행 중인 요청이 끝나면 중지합니다…";
});

elements.export.addEventListener("click", async () => {
  const analyzed = state.pages.filter((page) => page.analysis);
  if (!analyzed.length) return;
  if (analyzed.length !== state.pages.length && !confirm(`전체 ${state.pages.length}쪽 중 ${analyzed.length}쪽만 분석됐습니다. 이 결과만 EPUB으로 저장할까요?`)) {
    return;
  }
  try {
    elements.status.textContent = "EPUB 파일을 만드는 중…";
    const bytes = await createEpub(window.JSZip, state.pages, {
      title: elements.title.value,
      author: elements.author.value,
      language: elements.language.value,
      useFirstPageAsCover: elements.useCover.checked
    });
    const filePath = await window.desktop.saveEpub({
      bytes,
      defaultName: `${safeFileName(elements.title.value || state.fileName)}.epub`
    });
    if (filePath) {
      elements.status.textContent = `저장 완료: ${filePath}`;
      toast("EPUB 저장 완료");
      if (confirm("저장된 파일을 폴더에서 볼까요?")) window.desktop.showFile(filePath);
    } else {
      elements.status.textContent = "저장을 취소했습니다.";
    }
  } catch (error) {
    elements.status.textContent = `EPUB 생성 실패: ${errorText(error)}`;
  }
});

updateControls();
document.documentElement.dataset.appReady = "true";
