// ゲームルール: 経験値、レベル、ストリーク、きれい度の計算
// 数値はすべて仮置き（SPEC.md 5章）

const XP_BY_DIFFICULTY = { 1: 15, 2: 25, 3: 50 };
// 難易度ごとのタイマーの長さ（秒）
const QUEST_SECONDS = { 1: 180, 2: 300, 3: 600 };
// コンボ倍率: 1コンボ目 1.0、2コンボ目 1.2、以降 0.1 ずつ（数列はあとで調整する前提）
function comboMultiplier(n) {
  if (n <= 1) return 1.0;
  return 1 + 0.1 * n;
}
// 残り秒数ボーナス: 残り秒数 × 0.1 × コンボ倍率 を切り上げ
function timerBonus(remainingSec, combo) {
  if (remainingSec <= 0) return 0;
  return Math.ceil(remainingSec * 0.1 * comboMultiplier(combo));
}

const TITLES = [
  [1, 'かけだし'],
  [3, '見習い冒険者'],
  [5, '冒険者'],
  [8, '熟練冒険者'],
  [10, '達人'],
  [15, '英雄'],
  [20, '伝説'],
];

function xpToNext(level) {
  return 100 * level;
}

// 累計経験値からレベルと現在レベル内の経験値を求める
function levelInfo(totalXp) {
  let level = 1;
  let xp = totalXp;
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
  }
  return { level, xpInLevel: xp, xpToNext: xpToNext(level) };
}

function titleForLevel(level) {
  let title = TITLES[0][1];
  for (const [lv, name] of TITLES) {
    if (level >= lv) title = name;
  }
  return title;
}

function baseXpForTask(task) {
  return XP_BY_DIFFICULTY[task.difficulty] || XP_BY_DIFFICULTY[1];
}

// やることの状態
//   done    : 繰り返しなしでやり終えた（一覧では「やったこと」）
//   todo    : 繰り返しなし。期限なし、または期限内。やることに出るが、きれい度では期限内扱い
//   overdue : 繰り返しなしで期限切れ
//   fresh   : 繰り返しありで次回期限がまだ来ていない
//   due     : 繰り返しありで次回期限が来ている（未完了を含む）
function taskStatus(task, now = new Date()) {
  if (task.done) return 'done';
  const t = now.getTime();
  if (task.repeat.type === 'none') {
    if (!task.deadline) return 'todo';
    return new Date(task.deadline).getTime() <= t ? 'overdue' : 'todo';
  }
  if (!task.dueAt) return 'due';
  return new Date(task.dueAt).getTime() <= t ? 'due' : 'fresh';
}

// ローカル日付キー YYYY-MM-DD
function dateKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ストリーク: 今日または昨日から遡って、達成日が連続している日数
function currentStreak(logs, now = new Date()) {
  const days = new Set(logs.map((log) => dateKey(log.doneAt)));
  if (days.size === 0) return 0;
  let cursor = new Date(now);
  if (!days.has(dateKey(cursor))) {
    cursor = addDays(cursor, -1);
    if (!days.has(dateKey(cursor))) return 0;
  }
  let streak = 0;
  while (days.has(dateKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// --- 日付ユーティリティと繰り返し ------------------------------------

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// 完了時刻から次回期限を求める。翌日以降の 0:00 にそろえる
function nextDueDate(doneAt, repeat) {
  const base = startOfDay(doneAt);
  if (repeat.type === 'daily') return addDays(base, 1);
  if (repeat.type === 'weekly') return addDays(base, 7);
  if (repeat.type === 'days') return addDays(base, Math.max(1, repeat.every || 1));
  return null;
}

function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
}

function formatShortDate(date) {
  const d = new Date(date);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function repeatLabel(repeat) {
  if (repeat.type === 'daily') return '毎日';
  if (repeat.type === 'weekly') return '毎週';
  if (repeat.type === 'days') return `${repeat.every}日ごと`;
  return '';
}

