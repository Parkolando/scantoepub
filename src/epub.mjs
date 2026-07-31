export function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function joinText(left, right, joiner) {
  if (!left) return right;
  if (!right) return left;
  if (joiner === "none") return left.replace(/[-‐‑]\s*$/, "") + right.replace(/^\s+/, "");
  return `${left.trimEnd()} ${right.trimStart()}`;
}

export function makeSections(pages) {
  const sections = [];
  let flow = [];

  const flush = () => {
    if (!flow.length) return;
    sections.push({ kind: "reflow", blocks: flow });
    flow = [];
  };

  for (const page of pages) {
    if (!page?.analysis) continue;
    if (page.analysis.mode === "full_page_image") {
      flush();
      if (page.fullImage) {
        sections.push({
          kind: "fixed",
          image: page.fullImage,
          alt: page.analysis.altText || "원본 디자인을 보존한 페이지"
        });
      }
      continue;
    }

    for (const source of page.blocks || []) {
      if (source.type === "page_number") continue;
      const block = structuredClone(source);
      const previous = flow.at(-1);
      if (
        block.type === "paragraph" &&
        previous?.type === "paragraph" &&
        (block.continuesFromPrevious || previous.continuesToNext)
      ) {
        previous.text = joinText(previous.text, block.text, block.joinWithPrevious);
        previous.continuesToNext = block.continuesToNext;
      } else {
        flow.push(block);
      }
    }
  }
  flush();
  return sections;
}

function renderTable(block) {
  const rows = block.rows || [];
  const headerRows = Math.min(block.headerRows || 0, rows.length);
  const renderRows = (items, header) => items.map((row) =>
    `<tr>${row.map((cell) => header
      ? `<th scope="col">${escapeXml(cell)}</th>`
      : `<td>${escapeXml(cell)}</td>`).join("")}</tr>`
  ).join("");
  const head = headerRows ? `<thead>${renderRows(rows.slice(0, headerRows), true)}</thead>` : "";
  return `<table>${head}<tbody>${renderRows(rows.slice(headerRows), false)}</tbody></table>`;
}

function renderFlow(section, sectionIndex, headings) {
  let html = "";
  let list = null;
  const closeList = () => {
    if (list) html += `</${list}>`;
    list = null;
  };

  for (const block of section.blocks) {
    if (block.type === "list_item") {
      const next = block.ordered ? "ol" : "ul";
      if (list !== next) {
        closeList();
        list = next;
        html += `<${list}>`;
      }
      html += `<li>${escapeXml(block.text)}</li>`;
      continue;
    }
    closeList();

    if (block.type === "heading") {
      const id = `heading-${headings.length + 1}`;
      headings.push({
        label: block.text || "제목",
        href: `text/section-${String(sectionIndex + 1).padStart(3, "0")}.xhtml#${id}`,
        level: block.level || 2
      });
      html += `<h${block.level} id="${id}">${escapeXml(block.text)}</h${block.level}>`;
    } else if (block.type === "paragraph") {
      html += `<p>${escapeXml(block.text)}</p>`;
    } else if (block.type === "table") {
      html += renderTable(block);
    } else if (block.type === "image" && block.asset) {
      html += `<figure><img src="../images/${escapeXml(block.asset.name)}" alt="${escapeXml(block.alt)}"/></figure>`;
    }
  }
  closeList();
  return html;
}

function xhtml(title, language, body, viewport = "") {
  const metaViewport = viewport ? `<meta name="viewport" content="${viewport}"/>` : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(language)}" xml:lang="${escapeXml(language)}">
