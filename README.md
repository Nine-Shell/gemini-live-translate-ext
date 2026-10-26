# Gemini Live 同時通訳（Chrome拡張）

開いているタブの音声を、Gemini Live Translate でリアルタイムに日本語へ翻訳し、字幕として表示する Chrome 拡張機能です。

## 使い方
1. このフォルダをダウンロードする
2. Chrome の `chrome://extensions` を開き、「デベロッパーモード」をオン
3. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選ぶ
4. 翻訳したいタブで拡張アイコンをクリック → 表示された小窓に **自分の Gemini API キー** を入力（初回のみ）

## APIキーについて
- キーはこのリポジトリには含まれていません。各自で取得したキーを入力してください。
- 入力したキーはお使いのブラウザの `chrome.storage.local` にだけ保存され、Gemini API 以外には送信されません（保存は平文です。自己責任でお使いください）。

## 注意
- 使用モデル `gemini-3.5-live-translate-preview` はプレビュー版のため、提供終了・変更の可能性があります。
- 権限: `tabCapture`（タブ音声の取得）、`storage`（キーの保存）、`activeTab`

## ライセンス
MIT（[LICENSE](LICENSE)）、著作権者 @Nine_Shell。`genai.js` は Google の `@google/genai`（Apache-2.0）のバンドルです。
