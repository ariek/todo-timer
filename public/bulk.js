// クエスト・やることの一括追加: 貼り付けた文字列を解釈して登録する（画面は「クエストを追加」「やることを追加」のシートの「まとめて」）

const BULK_DEFAULT_CATEGORY = 'なんでも';
const BULK_TITLE_MAX = 60;
const BULK_NOTE_MAX = 200;
const CATEGORY_NAME_MAX = 20; // クエスト名の長さ（シートの入力欄と同じ）

// 行頭の箇条書き記号を外す
const BULLET_RE = /^(?:[-*・•□■◇◆○●]|\[\s?[xX ]?\]|\d+[.．)）]|[①-⑳])\s*/;
const SEPARATOR_RE = /[：:\t]/;

function bulkTrim(str) {
  return str.replace(/^[\s　]+|[\s　]+$/g, '');
}

// 難易度: 1〜3、★〜★★★、☆〜☆☆☆（全角数字も可）。読めなければ null
function parseDifficulty(str) {
  const t = bulkTrim(str).replace(/[１２３]/g, (c) => String('１２３'.indexOf(c) + 1));
  if (/^[1-3]$/.test(t)) return Number(t);
  if (/^[★☆]{1,3}$/.test(t)) return t.length;
  return null;
}

function looksLikeDifficulty(str) {
  return parseDifficulty(str) !== null;
}

