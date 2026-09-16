// クエスト画面: やること一覧、追加・編集・削除、完了と取り消し

const DIFFICULTY_LABELS = { 1: '★', 2: '★★', 3: '★★★' };

// --- やることの操作 -----------------------------------------------------

// award: { xp, baseXp, bonusXp, combo, durationSec, remainingSec }（timer.js が計算する）
function completeTask(taskId, award, now = new Date()) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || task.done) return null;
  const xp = award.xp;
  const before = levelInfo(state.player.xp).level;

  const log = {
    taskId,
    doneAt: now.toISOString(),
    xp,
    baseXp: award.baseXp,
    bonusXp: award.bonusXp,
    combo: award.combo,
    durationSec: award.durationSec,
    remainingSec: award.remainingSec,
    prev: { done: task.done, lastDoneAt: task.lastDoneAt, dueAt: task.dueAt },
  };
  state.logs.push(log);
  state.player.xp += xp;

  if (task.repeat.type === 'none') {
    task.done = true;
    task.lastDoneAt = log.doneAt;
  } else {
    task.lastDoneAt = log.doneAt;
    task.dueAt = nextDueDate(now, task.repeat).toISOString();
  }

  const streak = currentStreak(state.logs, now);
  if (streak > state.player.bestStreak) state.player.bestStreak = streak;
  saveState();

  const after = levelInfo(state.player.xp).level;
  return { xp, levelUp: after > before ? after : null };
}

// 当日分の完了だけ取り消せる
// クエストクリアのボーナス: そのクエストの今日の分（やること）が全部終わった瞬間に、今日そのクエストでやり遂げた件数 × 10。
// 同じクエストで1日1回だけ（category.clearedAt の日付で判定）。まだ残りがある、または今日すでに付けたなら null
const QUEST_CLEAR_XP_PER_TASK = 10;
function questClearBonus(categoryId, now = new Date()) {
  const category = state.categories.find((c) => c.id === categoryId);
  if (!category) return null;
  const today = dateKey(now);
  if (category.clearedAt && dateKey(category.clearedAt) === today) return null;
  const remaining = state.tasks.some((t) => t.categoryId === categoryId && ['overdue', 'due', 'todo'].includes(taskStatus(t, now)));
  if (remaining) return null;
  const doneIds = new Set(state.logs.filter((l) => dateKey(l.doneAt) === today).map((l) => l.taskId));
  const count = state.tasks.filter((t) => t.categoryId === categoryId && doneIds.has(t.id)).length;
  if (!count) return null;
  return { count, xp: count * QUEST_CLEAR_XP_PER_TASK, name: category.name };
}

function undoComplete(taskId, now = new Date()) {
  const today = dateKey(now);
  for (let i = state.logs.length - 1; i >= 0; i--) {
    const log = state.logs[i];
    if (log.taskId !== taskId || dateKey(log.doneAt) !== today) continue;
    const task = state.tasks.find((t) => t.id === taskId);
    if (task && log.prev) {
      task.done = log.prev.done;
      task.lastDoneAt = log.prev.lastDoneAt;
      task.dueAt = log.prev.dueAt;
    }
    // クエストクリアのボーナスが付いた完了を取り消したら、もう一度やり終えたときにまた付けられるようにする
    if (log.questBonusXp && task) {
      const category = state.categories.find((c) => c.id === task.categoryId);
      if (category) category.clearedAt = null;
    }
    state.player.xp = Math.max(0, state.player.xp - log.xp);
    state.logs.splice(i, 1);
    saveState();
    return true;
  }
  return false;
}

// 「あとで」: 当日限りで後ろに回す
// クエスト内のやることを、いまやるを決める順に並べたもの
function categorySequence(categoryId, now = new Date()) {
  const entries = state.tasks.filter((t) => t.categoryId === categoryId)
    .map((task) => ({ task, status: taskStatus(task, now) }))
    .filter((e) => ['overdue', 'due', 'todo'].includes(e.status));
  return sortFocusOrder(entries, now).map((e) => e.task);
}

// スキップできるか: 同じクエストの中に、ひとつ後ろの候補があるか
function canDeferTask(task, now = new Date()) {
  const seq = categorySequence(task.categoryId, now);
  const i = seq.findIndex((t) => t.id === task.id);
  return i >= 0 && i < seq.length - 1;
}

// スキップ: クエスト内でひとつ後ろに回す（一覧には「スキップ済み」と出る）。入れ替えた相手のやることを返す。
// 期限切れのやることが期限切れでないやることを飛び越えるときは、今日だけ先頭固定を外す
function deferTask(taskId, now = new Date()) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  const seq = categorySequence(task.categoryId, now);
  const i = seq.findIndex((t) => t.id === task.id);
  if (i < 0 || i >= seq.length - 1) return null;
  const other = seq[i + 1];
  task.deferredAt = now.toISOString();
  if (isPinned(task, now) && !isPinned(other, now)) task.unpinnedAt = now.toISOString();
  const next = [...seq];
  [next[i], next[i + 1]] = [next[i + 1], next[i]];
  assignOrders(next);
  saveState();
  return other;
}

// 並び順の値を、いま持っている値を小さい順に配り直す（ほかのやることとの前後関係は保つ）
function assignOrders(tasks) {
  const slots = tasks.map(taskOrder).sort((a, b) => a - b);
  tasks.forEach((t, i) => { t.order = slots[i]; });
}

// 手動の並び順。新しいやることは末尾
function taskOrder(task) {
  return typeof task.order === 'number' ? task.order : 0;
}

function nextTaskOrder() {
  return state.tasks.reduce((m, t) => Math.max(m, taskOrder(t)), -1) + 1;
}

function isDeferredToday(task, now = new Date()) {
  return !!task.deferredAt && dateKey(task.deferredAt) === dateKey(now);
}

// やることの並び順: 日付が早い順（期限なしは最後）、同じ日なら登録が早い順。
// 「あとで」にしたものは、その日付の中で最後に回る（先送りが早い順）。先頭が「いまやる」になる
function dueDayKey(task) {
  const due = task.repeat.type === 'none' ? task.deadline : task.dueAt;
  return due ? dateKey(due) : '9999-99-99';
}

