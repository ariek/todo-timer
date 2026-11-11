// データの一括編集: やることとクエストを表（スプレッドシートのような入力欄の並び）でまとめて編集する。
// 設定画面の「データの一括編集」から開く。編集は下書き（bulkEdit）に入れておき、「保存」を押したときにまとめて反映する。
// 反映は、ひとつずつ編集するときと同じ関数（upsertTask / deleteTask / upsertCategory / deleteCategory）を使う

let bulkEdit = null; // 下書き { tab: 'tasks' | 'cats', cats: [...], tasks: [...], seq }

const BE_REPEATS = [['none', 'なし'], ['daily', '毎日'], ['weekly', '毎週'], ['days', '数日ごと']];
const BE_DIFFICULTIES = [[1, '★'], [2, '★★'], [3, '★★★']];

function isBulkEditOpen() {
  return !!bulkEdit;
}

function beOptions(pairs, value) {
  return pairs.map(([v, label]) => `<option value="${escapeHtml(String(v))}" ${String(v) === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

// --- 下書きを作る -------------------------------------------------------

function beTaskFields(task) {
  return {
    catKey: task.categoryId,
    title: task.title,
    difficulty: task.difficulty,
    repeatType: task.repeat.type,
    every: task.repeat.type === 'days' ? task.repeat.every : 3,
    date: task.repeat.type === 'none' && task.deadline ? dateKey(task.deadline) : '',
    note: task.note || '',
  };
}

function beTaskStatusText(task, now) {
  const st = taskStatus(task, now);
  if (st === 'done') return '済み';
  if (st === 'fresh') return `次は ${formatShortDate(task.dueAt)}`;
  return 'やること';
}

function openBulkEdit() {
  if (sessionActive()) { showToast('作業中は編集できません'); return; }
  const now = new Date();
  const cats = sortedCategories().map((c) => ({
    key: c.id, id: c.id, name: c.name, color: c.color, icon: c.icon, deleted: false,
    orig: { name: c.name, color: c.color, icon: c.icon },
  }));
  const catOrder = new Map(cats.map((c, i) => [c.key, i]));
  const tasks = [...state.tasks]
    .sort((a, b) => (catOrder.get(a.categoryId) - catOrder.get(b.categoryId)) || (a.done - b.done) || (taskOrder(a) - taskOrder(b)))
    .map((t) => {
      const f = beTaskFields(t);
      return { key: t.id, id: t.id, ...f, deleted: false, status: beTaskStatusText(t, now), orig: { ...f } };
    });
  bulkEdit = { tab: 'tasks', cats, tasks, seq: 0 };
  document.querySelector('input[name="bulk-edit-tab"][value="tasks"]').checked = true;
  renderBulkEdit();
  showPage(document.getElementById('page-bulk-edit'), !reducedMotion());
}

function closeBulkEdit() {
  bulkEdit = null;
  hidePage(document.getElementById('page-bulk-edit'), !reducedMotion());
}

// 閉じる（×、キャンセル、ブラウザの戻る）。変更があれば確かめる
async function requestCloseBulkEdit() {
  if (!bulkEdit) return;
  const s = bulkEditSummary();
  if (s.changed + s.added + s.removed > 0
    && !(await askConfirm('変更を保存せずに閉じますか？', { ok: '閉じる', danger: true }))) return;
  closeBulkEdit();
}

// --- 変更の数え方 -------------------------------------------------------

function beCatOf(task) {
  return bulkEdit.cats.find((c) => c.key === task.catKey) || null;
}

function beTaskGone(task) {
  const cat = beCatOf(task);
  return task.deleted || !cat || cat.deleted;
}

function beTaskChanged(t) {
  if (!t.orig) return false;
  const o = t.orig;
  if (t.catKey !== o.catKey || t.title.trim() !== o.title || Number(t.difficulty) !== Number(o.difficulty)
    || t.repeatType !== o.repeatType || t.note !== o.note) return true;
  if (t.repeatType === 'days' && beEvery(t) !== Number(o.every)) return true;
  if (t.repeatType === 'none' && t.date !== o.date) return true;
  return false;
}

function beCatChanged(c) {
  return !!c.orig && (c.name.trim() !== c.orig.name || c.color !== c.orig.color || c.icon !== c.orig.icon);
}

function beEvery(t) {
  return Math.min(365, Math.max(1, parseInt(t.every, 10) || 1));
}

// 新しい行は、名前（やること）が入っているものだけを数える。空のままの新しい行は保存しない
function bulkEditSummary() {
  const d = bulkEdit;
  let changed = 0; let added = 0; let removed = 0;
  for (const c of d.cats) {
    if (c.id) { if (c.deleted) removed += 1; else if (beCatChanged(c)) changed += 1; }
    else if (!c.deleted && c.name.trim()) added += 1;
  }
  for (const t of d.tasks) {
    if (t.id) { if (beTaskGone(t)) removed += 1; else if (beTaskChanged(t)) changed += 1; }
    else if (!beTaskGone(t) && t.title.trim()) added += 1;
  }
  return { changed, added, removed };
}

// --- 描画 ---------------------------------------------------------------

function beRowClass(row, gone, changed) {
  if (gone) return 'is-deleted';
  if (!row.id) return 'is-new';
  return changed ? 'is-changed' : '';
}

function beTaskRowHtml(t) {
  const cat = beCatOf(t);
  const gone = beTaskGone(t);
  const dis = gone ? 'disabled' : '';
  const cats = bulkEdit.cats.filter((c) => !c.deleted || c.key === t.catKey).map((c) => [c.key, c.name.trim() || '（名前なし）']);
  const lines = Math.min(4, Math.max(1, t.note.split('\n').length));
  const byCat = !t.deleted && cat && cat.deleted; // クエストごと消える行は、ここでは戻せない
  return `<tr data-key="${t.key}" class="${beRowClass(t, gone, beTaskChanged(t))}">
    <td><select data-f="catKey" aria-label="クエスト" ${dis}>${beOptions(cats, t.catKey)}</select></td>
    <td><input type="text" data-f="title" aria-label="やること" maxlength="60" value="${escapeHtml(t.title)}" placeholder="やること" ${dis}></td>
    <td><select data-f="difficulty" aria-label="難易度" ${dis}>${beOptions(BE_DIFFICULTIES, t.difficulty)}</select></td>
    <td><select data-f="repeatType" aria-label="繰り返し" ${dis}>${beOptions(BE_REPEATS, t.repeatType)}</select></td>
    <td><input type="number" data-f="every" aria-label="何日ごと" min="1" max="365" inputmode="numeric" value="${escapeHtml(String(t.every))}" ${gone || t.repeatType !== 'days' ? 'disabled' : ''}></td>
    <td><input type="date" data-f="date" aria-label="日付" value="${escapeHtml(t.date)}" ${gone || t.repeatType !== 'none' ? 'disabled' : ''}></td>
    <td><textarea data-f="note" aria-label="メモ" rows="${lines}" maxlength="200" ${dis}>${escapeHtml(t.note)}</textarea></td>
    <td class="edit-ro">${escapeHtml(byCat ? 'クエストごと削除' : t.status)}</td>
    <td class="edit-act"><button type="button" class="edit-del" data-del ${byCat ? 'disabled' : ''}>${t.deleted ? '戻す' : '削除'}</button></td>
  </tr>`;
}

function beCatRowHtml(c) {
  const dis = c.deleted ? 'disabled' : '';
  const n = bulkEdit.tasks.filter((t) => t.catKey === c.key && !t.deleted && (t.id || t.title.trim())).length;
  return `<tr data-key="${c.key}" class="${beRowClass(c, c.deleted, beCatChanged(c))}">
    <td class="edit-preview">${categoryIconHtml(c, 'cat-icon cat-icon--sm')}</td>
    <td><input type="text" data-f="name" aria-label="名前" maxlength="20" value="${escapeHtml(c.name)}" placeholder="クエストの名前" ${dis}></td>
    <td><select data-f="color" aria-label="色" ${dis}>${beOptions(CATEGORY_COLORS.map((x) => [x.id, x.name]), c.color)}</select></td>
    <td><select data-f="icon" aria-label="アイコン" ${dis}>${beOptions(CATEGORY_ICONS.map(([id, label]) => [id, label]), c.icon)}</select></td>
    <td class="edit-ro">${n} 件${c.deleted && n ? '（一緒に削除）' : ''}</td>
    <td class="edit-act"><button type="button" class="edit-del" data-del>${c.deleted ? '戻す' : '削除'}</button></td>
  </tr>`;
}

function renderBulkEdit() {
  const d = bulkEdit;
  if (!d) return;
  const table = document.getElementById('bulk-edit-table');
  if (d.tab === 'tasks') {
    table.className = 'edit-table edit-table--tasks';
    table.innerHTML = `<thead><tr><th>クエスト</th><th>やること</th><th>難易度</th><th>繰り返し</th><th>何日ごと</th><th>日付</th><th>メモ</th><th>状態</th><th></th></tr></thead>
      <tbody>${d.tasks.map(beTaskRowHtml).join('') || '<tr><td class="edit-empty" colspan="9">やることはまだありません</td></tr>'}</tbody>`;
  } else {
    table.className = 'edit-table edit-table--cats';
    table.innerHTML = `<thead><tr><th></th><th>名前</th><th>色</th><th>アイコン</th><th>やること</th><th></th></tr></thead>
      <tbody>${d.cats.map(beCatRowHtml).join('') || '<tr><td class="edit-empty" colspan="6">クエストはまだありません</td></tr>'}</tbody>`;
  }
  document.getElementById('bulk-edit-count-tasks').textContent = String(d.tasks.filter((t) => !beTaskGone(t)).length);
  document.getElementById('bulk-edit-count-cats').textContent = String(d.cats.filter((c) => !c.deleted).length);
  renderBulkEditStatus();
}

function renderBulkEditStatus() {
  const s = bulkEditSummary();
  const parts = [];
  if (s.changed) parts.push(`変更 ${s.changed}`);
  if (s.added) parts.push(`追加 ${s.added}`);
  if (s.removed) parts.push(`削除 ${s.removed}`);
  document.getElementById('bulk-edit-status').textContent = parts.length ? parts.join(' · ') : '変更はありません';
  document.getElementById('bulk-edit-save').disabled = parts.length === 0;
}

// 入力のたびに、行の色（変更あり）と使えない欄（何日ごと・日付）だけを直す。表は描き直さない（入力中の欄を保つ）
function beSyncRow(tr, row) {
  const isTask = bulkEdit.tab === 'tasks';
  const gone = isTask ? beTaskGone(row) : row.deleted;
  tr.className = beRowClass(row, gone, isTask ? beTaskChanged(row) : beCatChanged(row));
  if (isTask) {
    tr.querySelector('[data-f="every"]').disabled = gone || row.repeatType !== 'days';
    tr.querySelector('[data-f="date"]').disabled = gone || row.repeatType !== 'none';
  } else {
    tr.querySelector('.edit-preview').innerHTML = categoryIconHtml(row, 'cat-icon cat-icon--sm');
  }
}

// --- 行の追加・保存 -----------------------------------------------------

function addBulkEditRow() {
  const d = bulkEdit;
  d.seq += 1;
  const key = `new-${d.seq}`;
  let field = 'title';
  if (d.tab === 'tasks') {
    const cat = d.cats.find((c) => !c.deleted);
    if (!cat) { showToast('先に「クエスト」の表でクエストを追加してください'); return; }
    // 直前の行と同じクエストに入れる（続けて足しやすいように）
    const last = [...d.tasks].reverse().find((t) => !beTaskGone(t));
    d.tasks.push({ key, id: null, catKey: last ? last.catKey : cat.key, title: '', difficulty: 1, repeatType: 'none', every: 3, date: '', note: '', deleted: false, status: '新規', orig: null });
  } else {
    const used = new Set(d.cats.filter((c) => !c.deleted).map((c) => c.color));
    const free = CATEGORY_COLORS.find((c) => !used.has(c.id));
    d.cats.push({ key, id: null, name: '', color: free ? free.id : DEFAULT_COLOR, icon: DEFAULT_ICON, deleted: false, orig: null });
    field = 'name';
  }
  renderBulkEdit();
  const input = document.querySelector(`#bulk-edit-table tr[data-key="${key}"] [data-f="${field}"]`);
  if (input) { input.scrollIntoView({ block: 'nearest' }); input.focus(); }
}

// 入力の誤りがあれば、その表と欄を出して知らせる
function beFocusError(tab, key, field, message) {
  bulkEdit.tab = tab;
  document.querySelector(`input[name="bulk-edit-tab"][value="${tab}"]`).checked = true;
  renderBulkEdit();
  const input = document.querySelector(`#bulk-edit-table tr[data-key="${key}"] [data-f="${field}"]`);
  if (input) { input.scrollIntoView({ block: 'center' }); input.focus(); }
  showToast(message);
}

async function saveBulkEdit() {
  const d = bulkEdit;
  if (!d) return;
  if (sessionActive()) { showToast('作業中は編集できません'); return; }
  // 確かめる: 名前のないクエスト、やることが空の行
  for (const c of d.cats) {
    if (c.deleted || c.name.trim()) continue;
    const used = d.tasks.some((t) => t.catKey === c.key && !t.deleted && (t.id || t.title.trim()));
    if (c.id || used) { beFocusError('cats', c.key, 'name', 'クエストの名前を入力してください'); return; }
  }
  for (const t of d.tasks) {
    if (beTaskGone(t) || t.title.trim() || !t.id) continue;
    beFocusError('tasks', t.key, 'title', 'やることを入力してください');
    return;
  }
  const s = bulkEditSummary();
  if (s.removed > 0) {
    const cats = d.cats.filter((c) => c.id && c.deleted).length;
    const tasks = d.tasks.filter((t) => t.id && beTaskGone(t)).length;
    const what = [cats ? `クエスト ${cats} 件` : '', tasks ? `やること ${tasks} 件` : ''].filter(Boolean).join('と');
    if (!(await askConfirm(`${what}を削除します。`, { ok: '保存する', danger: true }))) return;
  }

  // 反映: クエスト → やること の順（新しいクエストの id を先に決める）
  const idOf = new Map();
  for (const c of d.cats) {
    if (c.deleted) { if (c.id) deleteCategory(c.id); continue; }
    const data = { name: c.name.trim(), color: c.color, icon: c.icon };
    if (!c.id) { if (data.name) idOf.set(c.key, upsertCategory({ id: null, ...data })); continue; }
    idOf.set(c.key, c.id);
    if (beCatChanged(c)) upsertCategory({ id: c.id, ...data });
  }
  for (const t of d.tasks) {
    if (beTaskGone(t)) { if (t.id && state.tasks.some((x) => x.id === t.id)) deleteTask(t.id); continue; }
    const title = t.title.trim();
    if (!t.id && !title) continue;
    if (t.id && !beTaskChanged(t)) continue;
    const repeat = t.repeatType === 'days' ? { type: 'days', every: beEvery(t) } : { type: t.repeatType };
    let deadline = null;
    if (t.repeatType === 'none' && t.date) {
      const existing = t.id ? state.tasks.find((x) => x.id === t.id) : null;
      // 日付を変えていなければ元の値のまま。変えたらその日の 23:59:59
      deadline = existing && existing.deadline && t.orig && t.orig.date === t.date ? existing.deadline : new Date(`${t.date}T23:59:59`).toISOString();
    }
    upsertTask({ id: t.id, title, categoryId: idOf.get(t.catKey), difficulty: Number(t.difficulty) || 1, repeat, deadline, note: t.note.trim() });
  }
  saveScreen();
  closeBulkEdit();
  render();
  const parts = [];
  if (s.changed) parts.push(`変更 ${s.changed}`);
  if (s.added) parts.push(`追加 ${s.added}`);
  if (s.removed) parts.push(`削除 ${s.removed}`);
  showToast(`保存しました（${parts.join('、')}）`);
}

// --- イベント -----------------------------------------------------------

function initBulkEdit() {
  const table = document.getElementById('bulk-edit-table');
  const rowOf = (el) => {
    const tr = el.closest('tr[data-key]');
    if (!tr || !bulkEdit) return null;
    const list = bulkEdit.tab === 'tasks' ? bulkEdit.tasks : bulkEdit.cats;
    const row = list.find((r) => r.key === tr.dataset.key);
    return row ? { tr, row, list } : null;
  };
  const onEdit = (e) => {
    const input = e.target.closest('[data-f]');
    const hit = input && rowOf(input);
    if (!hit) return;
    hit.row[input.dataset.f] = input.value;
    beSyncRow(hit.tr, hit.row);
    renderBulkEditStatus();
  };
  table.addEventListener('input', onEdit);
  table.addEventListener('change', onEdit);
  table.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    const hit = del && rowOf(del);
    if (!hit) return;
    if (!hit.row.id && !hit.row.deleted) {
      // まだ保存していない行はそのまま消す（新しいクエストなら、そこに入れた新しいやることも）
      hit.list.splice(hit.list.indexOf(hit.row), 1);
      if (bulkEdit.tab === 'cats') bulkEdit.tasks = bulkEdit.tasks.filter((t) => t.catKey !== hit.row.key || t.id);
    } else {
      hit.row.deleted = !hit.row.deleted;
    }
    renderBulkEdit();
  });
  // Enter で同じ列の次の行へ（メモは改行できるのでそのまま）
  table.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || !e.target.matches('input[data-f]')) return;
    e.preventDefault();
    let tr = e.target.closest('tr').nextElementSibling;
    while (tr) {
      const next = tr.querySelector(`[data-f="${e.target.dataset.f}"]`);
      if (next && !next.disabled) { next.focus(); if (next.select) next.select(); return; }
      tr = tr.nextElementSibling;
    }
  });
  document.querySelectorAll('input[name="bulk-edit-tab"]').forEach((r) => r.addEventListener('change', () => {
    if (!bulkEdit) return;
    bulkEdit.tab = r.value;
    renderBulkEdit();
    document.querySelector('#page-bulk-edit .edit-body').scrollTo(0, 0);
  }));
  document.getElementById('bulk-edit-open').addEventListener('click', openBulkEdit);
  document.getElementById('bulk-edit-add').addEventListener('click', addBulkEditRow);
  document.getElementById('bulk-edit-save').addEventListener('click', saveBulkEdit);
  document.getElementById('bulk-edit-cancel').addEventListener('click', requestCloseBulkEdit);
  document.getElementById('bulk-edit-close').addEventListener('click', requestCloseBulkEdit);
}
