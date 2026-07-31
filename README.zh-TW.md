# Scan to EPUB

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

一款 Electron 應用程式，可將乾淨的裁書掃描 PDF 重構為可重排的 EPUB 3 電子書。

## 功能

- 移除一般頁面的 PDF 頁面邊界，並將正文合併為連續的 XHTML。
- 將目錄、章節扉頁、裝飾版面、黑白反轉頁等難以無損重現的頁面保留為整頁圖像。
- 從原始算繪中裁切照片、插圖、公式和複雜表格並插入電子書。
- 將簡單表格轉換為安全的 XHTML 表格。
- 合併跨掃描頁延續的段落。
- 略過失敗頁面並繼續處理其餘頁面，下次執行時僅繼續分析失敗或未處理的頁面。
- 依指定數量平行處理請求，同時保持結果與原始順序一致。
- 可在應用程式中直接編輯辨識出的文字。
- 儲存包含封面、書名、作者、語言和目錄的 EPUB 3 檔案。
- UI 支援韓文、英文、簡體中文、繁體中文和日文。

## 使用方式

1. 安裝並執行 `Scan-to-EPUB-0.2.0-x64-setup.exe`。
2. 選擇 PDF，並指定要分析的頁面範圍。
3. 輸入 OpenAI 相容的 `/chat/completions` 位址和多模態模型名稱。
4. 使用遠端 API 時請輸入 API 金鑰；無需驗證的本機伺服器可留空。
5. 執行頁面分析，然後檢查並編輯結果。
6. 選擇「儲存 EPUB」。

API 金鑰不會被儲存，只有 API 位址和模型名稱會保留在本機應用程式設定中。
如果 Chat Completions 拒絕 Base64 圖像，應用程式會自動切換至同一伺服器的 Responses API。
安裝版應用程式會在啟動時檢查 GitHub Releases 並自動下載更新。
書籍語言請填寫 BCP 47 代碼。建議使用：韓文 `ko`、英文 `en`、日文 `ja`、簡體中文 `zh-Hans`、繁體中文 `zh-Hant`。

## 開發

```powershell
npm install
npm start
```

```powershell
npm test
npm run test:smoke
npm run dist
```

`npm run dist` 會產生支援自動更新的 NSIS 安裝程式。產生器的可重排／固定版面混合範例已通過 EPUBCheck 5.3.0 檢查，沒有錯誤或警告。
