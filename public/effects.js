// 完了時の演出: 紙吹雪、浮かぶ XP、経験値バーの光、レベルアップのお祝い

const EFFECT_COLORS = ['#f6c9b3', '#bfe3d0', '#c9ddf2', '#dcd0f0', '#f7e3a1', '#f4b8c8', '#9fcf9a'];

function reducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function particleShape(i) {
  const kind = i % 4;
  if (kind === 0) return 'is-circle';
  if (kind === 1) return 'is-star';
  if (kind === 2) return 'is-rect';
  return 'is-spark';
}

// 座標から紙吹雪を飛ばす
function burstAt(x, y, count = 22, spread = 130) {
  if (reducedMotion()) return;
  const layer = document.getElementById('fx-layer');
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = `fx-particle ${particleShape(i)}`;
    p.style.background = EFFECT_COLORS[i % EFFECT_COLORS.length];
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    layer.appendChild(p);

    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    const dist = spread * (0.5 + Math.random() * 0.6);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - spread * 0.35;
    const rot = (Math.random() - 0.5) * 720;
    const duration = 900 + Math.random() * 500;

    // 区間ごとにイージングを分ける: 勢いよく飛び出し、ふわっと落ちながら消える
    p.animate([
      { transform: 'translate(-50%, -50%) scale(0.4) rotate(0deg)', opacity: 1, easing: 'cubic-bezier(0.1, 0.9, 0.3, 1)' },
      { transform: `translate(calc(-50% + ${dx * 0.75}px), calc(-50% + ${dy * 0.75}px)) scale(1.1) rotate(${rot * 0.6}deg)`, opacity: 1, offset: 0.4, easing: 'linear' },
      { transform: `translate(calc(-50% + ${dx * 0.95}px), calc(-50% + ${dy + spread * 0.25}px)) scale(1) rotate(${rot * 0.85}deg)`, opacity: 1, offset: 0.7, easing: 'ease-in' },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + spread * 0.6}px)) scale(0.6) rotate(${rot}deg)`, opacity: 0 },
    ], { duration, fill: 'forwards' }).onfinish = () => p.remove();
    setTimeout(() => p.remove(), duration + 300); // 画面が非表示で終了イベントが来なくても消す
  }
}

// 「+25 XP」が浮かび上がる
function floatText(x, y, text, big = false, small = false) {
  const layer = document.getElementById('fx-layer');
  const el = document.createElement('div');
  el.className = `fx-float ${big ? 'is-big' : ''} ${small ? 'is-small' : ''}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  layer.appendChild(el);
  if (reducedMotion()) { setTimeout(() => el.remove(), 900); return; }
  el.animate([
    { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 0, easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)' },
    { transform: 'translate(-50%, -90%) scale(1.35)', opacity: 1, offset: 0.2, easing: 'ease-out' },
    { transform: 'translate(-50%, -150%) scale(1.2)', opacity: 1, offset: 0.75, easing: 'ease-in' },
    { transform: 'translate(-50%, -210%) scale(1)', opacity: 0 },
  ], { duration: 1400, fill: 'forwards' }).onfinish = () => el.remove();
  setTimeout(() => el.remove(), 1700);
}

// 経験値ゲージ（ヘッダーの札）を光らせる
function pulseXpBar() {
  for (const el of [document.getElementById('level-gauge')]) {
    if (!el) continue;
    el.classList.remove('is-gaining');
    void el.offsetWidth; // アニメーションをやり直すためのリフロー
    el.classList.add('is-gaining');
    el.addEventListener('animationend', () => el.classList.remove('is-gaining'), { once: true });
  }
}

function initEffects() {
  // いまは初期化の必要なし（完了演出は showClearModal から呼ぶ）
}

// --- 完了演出モーダル（SPEC 7.3）-------------------------------------------

let clearTimers = [];
function laterFx(fn, ms) { clearTimers.push(setTimeout(fn, ms)); }

function boingEl(el) {
  el.classList.remove('is-boing');
  void el.offsetWidth;
  el.classList.add('is-boing');
}

// 完了演出の行数（基本 / ボーナス / コンボ）と、数字の動きが終わるまでの時間
function clearRowCount(data) {
  let n = 1;
  if (data.bonusXp > 0) {
    n += 1;
    if (data.combo >= 2) n += 1;
  }
  if (data.questBonusXp > 0) n += 1;
  return n;
}

function clearAnimationMs(data) {
  return 400 + clearRowCount(data) * 900;
}

