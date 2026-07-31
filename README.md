# Scan to EPUB

[한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md)

An Electron app that reconstructs clean, destructively scanned PDFs as reflowable EPUB 3 ebooks.

## Features

- Removes PDF page boundaries from regular pages and merges the body into continuous XHTML.
- Preserves tables of contents, chapter covers, decorative layouts, reversed pages, and other designs that would lose fidelity as full-page images.
- Crops photos, illustrations, equations, and complex tables from the original rendering and inserts them into the ebook.
- Converts simple tables into safe XHTML tables.
- Joins paragraphs that continue across scanned pages.
- Skips failed pages, continues processing the rest, and resumes only failed or unprocessed pages on the next run.
- Processes the configured number of requests in parallel while keeping results in source order.
- Lets you edit recognized text directly in the app.
- Saves an EPUB 3 file with a cover, title, author, language, and table of contents.
- Supports Korean, English, Simplified Chinese, Traditional Chinese, and Japanese UI languages.

## Usage

1. Install and run `Scan-to-EPUB-0.2.0-x64-setup.exe`.
2. Select a PDF and choose the page range to analyze.
3. Enter an OpenAI-compatible `/chat/completions` URL and a multimodal model name.
4. Enter an API key for a remote API. Leave it blank for an unauthenticated local server.
5. Run the page analysis, then review and edit the results.
6. Select `Save EPUB`.

The API key is never stored. Only the API URL and model name remain in local app settings.
If Chat Completions rejects Base64 images, the app automatically falls back to the same server's Responses API.
The installed app checks GitHub Releases at startup and downloads updates automatically.
Enter a BCP 47 code for the book language. Recommended values are `ko` for Korean, `en` for English, `ja` for Japanese, `zh-Hans` for Simplified Chinese, and `zh-Hant` for Traditional Chinese.

## Development

```powershell
npm install
npm start
```

```powershell
npm test
npm run test:smoke
npm run dist
```

`npm run dist` creates an auto-updatable NSIS installer. The generator's mixed reflowable/fixed-layout sample passes EPUBCheck 5.3.0 with no errors or warnings.
