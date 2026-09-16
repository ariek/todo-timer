// クエストのタイマーとセッション（SPEC 7章）
// 状態は state.session に持ち、時刻の差分で進める。画面を閉じても進む

const DONE_HOLD_MS = 2100;     // 完了演出で数字の動きが終わってから閉じるまで
const DONE_LAST_EXTRA_MS = 1000; // 最後のクエストのときはさらに長く見せる
const COUNTDOWN_SEC = 5;       // 次のクエストまでの待ち
const BREAK_SEC = 300;         // 休憩
const CYCLE_SEC = 25 * 60;     // 休憩までの区切り
const IDLE_END_MIN = 30;       // これ以上放置したらセッションを終える

let sessionLoop = null;
let audioCtx = null;
let scheduledSounds = []; // 次への待ちの音（3・2・1 とスタート）は音の時計で先に予約しておく
let startToneScheduled = false;

const nowIso = () => new Date().toISOString();
const secondsSince = (iso) => (Date.now() - new Date(iso).getTime()) / 1000;

function sessionActive() {
  return !!state.session;
}

function sessionPhase() {
  return state.session ? state.session.phase : 'idle';
}

// 残り秒数（整数、0未満にはしない）
function questRemainingSec(session = state.session) {
  if (!session || !session.timerStartedAt) return 0;
  const pausedNow = session.pausedAt ? secondsSince(session.pausedAt) : 0;
  const elapsed = secondsSince(session.timerStartedAt) - session.pausedTotalSec - pausedNow;
  return Math.max(0, Math.ceil(session.durationSec - elapsed));
}

function breakRemainingSec(session = state.session) {
  return Math.max(0, Math.ceil(BREAK_SEC - secondsSince(session.phaseStartedAt)));
}

function countdownRemainingSec(session = state.session) {
  return Math.max(0, Math.ceil(COUNTDOWN_SEC - secondsSince(session.phaseStartedAt)));
}

function touchSession() {
  if (state.session) state.session.lastActionAt = nowIso();
}

// --- 開始 / 一時停止 / 再開 ------------------------------------------

function ensureAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (err) { audioCtx = null; }
}

function startSession(taskId) {
  if (state.session) return;
  ensureAudio();
  const now = nowIso();
  state.session = {
    startedAt: now,
    cycleStartedAt: now,
    lastActionAt: now,
    phase: 'running',
    phaseStartedAt: now,
    taskId: null,
    durationSec: 0,
    timerStartedAt: null,
    pausedTotalSec: 0,
    pausedAt: null,
    timedOut: false,
    combo: 0,
    maxCombo: 0,
    completed: 0,
    xp: 0,
    lastClear: null,
    summary: null,
  };
  // 最初も5秒のカウントダウン（3・2・1の音つき）を経てからスタートする
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) { state.session = null; return; }
  const extra = idleExtraFor(taskId); // 待機中に足した（引いた）分を持ち越す
  ui.extraSec = 0;
  ui.extraTaskId = null;
  state.session.taskId = taskId;
  state.session.durationSec = (QUEST_SECONDS[task.difficulty] || QUEST_SECONDS[1]) + extra;
  state.session.phase = 'countdown';
  state.session.phaseStartedAt = now;
  saveState();
  scheduleCountdownSounds(state.session);
  ensureSessionLoop();
  render();
}

function beginQuest(taskId) {
  const s = state.session;
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) { endSession('empty'); return; }
  const now = nowIso();
  const base = QUEST_SECONDS[task.difficulty] || QUEST_SECONDS[1];
  // 次への待ちの間に決まっていた長さ（待機中の調整分を含む）をそのまま使う
  const extra = (s.phase === 'countdown' && s.taskId === taskId) ? (s.durationSec - base) : 0;
  Object.assign(s, {
    phase: 'running',
    phaseStartedAt: now,
    taskId,
    durationSec: base + extra,
    timerStartedAt: now,
    pausedTotalSec: 0,
    pausedAt: null,
    timedOut: false,
    lastActionAt: now,
  });
  saveState();
  ensureSessionLoop();
  if (!startToneScheduled) playTone([880], 0, 0.6); // 予約済み（次への待ちから）ならそちらが鳴る
  startToneScheduled = false;
  scheduledSounds = [];
  render();
}