function showClearModal(data) {
  clearTimers.forEach(clearTimeout); clearTimers = [];
  stopClearTimeline();
  const modal = document.getElementById('clear-modal');
  const card = modal.querySelector('.clear-card');
  document.getElementById('clear-title').textContent = data.title;
  const rowsEl = document.getElementById('clear-rows');
  const rows = [
    { label: '基本', note: '★'.repeat(data.difficulty), value: data.baseXp, cls: '' },
  ];
  if (data.bonusXp > 0) {
    // 2行に分けて出す（式は見せない）: ボーナス = 残り秒数分、コンボ = 倍率で増えた分
    const base = Math.ceil(data.remainingSec * 0.1);
    const comboPart = data.bonusXp - base;
    rows.push({ label: 'ボーナス', note: `残り ${data.remainingSec}秒`, value: base, cls: 'is-bonus' });
    if (data.combo >= 2) rows.push({ label: 'コンボ', note: `${data.combo}コンボ`, value: comboPart, cls: 'is-bonus' });
  }
  if (data.questBonusXp > 0) rows.push({ label: 'クエストクリア', note: `${data.questName} ${data.questDoneCount}件`, value: data.questBonusXp, cls: 'is-quest' });
  rowsEl.innerHTML = rows.map((r) => `<div class="clear-row ${r.cls} is-hidden"><span>${r.label} <small>${escapeHtml(r.note)}</small></span><strong>+0</strong></div>`).join('');
  const num = document.getElementById('clear-num');
  num.textContent = '0';
  const comboEl = document.getElementById('clear-combo');
  comboEl.textContent = data.combo >= 1 ? `${data.combo}コンボ！` : 'ボーナスなし';
  comboEl.classList.toggle('is-none', data.combo < 1);
  comboEl.classList.add('is-hidden');
  const lvEl = document.getElementById('clear-levelup');
  lvEl.hidden = !data.levelUp;
  if (data.levelUp) lvEl.textContent = `レベルアップ！ Lv.${data.levelUp} ${data.title2}`;
  lvEl.classList.add('is-hidden');

  setModalVisible(modal, true);
  card.classList.remove('is-pop', 'is-final'); void card.offsetWidth; card.classList.add('is-pop');

  if (!reducedMotion()) {
    const r = card.getBoundingClientRect();
    const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
    burstAt(cx, r.top + 10, 36, 220);
    laterFx(() => burstAt(r.left + 20, cy, 18, 150), 200);
    laterFx(() => burstAt(r.right - 20, cy, 18, 150), 350);
  }

  // カウントアップの予定表（ms）。音は音の時計に先に予約し、数字は同じ時計を見ながら進めるので、音と数字がぴったり合う
  const rowEls = [...rowsEl.querySelectorAll('.clear-row')];
  const events = [];
  let total = 0;
  rows.forEach((row, i) => {
    const rowAt = 400 + i * 900;
    events.push({ at: rowAt, fn: () => rowEls[i].classList.remove('is-hidden') });
    const strong = rowEls[i].querySelector('strong');
    const v = row.value;
    const steps = Math.max(1, Math.min(v, 8));
    const from = total;
    for (let k = 1; k <= steps; k++) {
      const cur = Math.round(v * k / steps);
      events.push({ at: rowAt + Math.round(650 * k / steps), coin: true, fn: () => {
        strong.textContent = `+${cur}`;
        num.textContent = String(from + cur);
        boingEl(num);
      } });
    }
    total = from + v;
  });
  const endAt = 400 + rows.length * 900;
  events.push({ at: endAt, fn: () => {
    comboEl.classList.remove('is-hidden');
    if (data.levelUp) lvEl.classList.remove('is-hidden');
    card.classList.add('is-final'); // 両脇のきらめき
    boingEl(num);
    if (!reducedMotion()) {
      const r = card.getBoundingClientRect();
      burstAt(r.left + r.width / 2, r.top + r.height / 2 + 40, data.levelUp ? 40 : 30, 200);
    }
    pulseXpBar();
  } });
  runClearTimeline(events);
}

// 予定表どおりに数字を進め、チャリンを鳴らす。音の時計が使えればそれを基準にし、なければ画面の時計を使う
let clearSounds = [];
let clearTicker = 0; // 数字を進める刻み（requestAnimationFrame は画面が隠れていると止まるので setInterval を使う）
function runClearTimeline(events) {
  const useAudio = typeof audioCtx !== 'undefined' && audioCtx && audioCtx.state === 'running';
  const t0Audio = useAudio ? audioCtx.currentTime : 0;
  const t0Perf = performance.now();
  if (useAudio) {
    events.forEach((ev) => {
      if (!ev.coin) return;
      const t = t0Audio + ev.at / 1000;
      scheduleToneAt(t, 1760, 0.08, clearSounds);
      scheduleToneAt(t + 0.045, 2349, 0.08, clearSounds);
    });
  }
  let next = 0;
  const step = () => {
    const elapsed = useAudio ? (audioCtx.currentTime - t0Audio) * 1000 : performance.now() - t0Perf;
    while (next < events.length && events[next].at <= elapsed) {
      const ev = events[next];
      next += 1;
      ev.fn();
      if (ev.coin && !useAudio && typeof playCoin === 'function') playCoin();
    }
    if (next >= events.length) { clearInterval(clearTicker); clearTicker = 0; }
  };
  clearTicker = setInterval(step, 40);
  step();
}

function stopClearTimeline() {
  if (clearTicker) { clearInterval(clearTicker); clearTicker = 0; }
  clearSounds.forEach((osc) => { try { osc.stop(); } catch (err) { /* すでに止まっている */ } });
  clearSounds = [];
}

function hideClearModal() {
  clearTimers.forEach(clearTimeout); clearTimers = [];
  stopClearTimeline();
  setModalVisible(document.getElementById('clear-modal'), false);
}

// モーダルの表示・非表示。消すときはふわっとフェードアウトする
function setModalVisible(el, visible) {
  if (visible) {
    el.classList.remove('is-leaving');
    el.hidden = false;
    return;
  }
  if (el.hidden || el.classList.contains('is-leaving')) return;
  if (reducedMotion()) { el.hidden = true; return; }
  el.classList.add('is-leaving');
  setTimeout(() => {
    if (el.classList.contains('is-leaving')) { el.hidden = true; el.classList.remove('is-leaving'); }
  }, 280);
}
