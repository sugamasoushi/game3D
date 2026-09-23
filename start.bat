@echo off
cd /d "%~dp0."
title ゲーム 5928

where node > nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js が見つかりません。
  echo.
  echo   次のコマンドでインストールできます:
  echo       winget install -e --id OpenJS.NodeJS.LTS
  echo.
  echo   インストール後、このウィンドウを閉じてもう一度実行してください。
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   初回起動: 依存パッケージを取得します。数分かかります...
  call npm install
  if errorlevel 1 (
    echo   npm install に失敗しました。
    pause
    exit /b 1
  )
)

echo   ゲームの開発サーバを起動します。止めるにはこのウィンドウで Ctrl+C。
echo   画面は http://localhost:5928/
echo.
call npm run dev
if errorlevel 1 (
  echo.
  echo   サーバが異常終了しました。
  pause
  exit /b 1
)
exit /b 0
