# Windows アプリのビルド

旧 game と同じ electron-serve + electron-builder の portable EXE 形式。
Next.js の静的出力 `out/` と素材を同梱し、サーバや Node.js のインストールなしで起動する。

SampleGame フォルダで実行する。
この PC の Node.js 20.17 でも実行できるよう、electron-builder は 26.0.12 に固定している。
Next.js / React / three などは静的出力を作るための devDependencies に置いている。
Web 版を含め、ビルド前のインストールでは `--omit=dev` を付けない。

```powershell
npm install
npm run electron:build
```

`electron:build` と `electron:pack` は必ず本番モードでビルドする。
`NEXT_PUBLIC_PRODUCTION=true` を自動設定し、開発用 UI を無効にする。

配布するファイルは `dist/SampleGame-0.1.0-x64.exe`（バージョンは package.json に従う）。
コード署名・独自アイコンは未設定。Windows の警告が出る場合がある。

## ローカルで確認

```powershell
npm run build:production
npm run electron:dev
```

`electron:dev` はビルド済みの out/ を開く。ホットリロードは行わない。
変更後は再度 `npm run build:production` を実行する。
EXE の圧縮を省いて確認する場合は `npm run electron:pack`。
`dist/win-unpacked/SampleGame.exe` が作られる（配布にはフォルダ全体が必要）。

開発用 UI を表示して確認したい場合だけ、`npm run build` の後に
`npm run electron:dev` で開く。

## 記録

既存の IndexedDB と localStorage を使用する。
Windows では `%APPDATA%/samplegame/` に保存され、EXE を置き換えても残る。
ブラウザ版・旧 game の記録とは別。EXE 単体を別の PC に移しても記録は移らない。
`app://samplegame` の origin と package.json の name は記録の保存先に関わるため、変更に注意。
Electron 内では PWA の Service Worker を登録しない。

参考: https://www.electron.build/v26/docs/win/
