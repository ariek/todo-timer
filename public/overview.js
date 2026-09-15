// クエスト一覧画面: クエスト（カテゴリー）ごとの行。色とアイコン、名前、件数、編集、並べ替え。
// 行をタップするとそのクエストのやること画面へ。先頭の「すべて」は全クエストのやること画面へ

const ICON_EDIT = '<svg class="icon" aria-hidden="true"><use href="#c-pen"/></svg>';
const ICON_GRIP = '<svg class="icon" aria-hidden="true"><use href="#i-grip"/></svg>';

function renderOverview() {
  const now = new Date();
  const list = document.getElementById('category-list');
  const cats = [...state.categories].sort((a, b) => a.order - b.order);
  const counts = {};
  let todoTotal = 0;
  let overdueTotal = 0;
  for (const t of state.tasks) {
    if (t.done) continue;
    const st = taskStatus(t, now);
    const c = counts[t.categoryId] || (counts[t.categoryId] = { todo: 0, overdue: 0 });
    if (st === 'overdue' || st === 'due' || st === 'todo') { c.todo += 1; todoTotal += 1; }
    if (isPastDue(t, now)) { c.overdue += 1; overdueTotal += 1; }
  }
  const meta = (todo, overdue) => `${todo > 0 ? `やること ${todo}` : 'やること なし'}${overdue > 0 ? ` <span class="category-overdue">期限切れ ${overdue}</span>` : ''}`;

  const allRow = `<li class="category-row category-row--all is-fixed">
    <button class="category-body" data-open="">
      <span class="cat-icon cat-icon--lg"><svg class="icon" aria-hidden="true"><use href="#i-scroll"/></svg></span>
      <span class="category-text"><span class="category-name">すべて</span><span class="category-meta">${meta(todoTotal, overdueTotal)}</span></span>
    </button>
  </li>`;
  const rows = cats.map((cat) => {
    const c = counts[cat.id] || { todo: 0, overdue: 0 };
    return `<li class="category-row" data-id="${cat.id}" style="--cat-color:${categoryColorHex(cat.color)}">
      <button class="category-body" data-open="${cat.id}">
        ${categoryIconHtml(cat, 'cat-icon cat-icon--lg')}
        <span class="category-text"><span class="category-name">${escapeHtml(cat.name)}</span><span class="category-meta">${meta(c.todo, c.overdue)}</span></span>
      </button>
      <button class="category-edit" data-category-edit="${cat.id}" aria-label="${escapeHtml(cat.name)}を編集" title="編集">${ICON_EDIT}</button>
      <span class="drag-grip" aria-label="押したまま動かして並べ替え" title="押したまま動かして並べ替え">${ICON_GRIP}</span>
    </li>`;
  });
  list.innerHTML = cats.length
    ? allRow + rows.join('')
    : `<li class="focus-card is-empty" data-empty="none"><div class="focus-empty"><strong>まだクエストがありません</strong><span>右下の「＋」から、最初のクエストを作ろう。設定の一括追加でまとめて作ることもできます</span></div></li>`;
}

function initOverview() {
  const list = document.getElementById('category-list');
  list.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-category-edit]');
    if (edit) { openCategorySheet(edit.dataset.categoryEdit); return; }
    const open = e.target.closest('[data-open]');
    if (open) openTasks(open.dataset.open || null);
  });
  document.getElementById('category-add-btn').addEventListener('click', () => openCategorySheet());
  makeSortable(list, {
    row: '.category-row',
    grip: '.drag-grip',
    fixed: '.is-fixed', // 「すべて」の行は動かせず、その上にも置けない
    onDrop: (row, ul) => {
      const ids = [...ul.querySelectorAll('.category-row[data-id]')].map((r) => r.dataset.id);
      reorderCategories(ids);
      render();
    },
  });
}