// 期限: 2026/9/20、9/20、2026-09-20、9月20日、今日、明日、明後日。その日の 23:59:59 を返す。読めなければ null
function parseDeadline(str, now = new Date()) {
  const t = bulkTrim(str).replace(/[０-９]/g, (c) => String('０１２３４５６７８９'.indexOf(c)));
  const endOfDay = (y, m, d) => {
    const dt = new Date(y, m - 1, d, 23, 59, 59);
    return dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
  };
  const rel = { '今日': 0, '明日': 1, '明後日': 2, 'きょう': 0, 'あした': 1, 'あさって': 2 };
  if (rel[t] !== undefined) {
    const d = addDays(now, rel[t]);
    return endOfDay(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  let m = t.match(/^(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?$/);
  if (m) return endOfDay(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/^(\d{1,2})[\/\-月](\d{1,2})日?$/);
  if (m) {
    const month = Number(m[1]); const day = Number(m[2]);
    let dt = endOfDay(now.getFullYear(), month, day);
    if (!dt) return null;
    // 年なしは今日以降で直近のその日付
    if (dt < startOfDay(now)) dt = endOfDay(now.getFullYear() + 1, month, day);
    return dt;
  }
  return null;
}

// 文字列を解釈して「登録の計画」を返す。まだ状態は変えない。
// opts.fixedCategory: すべての行をそのクエストに入れ、行は「やること：日付：難易度：メモ」として読む（やることの追加の「まとめて」）
// opts.bareIsCategory: 区切りのない行はクエスト名として、そのクエストだけを作る（クエストの追加の「まとめて」）
function parseBulkText(text, categories, tasks, opts = {}) {
  const fixedCategory = opts.fixedCategory || null;
  const categoryByName = new Map(sortedCategories().map((a) => [a.name, a]));
  // 新しいクエストの色は、まだ使われていない色からランダムに選ぶ（使い切ったら全色から）
  const usedColors = new Set(state.categories.map((a) => a.color));
  const pickColor = () => {
    const pool = CATEGORY_COLORS.filter((c) => !usedColors.has(c.id));
    const from = pool.length ? pool : CATEGORY_COLORS;
    const picked = from[Math.floor(Math.random() * from.length)];
    usedColors.add(picked.id);
    return picked.id;
  };
  const existingTitles = new Set(tasks.filter((t) => !t.done).map((t) => `${t.categoryId}\n${t.title}`));
  const newCategories = []; // { name, color, icon }
  const entries = []; // { categoryName, categoryId|null, title, deadline, difficulty }
  const skipped = { empty: 0, badDeadline: 0, badDifficulty: 0, duplicate: 0 };
  let truncated = 0;
  const seen = new Set();
  const now = new Date();

  const resolveCategory = (name) => {
    const found = categoryByName.get(name);
    if (found) return { id: found.id, name: found.name };
    let pending = newCategories.find((a) => a.name === name);
    if (!pending) {
      pending = name === BULK_DEFAULT_CATEGORY
        ? { name, color: DEFAULT_COLOR, icon: DEFAULT_ICON }
        : { name, color: pickColor(), icon: DEFAULT_ICON };
      newCategories.push(pending);
    }
    return { id: null, name };
  };

  for (const rawLine of String(text).split(/\r?\n/)) {
    let line = bulkTrim(rawLine);
    if (!line) continue;
    line = bulkTrim(line.replace(BULLET_RE, ''));
    if (!line) continue;

    // クエスト：タイトル：期限：難易度：メモ（区切りは ：, :, タブ。メモの中の区切りはそのまま残す）
    const rawParts = line.split(SEPARATOR_RE).map(bulkTrim);
    if (opts.bareIsCategory && rawParts.length === 1) {
      // クエスト名だけの行: そのクエストを作る（あれば何もしない）
      if (rawParts[0].length > CATEGORY_NAME_MAX) rawParts[0] = rawParts[0].slice(0, CATEGORY_NAME_MAX);
      resolveCategory(rawParts[0]);
      continue;
    }
    // クエスト固定のときは、先頭にクエスト名があるものとして同じ規則で読む
    const parts = fixedCategory ? [fixedCategory.name, ...rawParts] : rawParts;
    let categoryName = BULK_DEFAULT_CATEGORY;
    let title = '';
    let deadlineText = '';
    let difficultyText = '';
    let note = '';
    if (parts.length === 1) {
      title = parts[0];
    } else if (parts.length === 2) {
      [categoryName, title] = parts;
    } else if (parts.length === 3) {
      [categoryName, title] = parts;
      if (looksLikeDifficulty(parts[2])) difficultyText = parts[2]; else deadlineText = parts[2];
    } else {
      [categoryName, title, deadlineText, difficultyText] = parts;
      note = parts.slice(4).join('：');
    }
    if (!categoryName) categoryName = BULK_DEFAULT_CATEGORY;
    if (!title) { skipped.empty += 1; continue; }
    if (title.length > BULK_TITLE_MAX) { title = title.slice(0, BULK_TITLE_MAX); truncated += 1; }
    if (note.length > BULK_NOTE_MAX) note = note.slice(0, BULK_NOTE_MAX);

    let deadline = null;
    if (deadlineText) {
      const d = parseDeadline(deadlineText, now);
      if (!d) { skipped.badDeadline += 1; continue; }
      deadline = d.toISOString();
    }
    let difficulty = 1;
    if (difficultyText) {
      const v = parseDifficulty(difficultyText);
      if (v === null) { skipped.badDifficulty += 1; continue; }
      difficulty = v;
    }

    const category = fixedCategory ? { id: fixedCategory.id, name: fixedCategory.name } : resolveCategory(categoryName);
    const key = `${category.id || `new:${category.name}`}\n${title}`;
    if (seen.has(key) || (category.id && existingTitles.has(`${category.id}\n${title}`))) { skipped.duplicate += 1; continue; }
    seen.add(key);
    entries.push({ categoryName: category.name, categoryId: category.id, title, deadline, difficulty, note });
  }

  // クエストごとの件数
  const perCategory = {};
  for (const e of entries) perCategory[e.categoryName] = (perCategory[e.categoryName] || 0) + 1;
  return { newCategories, entries, skipped, perCategory, truncated };
}

function applyBulkPlan(plan) {
  const now = new Date().toISOString();
  const createdCategoryIds = [];
  const createdTaskIds = [];
  let maxOrder = state.categories.reduce((m, a) => Math.max(m, a.order), -1);
  const idByName = new Map(state.categories.map((a) => [a.name, a.id]));

  for (const a of plan.newCategories) {
    maxOrder += 1;
    const category = { id: newId('c'), name: a.name, color: a.color, icon: a.icon, order: maxOrder };
    state.categories.push(category);
    idByName.set(category.name, category.id);
    createdCategoryIds.push(category.id);
  }
  for (const e of plan.entries) {
    const task = {
      id: newId('t'),
      categoryId: e.categoryId || idByName.get(e.categoryName),
      title: e.title,
      difficulty: e.difficulty || 1,
      repeat: { type: 'none' },
      note: e.note || '',
      deadline: e.deadline || null,
      deferredAt: null,
      unpinnedAt: null,
      lastDoneAt: null,
      dueAt: null,
      done: false,
      createdAt: now,
      order: nextTaskOrder(),
    };
    state.tasks.push(task);
    createdTaskIds.push(task.id);
    addRegisterXp();
  }
  saveState();
  return { categories: createdCategoryIds.length, tasks: createdTaskIds.length };
}
