// 一覧のドラッグ＆ドロップ並べ替え。つまみを押したまま上下に動かし、同じ一覧の中で入れ替える。
// ポインターイベントで作っているので、指でもマウスでも同じ動きになる。
//
// 作り: ドラッグ中は DOM を動かさず、行の位置を transform でずらして見せる。指を離した瞬間に DOM を並べ替える。
// （ドラッグ中に行を DOM 上で動かすと、iOS でポインターの捕捉が外れて pointerup が届かなくなり、
//   ドラッグ状態が残ったままになることがあったため）
// イベントは window で受けるので、一覧の外で指を離しても必ず終わる。

// 始め方は3つ: つまみ（grip）を押した瞬間、行の長押し（タッチ。つまみが行の中にある = 動かせる行だけ）、
// 行をそのまま押して縦に動かす（マウス。横に動かしたら横スワイプに任せる）。つかんで離したあとの click は行に届かせない
//
// fixed を渡すと、それに当てはまる行は動かせず、ほかの行をその前後に割り込ませることもできない（先頭に固定された行など）
// ignore を渡すと、その中で押しても長押しにしない（行の下の層のボタンなど）
const LONG_PRESS_MS = 300;
let sortableActive = 0; // ドラッグ中の一覧の数。横スワイプなどが横取りしないように見る
function isSortableDragging() { return sortableActive > 0; }

