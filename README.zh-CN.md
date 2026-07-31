# Scan to EPUB

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [繁體中文](README.zh-TW.md)

一款 Electron 应用，可将干净的拆书扫描 PDF 重构为可重排的 EPUB 3 电子书。

## 功能

- 移除普通页面的 PDF 页面边界，并将正文合并为连续的 XHTML。
- 将目录、章节扉页、装饰版式、黑白反转页等难以无损重现的页面保留为整页图像。
- 从原始渲染中裁剪照片、插图、公式和复杂表格并插入电子书。
- 将简单表格转换为安全的 XHTML 表格。
- 合并跨扫描页延续的段落。
- 跳过失败页面并继续处理其余页面，下次运行时仅继续分析失败或未处理的页面。
- 按指定数量并行处理请求，同时保持结果与原始顺序一致。
- 可在应用中直接编辑识别出的文本。
- 保存包含封面、书名、作者、语言和目录的 EPUB 3 文件。
- UI 支持韩语、英语、简体中文、繁体中文和日语。

## 使用方法

1. 安装并运行 `Scan-to-EPUB-0.2.0-x64-setup.exe`。
2. 选择 PDF，并指定要分析的页面范围。
3. 输入 OpenAI 兼容的 `/chat/completions` 地址和多模态模型名称。
4. 使用远程 API 时请输入 API 密钥；无需认证的本地服务器可留空。
5. 运行页面分析，然后检查并编辑结果。
6. 选择“保存 EPUB”。

API 密钥不会被保存，只有 API 地址和模型名称会保留在本地应用设置中。
如果 Chat Completions 拒绝 Base64 图像，应用会自动切换到同一服务器的 Responses API。
安装版应用会在启动时检查 GitHub Releases 并自动下载更新。
书籍语言请填写 BCP 47 代码。推荐使用：韩语 `ko`、英语 `en`、日语 `ja`、简体中文 `zh-Hans`、繁体中文 `zh-Hant`。

## 开发

```powershell
npm install
npm start
```

```powershell
npm test
npm run test:smoke
npm run dist
```

`npm run dist` 会生成支持自动更新的 NSIS 安装程序。生成器的可重排／固定版式混合示例已通过 EPUBCheck 5.3.0 检查，没有错误或警告。
