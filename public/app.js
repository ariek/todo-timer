// 状態管理、保存、画面切り替え

const STORAGE_KEY = 'todo-timer.v1';
const SCREEN_KEY = 'todo-timer.screen'; // クエストタブで開いていた画面（一覧かやることか、どのクエストか）。エクスポートには含めない
const DATA_VERSION = 1;

let state = null;
const SECTIONS_KEY = 'todo-timer.sections'; // やること画面の折りたたみ状態。エクスポートには含めない
const ui = { tab: 'categories', showTasks: false, categoryFilter: null, focusTaskId: null, logMonth: null, logDay: null, sections: loadSections(), extraSec: 0, extraTaskId: null };

function loadSections() {
  const defaults = { todo: false, done: false };
  try {
    const saved = JSON.parse(localStorage.getItem(SECTIONS_KEY) || '{}');
    return { ...defaults, ...saved };
  } catch (err) { return defaults; }
}

function saveSections() {
  try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(ui.sections)); } catch (err) { /* 保存できなくても続行 */ }
}

// --- 保存 -------------------------------------------------------------

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function emptyState() {
  return {
    version: DATA_VERSION,
    player: { xp: 0, level: 1, bestStreak: 0 },
    categories: [],
    tasks: [],
    logs: [],
    session: null,
    sessions: [],
    sample: false,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return migrate(data);
  } catch (err) {
    console.error('保存データを読み込めませんでした', err);
    return null;
  }
}

// 0.x の間は変換処理を書かず、足りない項目を初期値で埋めるだけ（SPEC 9.2）
function migrate(data) {
  if (!data.version) data.version = DATA_VERSION;
  if (!data.player) data.player = { xp: 0, level: 1, bestStreak: 0 };
  if (!Array.isArray(data.categories)) data.categories = [];
  data.categories.forEach((c, i) => {
    if (!c.color) c.color = CATEGORY_COLORS[i % CATEGORY_COLORS.length].id;
    if (!c.icon) c.icon = DEFAULT_ICON;
  });
  if (!Array.isArray(data.tasks)) data.tasks = [];
  // 手動の並び順がないやることは登録順で末尾に
  let nextOrder = data.tasks.reduce((m, t) => (typeof t.order === 'number' ? Math.max(m, t.order) : m), -1) + 1;
  data.tasks.filter((t) => typeof t.order !== 'number')
    .sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? -1 : 1))
    .forEach((t) => { t.order = nextOrder++; });
  if (!Array.isArray(data.logs)) data.logs = [];
  if (!Array.isArray(data.sessions)) data.sessions = [];
  if (data.session === undefined) data.session = null;
  return data;
}

