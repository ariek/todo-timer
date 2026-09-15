// 設定画面: エクスポート/インポート、サンプル削除、初期化。クエストの編集シートもここで持つ

// 初期クエスト（名前、色、アイコン）
const DEFAULT_CATEGORIES = [
  ['仕事', 'sky', 'briefcase'], ['家事', 'mint', 'house'], ['勉強', 'lav', 'book'], ['健康', 'pink', 'heart'], ['買い物', 'yellow', 'cart'],
];

// まだ使われていない色から順に選ぶ
function nextFreeColor() {
  const used = new Set(state.categories.map((a) => a.color));
  const free = CATEGORY_COLORS.find((c) => !used.has(c.id));
  return free ? free.id : CATEGORY_COLORS[state.categories.length % CATEGORY_COLORS.length].id;
}

// --- クエスト（カテゴリー）の操作 -----------------------------------------------------

function sortedCategories() {
  return [...state.categories].sort((a, b) => a.order - b.order);
}

// 保存したクエストの id を返す
function upsertCategory(data) {
  let id = data.id;
  if (data.id) {
    const category = state.categories.find((a) => a.id === data.id);
    if (category) Object.assign(category, { name: data.name, color: data.color, icon: data.icon });
  } else {
    const maxOrder = state.categories.reduce((m, a) => Math.max(m, a.order), -1);
    id = newId('c');
    state.categories.push({ id, name: data.name, color: data.color, icon: data.icon, order: maxOrder + 1 });
  }
  saveState();
  return id;
}

function deleteCategory(categoryId) {
  const ids = new Set(state.tasks.filter((t) => t.categoryId === categoryId).map((t) => t.id));
  state.tasks = state.tasks.filter((t) => t.categoryId !== categoryId);
  if (ids.size > 0) removeRegisterXp(ids.size);
  state.logs = state.logs.filter((l) => !ids.has(l.taskId));
  state.categories = state.categories.filter((a) => a.id !== categoryId);
  sortedCategories().forEach((a, i) => { a.order = i; });
  if (ui.categoryFilter === categoryId) ui.categoryFilter = null;
  saveState();
}

// 並び順を id の配列どおりにする（ドラッグ＆ドロップの結果を反映）
function reorderCategories(ids) {
  const byId = new Map(state.categories.map((c) => [c.id, c]));
  let order = 0;
  ids.forEach((id) => { const c = byId.get(id); if (c) c.order = order++; });
  // 配列に含まれなかったものは末尾に
  sortedCategories().forEach((c) => { if (!ids.includes(c.id)) c.order = order++; });
  saveState();
}

// --- エクスポート / インポート ----------------------------------------

function exportJson() {
  return JSON.stringify(state, null, 2);
}

function validateImport(data) {
  if (!data || typeof data !== 'object') return 'JSON の形式が違います';
  if (!Array.isArray(data.categories) || !Array.isArray(data.tasks) || !Array.isArray(data.logs)) {
    return 'データの形式が違います（クエスト・やること・記録が見つかりません）';
  }
  if (!data.player || typeof data.player.xp !== 'number') return 'データの形式が違います（レベルと経験値が見つかりません）';
  return null;
}

async function importJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return 'JSON として読み込めませんでした';
  }
  const error = validateImport(data);
  if (error) return error;
  const summary = `クエスト ${data.categories.length} 件、やること ${data.tasks.length} 件、記録 ${data.logs.length} 件を読み込みます。現在のデータは上書きされます。`;
  if (!(await askConfirm(summary, { ok: '読み込む', danger: true }))) return null;
  state = migrate(data);
  ui.categoryFilter = null;
  saveState();
  stopSessionLoop();
  initSession();
  return '';
}

