// クエスト一覧画面: クエスト（カテゴリー）ごとの行。色とアイコン、名前、件数、編集、並べ替え。
// 行をタップするとそのクエストのやること画面へ。先頭の「すべて」は全クエストのやること画面へ

const ICON_EDIT = '<svg class="icon" aria-hidden="true"><use href="#c-pen"/></svg>';

function renderOverview() {
  const now = new Date();
  const list = document.getElementById('category-list');
  const cats = [...state.categories].sort((a, b) => a.order - b.order);
  const counts = {};
  const total = { todo: 0, today: 0, overdue: 0 };
  for (const t of state.tasks) {
    if (t.done) continue;
    const st = taskStatus(t, now);
    const c = counts[t.categoryId] || (counts[t.categoryId] = { todo: 0, today: 0, overdue: 0 });
    if (st === 'overdue' || st === 'due' || st === 'todo') { c.todo += 1; total.todo += 1; }
    const kind = dueKind(t, now);
    if (kind === 'over') { c.overdue += 1; total.overdue += 1; }
    if (kind === 'today') { c.today += 1; total.today += 1; }
  }
  // 件数: やること N (今日 N / 期限切れ N)。かっこの中は赤。どちらもなければかっこを出さない
  const meta = (c) => {
    const inner = [c.today > 0 ? `今日 ${c.today}` : '', c.overdue > 0 ? `期限切れ ${c.overdue}` : ''].filter(Boolean).join(' / ');
    return `${c.todo > 0 ? `やること ${c.todo}` : 'やること なし'}${inner ? ` <span class="category-urgent">(${inner})</span>` : ''}`;
  };

  const allRow = `<li class="category-row category-row--all is-fixed">
    <div class="category-front">
      <button class="category-body" data-open="">
        <span class="cat-icon cat-icon--lg"><svg class="icon" aria-hidden="true"><use href="#i-scroll"/></svg></span>
        <span class="category-text"><span class="category-name">すべて</span><span class="category-meta">${meta(total)}</span></span>
      </button>
    </div>
  </li>`;
  // 行は「表（カード）」と「下の層」の2枚。タッチ端末では表を横にスワイプすると下の層のボタンが見える
  // （右にスワイプ → 左端に「一番上へ」「一番下へ」、左にスワイプ → 右端に「削除」「編集」）
  const rows = cats.map((cat) => {
    const c = counts[cat.id] || { todo: 0, today: 0, overdue: 0 };
    const name = escapeHtml(cat.name);
    return `<li class="category-row" data-id="${cat.id}" style="--cat-color:${categoryColorHex(cat.color)}">
      <div class="row-under row-under--left">
        <button class="row-act" data-cat-top="${cat.id}" aria-label="${name}を一番上に移動" title="一番上に移動"><svg class="icon" aria-hidden="true"><use href="#i-to-top"/></svg></button>
        <button class="row-act" data-cat-bottom="${cat.id}" aria-label="${name}を一番下に移動" title="一番下に移動"><svg class="icon" aria-hidden="true"><use href="#i-to-bottom"/></svg></button>
      </div>
      <div class="row-under row-under--right">
        <button class="row-act is-danger" data-cat-delete="${cat.id}" aria-label="${name}を削除" title="削除"><svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg></button>
        <button class="row-act" data-category-edit="${cat.id}" aria-label="${name}を編集" title="編集">${ICON_EDIT}</button>
      </div>
      <div class="category-front">
        <button class="category-body" data-open="${cat.id}">
          ${categoryIconHtml(cat, 'cat-icon cat-icon--lg')}
          <span class="category-text"><span class="category-name">${name}</span><span class="category-meta">${meta(c)}</span></span>
        </button>
        <span class="drag-grip" hidden></span><!-- 動かせる行の印（表示はしない。sortable が見る） -->
      </div>
    </li>`;
  });
  openRow = null; // 描き直すと行は閉じた状態に戻る
  list.innerHTML = cats.length
    ? allRow + rows.join('')
    : `<li class="focus-card is-empty" data-empty="none"><div class="focus-empty"><strong>まだクエストがありません</strong><span>右下の「＋」から、最初のクエストを作ろう。「まとめて」を選ぶと、やることごと一度に作ることもできます</span></div></li>`;
}

// クエストを一番上か一番下へ
function moveCategoryToEdge(id, edge) {
  const ids = sortedCategories().map((c) => c.id).filter((x) => x !== id);
  reorderCategories(edge === 'top' ? [id, ...ids] : [...ids, id]);
}

function initOverview() {
  const list = document.getElementById('category-list');
  list.addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-category-edit]');
    if (edit) { closeRevealed(); openCategorySheet(edit.dataset.categoryEdit); return; }
    const top = e.target.closest('[data-cat-top]');
    if (top) { moveCategoryToEdge(top.dataset.catTop, 'top'); render(); settleRow(`#category-list .category-row[data-id="${top.dataset.catTop}"]`); return; }
    const bottom = e.target.closest('[data-cat-bottom]');
    if (bottom) { moveCategoryToEdge(bottom.dataset.catBottom, 'bottom'); render(); settleRow(`#category-list .category-row[data-id="${bottom.dataset.catBottom}"]`); return; }
    const del = e.target.closest('[data-cat-delete]');
    if (del) { if (await confirmDeleteCategory(del.dataset.catDelete)) render(); else closeRevealed(); return; }
    const open = e.target.closest('[data-open]');
    if (open) openTasks(open.dataset.open || null);
  });
  document.getElementById('category-add-btn').addEventListener('click', () => { if (!sheetJustClosed()) openCategorySheet(); });
  makeRevealable(list, { row: '.category-row', front: '.category-front' });
  makeSortable(list, {
    row: '.category-row',
    grip: '.drag-grip',
    fixed: '.is-fixed', // 「すべて」の行は動かせず、その上にも置けない
    ignore: '.row-under',
    onDrop: (row, ul) => {
      const ids = [...ul.querySelectorAll('.category-row[data-id]')].map((r) => r.dataset.id);
      reorderCategories(ids);
      render();
      settleRow(`#category-list .category-row[data-id="${row.dataset.id}"]`);
    },
  });
}
