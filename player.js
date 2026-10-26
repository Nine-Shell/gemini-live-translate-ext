import { GoogleGenAI, Modality } from './genai.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const targetTabId = Number(params.get('tabId'));
const tabTitle = params.get('title') || '';

const jpBox = $('jp'), histEl = $('hist'), curEl = $('cur'), enEl = $('en');
if (tabTitle) $('ttl').textContent = tabTitle;

let session = null, stream = null, ctxIn = null, ctxPlay = null, proc = null;
let gainJp = null, gainEn = null, playT = 0;
let paused = false, manualStop = false, retries = 0;
let jpCur = '', enCur = '', lineCount = 0;
let activeSec = 0, pipWin = null;

const ICONS = {
  play:  '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M8 5.5v13a.7.7 0 0 0 1.07.6l10.2-6.5a.7.7 0 0 0 0-1.2L9.07 4.9A.7.7 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><rect x="6.5" y="5" width="3.6" height="14" rx="1.2"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2"/></svg>',
  jp:    '<span style="font-size:11px;font-weight:700">あ</span>',
  en:    '<span style="font-size:10px;font-weight:700">EN</span>',
};
$('pp').innerHTML = ICONS.play;
$('jpaud').innerHTML = ICONS.jp;
$('enaud').innerHTML = ICONS.en;
$('enaud').classList.add('off'); // 既定: 原音はミュート、日本語吹き替えON

function setState(state, label) { // 'live' | 'paused' | 'off'
  $('dot').className = state;
  $('state').textContent = label;
  $('pp').innerHTML = state === 'live' ? ICONS.pause : ICONS.play;
}

// ---- 字幕レンダリング（差分DOM・カラオケ表示） ----
function nearBottom() {
  return jpBox.scrollHeight - jpBox.scrollTop - jpBox.clientHeight < 60;
}
function follow(f) { if (f) jpBox.scrollTop = jpBox.scrollHeight; }

function pushLine(text) {
  const f = nearBottom();
  const div = document.createElement('div');
  div.className = 'old';
  div.textContent = text;
  histEl.appendChild(div);
  if (++lineCount > 120) histEl.removeChild(histEl.firstChild);
  follow(f);
}
function setCur(text) {
  const f = nearBottom();
  curEl.textContent = text;
  follow(f);
}

// ---- 経過時間と推定コスト（$0.0368/分 = 入出力音声の合算目安） ----
setInterval(() => {
  if (session && !paused) activeSec++;
  if (!activeSec) return;
  const m = String(Math.floor(activeSec / 60)).padStart(2, '0');
  const s = String(activeSec % 60).padStart(2, '0');
  $('meter').textContent = `${m}:${s} ・ 推定 $${(activeSec / 60 * 0.0368).toFixed(2)}`;
}, 1000);

// ---- タブ音声のキャプチャ ----
function getStreamId() {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, id => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(id);
    });
  });
}

async function startCapture() {
  const streamId = await getStreamId();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
    },
    video: false,
  });
  stream.getAudioTracks()[0].onended = () => {
    manualStop = true;
    stopAll('タブが閉じられました');
  };

  // tabCapture はローカル再生をミュートするため、ゲイン経由で出し分ける
  ctxPlay = new AudioContext();
  const src = ctxPlay.createMediaStreamSource(stream);
  gainEn = ctxPlay.createGain();
  gainEn.gain.value = 0; // 原音は既定でミュート
  src.connect(gainEn).connect(ctxPlay.destination);
  gainJp = ctxPlay.createGain();
  gainJp.gain.value = 1;
  gainJp.connect(ctxPlay.destination);

  // 送信用 16kHz パイプライン
  ctxIn = new AudioContext({ sampleRate: 16000 });
  // 自動再生ポリシーで suspended の場合に備える（クリックでも復帰可能に）
  const resumeAll = () => { ctxPlay?.resume(); ctxIn?.resume(); };
  resumeAll();
  document.addEventListener('click', resumeAll);
  const src16 = ctxIn.createMediaStreamSource(stream);
  proc = ctxIn.createScriptProcessor(2048, 1, 1);
  src16.connect(proc);
  proc.connect(ctxIn.destination); // 出力バッファは未書き込み=無音
  proc.onaudioprocess = e => {
    if (!session || paused) return;
    const f = e.inputBuffer.getChannelData(0);
    const i16 = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    let bin = '';
    const u8 = new Uint8Array(i16.buffer);
    for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode(...u8.subarray(i, i + 8192));
    try {
      session.sendRealtimeInput({ audio: { data: btoa(bin), mimeType: 'audio/pcm;rate=16000' } });
    } catch { /* 再接続中は捨てる */ }
  };
}

// ---- Gemini Live セッション（切断時は自動再接続） ----
async function connectSession() {
  const { gemini_key } = await chrome.storage.local.get('gemini_key');
  const ai = new GoogleGenAI({ apiKey: gemini_key });
  session = await ai.live.connect({
    model: 'gemini-3.5-live-translate-preview',
    config: {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      translationConfig: { targetLanguageCode: 'ja', echoTargetLanguage: true },
    },
    callbacks: {
      onopen: () => { retries = 0; setState(paused ? 'paused' : 'live', paused ? '一時停止中' : 'LIVE'); },
      onmessage: onMsg,
      onerror: e => setState('off', 'エラー'),
      onclose: () => {
        session = null;
        if (manualStop) return;
        if (retries++ < 5) {
          setState('off', '再接続中…');
          playT = 0;
          setTimeout(connectSession, 1500);
        } else {
          setState('off', '切断（再接続失敗）');
        }
      },
    },
  });
}

