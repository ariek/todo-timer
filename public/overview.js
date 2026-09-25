// クエスト一覧画面: クエスト（カテゴリー）ごとの行。色とアイコン、名前、件数、編集、並べ替え。
// 行をタップするとそのクエストのやること画面へ。先頭の「すべて」は全クエストのやること画面へ

const ICON_EDIT = '<svg class="icon" aria-hidden="true"><use href="#c-pen"/></svg>';
const ICON_GRIP = '<svg class="icon" aria-hidden="true"><use href="#i-grip"/></svg>';

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
        <button class="category-edit" data-category-edit="${cat.id}" aria-label="${name}を編集" title="編集">${ICON_EDIT}</button>
        <span class="drag-grip" aria-label="押したまま動かして並べ替え" title="押したまま動かして並べ替え">${ICON_GRIP}</span>
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

// --- 行の横スワイプ（タッチ端末）: 表のカードを指で横にずらし、下の層のボタンを見せる ---------
const REVEAL_W = 100; // 下の層のボタン2つぶん
let openRow = null; // 開いている（ずれたままの）行

function setReveal(row, x, animate) {
  const front = row.querySelector('.category-front');
  front.classList.toggle('is-settling', animate);
  front.style.transform = x ? `translateX(${x}px)` : '';
  row.classList.toggle('is-reveal-left', x > 0);
  row.classList.toggle('is-reveal-right', x < 0);
  row.classList.toggle('is-open', x !== 0);
}

function closeRevealed() {
  if (!openRow) return;
  if (openRow.isConnected) setReveal(openRow, 0, true);
  openRow = null;
}

function initCategorySwipe(list) {
  let sw = null; // { row, id, x0, y0, base, dir, x }
  const decide = (dx, dy) => {
    if (!sw || sw.dir) return;
    if (dx === 0 && dy === 0) return;
    sw.dir = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
  };
  list.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const row = e.target.closest('.category-row');
    if (openRow && row !== openRow) closeRevealed(); // ほかの行に触れたら閉じる
    if (!row || row.classList.contains('is-fixed') || e.target.closest('.row-under')) return;
    const base = row === openRow ? (row.classList.contains('is-reveal-left') ? REVEAL_W : -REVEAL_W) : 0;
    sw = { row, id: e.pointerId, x0: e.clientX, y0: e.clientY, base, dir: null, x: base };
  });
  // 横と決めた指の動きはブラウザに渡さない（縦スクロールが混ざらないように）
  list.addEventListener('touchmove', (e) => {
    if (!sw || e.touches.length !== 1) return;
    if (isSortableDragging()) { sw = null; return; }
    const t = e.touches[0];
    decide(t.clientX - sw.x0, t.clientY - sw.y0);
    if (sw.dir === 'h' && e.cancelable) e.preventDefault();
  }, { passive: false });
  list.addEventListener('pointermove', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    if (isSortableDragging()) { sw = null; return; } // 長押しで行をつかんだ
    const dx = e.clientX - sw.x0;
    const dy = e.clientY - sw.y0;
    decide(dx, dy);
    if (sw.dir === 'v') { sw = null; return; }
    if (sw.dir !== 'h') return;
    let x = sw.base + dx;
    if (x > REVEAL_W) x = REVEAL_W + (x - REVEAL_W) * 0.25; // 端を越えたら重くなる
    if (x < -REVEAL_W) x = -REVEAL_W + (x + REVEAL_W) * 0.25;
    sw.x = x;
    setReveal(sw.row, x, false);
  });
  const finish = (e) => {
    if (!sw || (e && e.pointerId !== undefined && e.pointerId !== sw.id)) return;
    const { row, x, dir } = sw;
    sw = null;
    if (dir !== 'h') return;
    let to = 0;
    if (x > REVEAL_W / 2) to = REVEAL_W;
    else if (x < -REVEAL_W / 2) to = -REVEAL_W;
    setReveal(row, to, true);
    openRow = to ? row : null;
  };
  list.addEventListener('pointerup', finish);
  list.addEventListener('pointercancel', finish);
  // 開いている行の表をタップしたら閉じるだけ（やること画面は開かない）
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.category-row');
    if (openRow && row === openRow && !e.target.closest('.row-under')) { e.stopPropagation(); e.preventDefault(); closeRevealed(); }
  }, true);
  // 一覧の外に触れたら閉じる
  document.addEventListener('pointerdown', (e) => { if (openRow && !e.target.closest('#category-list')) closeRevealed(); });
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
  initCategorySwipe(list);
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