function makeSortable(container, { row: rowSel, grip: gripSel, fixed: fixedSel = null, ignore: ignoreSel = null, onDrop }) {
  const main = container.closest('.main') || document.scrollingElement;
  let drag = null;
  let pending = null; // 長押し待ち { row, x, y, pointerId, timer }
  let suppressClickUntil = 0;

  const rowsOf = (list) => [...list.children].filter((el) => el.matches(rowSel));
  const isFixed = (el) => !!fixedSel && el.matches(fixedSel);
  const listY = (list, clientY) => clientY - list.getBoundingClientRect().top; // 一覧の上端からの位置（スクロールしても変わらない）

  // 動かせる行の、一覧内での位置と高さ（ドラッグ開始時に測る）
  const measure = (list) => {
    const top = list.getBoundingClientRect().top;
    return rowsOf(list).filter((el) => !isFixed(el)).map((el) => {
      const r = el.getBoundingClientRect();
      return { el, top: r.top - top, height: r.height, mid: r.top - top + r.height / 2 };
    });
  };

  const applyShift = () => {
    const { rows, startIndex, targetIndex, rowH, gap } = drag;
    rows.forEach((r, i) => {
      if (i === startIndex) return;
      let dy = 0;
      if (startIndex < targetIndex && i > startIndex && i <= targetIndex) dy = -(rowH + gap);
      else if (startIndex > targetIndex && i >= targetIndex && i < startIndex) dy = rowH + gap;
      r.el.style.transform = dy ? `translateY(${dy}px)` : '';
    });
  };

  const moveTo = (clientY) => {
    const { list, rows, startIndex, grabY, rowH } = drag;
    // 画面の端に近づいたら少しスクロールする
    const m = main.getBoundingClientRect ? main.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    if (clientY < m.top + 48) main.scrollTop -= 8;
    else if (clientY > m.bottom - 48) main.scrollTop += 8;
    const y = listY(list, clientY);
    const dragTop = y - grabY;
    const center = dragTop + rowH / 2;
    // 行の中央を越えた数で行き先を決める
    let target = startIndex;
    if (center < rows[startIndex].mid) {
      for (let i = startIndex - 1; i >= 0; i -= 1) { if (center < rows[i].mid) target = i; else break; }
    } else {
      for (let i = startIndex + 1; i < rows.length; i += 1) { if (center > rows[i].mid) target = i; else break; }
    }
    drag.targetIndex = target;
    applyShift();
    drag.row.style.transform = `translateY(${dragTop - rows[startIndex].top}px)`;
  };

  const finish = () => {
    if (!drag) return;
    const { row, list, rows, startIndex, targetIndex, viaLongPress } = drag;
    drag = null;
    sortableActive = Math.max(0, sortableActive - 1);
    if (viaLongPress) suppressClickUntil = Date.now() + 400; // 指を離したときの click を行（開くボタンなど）に届かせない
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('blur', onUp);
    rows.forEach((r) => { r.el.style.transform = ''; });
    row.classList.remove('is-dragging');
    list.classList.remove('is-reordering');
    if (targetIndex !== startIndex) {
      const other = rows[targetIndex].el;
      if (targetIndex < startIndex) list.insertBefore(row, other);
      else other.after(row);
    }
    onDrop(row, list, { moved: targetIndex !== startIndex, startIndex, endIndex: targetIndex });
  };

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    moveTo(e.clientY);
  };
  const onUp = (e) => {
    if (!drag) return;
    if (e && e.pointerId !== undefined && e.pointerId !== drag.pointerId) return;
    finish();
  };

  const startDrag = (row, clientY, pointerId, viaLongPress) => {
    if (drag) finish(); // 前のドラッグが残っていたら片付けてから始める
    const list = row.parentElement;
    const rows = measure(list);
    const startIndex = rows.findIndex((r) => r.el === row);
    if (startIndex < 0) return;
    const gap = rows.length > 1 ? Math.max(0, rows[1].top - rows[0].top - rows[0].height) : 0;
    drag = { row, list, rows, startIndex, targetIndex: startIndex, rowH: rows[startIndex].height, gap, grabY: listY(list, clientY) - rows[startIndex].top, pointerId, viaLongPress };
    sortableActive += 1;
    row.classList.add('is-dragging');
    list.classList.add('is-reordering');
    if (viaLongPress && navigator.vibrate) navigator.vibrate(15); // つかんだ合図（振動のある端末だけ）
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
  };

  // 長押し待ち: 指が動いたり離れたりしたらやめる（スクロールや横スワイプに任せる）
  const cancelPending = () => {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
    window.removeEventListener('pointermove', onPendingMove);
    window.removeEventListener('pointerup', cancelPending);
    window.removeEventListener('pointercancel', cancelPending);
  };
  const onPendingMove = (e) => {
    if (!pending || e.pointerId !== pending.pointerId) return;
    const dx = e.clientX - pending.x;
    const dy = e.clientY - pending.y;
    if (Math.hypot(dx, dy) <= (pending.mouse ? 6 : 8)) return;
    if (pending.mouse && Math.abs(dy) >= Math.abs(dx)) {
      // マウス: 縦に動き始めたらつかむ（押した位置を基準に）
      const { row, y, pointerId } = pending;
      cancelPending();
      startDrag(row, y, pointerId, true);
      return;
    }
    cancelPending();
  };

  container.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest(gripSel);
    if (grip) {
      const row = grip.closest(rowSel);
      if (!row || isFixed(row)) return;
      e.preventDefault();
      startDrag(row, e.clientY, e.pointerId, false);
      return;
    }
    // 動かせる行（つまみを持つ行）を、タッチ端末では長押しでつかむ。マウスでは押して縦に動かし始めたらつかむ
    const touch = e.pointerType === 'touch';
    if (!touch && e.button !== 0) return;
    const row = e.target.closest(rowSel);
    if (!row || isFixed(row) || !row.querySelector(gripSel)) return;
    if (e.target.closest('a, input, textarea, select') || (ignoreSel && e.target.closest(ignoreSel))) return;
    cancelPending();
    const { clientY, pointerId } = e;
    pending = {
      row, x: e.clientX, y: e.clientY, pointerId, mouse: !touch,
      timer: touch ? setTimeout(() => { cancelPending(); startDrag(row, clientY, pointerId, true); }, LONG_PRESS_MS) : null,
    };
    window.addEventListener('pointermove', onPendingMove);
    window.addEventListener('pointerup', cancelPending);
    window.addEventListener('pointercancel', cancelPending);
  });
  // ドラッグ中の指の動きはブラウザに渡さない（縦スクロールにならないように）
  container.addEventListener('touchmove', (e) => { if (drag && e.cancelable) e.preventDefault(); }, { passive: false });
  container.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  container.addEventListener('contextmenu', (e) => { if (pending || drag) e.preventDefault(); });
}

