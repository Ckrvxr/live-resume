# Live Resume

静态简历，直接打开 `index.html` 即可浏览。

## 测试

需要 Node.js 22.13+（或 24+）及 `agent-browser` 0.36.0+ CLI。

```sh
# macOS 安装浏览器工具；其他平台可用 pnpm add -g agent-browser@0.36.0
brew install agent-browser
agent-browser install

# 按已有 package-lock.json 安装测试依赖
npm ci
pnpm test
```

浏览器测试通过 `agent-browser` CLI 运行，使用独立会话，结束后自动关闭。覆盖只读状态、二维码、Markdown 导出、打印按钮、响应式布局及单页 A4 PDF 的文字和链接。

CLI 尚未提供打印媒体模拟及 A4 PDF 参数，这两项通过 `agent-browser get cdp-url` 返回的同一浏览器连接完成，无需额外浏览器自动化库。`pdfjs-dist` 仅用于校验生成的 PDF。

截图和导出文件保存在已忽略的 `test-results/agent-browser-*/` 中。