function onMsg(m) {
  const sc = m.serverContent;
  if (!sc) return;
  if (sc.outputTranscription?.text) {
    jpCur += sc.outputTranscription.text;
    // 文末（。！？）で確定行に送る
    let idx;
    while ((idx = jpCur.search(/[。！？!?]/)) !== -1) {
      const line = jpCur.slice(0, idx + 1).trim();
      if (line) pushLine(line);
      jpCur = jpCur.slice(idx + 1);
    }
    setCur(jpCur);
  }
  if (sc.inputTranscription?.text) {
    enCur = (enCur + sc.inputTranscription.text).slice(-200);
    enEl.textContent = enCur;
  }
  for (const p of sc.modelTurn?.parts || []) {
    if (p.inlineData?.data) playPcm(p.inlineData.data);
  }
  if (sc.turnComplete && jpCur.trim()) {
    pushLine(jpCur.trim());
    jpCur = '';
    setCur('');
  }
}

function playPcm(b64) {
  if (!ctxPlay || paused) return;
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(u8.buffer);
  const f = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 0x8000;
  const ab = ctxPlay.createBuffer(1, f.length, 24000); // 再生側で自動リサンプル
  ab.getChannelData(0).set(f);
  const s = ctxPlay.createBufferSource();
  s.buffer = ab;
  s.connect(gainJp);
  playT = Math.max(playT, ctxPlay.currentTime + 0.05);
  s.start(playT);
  playT += ab.duration;
}

function stopAll(msg) {
  try { session?.close(); } catch {}
  session = null;
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  proc?.disconnect(); proc = null;
  ctxIn?.close(); ctxIn = null;
  ctxPlay?.close(); ctxPlay = null;
  setState('off', msg || '停止');
}

// ---- コントロール ----
$('pp').addEventListener('click', () => {
  if (!session) return;
  paused = !paused;
  setState(paused ? 'paused' : 'live', paused ? '一時停止中' : 'LIVE');
});
$('jpaud').addEventListener('click', e => {
  if (!gainJp) return;
  const on = gainJp.gain.value > 0;
  gainJp.gain.value = on ? 0 : 1;
  e.currentTarget.classList.toggle('off', on);
});
$('enaud').addEventListener('click', e => {
  if (!gainEn) return;
  const on = gainEn.gain.value > 0;
  gainEn.gain.value = on ? 0 : 1;
  e.currentTarget.classList.toggle('off', on);
});
window.addEventListener('beforeunload', () => { manualStop = true; stopAll(); });

// ---- Document PiP（さらに最前面に固定したい場合） ----
$('pipbtn').addEventListener('click', async () => {
  if (!('documentPictureInPicture' in window)) {
    setState($('dot').className, 'PiP非対応');
    return;
  }
  if (pipWin && !pipWin.closed) { pipWin.focus(); return; }
  const pip = await documentPictureInPicture.requestWindow({ width: 560, height: 240 });
  pipWin = pip;
  const d = pip.document;
  const style = d.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; margin: 0; }
    html, body { height: 100%; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
      background: rgba(13,10,9,.96); color: rgba(255,255,255,.92);
      overflow: hidden; display: flex; flex-direction: column; padding: 12px 14px; }
    #jp { flex: 1; overflow-y: auto; font-size: 24px; line-height: 1.55;
      mask-image: linear-gradient(to bottom, transparent, black 24px);
      -webkit-mask-image: linear-gradient(to bottom, transparent, black 24px);
      scrollbar-width: none; }
    #jp::-webkit-scrollbar { display: none; }
    #jp .old { display: block; color: rgba(255,255,255,.42); font-size: 17px; animation: settle .5s ease; }
    #jp .cur { color: #fff; font-weight: 600; }
    @keyframes settle { from { opacity: 0; transform: translateY(4px); } }
    #en { flex: none; font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase;
      color: rgba(255,255,255,.32); margin-top: 6px; white-space: nowrap; overflow: hidden; }
  `;
  d.head.appendChild(style);
  d.body.appendChild(jpBox);
  d.body.appendChild(enEl);
  pip.addEventListener('pagehide', () => {
    const shell = $('shell');
    shell.appendChild(jpBox);
    shell.appendChild(enEl);
    pipWin = null;
  });
});

// ---- 起動 ----
async function boot() {
  const { gemini_key } = await chrome.storage.local.get('gemini_key');
  if (!gemini_key) {
    $('keypanel').classList.add('show');
    $('keyinput').focus();
    return;
  }
  try {
    setState('off', '接続中…');
    await startCapture();
    await connectSession();
  } catch (err) {
    setState('off', 'エラー');
    enEl.textContent = '開始できません: ' + err.message + ' — 配信タブで拡張アイコンを押し直してください';
  }
}

$('keysave').addEventListener('click', async () => {
  const key = $('keyinput').value.trim();
  if (!key) return;
  await chrome.storage.local.set({ gemini_key: key });
  $('keypanel').classList.remove('show');
  boot();
});
$('keyinput').addEventListener('keydown', e => { if (e.key === 'Enter') $('keysave').click(); });

boot();