// 期限切れ: 日付（繰り返しは次回期限）が今日より前
function isPastDue(task, now = new Date()) {
  return dueDayKey(task) < dateKey(now);
}

// 先頭固定: 期限切れで、今日スキップで固定を外していないもの
function isPinned(task, now = new Date()) {
  const off = !!task.unpinnedAt && dateKey(task.unpinnedAt) === dateKey(now);
  return isPastDue(task, now) && !off;
}

// クエスト内の並び: 先頭固定（期限切れ）が先、あとは手動順
function sortFocusOrder(todoEntries, now = new Date()) {
  return [...todoEntries].sort((a, b) => {
    const pa = isPinned(a.task, now);
    const pb = isPinned(b.task, now);
    if (pa !== pb) return pa ? -1 : 1;
    return taskOrder(a.task) - taskOrder(b.task);
  });
}

// 「すべて」のときはクエストの並び順に分け、各クエスト内を標準の並びにする。絞り込み中は標準の並び
function orderTodo(todoEntries, now = new Date()) {
  if (ui.categoryFilter) return sortFocusOrder(todoEntries, now);
  const categories = [...state.categories].sort((a, b) => a.order - b.order);
  const out = [];
  for (const a of categories) out.push(...sortFocusOrder(todoEntries.filter((e) => e.task.categoryId === a.id), now));
  // どのクエストにも属さないものがあれば最後に
  const seen = new Set(out.map((e) => e.task.id));
  out.push(...sortFocusOrder(todoEntries.filter((e) => !seen.has(e.task.id)), now));
  return out;
}

function pickFocus(todoEntries, now = new Date()) {
  if (todoEntries.length === 0) return null;
  return orderTodo(todoEntries, now)[0];
}

const ICON_PAUSE = '<svg class="icon" aria-hidden="true"><use href="#i-pause"/></svg>';
const ICON_PLAY = '<svg class="icon" aria-hidden="true"><use href="#i-play"/></svg>';
const ICON_PLUS = '<svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg>';
const ICON_MINUS = '<svg class="icon" aria-hidden="true"><use href="#i-minus"/></svg>';
function plusBtn(sec) { return `<button class="qt-ctl" data-qt="plus" aria-label="10秒足す" ${sec >= 999 ? 'disabled' : ''}>${ICON_PLUS}</button>`; }
function minusBtn(sec) { return `<button class="qt-ctl" data-qt="minus" aria-label="10秒引く" ${sec <= 0 ? 'disabled' : ''}>${ICON_MINUS}</button>`; }

// 実行中のカードと同じ構造（透明な下敷き用）。待機中と次への待ちの高さを実行中とそろえるために使う
function runningBaseHtml(task, metaHtmlStr, seconds) {
  return `<div class="focus-title">${escapeHtml(task.title)}</div>
      <div class="focus-meta">${metaHtmlStr}</div>
      <div class="qt"><div class="qt-dial">${ringHtml(0)}<div class="qt-center"><div class="qt-seconds">${digitsHtml(seconds)}</div><div class="qt-slot"><button type="button" class="qt-ctl" tabindex="-1">${ICON_MINUS}</button><button type="button" class="qt-ctl" tabindex="-1">${ICON_PAUSE}</button><button type="button" class="qt-ctl" tabindex="-1">${ICON_PLUS}</button></div></div></div></div>
      <div class="qt-actions"><button type="button" class="btn btn-primary qt-main" tabindex="-1"><svg class="icon" aria-hidden="true"><use href="#i-check-box"/></svg> できた！</button><div class="qt-subrow"><button type="button" class="btn qt-small qt-quit" tabindex="-1">× やめる</button><button type="button" class="btn qt-small" tabindex="-1">スキップ</button></div></div>`;
}

function ringHtml(offset, color = null) {
  return `<svg class="qt-ring" viewBox="0 0 130 130"><g filter="url(#wobble)">
      <circle class="qt-track" cx="65" cy="65" r="54"/>
      <circle class="qt-fill" cx="65" cy="65" r="54" stroke-dasharray="${QT_LEN.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" ${color ? `style="stroke:${color}"` : ''}/>
      <circle class="qt-edge" cx="65" cy="65" r="58.5"/><circle class="qt-edge" cx="65" cy="65" r="49.5"/>
    </g></svg>`;
}

// メモがあるやることには、クエスト・難易度などの行の後ろにメモ紙のアイコンを出す。押すとメモをモーダルで見る
function noteBtn(task) {
  return task && task.note ? `<button type="button" class="note-btn" data-qt="note" aria-label="メモを見る" title="メモ"><svg class="icon" aria-hidden="true"><use href="#i-note"/></svg></button>` : '';
}

function comboBadge(combo) {
  const zero = combo <= 0;
  return `<span class="focus-combo ${zero ? 'is-zero' : ''}"><svg class="icon icon-flame ${zero ? 'icon-off' : ''}" aria-hidden="true"><use href="#i-flame"/></svg>${combo}コンボ</span>`;
}

// 「いまやる」カード。セッションの状態に応じてタイマーとボタンを出し分ける
// やることがないときのカードの文言。状況で変える
//   none: 開いているクエストにやることが1つもない / cleared: 今日やって空になった / rest: 今日の分はなく次回待ちだけ
function emptyFocusHtml(kind, doneCount = 0) {
  const sparkle = iconHtml('i-sparkle', 'icon icon-sparkle');
  if (kind === 'none') {
    return `<div class="focus-empty"><strong>まだやることがありません</strong><span>右下の「＋」から、最初のやることを書き出そう</span></div>`;
  }
  if (kind === 'cleared') {
    return `<div class="focus-empty"><strong>クエストクリア！ ${sparkle}</strong><span>今日は ${doneCount} 件やり遂げました。おつかれさま！</span>
      <button class="btn focus-empty-btn" data-back-to-list>ほかのクエストをやる</button></div>`;
  }
  return `<div class="focus-empty"><strong>今日のやることはありません</strong><span>次回待ちのやることが来るまで、ひと休み ${sparkle}</span></div>`;
}

