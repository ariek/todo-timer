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

function ringHtml(offset, color = null) {
  return `<svg class="qt-ring" viewBox="0 0 130 130"><g filter="url(#wobble)">
      <circle class="qt-track" cx="65" cy="65" r="54"/>
      <circle class="qt-fill" cx="65" cy="65" r="54" stroke-dasharray="${QT_LEN.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" ${color ? `style="stroke:${color}"` : ''}/>
      <circle class="qt-edge" cx="65" cy="65" r="58.5"/><circle class="qt-edge" cx="65" cy="65" r="49.5"/>
    </g></svg>`;
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
    return `<div class="focus-empty"><strong>まだやることがありません</strong><span>下の「やることを追加」から、最初のやることを書き出そう</span></div>`;
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
  let metaTail = '';
  if (phase === 'paused') metaTail = '一時停止中';
  else if (phase === 'running' && s.timedOut) metaTail = '時間切れ';
  else if (task) metaTail = dueText(task, status, now);
  const meta = task ? [categoryName, DIFFICULTY_LABELS[task.difficulty], repeatLabel(task.repeat), metaTail].filter(Boolean).join(' · ') : '';

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
  } else if (phase === 'countdown') {
    // 次への待ち: 待機中と同じ構造のカードを透明にして下敷きにし、その上に専用の表示を重ねる。
    // こうするとフォントや行数に関係なく、カードの高さが待機中と必ず一致する
    const cdMeta = [categoryName, DIFFICULTY_LABELS[task.difficulty], repeatLabel(task.repeat), dueText(task, status, now)]
      .filter(Boolean).join(' · ');
    const canSkip = !!task && canDeferTask(task, now); // 同じクエストにひとつ後ろの候補がなければ押せない（まとめ中はやることがないこともある）
    const left = Math.max(1, countdownRemainingSec(s));
    return `<div class="focus-card focus-card--countdown is-session" data-phase="countdown">
      <div class="focus-title">${escapeHtml(task.title)}</div>
      <div class="focus-meta">${escapeHtml(meta)}</div>
      <div class="qt"><div class="qt-dial">${ringHtml(0)}<div class="qt-center"><div class="qt-seconds">${digitsHtml(s.durationSec)}</div><div class="qt-slot">${minusBtn(1)}<span class="qt-ctl">${ICON_PLAY}</span>${plusBtn(1)}</div></div></div></div>
      <div class="qt-actions"><button class="btn btn-primary qt-main" disabled>${ICON_PLAY} はじめる</button><div class="qt-subrow"><button class="btn qt-small" disabled>スキップ</button></div></div>
      <div class="cd-overlay">
        <div class="cd-body">
          <div class="cd-title">${escapeHtml(task.title)}<span class="cd-sec">（${s.durationSec}秒）</span></div>
          <div class="cd-meta">${escapeHtml(cdMeta)}</div>
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
  if (phase === 'idle') {
    main = `<button class="btn btn-primary qt-main is-start" data-qt="start">${ICON_PLAY} はじめる</button>`;
    // 同じ日付にほかのクエストがなければ「あとで」は意味がないので押せない
    const canDefer = canDeferTask(task, now); // 同じクエストにひとつ後ろの候補がなければ押せない
    sub = `<button class="btn qt-small" data-defer="${task.id}" ${canDefer ? '' : 'disabled'}>スキップ</button>`;
  } else {
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
  return `<div class="focus-card ${comboCircle ? 'has-combo' : ''} ${phase === 'idle' ? 'is-editable' : ''} ${inSession ? 'is-session' : ''}" data-phase="${phase}" data-task-id="${task ? task.id : ''}">
    <div class="focus-title">${task ? escapeHtml(task.title) : ''}</div>
    <div class="focus-meta">${escapeHtml(meta)}</div>
    ${task && task.note && phase === 'idle' ? `<div class="focus-note">${escapeHtml(task.note)}</div>` : ''}
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
    if (!task.dueAt) return 'まだ一度も';
    const d = daysBetween(task.dueAt, now);
    return d === 0 ? '今日' : `${d}日遅れ`;
  }
  if (status === 'todo' && task.deadline) return `${formatShortDate(task.deadline)}まで`;
  if (status === 'fresh') return `次は ${formatShortDate(task.dueAt)}`;
  return '';
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
  const cat = state.categories.find((a) => a.id === task.categoryId);
  const meta = [categoryName, DIFFICULTY_LABELS[task.difficulty], repeatLabel(task.repeat), dueText(task, status, now),
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
  return `<li class="task-row ${fixed ? 'is-fixed' : ''}" data-status="${status}" data-id="${task.id}">
    ${action}
    <button class="task-body" data-edit="${task.id}">
      <span class="task-title">${escapeHtml(task.title)}</span>
      <span class="task-meta">${escapeHtml(meta)}</span>
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
  const shadeOn = !!state.session && state.session.phase !== 'summary';
  if (shadeOn && shade.hidden) document.querySelector('.main').scrollTo(0, 0); // カードが見えるように上へ
  shade.hidden = !shadeOn;

  // 追加ボタンは常に出す（作業中は覆いの下になって押せない）

  // 「ほかのやること」は「いまやる」と同じ規則で並べる（上から順に次に来る）
  const others = orderTodo(todo.filter((e) => !focus || e.task.id !== focus.task.id), now);
  if (others.length) {
    let body;
    if (byCategory) {
      // クエストごとに分けて、クエストの並び順で見出しを付ける。各クエスト内は標準の並び
      body = categories.map((a) => {
        const list = others.filter((e) => e.task.categoryId === a.id);
        if (!list.length) return '';
        return `<h3 class="quest-subheading">${categoryIconHtml(a, 'cat-icon cat-icon--sm')}${escapeHtml(a.name)} <span class="count">${list.length}</span></h3>
          <ul class="task-list" data-category="${a.id}">${list.map(row('todo', dragOk(list))).join('')}</ul>`;
      }).join('');
    } else {
      body = `<ul class="task-list" data-category="${ui.categoryFilter}">${others.map(row('todo', dragOk(others))).join('')}</ul>`;
    }
    html += `<details class="quest-section quest-details" data-section="todo" ${ui.sections.todo ? 'open' : ''}>
      <summary class="quest-heading">ほかのやること <span class="count">${others.length}</span></summary>
      ${body}
    </details>`;
  }

  if (doneToday.length) {
    html += `<details class="quest-section quest-details" data-section="done" ${ui.sections.done ? 'open' : ''}>
      <summary class="quest-heading">今日やった <span class="count">${doneToday.length}</span></summary>
      <ul class="task-list">${doneToday.map(row('undo')).join('')}</ul>
    </details>`;
  }
  if (waiting.length) {
    html += `<details class="quest-section quest-details">
      <summary class="quest-heading">次回待ち <span class="count">${waiting.length}</span></summary>
      <ul class="task-list">${waiting.map(row('wait')).join('')}</ul>
    </details>`;
  }
  if (finished.length) {
    html += `<details class="quest-section quest-details">
      <summary class="quest-heading">達成済み <span class="count">${finished.length}</span></summary>
      <ul class="task-list">${finished.map(row('done')).join('')}</ul>
    </details>`;
  }
  if (state.tasks.length === 0) {
    html = '<p class="quest-empty">下の「やることを追加」から最初のやることを登録しましょう。</p>';
  }
  document.getElementById('quest-list').innerHTML = html;
  // 折りたたみの開閉を覚える
  document.querySelectorAll('#quest-list details[data-section]').forEach((details) => {
    details.addEventListener('toggle', () => {
      ui.sections[details.dataset.section] = details.open;
      saveSections();
    });
  });
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
  document.getElementById('task-sheet-title').textContent = task ? 'やることを編集' : 'やることを追加';
  document.getElementById('task-delete').hidden = !task;
  updateTaskFormVisibility();
  document.getElementById('task-sheet').hidden = false;
  setTimeout(() => form.elements.title.focus(), 50);
}

function closeTaskSheet() {
  document.getElementById('task-sheet').hidden = true;
}

function updateTaskFormVisibility() {
  const form = document.getElementById('task-form');
  const type = form.elements.repeatType.value;
  document.getElementById('repeat-every-wrap').hidden = type !== 'days';
  document.getElementById('deadline-wrap').hidden = type !== 'none';
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

let toastTimer = null;
function showToast(message, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

// --- イベント ---------------------------------------------------------

// 「ほかのやること」の並べ替え。一覧の順をそのクエストの手動順にする。
// いまやるやることは動かさない（同じクエストなら常に先頭のまま）。いまやるを替えたいときは「スキップ」を使う
function reorderTasksFromList(row, ul) {
  const ids = [...ul.querySelectorAll('.task-row')].map((r) => r.dataset.id);
  const categoryId = ul.dataset.category;
  const focus = ui.focusTaskId ? state.tasks.find((t) => t.id === ui.focusTaskId) : null;
  const seq = focus && focus.categoryId === categoryId ? [focus.id, ...ids] : ids;
  assignOrders(seq.map((id) => state.tasks.find((t) => t.id === id)).filter(Boolean));
  saveState();
}

function initQuests() {
  document.getElementById('tasks-back').addEventListener('click', () => showCategoryList());
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
      else if (action === 'complete') completeQuest();
      else if (action === 'quit') quitSession();
      else if (action === 'plus') adjustSeconds(ADJUST_SEC);
      else if (action === 'minus') adjustSeconds(-ADJUST_SEC);
      else if (action === 'skip') skipQuest();
      return;
    }
    const defer = e.target.closest('[data-defer]');
    if (defer) {
      if (sessionActive()) return;
      deferTask(defer.dataset.defer);
      render();
      return;
    }
    const undo = e.target.closest('[data-undo]');
    if (undo) {
      if (undoComplete(undo.dataset.undo)) {
        showToast('取り消しました');
        render();
      }
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      if (sessionActive()) { showToast('作業中は編集できません'); return; }
      openTaskSheet(edit.dataset.edit);
      return;
    }
    // 待機中のカードは、ボタン以外の場所をタップすると編集できる（一覧の行と同じ）
    const card = e.target.closest('.focus-card[data-phase="idle"]');
    if (card && card.dataset.taskId && !e.target.closest('button')) openTaskSheet(card.dataset.taskId);
  };
  document.getElementById('quest-list').addEventListener('click', handleTaskAction);
  document.getElementById('focus-quests').addEventListener('click', handleTaskAction);

  document.getElementById('add-task-btn').addEventListener('click', () => { if (!sessionActive()) openTaskSheet(); });

  const sheet = document.getElementById('task-sheet');
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeTaskSheet(); });
  document.getElementById('task-cancel').addEventListener('click', closeTaskSheet);

  const form = document.getElementById('task-form');
  form.elements.repeatType.addEventListener('change', updateTaskFormVisibility);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = readTaskForm();
    if (!data.title) { form.elements.title.focus(); return; }
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
