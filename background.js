// 拡張アイコンのクリックで、そのタブを対象にプレイヤーウィンドウを開く。
// タブ音声の取得自体はプレイヤー側が chrome.tabCapture.getMediaStreamId で行う
// （アクション起動済みのタブに対しては拡張のどのページからでも呼べる）。

chrome.action.onClicked.addListener(async (tab) => {
  const { playerWin } = await chrome.storage.session.get('playerWin');
  if (playerWin) {
    try {
      await chrome.windows.get(playerWin);
      chrome.windows.update(playerWin, { focused: true });
      return; // すでに開いている場合はフォーカスのみ（別タブに切替えたい場合は一度閉じる）
    } catch {
      // ウィンドウは既に閉じられている
    }
  }
  const url = chrome.runtime.getURL(
    `player.html?tabId=${tab.id}&title=${encodeURIComponent(tab.title || '')}`
  );
  const w = await chrome.windows.create({
    url,
    type: 'popup',
    width: 640,
    height: 360,
    focused: true,
  });
  await chrome.storage.session.set({ playerWin: w.id });
});

chrome.windows.onRemoved.addListener(async (id) => {
  const { playerWin } = await chrome.storage.session.get('playerWin');
  if (playerWin === id) await chrome.storage.session.remove('playerWin');
});