function renderFocusCard(entry, categoryName, now, empty = { kind: 'rest', doneCount: 0 }) {
  const s = state.session;
  const phase = sessionPhase();
  // やることがなければ空のカード（まとめの表示中も、後ろに空のやることを出さない）
  if (!entry && (phase === 'idle' || phase === 'summary')) {
    return `<div class="focus-card is-empty" data-empty="${empty.kind}">${emptyFocusHtml(empty.kind, empty.doneCount)}</div>`;
  }
  const task = entry ? entry.task : null;
  const status = entry ? entry.status : 'todo';
  const inSession = phase !== 'idle' && phase !== 'summary';
  // 情報行（HTML）。一時停止中・時間切れは日付の代わりにその状態を出す
  const head = task ? [categoryName, DIFFICULTY_LABELS[task.difficulty], repeatLabel(task.repeat)] : [];
  let meta = '';
  if (task && phase === 'paused') meta = [...head, '一時停止中'].filter(Boolean).map((p) => escapeHtml(p)).join(' · ');
  else if (task && phase === 'running' && s.timedOut) meta = [...head, '時間切れ'].filter(Boolean).map((p) => escapeHtml(p)).join(' · ');
  else if (task) meta = metaHtml(task, status, now, head);

  // リング
  let seconds = task ? (QUEST_SECONDS[task.difficulty] || QUEST_SECONDS[1]) + (phase === 'idle' ? idleExtraFor(task.id) : 0) : 0;
  let offset = 0;
  let ringStroke = null; // 実行中だけ残り割合の色。一時停止・時間切れは CSS の色
  let qtCls = '';
  let slot = task ? `${minusBtn(seconds)}<button class="qt-ctl" data-qt="start" aria-label="はじめる">${ICON_PLAY}</button>${plusBtn(seconds)}` : '';
  if (phase === 'running' || phase === 'paused') {
    const rem = questRemainingSec(s);
    seconds = rem;
    offset = QT_LEN * (1 - rem / s.durationSec);
    if (s.timedOut) {
      qtCls = 'is-timeup';
      slot = `${minusBtn(0)}<div class="qt-timeup">時間切れ</div>${plusBtn(0)}`;
    } else if (phase === 'paused') {
      qtCls = 'is-paused';
      slot = `${minusBtn(rem)}<button class="qt-ctl" data-qt="resume" aria-label="再開">${ICON_PLAY}</button>${plusBtn(rem)}`;
    } else {
      ringStroke = ringColor(rem / s.durationSec);
      slot = `${minusBtn(rem)}<button class="qt-ctl" data-qt="pause" aria-label="一時停止">${ICON_PAUSE}</button>${plusBtn(rem)}`;
    }
  } else if (phase === 'idle') {
    // 待機中: リングとスキップは出さず、タイトルと秒数を次への待ちと同じ大きさで出す。
    // 高さは実行中のカードと同じにする（実行中と同じ構造を透明な下敷きにして、その上に重ねる）
    return `<div class="focus-card focus-card--idle" data-phase="idle" data-task-id="${task.id}">
      ${runningBaseHtml(task, meta, seconds)}
      <div class="cd-overlay">
        <div class="cd-body">
          <div class="cd-title">${escapeHtml(task.title)}<span class="cd-sec">（${seconds}秒）</span></div>
          <div class="cd-meta">${meta}${noteBtn(task)}</div>
        </div>
        <div class="qt-actions">
          <button class="btn btn-primary qt-main is-start" data-qt="start">${ICON_PLAY} はじめる</button>
          <div class="qt-subrow"><span class="btn qt-small is-ghost">スキップ</span></div>
        </div>
      </div>
    </div>`;
  } else if (phase === 'countdown') {
    // 次への待ち: 待機中と同じ並び（タイトル、秒数、情報）の下にカウントダウンの数字を大きく出す。高さは実行中と同じ
    const cdMeta = metaHtml(task, status, now, head);
    const canSkip = !!task && canDeferTask(task, now); // 同じクエストにひとつ後ろの候補がなければ押せない（まとめ中はやることがないこともある）
    const left = Math.max(1, countdownRemainingSec(s));
    return `<div class="focus-card focus-card--countdown is-session" data-phase="countdown" data-task-id="${task.id}">
      ${runningBaseHtml(task, cdMeta, s.durationSec)}
      <div class="cd-overlay">
        <div class="cd-body">
          <div class="cd-title">${escapeHtml(task.title)}<span class="cd-sec">（${s.durationSec}秒）</span></div>
          <div class="cd-meta">${cdMeta}${noteBtn(task)}</div>
          <div class="cd-num is-pop" data-value="${left}">${left}</div>
        </div>
        <div class="qt-actions">
          <div class="qt-subrow">
            <button class="btn qt-small qt-quit" data-qt="quit">× やめる</button>
            <button class="btn qt-small" data-qt="skip" ${canSkip ? '' : 'disabled'}>スキップ</button>
          </div>
        </div>
      </div>
    </div>`;
  } else if (phase === 'done') {
    // 完了演出の間は、完了した時点の残り秒数とリングをそのまま見せる（戻ったように見せない）
    const lc = s.lastClear;
    if (lc && lc.durationSec) {
      const shown = lc.shownRemainingSec !== undefined ? lc.shownRemainingSec : lc.remainingSec;
      seconds = shown;
      offset = QT_LEN * (1 - shown / lc.durationSec);
    }
    slot = '';
  } else if (phase === 'break' || phase === 'summary') {
    slot = '';
  }

  // ボタン
  let main;
  let sub;
  {
    const canComplete = phase === 'running' || phase === 'paused';
    main = `<button class="btn btn-primary qt-main" data-qt="complete" ${canComplete ? '' : 'disabled'}><svg class="icon" aria-hidden="true"><use href="#i-check-box"/></svg> できた！</button>`;
    // 「× やめる」の右に「スキップ」（いまのやることをひとつ後ろに回し、入れ替わったやることで待ち直す）
    const canSkip = !!task && canDeferTask(task, now); // 同じクエストにひとつ後ろの候補がなければ押せない（まとめ中はやることがないこともある）
    sub = `<button class="btn qt-small qt-quit" data-qt="quit">× やめる</button><button class="btn qt-small" data-qt="skip" ${canSkip ? '' : 'disabled'}>スキップ</button>`;
  }

  // コンボはタイマーの右上に円で出す（2コンボ以上のときだけ）
  const comboCircle = inSession && s.combo >= 2
    ? `<div class="qt-combo"><strong>${s.combo}</strong><small>コンボ</small></div>`
    : '';
  return `<div class="focus-card ${comboCircle ? 'has-combo' : ''} ${inSession ? 'is-session' : ''}" data-phase="${phase}" data-task-id="${task ? task.id : ''}">
    <div class="focus-title">${task ? escapeHtml(task.title) : ''}</div>
    <div class="focus-meta">${meta}${noteBtn(task)}</div>
    <div class="qt ${qtCls}">
      <div class="qt-dial">
        ${ringHtml(offset, ringStroke)}
        <div class="qt-center"><div class="qt-seconds">${digitsHtml(seconds)}</div><div class="qt-slot">${slot}</div></div>
      </div>
    </div>
    <div class="qt-actions">
      ${main}
      <div class="qt-subrow">${sub}</div>
    </div>
    ${comboCircle}
  </div>`;
}