<head>
  <meta charset="utf-8"/>
  ${metaViewport}
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body>${body}</body>
</html>`;
}

function dataUrlBytes(dataUrl) {
  const base64 = String(dataUrl).split(",", 2)[1];
  if (!base64) throw new Error("이미지 데이터가 올바르지 않습니다.");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function uuid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

const BOOK_CSS = `@charset "utf-8";
body { font-family: serif; line-height: 1.72; margin: 5%; overflow-wrap: break-word; }
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.8em 0 .8em; break-after: avoid; }
p { margin: 0 0 .8em; text-indent: 1em; }
figure { margin: 1.2em auto; text-align: center; break-inside: avoid; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; margin: 1em auto; max-width: 100%; }
th, td { border: 1px solid currentColor; padding: .35em .55em; vertical-align: top; }
.fixed-page { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
.fixed-page svg { display: block; width: 100%; height: 100%; }`;

export async function createEpub(JSZip, pages, metadata) {
  const sections = makeSections(pages);
  if (!sections.length) throw new Error("내보낼 분석 결과가 없습니다.");

  const title = metadata.title?.trim() || "제목 없음";
  const author = metadata.author?.trim() || "저자 미상";
  const language = metadata.language?.trim() || "ko";
  const identifier = `urn:uuid:${uuid()}`;
  const modified = metadata.modified || new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const headings = [];
  const assets = new Map();
  const sectionFiles = [];

  pages.forEach((page) => {
    if (page.fullImage) assets.set(page.fullImage.id, page.fullImage);
    if (page.coverImage) assets.set(page.coverImage.id, page.coverImage);
    (page.blocks || []).forEach((block) => {
      if (block.asset) assets.set(block.asset.id, block.asset);
    });
  });

  sections.forEach((section, index) => {
    const number = String(index + 1).padStart(3, "0");
    const file = `section-${number}.xhtml`;
    if (section.kind === "fixed") {
      const { width, height, name } = section.image;
      const body = `<div class="fixed-page"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeXml(section.alt)}"><image href="../images/${escapeXml(name)}" width="${width}" height="${height}"/></svg></div>`;
      sectionFiles.push({
        file,
        fixed: true,
        content: xhtml(title, language, body, `width=${width},height=${height}`)
      });
    } else {
      const body = renderFlow(section, index, headings);
      sectionFiles.push({ file, fixed: false, content: xhtml(title, language, body) });
    }
  });

  const firstPage = pages.find((page) => page?.analysis);
  const cover = metadata.useFirstPageAsCover ? firstPage?.coverImage || firstPage?.fullImage : null;
  if (cover) assets.set(cover.id, cover);

  const manifestSections = sectionFiles.map((section, index) =>
    `<item id="section-${index + 1}" href="text/${section.file}" media-type="application/xhtml+xml"${section.fixed ? ' properties="svg"' : ""}/>`
  ).join("\n    ");
  const spine = sectionFiles.map((section, index) =>
    `<itemref idref="section-${index + 1}"${section.fixed ? ' properties="rendition:layout-pre-paginated rendition:spread-none"' : ""}/>`
  ).join("\n    ");
  const manifestImages = [...assets.values()].map((asset) =>
    `<item id="${escapeXml(asset.id)}" href="images/${escapeXml(asset.name)}" media-type="${escapeXml(asset.mediaType)}"${cover?.id === asset.id ? ' properties="cover-image"' : ""}/>`
  ).join("\n    ");

  const navItems = headings.length
    ? headings.map((heading) => `<li><a href="${escapeXml(heading.href)}">${escapeXml(heading.label)}</a></li>`).join("")
    : `<li><a href="text/${sectionFiles[0].file}">${escapeXml(title)}</a></li>`;
  const nav = xhtml(title, language,
    `<nav epub:type="toc" id="toc"><h1>목차</h1><ol>${navItems}</ol></nav>`
  ).replace('href="../styles/book.css"', 'href="styles/book.css"');

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${escapeXml(language)}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
    <meta property="rendition:layout">reflowable</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="styles/book.css" media-type="text/css"/>
    ${manifestSections}
    ${manifestImages}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`;

  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", container);
  zip.file("EPUB/package.opf", opf);
  zip.file("EPUB/nav.xhtml", nav);
  zip.file("EPUB/styles/book.css", BOOK_CSS);
  sectionFiles.forEach((section) => zip.file(`EPUB/text/${section.file}`, section.content));
  assets.forEach((asset) => zip.file(`EPUB/images/${asset.name}`, dataUrlBytes(asset.dataUrl)));

  return zip.generateAsync({
    type: "uint8array",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "UNIX"
  });
}