// --- 行の横スワイプ: 表のカードを指（またはマウス）で横にずらし、下の層（.row-under）のボタンを見せる ---------
// クエスト一覧とやることの一覧で共用。右へずらすと左の層（.row-under--left）、左へずらすと右の層（.row-under--right）。
// その側の層がない行はその向きにはずれない。マウスは 6px 動いてから向きを決める（クリックと区別する）。
// 縦に動いたら並べ替え（sortable）に任せる。開いている行は一度に1つ
const REVEAL_W = 100; // 下の層のボタン2つぶん
let openRow = null; // 開いている（ずれたままの）行

function setReveal(row, x, animate) {
  const front = row.querySelector('.category-front, .task-front');
  if (!front) return;
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

function makeRevealable(container, { row: rowSel, fixed: fixedSel = '.is-fixed' }) {
  let sw = null; // { row, id, x0, y0, base, dir, x, mouse, minX, maxX }
  let suppressClickUntil = 0; // 横に引いて離した直後の click は行に届かせない
  const decide = (dx, dy) => {
    if (!sw || sw.dir) return;
    if (dx === 0 && dy === 0) return;
    if (sw.mouse && Math.hypot(dx, dy) < 6) return;
    sw.dir = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
  };
  container.addEventListener('pointerdown', (e) => {
    const touch = e.pointerType === 'touch';
    if (!touch && e.button !== 0) return;
    const row = e.target.closest(rowSel);
    if (openRow && row !== openRow) closeRevealed(); // ほかの行に触れたら閉じる
    if (!row || (fixedSel && row.matches(fixedSel)) || e.target.closest('.row-under')) return;
    if (e.target.closest('a, input, textarea, select')) return;
    const hasLeft = !!row.querySelector('.row-under--left');
    const hasRight = !!row.querySelector('.row-under--right');
    if (!hasLeft && !hasRight) return;
    const base = row === openRow ? (row.classList.contains('is-reveal-left') ? REVEAL_W : -REVEAL_W) : 0;
    sw = { row, id: e.pointerId, x0: e.clientX, y0: e.clientY, base, dir: null, x: base, mouse: !touch, minX: hasRight ? -REVEAL_W : 0, maxX: hasLeft ? REVEAL_W : 0 };
  });
  // 横と決めた指の動きはブラウザに渡さない（縦スクロールが混ざらないように）
  container.addEventListener('touchmove', (e) => {
    if (!sw || e.touches.length !== 1) return;
    if (isSortableDragging()) { sw = null; return; }
    const t = e.touches[0];
    decide(t.clientX - sw.x0, t.clientY - sw.y0);
    if (sw.dir === 'h' && e.cancelable) e.preventDefault();
  }, { passive: false });
  window.addEventListener('pointermove', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    if (isSortableDragging()) { sw = null; return; } // 長押し（マウスは縦の動き）で行をつかんだ
    const dx = e.clientX - sw.x0;
    const dy = e.clientY - sw.y0;
    decide(dx, dy);
    if (sw.dir === 'v') { sw = null; return; }
    if (sw.dir !== 'h') return;
    let x = sw.base + dx;
    if (x > sw.maxX) x = sw.maxX + (x - sw.maxX) * 0.25; // 端（層がない側は 0）を越えたら重くなる
    if (x < sw.minX) x = sw.minX + (x - sw.minX) * 0.25;
    sw.x = x;
    setReveal(sw.row, x, false);
  });
  const finish = (e) => {
    if (!sw || (e && e.pointerId !== undefined && e.pointerId !== sw.id)) return;
    const { row, x, dir, mouse, minX, maxX } = sw;
    sw = null;
    if (dir !== 'h') return;
    if (mouse) suppressClickUntil = Date.now() + 300;
    let to = 0;
    if (maxX > 0 && x > REVEAL_W / 2) to = REVEAL_W;
    else if (minX < 0 && x < -REVEAL_W / 2) to = -REVEAL_W;
    setReveal(row, to, true);
    openRow = to ? row : null;
  };
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
  // 横に引いた直後の click は無視。開いている行の表をタップしたら閉じるだけ（やること画面や編集シートは開かない）
  container.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); return; }
    const row = e.target.closest(rowSel);
    if (openRow && row === openRow && !e.target.closest('.row-under')) { e.stopPropagation(); e.preventDefault(); closeRevealed(); }
  }, true);
  // 一覧の外に触れたら閉じる
  document.addEventListener('pointerdown', (e) => { if (openRow && container.contains(openRow) && !container.contains(e.target)) closeRevealed(); });
}