// 「+ / −」ボタン: 10秒ずつ増減する。表示は 0〜999 秒の範囲に収める。
// 待機中は次に始めるクエストの長さに、実行中・一時停止中は今のタイマーに効く
const ADJUST_SEC = 10;
const TIMER_MAX_SEC = 999;

// 待機中に調整した分は、そのときの「いまやる」クエストだけに効く（スキップなどで別のクエストになったら0に戻る）
function idleExtraFor(taskId) {
  return ui.extraTaskId === taskId ? (ui.extraSec || 0) : 0;
}

function adjustSeconds(delta) {
  const s = state.session;
  if (!s) {
    const next = pickNextQuest();
    if (!next) return;
    const base = QUEST_SECONDS[next.difficulty] || QUEST_SECONDS[1];
    const target = Math.min(TIMER_MAX_SEC, Math.max(0, base + idleExtraFor(next.id) + delta));
    ui.extraTaskId = next.id;
    ui.extraSec = target - base;
    render();
    return;
  }
  if (s.phase !== 'running' && s.phase !== 'paused') return;
  const remaining = questRemainingSec(s);
  const target = Math.min(TIMER_MAX_SEC, Math.max(0, remaining + delta));
  s.durationSec += target - remaining;
  if (target > 0 && s.timedOut) s.timedOut = false; // 時間切れからでも延長できる
  touchSession();
  saveState();
  render();
}

// 「スキップ」: いまのクエストを先送りして、別のクエストで5秒の待ちに入る。
// 次への待ちでも実行中・一時停止中でも使える（走っていたタイマーは捨てる。コンボは続く）
function skipQuest() {
  const s = state.session;
  if (!s || !['countdown', 'running', 'paused'].includes(s.phase)) return;
  const alt = deferTask(s.taskId); // ひとつ後ろに回し、入れ替わったやることに移る。候補がなければ何もしない
  if (!alt) return;
  s.taskId = alt.id;
  s.durationSec = QUEST_SECONDS[alt.difficulty] || QUEST_SECONDS[1];
  s.timerStartedAt = null;
  s.pausedAt = null;
  s.pausedTotalSec = 0;
  s.timedOut = false;
  s.phase = 'countdown';
  s.phaseStartedAt = nowIso(); // 5秒を数え直す
  scheduleCountdownSounds(s);
  touchSession();
  saveState();
  render();
}

function pauseQuest() {
  const s = state.session;
  if (!s || s.phase !== 'running' || s.timedOut) return;
  s.phase = 'paused';
  s.pausedAt = nowIso();
  touchSession();
  saveState();
  render();
}

function resumeQuest() {
  const s = state.session;
  if (!s || s.phase !== 'paused') return;
  s.pausedTotalSec += secondsSince(s.pausedAt);
  s.pausedAt = null;
  s.phase = 'running';
  touchSession();
  saveState();
  render();
}

// --- 完了 --------------------------------------------------------------

function completeQuest() {
  const s = state.session;
  if (!s || (s.phase !== 'running' && s.phase !== 'paused')) return;
  const task = state.tasks.find((t) => t.id === s.taskId);
  if (!task) { endSession('empty'); return; }

  // 一時停止してもボーナスとコンボは続く。時間切れだけが途切れる条件
  // 「+ / −」で調整した分も含めた、いまの残り秒数でボーナスを計算する
  const remaining = s.timedOut ? 0 : questRemainingSec(s);
  const remainingForBonus = remaining;
  // コンボは完了するたびに増え、「やめる」までは途切れない（時間切れでも続く）
  const combo = s.combo + 1;
  const baseXp = baseXpForTask(task);
  const bonusXp = remainingForBonus > 0 ? timerBonus(remainingForBonus, combo) : 0;
  playTone([660, 880, 1100, 1320], 0.11, 0.4);
  const before = levelInfo(state.player.xp).level;

  completeTask(task.id, { xp: baseXp + bonusXp, baseXp, bonusXp, combo, durationSec: s.durationSec, remainingSec: remainingForBonus });

  const after = levelInfo(state.player.xp).level;
  s.combo = combo;
  s.maxCombo = Math.max(s.maxCombo, combo);
  s.completed += 1;
  s.xp += baseXp + bonusXp;
  s.lastClear = {
    title: task.title,
    difficulty: task.difficulty,
    baseXp,
    bonusXp,
    combo,
    remainingSec: remainingForBonus,
    shownRemainingSec: remaining, // 完了演出の裏のリングに出す実際の残り秒数
    durationSec: s.durationSec,
    multiplier: comboMultiplier(combo),
    levelUp: after > before ? after : null,
    title2: titleForLevel(after),
  };
  s.phase = 'done';
  s.phaseStartedAt = nowIso();
  s.timerStartedAt = null;
  s.isLast = !pickNextQuest(); // 次のクエストがなければ最後
  // 演出の行数で長さが変わるので、動きが終わってからの静止時間をそろえる
  s.doneMs = clearAnimationMs(s.lastClear) + DONE_HOLD_MS + (s.isLast ? DONE_LAST_EXTRA_MS : 0);
  touchSession();
  saveState();
  render();
  showClearModal(s.lastClear);
}