// 登録ボーナス: 追加で +1 XP、削除で -1 XP（0 未満にはしない。境目をまたげばレベルは下がる）
const ADD_XP = 1;

function addRegisterXp() {
  state.player.xp += ADD_XP;
}

function removeRegisterXp(count = 1) {
  state.player.xp = Math.max(0, state.player.xp - ADD_XP * count);
}

function upsertTask(data) {
  const now = new Date().toISOString();
  if (data.id) {
    const task = state.tasks.find((t) => t.id === data.id);
    if (!task) return;
    const repeatChanged = JSON.stringify(task.repeat) !== JSON.stringify(data.repeat);
    if (task.categoryId !== data.categoryId) task.order = nextTaskOrder(); // クエストを変えたら移った先の末尾に
    Object.assign(task, {
      title: data.title,
      categoryId: data.categoryId,
      difficulty: data.difficulty,
      repeat: data.repeat,
      deadline: data.deadline,
      note: data.note,
    });
    if (task.repeat.type === 'none') {
      task.dueAt = null;
    } else if (repeatChanged && task.lastDoneAt) {
      task.dueAt = nextDueDate(new Date(task.lastDoneAt), task.repeat).toISOString();
    }
  } else {
    state.tasks.push({
      id: newId('t'),
      categoryId: data.categoryId,
      title: data.title,
      difficulty: data.difficulty,
      repeat: data.repeat,
      note: data.note,
      deadline: data.deadline,
      deferredAt: null,
      unpinnedAt: null,
      lastDoneAt: null,
      dueAt: null,
      done: false,
      createdAt: now,
      order: nextTaskOrder(),
    });
    addRegisterXp();
  }
  saveState();
}

function deleteTask(taskId) {
  const before = state.tasks.length;
  state.tasks = state.tasks.filter((t) => t.id !== taskId);
  if (state.tasks.length < before) removeRegisterXp();
  saveState();
}

// --- 一覧の描画 -------------------------------------------------------

function dueText(task, status, now) {
  if (status === 'overdue') {
    const d = daysBetween(task.deadline, now);
    return d === 0 ? '今日まで' : `${d}日遅れ`;
  }
  if (status === 'due') {
    if (!task.dueAt) return '初回';
    const d = daysBetween(task.dueAt, now);
    return d === 0 ? '今日' : `${d}日遅れ`;
  }
  if (status === 'todo' && task.deadline) return dateKey(task.deadline) === dateKey(now) ? '今日まで' : `${formatShortDate(task.deadline)}まで`;
  if (status === 'fresh') return `次は ${formatShortDate(task.dueAt)}`;
  return '';
}

// 日付の区分: over（期限切れ = 今日より前）/ today（今日）/ ''（それ以外・日付なし）。行と情報行の色分けに使う
function dueKind(task, now = new Date()) {
  if (task.done) return '';
  const key = dueDayKey(task);
  if (key === '9999-99-99') return '';
  const today = dateKey(now);
  if (key < today) return 'over';
  if (key === today) return 'today';
  return '';
}

// 情報行（クエスト · 難易度 · 繰り返し · 日付 …）を HTML にする。日付の部分は期限切れを赤、今日を橙で強調する
function metaHtml(task, status, now, extra = []) {
  const kind = dueKind(task, now);
  const due = dueText(task, status, now);
  const parts = extra.map((p) => escapeHtml(p));
  if (due) parts.push(kind ? `<span class="due-${kind}">${escapeHtml(due)}</span>` : escapeHtml(due));
  return parts.filter(Boolean).join(' · ');
}

