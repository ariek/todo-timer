#!/bin/sh
# コミット前の簡易チェック: JS の構文と CSS の波括弧の対応
set -e
cd "$(dirname "$0")/.."
for f in public/*.js; do
  node --check "$f"
done
python3 - <<'PY'
import sys
s = open('public/style.css', encoding='utf-8').read()
depth = 0
for i, line in enumerate(s.split('\n'), 1):
    for ch in line:
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth < 0:
                print(f'public/style.css: 余分な }} が {i} 行目にあります'); sys.exit(1)
if depth != 0:
    print(f'public/style.css: 波括弧が {depth} 個閉じていません'); sys.exit(1)

# ファイルをまたいで呼び合う関数がそろっているか（消してしまう事故の検知）
import re, glob
src = '\n'.join(open(f, encoding='utf-8').read() for f in glob.glob('public/*.js') if not f.endswith('sw.js'))
defined = set(m.group(1) for m in re.finditer(r'\bfunction\s+([A-Za-z_$][\w$]*)\s*\(', src))
required = [
    'init', 'render', 'switchTab', 'saveState', 'loadState', 'migrate', 'sampleState', 'newId', 'escapeHtml', 'iconHtml',
    'measureInsets', 'registerServiceWorker', 'waitInstalled', 'renderSessionModals', 'renderHeader', 'linkifyHtml', 'initSwipeBack', 'slideInTasks', 'slideOutTasks', 'renderOverview', 'initOverview', 'openTasks', 'showCategoryList', 'updateFabs', 'hideSheet', 'showSheet', 'sheetJustClosed', 'showPage', 'hidePage', 'fadeInSession', 'noteBtn', 'showNoteModal', 'hideNoteModal', 'dueKind', 'metaHtml', 'taskAddMode', 'taskFormMainInput', 'submitBulkTasks', 'markEnteringRows', 'leaveRow', 'unfold', 'settleRow', 'focusSnapshot', 'swapFocusCard', 'bumpFocusCard', 'saveScreen', 'loadScreen', 'categoryIconHtml', 'categoryColorHex', 'categoryIconId', 'injectCategoryIcons', 'renderPickers', 'nextFreeColor',
    'initQuests', 'renderQuests', 'renderFocusCard', 'emptyFocusHtml', 'runningBaseHtml', 'pickFocus', 'sortFocusOrder', 'orderTodo', 'reorderTasksFromList', 'nextTaskOrder', 'taskOrder', 'isPastDue', 'isPinned', 'categorySequence', 'canDeferTask', 'deferTask', 'assignOrders', 'completeTask', 'undoComplete',
    'upsertTask', 'deleteTask', 'deferTask', 'addRegisterXp', 'removeRegisterXp', 'openTaskSheet', 'closeTaskSheet', 'showToast', 'comboBadge',
    'initTimer', 'initSession', 'startSession', 'beginQuest', 'pauseQuest', 'resumeQuest', 'completeQuest', 'quitSession', 'endSession',
    'closeSummary', 'tickSession', 'ensureSessionLoop', 'stopSessionLoop', 'renderTimerTick', 'renderTimerMini', 'pickNextQuest',
    'questRemainingSec', 'sessionActive', 'sessionPhase', 'digitsHtml', 'playTone', 'scheduleCountdownSounds', 'scheduleToneAt', 'cancelScheduledSounds', 'skipQuest', 'adjustSeconds',
    'initSettings', 'renderSettings', 'sortedCategories', 'reorderCategories', 'makeSortable', 'deleteCategory', 'upsertCategory', 'importJson', 'exportJson', 'clearSample', 'resetAll',
    'initBulk', 'parseBulkText', 'applyBulkPlan', 'undoBulk',
    'initLog', 'formatDuration', 'logDayLabel', 'renderLog', 'initEffects', 'burstAt', 'floatText', 'pulseXpBar', 'centerOf', 'showClearModal', 'runClearTimeline', 'stopClearTimeline', 'hideClearModal', 'setModalVisible',
    'clearAnimationMs', 'initDialog', 'askConfirm', 'showAlert',
    'levelInfo', 'titleForLevel', 'baseXpForTask', 'timerBonus', 'comboMultiplier', 'taskStatus', 'currentStreak',
    'dateKey', 'addDays', 'startOfDay', 'nextDueDate', 'daysBetween', 'formatShortDate', 'repeatLabel',
]
missing = [n for n in required if n not in defined]
if missing:
    print('定義が見つからない関数: ' + ', '.join(missing)); sys.exit(1)
print('check ok')
PY