// 完了演出のあと: 休憩か、次のクエストか、終了か
function afterDone() {
  const s = state.session;
  if (!s) return;
  hideClearModal();
  if (secondsSince(s.cycleStartedAt) > CYCLE_SEC) {
    startBreak();
  } else {
    nextOrEnd();
  }
}

function startBreak() {
  const s = state.session;
  s.phase = 'break';
  s.phaseStartedAt = nowIso();
  saveState();
  render();
}

function endBreak() {
  const s = state.session;
  if (!s || s.phase !== 'break') return;
  s.cycleStartedAt = nowIso();
  touchSession();
  playTone([660, 880], 0.15);
  nextOrEnd();
}

function nextOrEnd() {
  const s = state.session;
  const next = pickNextQuest();
  if (!next) { endSession('empty'); return; }
  const before = focusSnapshot();
  s.taskId = next.id;
  s.durationSec = QUEST_SECONDS[next.difficulty] || QUEST_SECONDS[1];
  s.phase = 'countdown';
  s.phaseStartedAt = nowIso();
  s.timerStartedAt = null;
  saveState();
  scheduleCountdownSounds(s);
  render();
  swapFocusCard(before, 'up'); // 終えたカードが上へ抜け、次のカードが下から入る
}

function pickNextQuest(excludeId = null) {
  const now = new Date();
  const tasks = state.tasks.filter((t) => t.id !== excludeId && (!ui.categoryFilter || t.categoryId === ui.categoryFilter));
  const entries = tasks.map((task) => ({ task, status: taskStatus(task, now) }))
    .filter((e) => ['overdue', 'due', 'todo'].includes(e.status));
  const focus = pickFocus(entries, now);
  return focus ? focus.task : null;
}

// --- 終了 --------------------------------------------------------------

async function quitSession() {
  if (!state.session) return;
  if (!(await askConfirm('ここでやめますか？ いまのやることは未完了のまま残り、コンボは 0 に戻ります。', { ok: 'やめる', cancel: '続ける', danger: true }))) return;
  if (!state.session) return; // 待っている間に終わっていたら何もしない
  endSession('quit');
}

function endSession(reason) {
  const s = state.session;
  if (!s) return;
  cancelScheduledSounds();
  hideClearModal();
  const endedAt = nowIso();
  const record = {
    startedAt: s.startedAt,
    endedAt,
    completed: s.completed,
    xp: s.xp,
    maxCombo: s.maxCombo,
    durationSec: Math.round(secondsSince(s.startedAt)),
  };
  if (s.completed > 0) state.sessions.push(record);
  const ranked = [...state.sessions].sort((a, b) => b.xp - a.xp);
  const rank = s.completed > 0 ? ranked.findIndex((r) => r === record) + 1 : 0;
  s.phase = 'summary';
  s.phaseStartedAt = endedAt;
  s.timerStartedAt = null;
  s.summary = { ...record, rank, reason };
  saveState();
  render();
  if (reason !== 'idle') playSparkle(); // まとめが出るときのキラリン（放置による自動終了では鳴らさない）
}

function closeSummary() {
  state.session = null;
  stopSessionLoop();
  saveState();
  render(); // やることが残っていなければ、そのまま「やることはありません」のカードになる
}

// --- ループ ------------------------------------------------------------