function sortDue(a, b) {
  const rank = { overdue: 0, due: 1, todo: 2 };
  if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
  const ka = a.task.deadline || a.task.dueAt || '9999';
  const kb = b.task.deadline || b.task.dueAt || '9999';
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

function taskRow(entry, categoryName, now, mode, canDrag = false) {
  const { task, status } = entry;
  const isFocus = mode === 'todo' && task.id === ui.focusTaskId;
  const cat = state.categories.find((a) => a.id === task.categoryId);
  const meta = [metaHtml(task, status, now, [categoryName, DIFFICULTY_LABELS[task.difficulty], repeatLabel(task.repeat)]),
    isDeferredToday(task, now) ? 'スキップ済み' : '']
    .filter(Boolean).join(' · ');
  let action;
  if (mode === 'undo') {
    action = `<button class="task-undo" data-undo="${task.id}">取り消す</button>`;
  } else if (mode === 'done') {
    action = '<span class="task-check is-done" aria-hidden="true">✓</span>';
  } else if (mode === 'wait') {
    action = '<span class="task-check is-wait" aria-hidden="true"></span>';
  } else {
    action = categoryIconHtml(cat, 'cat-icon cat-icon--row'); // クエストの色とアイコン
  }
  // やることの行は、セッション中でなければつまみ（≡）で並べ替えられる。
  // 期限切れは先頭に固定なので出さない。動かせる行が1つしかない一覧でも出さない（canDrag）
  const fixed = mode === 'todo' && isPinned(task, now);
  const grip = mode === 'todo' && canDrag && !sessionActive() && !fixed
    ? '<span class="drag-grip" aria-label="押したまま動かして並べ替え" title="押したまま動かして並べ替え"><svg class="icon" aria-hidden="true"><use href="#i-grip"/></svg></span>'
    : '';
  return `<li class="task-row ${fixed ? 'is-fixed' : ''} ${isFocus ? 'is-focus' : ''}" data-status="${status}" data-due="${mode === 'todo' ? dueKind(task, now) : ''}" data-id="${task.id}">
    ${action}
    <button class="task-body" data-edit="${task.id}">
      <span class="task-title">${isFocus ? '<span class="task-focus-mark">いまやる</span>' : ''}${escapeHtml(task.title)}</span>
      <span class="task-meta">${meta}</span>
    </button>
    ${grip}
  </li>`;
}

function renderQuests() {
  const now = new Date();
  const today = dateKey(now);
  const categoryName = Object.fromEntries(state.categories.map((a) => [a.id, a.name]));

  // 見出し: いま開いているクエスト（「すべて」か1つのクエスト）
  const categories = [...state.categories].sort((a, b) => a.order - b.order);
  const byCategory = !ui.categoryFilter;
  const current = ui.categoryFilter ? state.categories.find((c) => c.id === ui.categoryFilter) : null;
  document.getElementById('tasks-heading').innerHTML = current
    ? `${categoryIconHtml(current, 'cat-icon cat-icon--sm')}<span>${escapeHtml(current.name)}</span>`
    : '<span class="cat-icon cat-icon--sm"><svg class="icon" aria-hidden="true"><use href="#i-scroll"/></svg></span><span>すべて</span>';

  const tasks = state.tasks.filter((t) => !ui.categoryFilter || t.categoryId === ui.categoryFilter);
  const doneTodayIds = new Set(state.logs.filter((l) => dateKey(l.doneAt) === today).map((l) => l.taskId));

  const entries = tasks.map((task) => ({ task, status: taskStatus(task, now) }));
  const todo = entries.filter((e) => ['overdue', 'due', 'todo'].includes(e.status)).sort(sortDue);
  const doneToday = entries.filter((e) => doneTodayIds.has(e.task.id));
  const waiting = entries.filter((e) => e.status === 'fresh' && !doneTodayIds.has(e.task.id))
    .sort((a, b) => (a.task.dueAt < b.task.dueAt ? -1 : 1));
  const finished = entries.filter((e) => e.status === 'done' && !doneTodayIds.has(e.task.id));

  const row = (mode, canDrag = false) => (e) => taskRow(e, categoryName[e.task.categoryId] || '', now, mode, canDrag);
  // 動かせる行（期限切れでない）が2つ以上ある一覧だけ、つまみを出す
  const dragOk = (list) => list.filter((e) => !isPinned(e.task, now)).length >= 2;
  let html = '';

  // いまやる1つ。セッション中はセッションが持っているクエスト
  let focus = pickFocus(todo, now);
  if (state.session && state.session.taskId && state.session.phase !== 'summary') {
    const st = state.tasks.find((t) => t.id === state.session.taskId);
    if (st) focus = { task: st, status: taskStatus(st, now) };
  }
  // やることがないときの文言: 1つもない / 今日やって空になった / 次回待ちだけ
  const emptyKind = tasks.length === 0 ? 'none' : (doneToday.length > 0 ? 'cleared' : 'rest');
  const focusHtml = renderFocusCard(focus, focus ? categoryName[focus.task.categoryId] || '' : '', now, { kind: emptyKind, doneCount: doneToday.length });
  document.getElementById('focus-quests').innerHTML = focusHtml;
  ui.focusTaskId = focus ? focus.task.id : null;
  // 作業中（次への待ち〜完了演出）はカード以外を覆って操作できなくする。まとめの間は外す
  const shade = document.getElementById('session-shade');
  const headerShade = document.getElementById('header-shade'); // ヘッダーは別の覆いで隠す（iOS 対策）
  const shadeOn = !!state.session && state.session.phase !== 'summary';
  if (shadeOn && shade.hidden) {
    document.querySelector('.main').scrollTo(0, 0); // カードが見えるように上へ
    fadeInSession(shade, headerShade);
  } else {
    shade.hidden = !shadeOn;
    headerShade.hidden = !shadeOn;
  }

  updateFabs(); // 作業中はやることの「＋」を隠す（右下の固定ボタンは覆いの上に浮くため）

  // 「やること」の一覧は「いまやる」と同じ規則で並べ、いまやるも含めてクエスト内の並びをそのまま出す（先頭がいまやる）
  const others = orderTodo(todo, now);
  if (others.length) {
    let body;
    if (byCategory) {
      // クエストごとに分けて、クエストの並び順で見出しを付ける。各クエスト内は標準の並び
      body = categories.map((a) => {
        const list = others.filter((e) => e.task.categoryId === a.id);
        if (!list.length) return '';
        return `<h3 class="quest-subheading">${categoryIconHtml(a, 'cat-icon cat-icon--sm')}${escapeHtml(a.name)} <span class="count">${list.length}</span></h3>
          <ul class="task-list" data-list="todo" data-category="${a.id}">${list.map(row('todo', dragOk(list))).join('')}</ul>`;
      }).join('');
    } else {
      body = `<ul class="task-list" data-list="todo" data-category="${ui.categoryFilter}">${others.map(row('todo', dragOk(others))).join('')}</ul>`;
    }
    html += `<details class="quest-section quest-details" data-section="todo" ${ui.sections.todo ? 'open' : ''}>
      <summary class="quest-heading">やること <span class="count">${others.length}</span></summary>
      ${body}
    </details>`;
  }

  if (doneToday.length) {
    html += `<details class="quest-section quest-details" data-section="done" ${ui.sections.done ? 'open' : ''}>
      <summary class="quest-heading">今日やった <span class="count">${doneToday.length}</span></summary>
      <ul class="task-list" data-list="undo">${doneToday.map(row('undo')).join('')}</ul>
    </details>`;
  }
  if (waiting.length) {
    html += `<details class="quest-section quest-details">
      <summary class="quest-heading">次回待ち <span class="count">${waiting.length}</span></summary>
      <ul class="task-list" data-list="wait">${waiting.map(row('wait')).join('')}</ul>
    </details>`;
  }
  if (finished.length) {
    html += `<details class="quest-section quest-details">
      <summary class="quest-heading">やったこと <span class="count">${finished.length}</span></summary>
      <ul class="task-list" data-list="done">${finished.map(row('done')).join('')}</ul>
    </details>`;
  }
  if (state.tasks.length === 0) {
    html = '<p class="quest-empty">右下の「＋」から最初のやることを登録しましょう。</p>';
  }
  document.getElementById('quest-list').innerHTML = html;
  markEnteringRows();
  // 折りたたみの開閉を覚える
  document.querySelectorAll('#quest-list details[data-section]').forEach((details) => {
    details.addEventListener('toggle', () => {
      ui.sections[details.dataset.section] = details.open;
      saveSections();
    });
  });
  // 折りたたみを指で開いたときは、中身が上からするっと出る（描き直しで開いた状態になったときは動かさない）
  document.querySelectorAll('#quest-list details.quest-details').forEach((details) => {
    details.querySelector('summary').addEventListener('click', () => { details.dataset.byUser = details.open ? '' : '1'; });
    details.addEventListener('toggle', () => {
      if (!details.open || !details.dataset.byUser) return;
      details.dataset.byUser = '';
      unfold(details.querySelector(':scope > :not(summary)'));
    });
  });
}

// 一覧の行の出入り: 前回の描画になかった行（完了して「今日やった」に移った、追加した、取り消した）は下からふわっと入る。
// 画面を開いた直後やクエストを切り替えた直後は、全部が新しいので動かさない
let renderedRowKeys = null;
let renderedRowScope = null;
function markEnteringRows() {
  const keys = new Set();
  document.querySelectorAll('#quest-list .task-list').forEach((ul) => {
    ul.querySelectorAll('.task-row[data-id]').forEach((li) => keys.add(`${ul.dataset.list}:${ul.dataset.category || ''}:${li.dataset.id}`));
  });
  const scope = String(ui.categoryFilter);
  const animate = renderedRowKeys && renderedRowScope === scope && !document.getElementById('view-quests').hidden
    && !(typeof reducedMotion === 'function' && reducedMotion());
  if (animate) {
    document.querySelectorAll('#quest-list .task-list').forEach((ul) => {
      ul.querySelectorAll('.task-row[data-id]').forEach((li) => {
        if (!renderedRowKeys.has(`${ul.dataset.list}:${ul.dataset.category || ''}:${li.dataset.id}`)) li.classList.add('is-entering');
      });
    });
  }
  renderedRowKeys = keys;
  renderedRowScope = scope;
}

// 行をすっと縮めて消してから then() を呼ぶ（取り消しなど、少し待っても困らない操作に使う）
function leaveRow(row, then) {
  if (!row || (typeof reducedMotion === 'function' && reducedMotion())) { then(); return; }
  row.style.height = `${row.getBoundingClientRect().height}px`;
  void row.offsetWidth;
  row.classList.add('is-leaving');
  setTimeout(then, 200);
}

// 折りたたみの中身を上からするっと出す
function unfold(body) {
  if (!body || (typeof reducedMotion === 'function' && reducedMotion())) return;
  body.classList.add('is-unfolding');
  void body.offsetWidth;
  body.classList.remove('is-unfolding');
}

// 並べ替えのドロップ: 収まった行が「トンッ」と落ち着く
function settleRow(selector) {
  const row = document.querySelector(selector);
  if (row) row.classList.add('is-dropped');
}

// 「いまやる」カードの写し（入れ替わりの動きに使う）
function focusSnapshot() {
  const card = document.querySelector('#focus-quests > .focus-card');
  return card ? { id: card.dataset.taskId || '', html: card.outerHTML } : null;
}

// 「いまやる」カードの入れ替わり: 古いカードの写しを重ねて外へ動かし、新しいカードを外から入れる。
// dir: 'up'（完了して次へ: 古いのが上へ抜け、次が下から）/ 'left'（スキップ: 古いのが左へ抜け、次が右から）。
// カードは描き直しのたびに作り直されるので、動きは入れ物（#focus-quests）と写しに付ける
let swapTimer = null;
function swapFocusCard(before, dir) {
  const wrap = document.getElementById('focus-quests');
  const card = wrap.querySelector(':scope > .focus-card');
  if (!before || !card || (card.dataset.taskId || '') === before.id) return;
  if (typeof reducedMotion === 'function' && reducedMotion()) return;
  clearTimeout(swapTimer);
  wrap.querySelectorAll('.focus-ghost').forEach((g) => g.remove());
  wrap.classList.remove('swap-up', 'swap-left');
  const ghost = document.createElement('div');
  ghost.className = 'focus-ghost';
  ghost.innerHTML = before.html;
  wrap.classList.add('is-swapping', `swap-${dir}`);
  card.classList.add('is-arriving');
  wrap.appendChild(ghost);
  void wrap.offsetWidth; // 古いのを定位置、新しいのを外に置いた状態を先に描く
  ghost.classList.add('is-gone');
  card.classList.remove('is-arriving');
  swapTimer = setTimeout(() => {
    ghost.remove();
    wrap.classList.remove('is-swapping', 'swap-up', 'swap-left');
  }, 380);
}

// 「できた！」を押した瞬間、カードがぷるっと弾む
function bumpFocusCard() {
  if (typeof reducedMotion === 'function' && reducedMotion()) return;
  const wrap = document.getElementById('focus-quests');
  wrap.classList.remove('is-bump');
  void wrap.offsetWidth;
  wrap.classList.add('is-bump');
  setTimeout(() => wrap.classList.remove('is-bump'), 350);
}

// --- 追加・編集シート -------------------------------------------------

function openTaskSheet(taskId = null) {
  const form = document.getElementById('task-form');
  const task = taskId ? state.tasks.find((t) => t.id === taskId) : null;
  const categories = [...state.categories].sort((a, b) => a.order - b.order);

  form.elements.id.value = task ? task.id : '';
  form.elements.title.value = task ? task.title : '';
  form.elements.categoryId.innerHTML = categories.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  form.elements.categoryId.value = task ? task.categoryId : (ui.categoryFilter || (categories[0] && categories[0].id) || '');
  form.elements.difficulty.value = task ? String(task.difficulty) : '1';
  form.elements.repeatType.value = task ? task.repeat.type : 'none';
  form.elements.repeatEvery.value = task && task.repeat.type === 'days' ? task.repeat.every : 3;
  form.elements.deadline.value = task && task.deadline ? dateKey(task.deadline) : '';
  form.elements.note.value = task ? task.note : '';
  form.elements.bulk.value = '';
  // 追加のときだけ「ひとつずつ / まとめて」を選べる（前回選んだ方を出す）。編集はひとつずつ
  document.getElementById('task-mode-wrap').hidden = !!task;
  form.elements.mode.value = task ? 'single' : lastAddMode;
  document.getElementById('task-sheet-title').textContent = task ? 'やることを編集' : 'やることを追加';
  document.getElementById('task-delete').hidden = !task;
  updateTaskFormVisibility();
  showSheet(document.getElementById('task-sheet'));
  setTimeout(() => taskFormMainInput().focus(), 320); // シートが上がりきってから（途中で入力欄に移るとキーボードで位置が飛ぶ）
}

// 追加のしかた。'single' = ひとつずつ、'bulk' = まとめて（1行に1つ）
let lastAddMode = 'single';
function taskAddMode() {
  const form = document.getElementById('task-form');
  return form.elements.id.value ? 'single' : form.elements.mode.value;
}
function taskFormMainInput() {
  const form = document.getElementById('task-form');
  return taskAddMode() === 'bulk' ? form.elements.bulk : form.elements.title;
}

function closeTaskSheet() {
  hideSheet(document.getElementById('task-sheet'));
}

function updateTaskFormVisibility() {
  const form = document.getElementById('task-form');
  const type = form.elements.repeatType.value;
  const bulk = taskAddMode() === 'bulk';
  form.querySelectorAll('.task-single').forEach((el) => { el.hidden = bulk; });
  form.querySelectorAll('.task-bulk').forEach((el) => { el.hidden = !bulk; });
  document.getElementById('repeat-every-wrap').hidden = bulk || type !== 'days';
  document.getElementById('deadline-wrap').hidden = bulk || type !== 'none';
}

// 「まとめて」の保存: 1行に1つを選んだクエストに登録する。読み飛ばした行はトーストで知らせる
function submitBulkTasks(form) {
  const text = form.elements.bulk.value;
  const category = state.categories.find((c) => c.id === form.elements.categoryId.value);
  if (!bulkTrim(text)) { form.elements.bulk.focus(); showToast('1行に1つずつ入力してください'); return; }
  if (!category) { showToast('先にクエスト一覧でクエストを作ってください'); return; }
  const plan = parseBulkText(text, state.categories, state.tasks, { fixedCategory: category });
  const skipped = Object.values(plan.skipped).reduce((a, b) => a + b, 0);
  if (!plan.entries.length) {
    form.elements.bulk.focus();
    showToast(plan.skipped.duplicate === skipped && skipped > 0 ? 'すべて登録済みのやることです' : '読める行がありません（日付や難易度を確かめてください）');
    return;
  }
  const at = centerOf(form.querySelector('button[type="submit"]'));
  const result = applyBulkPlan(plan);
  closeTaskSheet();
  render();
  floatText(at.x, at.y, `+${result.tasks} XP`, false, true);
  setTimeout(pulseXpBar, 250);
  showToast(`${result.tasks} 件を追加しました${skipped ? `（${skipped} 行は読み飛ばし）` : ''}`);
}

function readTaskForm() {
  const form = document.getElementById('task-form');
  const type = form.elements.repeatType.value;
  const repeat = type === 'days'
    ? { type, every: Math.max(1, parseInt(form.elements.repeatEvery.value, 10) || 1) }
    : { type };
  const deadlineValue = form.elements.deadline.value;
  let deadline = null;
  if (type === 'none' && deadlineValue) {
    // 日付の 23:59:59 を期限にする
    const d = new Date(`${deadlineValue}T23:59:59`);
    if (!Number.isNaN(d.getTime())) deadline = d.toISOString();
  }
  return {
    id: form.elements.id.value || null,
    title: form.elements.title.value.trim(),
    categoryId: form.elements.categoryId.value,
    difficulty: parseInt(form.elements.difficulty.value, 10) || 1,
    repeat,
    deadline,
    note: form.elements.note.value.trim(),
  };
}

// --- トースト ---------------------------------------------------------

// 作業の始まり: 覆いとカードをふわっと出す（覆いはその場でフェード、カードは少し小さい状態から広がる）。
// カードは描き直しのたびに作り直されるので、動きは入れ物（#focus-quests）に付ける
let sessionFadeTimer = null;
function fadeInSession(shade, headerShade) {
  const wrap = document.getElementById('focus-quests');
  shade.hidden = false;
  headerShade.hidden = false;
  if (typeof reducedMotion === 'function' && reducedMotion()) return;
  clearTimeout(sessionFadeTimer);
  const els = [shade, headerShade, wrap];
  els.forEach((el) => el.classList.add('is-fading'));
  wrap.classList.add('is-lifted');
  void wrap.offsetWidth; // 薄い状態をいったん描いてから濃くする（iOS でも確実に動く）
  els.forEach((el) => el.classList.remove('is-fading'));
  sessionFadeTimer = setTimeout(() => wrap.classList.remove('is-lifted'), 400);
}

// メモのモーダル
function showNoteModal(taskId, fromEl = null) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || !task.note) return;
  document.getElementById('note-body').innerHTML = linkifyHtml(task.note);
  const modal = document.getElementById('note-modal');
  modal.hidden = false;
  // 押したアイコンの位置から広がって出る
  const card = modal.querySelector('.note-card');
  card.classList.remove('is-growing');
  if (fromEl && !(typeof reducedMotion === 'function' && reducedMotion())) {
    const cr = card.getBoundingClientRect();
    const br = fromEl.getBoundingClientRect();
    card.style.transformOrigin = `${br.left + br.width / 2 - cr.left}px ${br.top + br.height / 2 - cr.top}px`;
    void card.offsetWidth;
    card.classList.add('is-growing');
  }
}
function hideNoteModal() {
  document.getElementById('note-modal').hidden = true;
}