function saveState() {
  state.player.level = levelInfo(state.player.xp).level;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// --- サンプルデータ ---------------------------------------------------

function sampleState(now = new Date()) {
  const s = emptyState();
  s.sample = true;
  const iso = (d) => new Date(d).toISOString();
  const daysAgo = (n) => addDays(now, -n);
  const daysLater = (n) => addDays(now, n);

  const categoryDefs = DEFAULT_CATEGORIES;
  const categories = categoryDefs.map(([name, color, icon], i) => ({ id: newId('c'), name, color, icon, order: i }));
  s.categories = categories;
  const A = Object.fromEntries(categoryDefs.map(([name], i) => [name, categories[i].id]));

  // repeat: none | daily | weekly | {days: n}
  const t = (categoryName, title, difficulty, repeat, opts = {}) => {
    const rep = typeof repeat === 'number' ? { type: 'days', every: repeat } : { type: repeat };
    return {
      id: newId('t'),
      categoryId: A[categoryName],
      title,
      difficulty,
      repeat: rep,
      note: '',
      deadline: opts.deadline ? iso(opts.deadline) : null,
      deferredAt: null,
      unpinnedAt: null,
      lastDoneAt: opts.lastDone ? iso(opts.lastDone) : null,
      dueAt: opts.due ? iso(opts.due) : null,
      done: false,
      createdAt: iso(daysAgo(7)),
    };
  };

  s.tasks = [
    t('仕事', 'メールの返信', 1, 'daily', { lastDone: daysAgo(2), due: daysAgo(1) }),
    t('仕事', '経費精算を出す', 2, 'weekly', { lastDone: daysAgo(10), due: daysAgo(3) }),
    t('仕事', '会議の資料を作る', 3, 'none', { deadline: daysLater(2) }),
    t('家事', '洗い物をする', 1, 'daily', { lastDone: daysAgo(1), due: daysAgo(0) }),
    t('家事', '洗濯物をたたむ', 1, 2, { lastDone: daysAgo(1), due: daysLater(1) }),
    t('家事', 'ゴミを出す', 1, 'weekly', { lastDone: daysAgo(2), due: daysLater(5) }),
    t('勉強', '英単語を10個おぼえる', 1, 'daily', { lastDone: now, due: daysLater(1) }),
    t('勉強', '参考書を1章読む', 2, 3, { lastDone: daysAgo(3), due: daysAgo(0) }),
    t('健康', 'ストレッチをする', 1, 'daily', { lastDone: daysAgo(1), due: daysAgo(0) }),
    t('健康', '30分歩く', 2, 'daily', { lastDone: daysAgo(3), due: daysAgo(2) }),
    t('買い物', '牛乳を買う', 1, 'none', { deadline: daysLater(1) }),
    t('買い物', '電池を買う', 1, 'none'),
  ];

  s.logs = [
    { taskId: s.tasks[6].id, doneAt: iso(now), xp: 15, baseXp: 15, bonusXp: 0, combo: 0, prev: { done: false, lastDoneAt: iso(daysAgo(1)), dueAt: iso(daysAgo(0)) } },
    { taskId: s.tasks[3].id, doneAt: iso(daysAgo(1)), xp: 27, baseXp: 15, bonusXp: 12, combo: 1 },
    { taskId: s.tasks[4].id, doneAt: iso(daysAgo(1)), xp: 47, baseXp: 25, bonusXp: 22, combo: 2 },
    { taskId: s.tasks[5].id, doneAt: iso(daysAgo(2)), xp: 15, baseXp: 15, bonusXp: 0, combo: 0 },
  ];
  s.player.xp = 104;
  s.player.bestStreak = 3;
  return s;
}

// --- 描画 -------------------------------------------------------------

// スプライトのアイコンを埋め込む HTML
function iconHtml(name, cls = 'icon') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#${name}"/></svg>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 文中の URL（http / https）をリンクにする。別ウインドウで開く。末尾の句読点や閉じかっこはリンクに含めない
function linkifyHtml(str) {
  const escaped = escapeHtml(str);
  return escaped.replace(/https?:\/\/[^\s<>"']+/g, (m) => {
    let url = m;
    let tail = '';
    const t = url.match(/[)\]}>.,。、!?！？]+$/);
    if (t) { url = url.slice(0, -t[0].length); tail = t[0]; }
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${tail}`;
  });
}

// ヘッダー: 「Lv. 称号」の札（背景が経験値ゲージ）と、現在の経験値 / 次のレベルまで
function renderHeader() {
  const info = levelInfo(state.player.xp);
  document.getElementById('level-badge').textContent = `Lv.${info.level} ${titleForLevel(info.level)}`;
  document.getElementById('xp-fill').style.width = `${Math.round((info.xpInLevel / info.xpToNext) * 100)}%`;
  document.getElementById('xp-now').textContent = String(info.xpInLevel);
  document.getElementById('xp-next').textContent = `/ ${info.xpToNext}`;
}

function render() {
  renderHeader();
  renderOverview();
  renderQuests();
  renderTimerMini();
  renderSettings();
  renderLog();
  renderSessionModals();
}

// 休憩とまとめのモーダル（完了演出は effects.js）
function renderSessionModals() {
  const s = state.session;
  const breakModal = document.getElementById('break-modal');
  const summaryModal = document.getElementById('summary-modal');
  setModalVisible(breakModal, !!(s && s.phase === 'break'));
  if (s && s.phase === 'break') {
    const note = document.querySelector('#break-modal .break-note');
    note.hidden = s.combo <= 0;
    document.getElementById('break-combo').innerHTML = comboBadge(s.combo);
    renderTimerTick();
  }
  setModalVisible(summaryModal, !!(s && s.phase === 'summary'));
  if (s && s.phase === 'summary') {
    const r = s.summary;
    const from = new Date(r.startedAt); const to = new Date(r.endedAt);
    const hm = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    document.getElementById('summary-sub').textContent = `${formatShortDate(from)} ${hm(from)} 〜 ${hm(to)}`;
    document.getElementById('summary-xp').textContent = String(r.xp);
    document.getElementById('summary-count').textContent = String(r.completed);
    document.getElementById('summary-combo').textContent = String(r.maxCombo);
    document.getElementById('summary-min').innerHTML = `${Math.max(1, Math.round(r.durationSec / 60))}<small>分</small>`;
    const rankCell = document.getElementById('summary-rank-cell');
    rankCell.hidden = !(r.rank >= 1 && r.rank <= 5);
    document.getElementById('summary-rank').textContent = String(r.rank);
    const best = document.getElementById('summary-best');
    best.hidden = !(r.rank >= 1 && r.rank <= 5);
    best.textContent = r.rank === 1 ? '自己ベスト更新！' : `自己ベスト${r.rank}位！`;
    document.getElementById('summary-title').textContent = r.completed > 0 ? 'おつかれさま！' : '中止しました';
  }
}

// --- タブ -------------------------------------------------------------

// tab: 'categories'（本体。クエスト一覧かやること画面）/ 'log' / 'settings'（本体の上に重なるページ）
function switchTab(tab) {
  const prev = ui.tab;
  ui.tab = tab;
  // 本体は、クエスト一覧かやること画面のどちらかを出す
  const view = ui.showTasks ? 'quests' : 'categories';
  document.querySelectorAll('.main > .view').forEach((v) => { v.hidden = v.dataset.view !== view; });
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  // 記録・設定は × のヘッダーごと下から上がって本体に重なり、閉じるときは下へ下がる
  const motion = prev !== tab && !(typeof reducedMotion === 'function' && reducedMotion());
  document.querySelectorAll('.page').forEach((p) => {
    if (p.dataset.page === tab) showPage(p, motion);
    else hidePage(p, motion && p.dataset.page === prev);
  });
  updateFabs();
  renderTimerMini();
  if (tab === 'categories' && prev === 'categories') document.querySelector('.main').scrollTo(0, 0);
}

// 記録・設定のページを出す（y: 100% → 0%）/ しまう（0% → 100%）。シートと同じく transition で動かす
const pageTimers = new WeakMap();
function showPage(page, animate) {
  clearTimeout(pageTimers.get(page));
  page.classList.remove('is-closing');
  if (page.hidden) {
    page.querySelector('.page-body').scrollTo(0, 0);
    if (animate) {
      // いったん「下にある状態」で描いてから定位置へ動かす（iOS でも確実に下から上がる）
      page.classList.add('is-opening');
      page.hidden = false;
      void page.offsetWidth;
    }
    page.hidden = false;
  }
  page.classList.remove('is-opening');
}
function hidePage(page, animate) {
  if (page.hidden) return;
  clearTimeout(pageTimers.get(page));
  page.classList.remove('is-opening');
  if (!animate) { page.classList.remove('is-closing'); page.hidden = true; return; }
  page.classList.add('is-closing');
  pageTimers.set(page, setTimeout(() => { page.classList.remove('is-closing'); page.hidden = true; }, 260));
}

// クエスト一覧からやること画面へ（categoryId が null なら「すべて」）
function openTasks(categoryId) {
  // 一覧から開くときだけ横にスライドする（作業中の復帰や再読み込みではしない）
  const animate = ui.tab === 'categories' && !ui.showTasks && !document.getElementById('view-categories').hidden
    && !(typeof reducedMotion === 'function' && reducedMotion());
  ui.categoryFilter = categoryId || null;
  ui.showTasks = true;
  saveScreen();
  renderQuests();
  switchTab('categories');
  if (animate) slideInTasks();
}

// クエスト一覧へ戻る
function showCategoryList() {
  ui.showTasks = false;
  saveScreen();
  switchTab('categories');
}

// 右下の追加ボタン: 一覧ではクエストの「＋」、やること画面ではやることの「＋」（作業中は隠す）。
// 記録・設定のページは本体の上に重なるので、開いている間も消さない（ページに隠れる）
function updateFabs() {
  document.getElementById('category-add-btn').hidden = ui.showTasks;
  document.getElementById('add-task-btn').hidden = !ui.showTasks || sessionActive();
}

// シートを開く/閉じる。閉じるときは下へ下がる動き（y: 0% → 100%）と板のフェードのあとで隠す。動きを減らす設定なら即座に隠す
const sheetCloseTimers = new WeakMap();
function showSheet(backdrop) {
  clearTimeout(sheetCloseTimers.get(backdrop)); // 閉じている途中なら止めて開き直す
  backdrop.classList.remove('is-closing');
  if (backdrop.hidden) {
    // いったん「下にある状態」で描いてから定位置へ動かす（iOS でも確実に下から上がる）
    backdrop.classList.add('is-opening');
    backdrop.hidden = false;
    void backdrop.offsetWidth;
  }
  backdrop.classList.remove('is-opening');
}
let lastSheetClosedAt = 0;
function hideSheet(backdrop) {
  if (backdrop.hidden) return;
  lastSheetClosedAt = Date.now();
  if (typeof reducedMotion === 'function' && reducedMotion()) { backdrop.hidden = true; return; }
  backdrop.classList.add('is-closing');
  sheetCloseTimers.set(backdrop, setTimeout(() => { backdrop.classList.remove('is-closing'); backdrop.hidden = true; }, 240));
}

// シートを閉じた直後のクリックは、指の下にあった「＋」などに届いたものなので無視する
function sheetJustClosed() {
  return Date.now() - lastSheetClosedAt < 400;
}

function saveScreen() {
  try { localStorage.setItem(SCREEN_KEY, JSON.stringify({ tasks: ui.showTasks, category: ui.categoryFilter })); } catch (err) { /* 保存できなくても続行 */ }
}

function loadScreen() {
  try {
    const saved = JSON.parse(localStorage.getItem(SCREEN_KEY) || '{}');
    ui.categoryFilter = saved.category && state.categories.some((c) => c.id === saved.category) ? saved.category : null;
    ui.showTasks = !!saved.tasks;
  } catch (err) { ui.categoryFilter = null; ui.showTasks = false; }
}

// --- 端末の余白（セーフエリア）を実測して CSS に渡す ---------------------
// iOS で env() を使った計算が効かないことがあるため、px の実数に置き換える

function measureInsets() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
    + 'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const top = parseFloat(cs.paddingTop) || 0;
  const bottom = parseFloat(cs.paddingBottom) || 0;
  probe.remove();
  // 0 のときは上書きせず CSS の env() に任せる（iOS が起動直後に 0 を返すことがある）
  const root = document.documentElement.style;
  if (top > 0) root.setProperty('--inset-top', `${top}px`); else root.removeProperty('--inset-top');
  if (bottom > 0) root.setProperty('--inset-bottom', `${bottom}px`); else root.removeProperty('--inset-bottom');
}

// --- PWA: サービスワーカーの登録と更新通知 ---------------------------

const APP_VERSION = 'v0.22.1';
let waitingWorker = null;

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        // 初回インストールではなく、すでに動いている版がある場合だけ知らせる
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
      });
    });
    document.getElementById('app-update').addEventListener('click', async () => {
      try {
        await reg.update();
        // update() は新しい版の取り込み（installing）が始まった時点で戻るので、入り終わるまで待ってから判断する
        if (reg.installing) await waitInstalled(reg.installing);
        if (reg.waiting) offerUpdate(reg.waiting);
        else showToast('最新版です');
      } catch (err) {
        showToast('確認できませんでした。オフラインかもしれません');
      }
    });
  }).catch((err) => console.warn('サービスワーカーを登録できませんでした', err));

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

// 取り込み中のサービスワーカーが installed（または redundant）になるまで待つ。長くても 15 秒
function waitInstalled(worker) {
  return new Promise((resolve) => {
    if (worker.state !== 'installing') { resolve(); return; }
    const timer = setTimeout(resolve, 15000);
    worker.addEventListener('statechange', () => {
      if (worker.state !== 'installing') { clearTimeout(timer); resolve(); }
    });
  });
}

function offerUpdate(worker) {
  waitingWorker = worker;
  document.getElementById('update-bar').hidden = false;
}

// --- 画面の横スライド（やること画面 ⇄ クエスト一覧）------------------------
// iOS の画面遷移の感じ: やること画面が手前で横に動き、クエスト一覧は後ろで -30% ⇄ 0% の間を追いかける。
// 右スワイプで戻るときは指についてきて、一覧からやることを開くときは逆向きに自動で動く

const slide = {
  quests: () => document.getElementById('view-quests'),
  cats: () => document.getElementById('view-categories'),
  taskFab: () => document.getElementById('add-task-btn'),
  catFab: () => document.getElementById('category-add-btn'),
  main: () => document.querySelector('.main'),
  width() { return this.quests().getBoundingClientRect().width; },
  // dx: やること画面の左端の位置（0 = 定位置、幅 = 完全に右へ出た状態）。右下の「＋」も各画面と一緒に動かす
  apply(dx) {
    const behind = -0.3 * (this.width() - dx);
    this.quests().style.transform = `translateX(${dx}px)`;
    this.cats().style.transform = `translateX(${behind}px)`;
    this.taskFab().style.transform = `translateX(${dx}px)`;
    this.catFab().style.transform = `translateX(${behind}px)`;
  },
  setup() {
    const cats = this.cats();
    cats.hidden = false;
    cats.classList.add('is-behind');
    cats.style.top = `${this.main().scrollTop + 16}px`; // 本文の上の余白の分
    this.quests().classList.add('is-swiping');
    // 動いている間は両方の「＋」を出す（作業中はやることの「＋」は出さない）。クエストの「＋」はやること画面の下に潜らせる
    this.catFab().hidden = false;
    this.catFab().classList.add('is-under');
    this.taskFab().hidden = sessionActive();
  },
  cleanup() {
    const quests = this.quests();
    const cats = this.cats();
    quests.classList.remove('is-swiping', 'is-settling');
    cats.classList.remove('is-behind', 'is-settling');
    quests.style.transform = '';
    cats.style.transform = '';
    cats.style.top = '';
    cats.hidden = true;
    [this.taskFab(), this.catFab()].forEach((b) => { b.classList.remove('is-settling', 'is-under'); b.style.transform = ''; });
    updateFabs();
  },
  // いまの位置から dx へ 0.2 秒で動かし、終わったら片付ける
  settle(dx, done) {
    [this.quests(), this.cats(), this.taskFab(), this.catFab()].forEach((el) => el.classList.add('is-settling'));
    this.apply(dx);
    setTimeout(() => { this.cleanup(); if (done) done(); }, 220);
  },
};

// 一覧からやること画面を開くときの自動スライド（やること: 100% → 0%、一覧: 0% → -30%）
function slideInTasks() {
  slide.setup();
  slide.apply(slide.width());
  void slide.quests().offsetWidth; // いったん右に置いてから動かす
  slide.settle(0);
}

// 戻るボタンで一覧に戻るときの自動スライド（やること: 0% → 100%、一覧: -30% → 0%）。終わってから一覧に切り替える
function slideOutTasks() {
  const quests = slide.quests();
  if (quests.hidden || quests.classList.contains('is-swiping') || (typeof reducedMotion === 'function' && reducedMotion())) {
    showCategoryList();
    return;
  }
  slide.setup();
  slide.apply(0);
  void quests.offsetWidth;
  slide.settle(slide.width(), showCategoryList);
}

function initSwipeBack() {
  const quests = slide.quests();
  let sw = null; // { id, x0, y0, dir: null | 'h' | 'v', active, samples }

  // 最初の動きで横か縦かを決める。少しでも右向きなら横（その間は縦スクロールさせない）
  const decide = (dx, dy) => {
    if (sw.dir) return;
    if (dx === 0 && dy === 0) return;
    sw.dir = dx > 0 && dx >= Math.abs(dy) ? 'h' : 'v';
  };

  quests.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || sw) return;
    if (sessionActive()) return; // 作業中は戻れない
    if (e.target.closest('.drag-grip, .sheet-backdrop, a, input, textarea, select')) return;
    sw = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dir: null, active: false, samples: [] };
  });
  // 横と決めた指の動きはブラウザに渡さず、縦スクロールが混ざらないようにする（最初の touchmove から止める必要がある）
  quests.addEventListener('touchmove', (e) => {
    if (!sw || e.touches.length !== 1) return;
    const t = e.touches[0];
    decide(t.clientX - sw.x0, t.clientY - sw.y0);
    if (sw.dir === 'h' && e.cancelable) e.preventDefault();
  }, { passive: false });
  quests.addEventListener('pointermove', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x0;
    const dy = e.clientY - sw.y0;
    decide(dx, dy);
    if (sw.dir === 'v') { sw = null; return; } // 縦スクロールに任せる
    if (!sw.active) {
      if (dx < 4) return;
      sw.active = true;
      slide.setup();
    }
    sw.samples.push({ x: e.clientX, t: Date.now() });
    if (sw.samples.length > 6) sw.samples.shift();
    slide.apply(Math.max(0, dx));
  });
  const finish = (e) => {
    if (!sw || (e && e.pointerId !== undefined && e.pointerId !== sw.id)) return;
    const { active, samples } = sw;
    const dx = e && e.clientX !== undefined ? e.clientX - sw.x0 : 0;
    sw = null;
    if (!active) return;
    // 幅の 35% を超えたら戻る。速く払ったとき（直近 0.1 秒の速さが 0.5px/ms 以上）は短い距離でも戻る
    const now = Date.now();
    const last = samples[samples.length - 1];
    const first = samples.find((p) => now - p.t <= 100) || last;
    const speed = last && first && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    const toList = dx > slide.width() * 0.35 || (speed >= 0.5 && dx > 24);
    slide.settle(toList ? slide.width() : 0, toList ? showCategoryList : null);
  };
  quests.addEventListener('pointerup', finish);
  quests.addEventListener('pointercancel', finish);
}

// --- 起動 -------------------------------------------------------------

function init() {
  injectCategoryIcons();
  state = loadState() || sampleState();
  state = migrate(state);
  saveState();
  render();

  document.getElementById('tabbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    switchTab(btn.dataset.tab);
  });
  // 記録・設定の × で元の画面（一覧またはやること画面）へ
  document.querySelectorAll('[data-page-close]').forEach((b) => b.addEventListener('click', () => switchTab('categories')));

  initOverview();
  initSwipeBack();
  initQuests();
  initSettings();
  initBulk();
  initLog();
  initEffects();
  initDialog();
  initTimer();
  render();
  // 前回見ていた画面（一覧かやること画面か）から始める。記録・設定は開いたまま終えても閉じた状態で始める
  loadScreen();
  if (sessionActive()) ui.showTasks = true; // 作業中はやること画面から始める
  if (ui.showTasks) renderQuests();
  switchTab('categories');

  document.getElementById('app-version').textContent = `やることクエスト ${APP_VERSION}`;
  // iOS はビューポート指定だけではピンチズームを止められないので、ジェスチャー自体を止める
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  measureInsets();
  setTimeout(measureInsets, 500);
  window.addEventListener('resize', measureInsets);
  window.addEventListener('pageshow', measureInsets);
  window.addEventListener('orientationchange', () => setTimeout(measureInsets, 300));
  document.getElementById('update-reload').addEventListener('click', () => {
    if (waitingWorker) waitingWorker.postMessage('skipWaiting');
    else window.location.reload();
  });
  registerServiceWorker();
}

document.addEventListener('DOMContentLoaded', init);