function ensureSessionLoop() {
  if (sessionLoop) return;
  sessionLoop = setInterval(tickSession, 100); // 数字の切り替わりを予約した音に近づける
}

function stopSessionLoop() {
  clearInterval(sessionLoop);
  sessionLoop = null;
}

function tickSession() {
  const s = state.session;
  if (!s) { stopSessionLoop(); return; }
  switch (s.phase) {
    case 'running':
      if (!s.timedOut && questRemainingSec(s) <= 0) {
        s.timedOut = true;
        saveState();
        playTone([660, 520, 400], 0.25);
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        render();
        const qt = document.querySelector('#focus-quests .qt');
        if (qt) qt.classList.add('is-shake'); // 時間切れの瞬間だけ横に揺れる（描き直すと消える）
      }
      break;
    case 'done':
      if (secondsSince(s.phaseStartedAt) * 1000 >= (s.doneMs || 5200)) afterDone();
      break;
    case 'break':
      if (breakRemainingSec(s) <= 0) endBreak();
      break;
    case 'countdown':
      // 3・2・1 とスタートの音は scheduleCountdownSounds で音の時計に予約済み（ここで鳴らすと 250ms 単位の遅れとぶれが出る）
      if (countdownRemainingSec(s) <= 0) beginQuest(s.taskId);
      break;
    default:
      break;
  }
  renderTimerTick();
}

// 起動時: 放置が長ければ終了、そうでなければ続きから
function initSession() {
  const s = state.session;
  if (!s) return;
  if (s.phase === 'summary') return; // まとめを表示したまま閉じていた
  if (secondsSince(s.lastActionAt) > IDLE_END_MIN * 60) {
    endSession('idle');
    return;
  }
  if (s.phase === 'done') { s.phase = 'countdown'; s.phaseStartedAt = nowIso(); }
  if (s.phase === 'countdown') {
    // 待ちの間に閉じていたら、開いた時点から数え直す
    s.phaseStartedAt = nowIso();
    scheduleCountdownSounds(s);
  }
  if (s.phase === 'running' && !s.timedOut && questRemainingSec(s) <= 0) { s.timedOut = true; }
  saveState();
  ensureSessionLoop();
}

// --- 音 ----------------------------------------------------------------

// まとめが出るときのキラリン（上昇する速いアルペジオ）
function playSparkle() {
  playTone([1319, 1760, 2093, 2637, 3136], 0.07, 0.5);
}

// 経験値が足し上がるときのチャリン
function playCoin() {
  playTone([1760, 2349], 0.045, 0.08);
}

// freqs: 鳴らす周波数の並び、gap: 音と音の間隔（秒）、length: 1音の長さ（秒）
// 次への待ちの音を、音の時計（AudioContext）で正確な時刻に予約する。
// 画面の数字が 3・2・1 に変わる瞬間に短い低い音、0 になる瞬間に長い高い音（カーレースのスタートのように）
function scheduleCountdownSounds(session) {
  cancelScheduledSounds();
  if (!audioCtx) return;
  if (audioCtx.state !== 'running') {
    // iOS では最初の操作のあと音の時計が動き出すまで少しかかる。動き出してから同じ待ちに対して予約し直す
    const started = session.phaseStartedAt;
    audioCtx.resume().then(() => {
      const cur = state.session;
      if (cur && cur.phase === 'countdown' && cur.phaseStartedAt === started) scheduleCountdownSounds(cur);
    }).catch(() => { /* 鳴らせなくても続行 */ });
    return;
  }
  const startedMs = new Date(session.phaseStartedAt).getTime();
  const nowMs = Date.now();
  const base = audioCtx.currentTime;
  [3, 2, 1].forEach((left) => {
    const atMs = startedMs + (COUNTDOWN_SEC - left) * 1000;
    if (atMs < nowMs - 50) return; // もう過ぎた分は鳴らさない
    scheduleToneAt(base + Math.max(0, (atMs - nowMs) / 1000), 440, 0.18);
  });
  const startAtMs = startedMs + COUNTDOWN_SEC * 1000;
  if (startAtMs >= nowMs - 50) {
    scheduleToneAt(base + Math.max(0, (startAtMs - nowMs) / 1000), 880, 0.6);
    startToneScheduled = true;
  }
}