function downloadJson() {
  const blob = new Blob([exportJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `todo-timer-${dateKey(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- サンプル削除 / 初期化 --------------------------------------------

function clearSample() {
  state.tasks = [];
  state.logs = [];
  state.player = { xp: 0, level: 1, bestStreak: 0 };
  state.session = null;
  state.sessions = [];
  state.sample = false;
  ui.categoryFilter = null;
  stopSessionLoop();
  saveState();
}

function resetAll() {
  localStorage.removeItem(STORAGE_KEY);
  state = emptyState(); // クエストも含めてすべて消す
  ui.categoryFilter = null;
  stopSessionLoop();
  saveState();
}

// --- 描画 -------------------------------------------------------------

function renderSettings() {
  document.getElementById('sample-section').hidden = !state.sample;
  document.getElementById('data-summary').textContent =
    `クエスト ${state.categories.length} 件 · やること ${state.tasks.length} 件 · 記録 ${state.logs.length} 件 · データ形式 v${state.version}`;
}

function openCategorySheet(categoryId = null) {
  const form = document.getElementById('category-form');
  const category = categoryId ? state.categories.find((a) => a.id === categoryId) : null;
  form.elements.id.value = category ? category.id : '';
  form.elements.name.value = category ? category.name : '';
  form.elements.color.value = category ? category.color : nextFreeColor();
  form.elements.icon.value = category ? category.icon : DEFAULT_ICON;
  document.getElementById('category-sheet-title').textContent = category ? 'クエストを編集' : 'クエストを追加';
  document.getElementById('category-delete').hidden = !category;
  renderPickers();
  showSheet(document.getElementById('category-sheet'));
  setTimeout(() => form.elements.name.focus(), 50);
}

function closeCategorySheet() {
  hideSheet(document.getElementById('category-sheet'));
}

// 色とアイコンの選択肢
function renderPickers() {
  const form = document.getElementById('category-form');
  const color = form.elements.color.value;
  const icon = form.elements.icon.value;
  document.getElementById('color-picker').innerHTML = CATEGORY_COLORS.map((c) =>
    `<button type="button" class="color-swatch ${c.id === color ? 'is-selected' : ''}" data-color="${c.id}" style="--cat-color:${c.hex}" aria-label="${c.name}"></button>`).join('');
  document.getElementById('icon-picker').innerHTML = CATEGORY_ICONS.map(([name, label]) =>
    `<button type="button" class="icon-choice ${name === icon ? 'is-selected' : ''}" data-icon="${name}" style="--cat-color:${categoryColorHex(color)}" aria-label="${label}" title="${label}"><svg class="icon" aria-hidden="true"><use href="#c-${name}"/></svg></button>`).join('');
}

// --- イベント ---------------------------------------------------------

function initSettings() {
  // クエストの編集シート（開くのはクエスト一覧画面から）
  const sheet = document.getElementById('category-sheet');
  const form = document.getElementById('category-form');
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeCategorySheet(); });
  document.getElementById('category-cancel').addEventListener('click', closeCategorySheet);
  document.getElementById('color-picker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    form.elements.color.value = b.dataset.color;
    renderPickers();
  });
  document.getElementById('icon-picker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-icon]');
    if (!b) return;
    form.elements.icon.value = b.dataset.icon;
    renderPickers();
  });
  let lastSubmit = 0;
  let fromPointer = false;
  form.querySelector('button[type="submit"]').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    fromPointer = true;
    form.requestSubmit();
    fromPointer = false;
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!fromPointer && Date.now() - lastSubmit < 400) return; // pointerdown で処理した直後のクリック分は無視
    lastSubmit = Date.now();
    const name = form.elements.name.value.trim();
    if (!name) { form.elements.name.focus(); showToast('クエストの名前を入力してください'); return; }
    const isNew = !form.elements.id.value;
    const id = upsertCategory({ id: form.elements.id.value || null, name, color: form.elements.color.value, icon: form.elements.icon.value });
    closeCategorySheet();
    render();
    if (isNew) {
      // 新しいクエストは空なので、そのやること画面に移って最初のやることの追加シートを続けて出す
      openTasks(id);
      setTimeout(() => openTaskSheet(), 80);
    }
  });
  document.getElementById('category-delete').addEventListener('click', async () => {
    const id = form.elements.id.value;
    const category = state.categories.find((a) => a.id === id);
    if (!category) return;
    const n = state.tasks.filter((t) => t.categoryId === id).length;
    const msg = n > 0
      ? `「${category.name}」と、所属するやること ${n} 件をまとめて削除します。`
      : `「${category.name}」を削除します。`;
    if (!(await askConfirm(msg, { ok: '削除する', danger: true }))) return;
    deleteCategory(id);
    closeCategorySheet();
    render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) closeCategorySheet();
  });

  // エクスポート
  const exportCategory = document.getElementById('export-text');
  document.getElementById('export-show').addEventListener('click', () => {
    exportCategory.value = exportJson();
    document.getElementById('export-box').hidden = false;
    exportCategory.focus();
    exportCategory.select();
  });
  document.getElementById('export-copy').addEventListener('click', async () => {
    exportCategory.value = exportJson();
    try {
      await navigator.clipboard.writeText(exportCategory.value);
      showToast('コピーしました');
    } catch (err) {
      exportCategory.focus();
      exportCategory.select();
      showToast('コピーできませんでした。選んだ文字を長押しでコピーしてください');
    }
  });
  document.getElementById('export-download').addEventListener('click', downloadJson);

  // インポート
  const importCategory = document.getElementById('import-text');
  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { importCategory.value = String(reader.result || ''); };
    reader.readAsText(file);
    e.target.value = '';
  });
  document.getElementById('import-run').addEventListener('click', async () => {
    const text = importCategory.value.trim();
    if (!text) { showToast('JSON を貼り付けるかファイルを選んでください'); return; }
    const result = await importJson(text);
    if (result === null) return;
    if (result) { showToast(result, 'is-levelup'); return; }
    importCategory.value = '';
    render();
    showToast('読み込みました');
  });

  // サンプル削除
  document.getElementById('sample-clear').addEventListener('click', async () => {
    if (!(await askConfirm('サンプルのやることと記録を削除します。クエストは残ります。', { ok: '消す', danger: true }))) return;
    clearSample();
    render();
    showToast('サンプルを消しました');
  });

  // 初期化
  document.getElementById('reset-all').addEventListener('click', async () => {
    if (!(await askConfirm('すべてのデータ（クエスト、やること、記録、レベル）を削除します。', { ok: '削除する', danger: true }))) return;
    if (!(await askConfirm('本当に削除しますか？ この操作は取り消せません。', { ok: '本当に削除する', danger: true }))) return;
    resetAll();
    render();
    showToast('初期化しました');
  });
}
