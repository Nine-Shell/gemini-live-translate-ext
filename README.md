# Gemini Live Interpreter (Chrome extension)

A Chrome extension that captures the audio of a browser tab, translates it into Japanese in real time with Gemini Live Translate, and shows the result as live captions while playing the translated voice.

## Features
- Captures audio from the tab you click the extension icon on (e.g. a live stream).
- Real-time translation into Japanese via the Gemini Live API.
- Karaoke-style captions showing the original transcript and the Japanese translation.
- The original audio is muted by default; the translated voice is played instead.
- Auto-reconnects if the session drops.
- Shows elapsed time and a rough cost estimate.

## Install
1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.

## Usage
1. Open the tab you want to translate (e.g. a live stream) and make sure audio is playing.
2. With that tab active, click the extension icon.
3. A small player window opens and starts translating that tab.
4. On first launch, enter your own Gemini API key when asked (one time only).

## API key
- You need your own Gemini API key. No key is included in this repository.
- The key is stored in your browser's `chrome.storage.local` (in plain text) and is sent only to the Gemini API. Use at your own risk.

## Notes
- The model `gemini-3.5-live-translate-preview` is a preview model and may change or be discontinued.
- API usage is billed to your Google account. The cost shown in the player is only an estimate.
- To switch to another tab, close the player window and click the icon on the new tab.
- Permissions: `tabCapture` (capture tab audio), `storage` (save the API key), `activeTab`.

## License
MIT, Copyright (c) 2026 @Nine_Shell. See [LICENSE](LICENSE).
`genai.js` is a bundle of Google's `@google/genai` SDK (Apache-2.0).
