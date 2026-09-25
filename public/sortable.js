// 一覧のドラッグ＆ドロップ並べ替え。つまみを押したまま上下に動かし、同じ一覧の中で入れ替える。
// ポインターイベントで作っているので、指でもマウスでも同じ動きになる。
//
// 作り: ドラッグ中は DOM を動かさず、行の位置を transform でずらして見せる。指を離した瞬間に DOM を並べ替える。
// （ドラッグ中に行を DOM 上で動かすと、iOS でポインターの捕捉が外れて pointerup が届かなくなり、
//   ドラッグ状態が残ったままになることがあったため）
// イベントは window で受けるので、一覧の外で指を離しても必ず終わる。

// 始め方は2つ: つまみ（grip）を押した瞬間（マウス向け。タッチ端末ではつまみを隠している）と、
// 行の長押し（タッチ向け。つまみが行の中にある = 動かせる行だけ）。長押しのあとの click は行に届かせない
//
// fixed を渡すと、それに当てはまる行は動かせず、ほかの行をその前後に割り込ませることもできない（先頭に固定された行など）
// ignore を渡すと、その中で押しても長押しにしない（行の下の層のボタンなど）
const LONG_PRESS_MS = 400;
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
    if (viaLongPress && navigator.vibrate) navigator.vibrate(15); // つかんだ合図
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
    if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 8) cancelPending();
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
    // タッチ端末: 動かせる行（つまみを持つ行）を長押しするとつかむ
    if (e.pointerType !== 'touch') return;
    const row = e.target.closest(rowSel);
    if (!row || isFixed(row) || !row.querySelector(gripSel)) return;
    if (e.target.closest('a, input, textarea, select') || (ignoreSel && e.target.closest(ignoreSel))) return;
    cancelPending();
    const { clientY, pointerId } = e;
    pending = {
      row, x: e.clientX, y: e.clientY, pointerId,
      timer: setTimeout(() => { cancelPending(); startDrag(row, clientY, pointerId, true); }, LONG_PRESS_MS),
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