function scheduleToneAt(t, freq, length, list = scheduledSounds) {
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    gain.gain.setValueAtTime(0.22, t + Math.max(0.02, length - 0.08));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + length + 0.05);
    list.push(osc);
  } catch (err) { /* 鳴らせなくても続行 */ }
}

// 予約した音を取り消す（スキップ、やめる、終了のとき）
function cancelScheduledSounds() {
  scheduledSounds.forEach((osc) => { try { osc.stop(); } catch (err) { /* すでに止まっている */ } });
  scheduledSounds = [];
  startToneScheduled = false;
}

function playTone(freqs, gap, length = 0.3) {
  if (!audioCtx) return;
  try {
    freqs.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = audioCtx.currentTime + i * gap;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      gain.gain.setValueAtTime(0.22, t + Math.max(0.02, length - 0.08));
      gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + length + 0.05);
    });
  } catch (err) { /* 鳴らせなくても続行 */ }
}

// --- 描画（秒数だけの更新）------------------------------------------------

const QT_LEN = 2 * Math.PI * 54;

// 数字を1桁ずつ同じ幅の枠に入れて等幅に見せる（フォントが等幅数字に対応していないため）
function digitsHtml(n) {
  return String(n).split('').map((d) => `<span>${d}</span>`).join('');
}

// リングの色: 残りの割合で 緑 → 黄緑 → 黄 → オレンジ → 赤
function ringColor(ratio) {
  if (ratio > 0.6) return '#7fcaa2';
  if (ratio > 0.45) return '#b5d67f';
  if (ratio > 0.3) return '#f2d66b';
  if (ratio > 0.15) return '#f2a860';
  return '#e6887a';
}

function renderTimerTick() {
  const s = state.session;
  if (s && (s.phase === 'running' || s.phase === 'paused')) {
    const secEl = document.querySelector('#focus-quests .qt-seconds');
    const fillEl = document.querySelector('#focus-quests .qt-fill');
    if (secEl && fillEl) {
      const remaining = questRemainingSec(s);
      secEl.innerHTML = digitsHtml(remaining);
      fillEl.style.strokeDashoffset = String(QT_LEN * (1 - remaining / s.durationSec));
      if (s.phase === 'running' && !s.timedOut) fillEl.style.stroke = ringColor(remaining / s.durationSec);
      const minus = document.querySelector('#focus-quests [data-qt="minus"]');
      const plus = document.querySelector('#focus-quests [data-qt="plus"]');
      if (minus) minus.disabled = remaining <= 0;
      if (plus) plus.disabled = remaining >= TIMER_MAX_SEC;
    }
  } else if (s && s.phase === 'countdown') {
    const cd = document.querySelector('#focus-quests .cd-num');
    const left = Math.max(1, countdownRemainingSec(s));
    if (cd && cd.dataset.value !== String(left)) {
      // 数字が変わるたびに、手前からふわっと縮小しながら出す
      cd.dataset.value = String(left);
      cd.textContent = String(left);
      cd.classList.remove('is-pop');
      void cd.offsetWidth;
      cd.classList.add('is-pop');
    }
  }
  if (s && s.phase === 'break') {
    const remaining = breakRemainingSec(s);
    const el = document.getElementById('break-seconds');
    const fill = document.querySelector('#break-modal .qt-fill');
    if (el) el.innerHTML = digitsHtml(remaining);
    if (fill) fill.style.strokeDashoffset = String(QT_LEN * (1 - remaining / BREAK_SEC));
  }
  renderTimerMini();
}

// ヘッダーの残り秒数
function renderTimerMini() {
  const el = document.getElementById('timer-mini');
  const s = state.session;
  const show = s && (s.phase === 'running' || s.phase === 'paused') && !(ui.tab === 'categories' && ui.showTasks);
  el.hidden = !show;
  if (show) {
    el.innerHTML = `${iconHtml('i-timer', 'icon icon-timer')} 残り ${questRemainingSec(s)} 秒${s.phase === 'paused' ? '（一時停止中）' : ''}`;
  }
}

function initTimer() {
  document.getElementById('timer-mini').addEventListener('click', () => openTasks(ui.categoryFilter));
  document.getElementById('break-end').addEventListener('click', endBreak);
  document.getElementById('summary-close').addEventListener('click', closeSummary);
  initSession();
}