let toastTimer = null;
function showToast(message, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  const header = document.querySelector('.header');
  if (header) el.style.setProperty('--toast-top', `${Math.round(header.getBoundingClientRect().bottom) + 8}px`);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

// --- イベント ---------------------------------------------------------

// 「やること」の一覧の並べ替え。一覧にはいまやるも入っているので、一覧の順がそのままクエスト内の手動順になる
// （先頭に置いたやることがいまやるになる）
function reorderTasksFromList(row, ul) {
  const ids = [...ul.querySelectorAll('.task-row')].map((r) => r.dataset.id);
  assignOrders(ids.map((id) => state.tasks.find((t) => t.id === id)).filter(Boolean));
  saveState();
}

function initQuests() {
  document.getElementById('note-close').addEventListener('click', hideNoteModal);
  const noteModal = document.getElementById('note-modal');
  noteModal.addEventListener('click', (e) => { if (e.target === noteModal) hideNoteModal(); });
  document.getElementById('tasks-back').addEventListener('click', () => slideOutTasks()); // 右スワイプと同じ動きで一覧へ
  document.getElementById('focus-quests').addEventListener('click', (e) => {
    if (e.target.closest('[data-back-to-list]')) showCategoryList();
  });
  makeSortable(document.getElementById('view-quests'), {
    row: '.task-row',
    grip: '.drag-grip',
    fixed: '.is-fixed', // 期限切れの行。動かせず、その上にも置けない
    onDrop: (row, ul, info) => {
      if (info.moved && !sessionActive()) reorderTasksFromList(row, ul);
      render();
      settleRow(`#quest-list .task-row[data-id="${row.dataset.id}"]`);
    },
  });

  const handleTaskAction = (e) => {
    const qt = e.target.closest('[data-qt]');
    if (qt) {
      const action = qt.dataset.qt;
      if (action === 'start') {
        const card = qt.closest('.focus-card');
        const focus = card && card.dataset.phase === 'idle' ? pickNextQuest() : null;
        if (focus) startSession(focus.id);
      } else if (action === 'pause') pauseQuest();
      else if (action === 'resume') resumeQuest();
      else if (action === 'complete') { bumpFocusCard(); completeQuest(); }
      else if (action === 'quit') quitSession();
      else if (action === 'plus') adjustSeconds(ADJUST_SEC);
      else if (action === 'minus') adjustSeconds(-ADJUST_SEC);
      else if (action === 'skip') { const before = focusSnapshot(); skipQuest(); swapFocusCard(before, 'left'); }
      else if (action === 'note') showNoteModal(qt.closest('.focus-card').dataset.taskId, qt);
      return;
    }
    const undo = e.target.closest('[data-undo]');
    if (undo) {
      // 行をすっと消してから「やること」に戻す
      leaveRow(undo.closest('.task-row'), () => {
        if (undoComplete(undo.dataset.undo)) {
          showToast('取り消しました');
          render();
        } else render();
      });
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      if (sessionActive()) { showToast('作業中は編集できません'); return; }
      openTaskSheet(edit.dataset.edit);
      return;
    }
    // いまやるカードのタップでは編集しない（編集は一覧の行から）
  };
  document.getElementById('quest-list').addEventListener('click', handleTaskAction);
  document.getElementById('focus-quests').addEventListener('click', handleTaskAction);

  document.getElementById('add-task-btn').addEventListener('click', () => { if (!sessionActive() && !sheetJustClosed()) openTaskSheet(); });

  const sheet = document.getElementById('task-sheet');
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeTaskSheet(); });
  document.getElementById('task-cancel').addEventListener('click', closeTaskSheet);

  const form = document.getElementById('task-form');
  form.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => {
    lastAddMode = form.elements.mode.value;
    updateTaskFormVisibility();
    taskFormMainInput().focus();
  }));
  form.elements.repeatType.addEventListener('change', updateTaskFormVisibility);
  // 日付やプルダウンの選択パネルが開いたままだと最初のクリックがパネルを閉じるのに使われるので、
  // 選び終えたらすぐ選択を外し、保存は押し始めた瞬間（pointerdown）にも受け付ける
  ['deadline', 'categoryId', 'repeatType'].forEach((name) => {
    form.elements[name].addEventListener('change', () => form.elements[name].blur());
  });
  let lastSubmit = 0;
  let fromPointer = false;
  form.querySelector('button[type="submit"]').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // 標準のフォーカス移動を止める（入力欄からフォーカスが外れてキーボードが閉じるのを防ぐ）
    fromPointer = true;
    form.requestSubmit();
    fromPointer = false;
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!fromPointer && Date.now() - lastSubmit < 400) {
      // pointerdown で処理した直後のクリック分は無視。入力が空のままなら、指を離したあとも入力欄にフォーカスを戻しておく
      const main = taskFormMainInput();
      if (!main.value.trim()) main.focus();
      return;
    }
    lastSubmit = Date.now();
    if (taskAddMode() === 'bulk') { submitBulkTasks(form); return; }
    const data = readTaskForm();
    if (!data.title) { form.elements.title.focus(); showToast('やることを入力してください'); return; }
    if (!data.categoryId) { showToast('先にクエスト一覧でクエストを作ってください'); return; }
    const isNew = !data.id;
    const saveBtn = form.querySelector('button[type="submit"]');
    const at = centerOf(saveBtn);
    upsertTask(data);
    closeTaskSheet();
    render();
    if (isNew) {
      floatText(at.x, at.y, `+${ADD_XP} XP`, false, true);
      setTimeout(pulseXpBar, 250);
    }
  });

  document.getElementById('task-delete').addEventListener('click', async () => {
    const id = form.elements.id.value;
    if (!id) return;
    if (!(await askConfirm('このやることを削除します。', { ok: '削除する', danger: true }))) return;
    const at = centerOf(document.getElementById('task-delete'));
    const before = state.player.xp;
    deleteTask(id);
    closeTaskSheet();
    render();
    if (state.player.xp < before) floatText(at.x, at.y, `-${ADD_XP} XP`, false, true);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) closeTaskSheet();
  });
}
