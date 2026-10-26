# MCP接続

**MCP接続の権限は渡したAPIキーと同じです。owner/adminキーで接続するとDM送信・一斉配信・設定変更が可能です。** AIクライアント側でも実送信前に内容・宛先を確認してください。

```json
{
  "mcpServers": {
    "ig-harness": {
      "command": "npx",
      "args": ["-y", "@ig-harness/mcp-server"],
      "env": {
        "IG_HARNESS_API_URL": "https://your-worker.workers.dev",
        "IG_HARNESS_API_KEY": "YOUR_PRIVATE_KEY",
        "IG_HARNESS_ACCOUNT_ID": "YOUR_ACCOUNT_ID",
        "IG_HARNESS_READ_ONLY": "true"
      }
    }
  }
}
```

未公開の修正版を確認する際はnpxではなく、ローカルでSDK/MCPをbuildし `command: node` と `args: ["/absolute/path/packages/mcp-server/dist/index.js"]` を使う。公開パッケージに修正が入るまでは、この説明の新しいオプションを旧版が扱えるとは限らない。

Claude Codeはrepoの `.mcp.json`、Cursorは `.cursor/mcp.json`、Claude Desktopは `claude_desktop_config.json` のmcpServersに統合する。ウィザードは固定名 `ig-harness` の設定と、Cursor/Desktop向け `.ig-harness-mcp-clients.json` を0600で生成する。不正JSONを上書きしない。既存設定のbackupも秘密として扱う。

`IG_HARNESS_READ_ONLY=true` の場合、一覧・詳細・集計の7ツールだけ登録する。writeとreadが混在するmanageツールも除外する。`IG_HARNESS_ACCOUNT_ID` を省くと既定account。旧 `INSTAGRAM_HARNESS_*` は互換aliasとして読み、警告を出す。`LINE_HARNESS_*` は使用しない。env不足はstdio接続前にエラーにする。

Instagram broadcastはtext/image/template/quick_replyとall/tagが対象。LINE Flexとsegment送信は未実装で、成功したようには扱わない。
