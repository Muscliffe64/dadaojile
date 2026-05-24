// 记录本局：日期、1队2人、2队2人、胜负、比分（级数 2-A 双选 + 套圈）
// 启用"过程记录"后改为多手追踪模式：每手点 3 个排名 -> 自动算升级 -> 过A自动判定胜负
// 当前牌局是云牌局时，对局会写入云端 records 集合，所有成员共享。
const storage = require('../../utils/storage');
const cloud = require('../../utils/cloud');

const LEVELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A1', 'A2', 'A3'];
const A1_IDX = 12;
const A2_IDX = 13;
const A3_IDX = 14;
const START_IDX = 0;          // 起始打 2
const TAOQUAN_IDX = 1;        // 套圈后回到 3
const RANK_LABELS = ['头游', '二游', '三游', '末游'];
const TEAM_LABELS = ['1队', '1队', '2队', '2队'];

// 组队方式
const PAIRING_OPTIONS = [
  { value: '12-34', label: '1+2 vs 3+4', placeholders: ['1号', '2号', '3号', '4号'] },
  { value: '13-24', label: '1+3 vs 2+4', placeholders: ['1号', '3号', '2号', '4号'] },
  { value: '14-23', label: '1+4 vs 2+3', placeholders: ['1号', '4号', '2号', '3号'] }
];
const PAIRING_LABELS = PAIRING_OPTIONS.map((o) => o.label);

function findPairing(value) {
  return PAIRING_OPTIONS.find((o) => o.value === value) || PAIRING_OPTIONS[0];
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function buildScore(levelA, levelB, taoquanA, taoquanB) {
  let s = `${levelA}:${levelB}`;
  if (taoquanA) s += ' 1队套圈';
  if (taoquanB) s += ' 2队套圈';
  return s;
}

function computeSlotOptions(teamA, teamB, players) {
  const a1 = teamA[0] || '';
  const a2 = teamA[1] || '';
  const b1 = teamB[0] || '';
  const b2 = teamB[1] || '';
  const exclude = (slot) => {
    const out = [];
    if (slot !== 0) out.push(a1);
    if (slot !== 1) out.push(a2);
    if (slot !== 2) out.push(b1);
    if (slot !== 3) out.push(b2);
    return out.filter(Boolean);
  };
  const get = (slot, self) => {
    const ex = exclude(slot);
    return players.filter((p) => !ex.includes(p) || p === self);
  };
  return {
    options0: get(0, a1),
    options1: get(1, a2),
    options2: get(2, b1),
    options3: get(3, b2)
  };
}

/** 检查头+二游是否同队（双下条件）：rankOrder 长度 === 2 且两个 slot 同队 */
function isDoubleDownPair(rankOrder) {
  if (!rankOrder || rankOrder.length !== 2) return false;
  const a = rankOrder[0], b = rankOrder[1];
  return (a <= 1 && b <= 1) || (a >= 2 && b >= 2);
}

function buildRankSlots(teamA, teamB, placeholders, rankOrder, gameOver) {
  const names = [teamA[0] || '', teamA[1] || '', teamB[0] || '', teamB[1] || ''];
  const allFilled = names.every(Boolean);
  const doubleDown = isDoubleDownPair(rankOrder);
  const slots = [];
  for (let i = 0; i < 4; i++) {
    let rank = 0;
    const idx = rankOrder.indexOf(i);
    if (idx >= 0) rank = idx + 1;
    if (rank === 0 && rankOrder.length === 3 && !rankOrder.includes(i)) rank = 4;
    // 双下时未点的 2 个槽标记为"已败"（视觉打灰 + "败"小标签）
    const tied = rank === 0 && doubleDown;
    slots.push({
      key: 'slot-' + i,
      slot: i,
      teamLabel: TEAM_LABELS[i],
      name: names[i],
      placeholder: placeholders[i] || (i + 1) + '号',
      disabled: !allFilled || gameOver,
      rank,
      rankLabel: rank ? RANK_LABELS[rank - 1] : (tied ? '败' : ''),
      tied
    });
  }
  return slots;
}

/**
 * 计算本手结果（不修改入参）
 * 输入：当前 state {levelAIdx, levelBIdx, taoquanA, taoquanB}, 头/二/三游 slot
 * 输出：next state + 本手元数据（winSide, partnerRank, upBase, passed, taoquanTrigger, etc.）
 */
function applyRound(prev, headSlot, secondSlot, thirdSlot) {
  const lastSlot = [0, 1, 2, 3].find((s) => ![headSlot, secondSlot, thirdSlot].includes(s));
  const order = [headSlot, secondSlot, thirdSlot, lastSlot];
  const partnerOfHead = headSlot <= 1 ? (headSlot === 0 ? 1 : 0) : (headSlot === 2 ? 3 : 2);
  const partnerRank = order.indexOf(partnerOfHead) + 1; // 2/3/4
  const winSide = headSlot <= 1 ? 'A' : 'B';
  const upBase = partnerRank === 2 ? 3 : (partnerRank === 3 ? 2 : 1);

  let levelAIdx = prev.levelAIdx;
  let levelBIdx = prev.levelBIdx;
  let taoquanA = prev.taoquanA;
  let taoquanB = prev.taoquanB;
  let gameOver = false;
  let passed = false;
  let taoquanTrigger = false;
  let resultText = '';

  const adjust = (curIdx, taoquanFlag) => {
    // 返回 {next, taoquanFlag, gameOver, passed, taoquanTrigger}
    if (curIdx < A1_IDX) {
      // 未到 A：直接升级，封顶到 A1
      const next = Math.min(curIdx + upBase, A1_IDX);
      return { next, taoquanFlag, gameOver: false, passed: false, taoquanTrigger: false };
    }
    // 已在 A1/A2/A3
    const canPass = curIdx === A1_IDX ? (partnerRank === 2) : (partnerRank === 2 || partnerRank === 3);
    if (canPass) {
      return { next: curIdx, taoquanFlag, gameOver: true, passed: true, taoquanTrigger: false };
    }
    // 未过 A
    if (curIdx < A3_IDX) {
      return { next: curIdx + 1, taoquanFlag, gameOver: false, passed: false, taoquanTrigger: false };
    }
    // A3 未过（且只可能是头+末游）：套圈，回到 3
    return { next: TAOQUAN_IDX, taoquanFlag: true, gameOver: false, passed: false, taoquanTrigger: true };
  };

  if (winSide === 'A') {
    const r = adjust(levelAIdx, taoquanA);
    levelAIdx = r.next;
    taoquanA = r.taoquanFlag;
    gameOver = r.gameOver;
    passed = r.passed;
    taoquanTrigger = r.taoquanTrigger;
  } else {
    const r = adjust(levelBIdx, taoquanB);
    levelBIdx = r.next;
    taoquanB = r.taoquanFlag;
    gameOver = r.gameOver;
    passed = r.passed;
    taoquanTrigger = r.taoquanTrigger;
  }

  return {
    next: { levelAIdx, levelBIdx, taoquanA, taoquanB },
    winSide, partnerRank, upBase, order, lastSlot,
    gameOver, passed, taoquanTrigger
  };
}

function partnerName(names, headSlot) {
  const partnerOfHead = headSlot <= 1 ? (headSlot === 0 ? 1 : 0) : (headSlot === 2 ? 3 : 2);
  return names[partnerOfHead] || '?';
}

/** 把一手的元数据序列化成可读 summary */
function roundSummary(meta, names) {
  const winLabel = meta.winSide === 'A' ? '1队' : '2队';
  const headName = names[meta.order[0]] || '?';
  const partner = partnerName(names, meta.order[0]);
  const before = meta.levelBefore;
  const after = meta.levelAfter;
  if (meta.passed) {
    return `${winLabel} ${headName}+${partner} 过${LEVELS[before]}，掼蛋成功`;
  }
  if (meta.taoquanTrigger) {
    return `${winLabel} ${headName}+${partner} A3 头末游，套圈 → 3`;
  }
  if (before >= A1_IDX) {
    return `${winLabel} ${headName}+${partner} ${LEVELS[before]} 未过 → ${LEVELS[after]}`;
  }
  return `${winLabel} ${headName}+${partner} 升${meta.upBase}级：${LEVELS[before]} → ${LEVELS[after]}`;
}

function buildRankPreview(teamA, teamB, rankOrder, gameState) {
  const names = [teamA[0] || '', teamA[1] || '', teamB[0] || '', teamB[1] || ''];
  // 双下：头+二同队 → 不需要再点 3/4，直接出预览
  if (isDoubleDownPair(rankOrder)) {
    const remaining = [0, 1, 2, 3].filter((s) => !rankOrder.includes(s));
    const r = applyRound(gameState, rankOrder[0], rankOrder[1], remaining[0]);
    const winLabel = r.winSide === 'A' ? '1队' : '2队';
    const headName = names[rankOrder[0]] || '?';
    const partnerName = names[rankOrder[1]] || '?';
    let action;
    if (r.passed) {
      const curIdx = r.winSide === 'A' ? gameState.levelAIdx : gameState.levelBIdx;
      action = `🎉 ${winLabel} 在 ${LEVELS[curIdx]} 双下过A，掼蛋成功`;
    } else {
      const fromIdx = r.winSide === 'A' ? gameState.levelAIdx : gameState.levelBIdx;
      const toIdx = r.next[r.winSide === 'A' ? 'levelAIdx' : 'levelBIdx'];
      action = `${winLabel}（${headName}+${partnerName}）双下升 3 级：${LEVELS[fromIdx]} → ${LEVELS[toIdx]}`;
    }
    return {
      line1: `🎯 头游 ${headName} · 二游 ${partnerName}（同队即双下）`,
      line2: action,
      canCommit: true
    };
  }
  if (rankOrder.length < 3) return null;
  const r = applyRound(gameState, rankOrder[0], rankOrder[1], rankOrder[2]);
  const lastSlot = r.lastSlot;
  const order = [...rankOrder, lastSlot];
  const tagged = order.map((s, i) => `${RANK_LABELS[i]} ${names[s] || '?'}`);
  const winLabel = r.winSide === 'A' ? '1队' : '2队';
  let action;
  if (r.passed) {
    action = `🎉 ${winLabel} 在 ${LEVELS[gameState[r.winSide === 'A' ? 'levelAIdx' : 'levelBIdx']]} 过A，掼蛋成功`;
  } else if (r.taoquanTrigger) {
    action = `${winLabel} A3 头末游 → 套圈回 3`;
  } else if ((r.winSide === 'A' && gameState.levelAIdx >= A1_IDX) || (r.winSide === 'B' && gameState.levelBIdx >= A1_IDX)) {
    const curIdx = r.winSide === 'A' ? gameState.levelAIdx : gameState.levelBIdx;
    action = `${winLabel} ${LEVELS[curIdx]} 未过 → ${LEVELS[r.next[r.winSide === 'A' ? 'levelAIdx' : 'levelBIdx']]}`;
  } else {
    const fromIdx = r.winSide === 'A' ? gameState.levelAIdx : gameState.levelBIdx;
    const toIdx = r.next[r.winSide === 'A' ? 'levelAIdx' : 'levelBIdx'];
    action = `${winLabel} 升${r.upBase}级：${LEVELS[fromIdx]} → ${LEVELS[toIdx]}`;
  }
  return {
    line1: tagged.join(' · '),
    line2: action,
    canCommit: true
  };
}

function initialGameState() {
  return { levelAIdx: START_IDX, levelBIdx: START_IDX, taoquanA: false, taoquanB: false };
}

/**
 * 从历史记录中提取最近 N 个去重的 4 人搭配（按"4 人集合"去重，保留最新一次的 teamA/teamB 分配）
 */
function extractRecentPairings(records, n) {
  const seen = new Set();
  const out = [];
  for (const r of records || []) {
    const a1 = r.teamA && r.teamA[0];
    const a2 = r.teamA && r.teamA[1];
    const b1 = r.teamB && r.teamB[0];
    const b2 = r.teamB && r.teamB[1];
    if (!a1 || !a2 || !b1 || !b2) continue;
    // 用 4 人集合 + 队伍划分作为 key（这样同 4 人不同搭配会被视为不同记录）
    const teamAKey = [a1, a2].slice().sort().join('+');
    const teamBKey = [b1, b2].slice().sort().join('+');
    const key = [teamAKey, teamBKey].sort().join(' vs ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      teamA: [a1, a2],
      teamB: [b1, b2],
      labelA: `${a1}+${a2}`,
      labelB: `${b1}+${b2}`
    });
    if (out.length >= n) break;
  }
  return out;
}

Page({
  data: {
    players: [],
    date: '',
    writtenAtPreview: '',
    teamA: ['', ''],
    teamB: ['', ''],
    winner: '',
    options0: [],
    options1: [],
    options2: [],
    options3: [],
    levels: LEVELS,
    levelA: '2',
    levelAIndex: 0,
    levelB: '2',
    levelBIndex: 0,
    taoquanA: false,
    taoquanB: false,
    pairingMode: '12-34',
    pairingIndex: 0,
    pairingLabels: PAIRING_LABELS,
    placeholders: ['1号', '2号', '3号', '4号'],
    // === 过程记录（多手追踪）===
    rankEnabled: false,
    gameState: initialGameState(),
    rounds: [],          // [{order:[..], names:[..], winSide, partnerRank, upBase, levelBefore, levelAfter, passed, taoquanTrigger, summary}]
    rankOrder: [],       // 当前手按点击顺序的 slot
    rankSlots: [],
    rankPreview: null,
    gameOver: false,
    gameOverSide: '',    // 'A' or 'B'
    historyExpanded: true,
    // 历史搭配（自动从最近 records 提取）
    recentPairings: [],
    showRecentPairings: true,   // 开关，跟随用户偏好持久化
    // 当前是不是云牌局（云牌局对局录入下版上线，这版给提示）
    currentTableIsCloud: false
  },

  onLoad() {
    const mode = storage.getPairingMode();
    const idx = Math.max(0, PAIRING_OPTIONS.findIndex((o) => o.value === mode));
    this.setData({
      date: todayStr(),
      writtenAtPreview: timeStr(),
      pairingMode: mode,
      pairingIndex: idx,
      placeholders: findPairing(mode).placeholders,
      showRecentPairings: storage.getShowRecentPairings(),
      currentTableIsCloud: storage.isCurrentTableCloud()
    });
    this.loadPlayers();
    this._restoreDraft();
  },

  onRecentPairingsToggle() {
    const next = !this.data.showRecentPairings;
    storage.setShowRecentPairings(next);
    this.setData({ showRecentPairings: next });
  },

  onShow() {
    this.setData({ writtenAtPreview: timeStr() });
    this.loadPlayers();
  },

  /**
   * 状态足够"非默认"才值得保存草稿，避免一进页面就刷一堆空白草稿
   */
  _hasMeaningfulContent() {
    const { teamA, teamB, rounds, winner, taoquanA, taoquanB, levelAIndex, levelBIndex, rankEnabled } = this.data;
    if ((teamA && (teamA[0] || teamA[1])) || (teamB && (teamB[0] || teamB[1]))) return true;
    if (rankEnabled) return true;
    if (rounds && rounds.length > 0) return true;
    if (winner) return true;
    if (taoquanA || taoquanB) return true;
    if (levelAIndex > 0 || levelBIndex > 0) return true;
    return false;
  },

  /** 把当前页面状态序列化到 storage（只保留"用户输入"，不存 options/players 等可重算字段） */
  _saveDraft() {
    if (this._restoring) return; // 恢复过程中不要再写回
    if (!this._hasMeaningfulContent()) {
      storage.clearRecordDraft();
      return;
    }
    const d = this.data;
    storage.setRecordDraft({
      v: 1,
      date: d.date,
      teamA: d.teamA,
      teamB: d.teamB,
      pairingMode: d.pairingMode,
      winner: d.winner,
      levelA: d.levelA,
      levelAIndex: d.levelAIndex,
      levelB: d.levelB,
      levelBIndex: d.levelBIndex,
      taoquanA: d.taoquanA,
      taoquanB: d.taoquanB,
      rankEnabled: d.rankEnabled,
      gameState: d.gameState,
      rounds: d.rounds,
      rankOrder: d.rankOrder,
      gameOver: d.gameOver,
      gameOverSide: d.gameOverSide,
      historyExpanded: d.historyExpanded,
      savedAt: Date.now()
    });
  },

  _restoreDraft() {
    const draft = storage.getRecordDraft();
    if (!draft || typeof draft !== 'object') return;
    // 简单 sanity：rounds 是数组 / teamA 是数组 / ...
    const teamA = Array.isArray(draft.teamA) ? draft.teamA.slice(0, 2) : ['', ''];
    const teamB = Array.isArray(draft.teamB) ? draft.teamB.slice(0, 2) : ['', ''];
    const hasContent = (teamA[0] || teamA[1] || teamB[0] || teamB[1])
      || (Array.isArray(draft.rounds) && draft.rounds.length > 0)
      || draft.rankEnabled
      || draft.winner
      || draft.taoquanA || draft.taoquanB
      || (draft.levelAIndex && draft.levelAIndex > 0)
      || (draft.levelBIndex && draft.levelBIndex > 0);
    if (!hasContent) {
      storage.clearRecordDraft();
      return;
    }
    this._restoring = true;
    const pairingMode = draft.pairingMode && PAIRING_OPTIONS.find((o) => o.value === draft.pairingMode) ? draft.pairingMode : this.data.pairingMode;
    const pairingIdx = Math.max(0, PAIRING_OPTIONS.findIndex((o) => o.value === pairingMode));
    const placeholders = findPairing(pairingMode).placeholders;
    const players = this.data.players || [];
    const opts = computeSlotOptions(teamA, teamB, players);
    const rankEnabled = !!draft.rankEnabled;
    const gameOver = !!draft.gameOver;
    const rankOrder = Array.isArray(draft.rankOrder) ? draft.rankOrder.filter((s) => Number.isFinite(s) && s >= 0 && s <= 3) : [];
    const gameState = draft.gameState && typeof draft.gameState === 'object' ? {
      levelAIdx: parseInt(draft.gameState.levelAIdx, 10) || START_IDX,
      levelBIdx: parseInt(draft.gameState.levelBIdx, 10) || START_IDX,
      taoquanA: !!draft.gameState.taoquanA,
      taoquanB: !!draft.gameState.taoquanB
    } : initialGameState();
    const rounds = Array.isArray(draft.rounds) ? draft.rounds : [];
    // 恢复 rounds 时把 summary 补回来（之前没存 summary 文本）
    const decoratedRounds = rounds.map((r) => ({
      ...r,
      summary: r && r.summary ? r.summary : (r ? roundSummary(r, r.names || []) : '')
    }));
    this.setData({
      date: draft.date || this.data.date,
      teamA,
      teamB,
      pairingMode,
      pairingIndex: pairingIdx,
      placeholders,
      options0: opts.options0,
      options1: opts.options1,
      options2: opts.options2,
      options3: opts.options3,
      winner: draft.winner || '',
      levelAIndex: Number.isFinite(parseInt(draft.levelAIndex, 10)) ? parseInt(draft.levelAIndex, 10) : 0,
      levelA: draft.levelA || LEVELS[parseInt(draft.levelAIndex, 10) || 0],
      levelBIndex: Number.isFinite(parseInt(draft.levelBIndex, 10)) ? parseInt(draft.levelBIndex, 10) : 0,
      levelB: draft.levelB || LEVELS[parseInt(draft.levelBIndex, 10) || 0],
      taoquanA: !!draft.taoquanA,
      taoquanB: !!draft.taoquanB,
      rankEnabled,
      gameState,
      rounds: decoratedRounds,
      rankOrder,
      rankSlots: rankEnabled ? buildRankSlots(teamA, teamB, placeholders, rankOrder, gameOver) : [],
      rankPreview: rankEnabled && !gameOver && rankOrder.length === 3
        ? buildRankPreview(teamA, teamB, rankOrder, gameState)
        : null,
      gameOver,
      gameOverSide: draft.gameOverSide || '',
      historyExpanded: draft.historyExpanded !== false
    });
    this._restoring = false;
    // 友好提示
    const handCount = decoratedRounds.length;
    if (handCount > 0) {
      wx.showToast({ title: `已恢复 ${handCount} 手未保存的记录`, icon: 'none', duration: 1800 });
    } else if (teamA[0] || teamA[1] || teamB[0] || teamB[1]) {
      wx.showToast({ title: '已恢复上次未保存的选人', icon: 'none', duration: 1500 });
    }
  },

  async loadPlayers() {
    const localPlayers = storage.getPlayers() || [];
    const tableId = storage.getCurrentTableId();
    const isCloud = storage.isCurrentTableCloud();
    // 云表：把云对局里出现过的玩家名也并进 players 列表，
    // 不然新加入云牌局的人本地没有参与人，根本没法选 4 个人来录入
    let players = [...localPlayers];
    let records = [];
    if (isCloud) {
      try {
        records = await cloud.getCloudRecords(tableId, 200);
        const seen = new Set(players);
        for (const r of records) {
          for (const name of [...(r.teamA || []), ...(r.teamB || [])]) {
            if (name && !seen.has(name)) {
              players.push(name);
              seen.add(name);
            }
          }
        }
      } catch (e) {
        console.warn('[record.loadPlayers] cloud fetch failed', e);
      }
    } else {
      records = storage.getRecords(tableId) || [];
    }

    const { teamA, teamB } = this.data;
    const opts = computeSlotOptions(teamA || ['', ''], teamB || ['', ''], players);
    // 最近搭配：用同一份 records 列表算
    const sortedRecords = records.slice().sort((a, b) => {
      const da = (a.date || '') + ' ' + (a.writtenAt || '');
      const db = (b.date || '') + ' ' + (b.writtenAt || '');
      if (da !== db) return db.localeCompare(da);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    const recentPairings = extractRecentPairings(sortedRecords, 5);
    this.setData({
      players,
      options0: opts.options0,
      options1: opts.options1,
      options2: opts.options2,
      options3: opts.options3,
      recentPairings
    });
  },

  /** 一键填充：把选中的搭配套到 teamA/teamB */
  onPairingPickerTap(e) {
    const { rankEnabled, rounds } = this.data;
    if (rankEnabled && rounds.length > 0) {
      wx.showToast({ title: '本局进行中，先重置或完成再换搭配', icon: 'none' });
      return;
    }
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    const pairing = (this.data.recentPairings || [])[idx];
    if (!pairing) return;
    const teamA = [pairing.teamA[0], pairing.teamA[1]];
    const teamB = [pairing.teamB[0], pairing.teamB[1]];
    const { players, placeholders, gameOver } = this.data;
    const opts = computeSlotOptions(teamA, teamB, players || []);
    this.setData({
      teamA,
      teamB,
      options0: opts.options0,
      options1: opts.options1,
      options2: opts.options2,
      options3: opts.options3,
      rankOrder: rankEnabled ? [] : this.data.rankOrder,
      rankSlots: rankEnabled ? buildRankSlots(teamA, teamB, placeholders, [], gameOver) : [],
      rankPreview: null
    });
    wx.showToast({ title: '已套用 · ' + pairing.labelA + ' vs ' + pairing.labelB, icon: 'none', duration: 1500 });
    this._saveDraft();
  },

  onDateChange(e) {
    this.setData({ date: e.detail.value });
    this._saveDraft();
  },

  onSlotSelect(e) {
    const { rankEnabled, rounds } = this.data;
    if (rankEnabled && rounds.length > 0) {
      wx.showToast({ title: '本局进行中，请先重置过程或完成', icon: 'none' });
      return;
    }
    const slot = parseInt(e.currentTarget.dataset.slot, 10);
    const pickerIdx = parseInt(e.detail.value, 10);
    const key = `options${slot}`;
    const arr = this.data[key] || [];
    const name = arr[pickerIdx] || '';
    let teamA = [...(this.data.teamA || ['', ''])];
    let teamB = [...(this.data.teamB || ['', ''])];
    if (slot <= 1) teamA[slot] = name;
    else teamB[slot - 2] = name;
    const { players, placeholders, gameState, gameOver } = this.data;
    const opts = computeSlotOptions(teamA, teamB, players || []);
    this.setData({
      teamA,
      teamB,
      options0: opts.options0,
      options1: opts.options1,
      options2: opts.options2,
      options3: opts.options3,
      rankOrder: rankEnabled ? [] : this.data.rankOrder,
      rankSlots: rankEnabled ? buildRankSlots(teamA, teamB, placeholders, [], gameOver) : [],
      rankPreview: null
    });
    this._saveDraft();
  },

  onWinnerChange(e) {
    this.setData({ winner: e.detail.value });
    this._saveDraft();
  },

  onLevelAChange(e) {
    const i = parseInt(e.detail.value, 10);
    this.setData({ levelAIndex: i, levelA: LEVELS[i] });
    this._saveDraft();
  },

  onLevelBChange(e) {
    const i = parseInt(e.detail.value, 10);
    this.setData({ levelBIndex: i, levelB: LEVELS[i] });
    this._saveDraft();
  },

  onTaoquanAToggle() {
    this.setData({ taoquanA: !this.data.taoquanA });
    this._saveDraft();
  },

  onTaoquanBToggle() {
    this.setData({ taoquanB: !this.data.taoquanB });
    this._saveDraft();
  },

  onPairingChange(e) {
    const i = parseInt(e.detail.value, 10);
    const opt = PAIRING_OPTIONS[i] || PAIRING_OPTIONS[0];
    storage.setPairingMode(opt.value);
    const { rankEnabled, teamA, teamB, gameOver } = this.data;
    this.setData({
      pairingIndex: i,
      pairingMode: opt.value,
      placeholders: opt.placeholders,
      rankOrder: [],
      rankSlots: rankEnabled ? buildRankSlots(teamA, teamB, opt.placeholders, [], gameOver) : [],
      rankPreview: null
    });
    this._saveDraft();
  },

  // === 过程记录开关 ===
  onRankToggle() {
    const { rankEnabled, rounds } = this.data;
    const turningOff = rankEnabled;
    if (turningOff && rounds.length > 0) {
      wx.showModal({
        title: '关闭过程记录？',
        content: `已记录 ${rounds.length} 手，关闭会丢弃这些过程数据。是否确认？`,
        confirmText: '关闭并清空',
        confirmColor: '#c0392b',
        success: (res) => {
          if (res.confirm) this._setRankEnabled(false);
        }
      });
      return;
    }
    this._setRankEnabled(!rankEnabled);
  },

  _setRankEnabled(enabled) {
    const { teamA, teamB, placeholders } = this.data;
    const game = initialGameState();
    this.setData({
      rankEnabled: enabled,
      gameState: game,
      rounds: [],
      rankOrder: [],
      rankSlots: enabled ? buildRankSlots(teamA, teamB, placeholders, [], false) : [],
      rankPreview: null,
      gameOver: false,
      gameOverSide: '',
      // 启用时把比分/获胜方/套圈复位到起点
      ...(enabled ? {
        levelA: LEVELS[START_IDX],
        levelAIndex: START_IDX,
        levelB: LEVELS[START_IDX],
        levelBIndex: START_IDX,
        taoquanA: false,
        taoquanB: false,
        winner: ''
      } : {})
    });
    this._saveDraft();
  },

  // === 点击排名按钮 ===
  onRankTap(e) {
    const { gameOver } = this.data;
    if (gameOver) return;
    const slot = parseInt(e.currentTarget.dataset.slot, 10);
    if (!Number.isFinite(slot)) return;
    const { teamA, teamB, placeholders, gameState } = this.data;
    const allFilled = [teamA[0], teamA[1], teamB[0], teamB[1]].every(Boolean);
    if (!allFilled) {
      wx.showToast({ title: '请先在 1 队、2 队选齐 4 人', icon: 'none' });
      return;
    }
    let rankOrder = [...(this.data.rankOrder || [])];
    const existing = rankOrder.indexOf(slot);
    if (existing >= 0) {
      rankOrder.splice(existing, 1);
    } else {
      if (rankOrder.length >= 3) {
        wx.showToast({ title: '第 4 个自动是末游，不用点', icon: 'none' });
        return;
      }
      rankOrder.push(slot);
    }
    this.setData({
      rankOrder,
      rankSlots: buildRankSlots(teamA, teamB, placeholders, rankOrder, gameOver),
      rankPreview: buildRankPreview(teamA, teamB, rankOrder, gameState)
    });
    this._saveDraft();
  },

  onRankReset() {
    const { teamA, teamB, placeholders, rankEnabled, gameOver } = this.data;
    if (!rankEnabled) return;
    this.setData({
      rankOrder: [],
      rankSlots: buildRankSlots(teamA, teamB, placeholders, [], gameOver),
      rankPreview: null
    });
    this._saveDraft();
  },

  // === 确认本手 ===
  onRoundCommit() {
    let { rankOrder } = this.data;
    const { gameState, teamA, teamB, placeholders, rounds } = this.data;
    // 双下：只点了 2 个且同队 → 自动把剩下 2 个补到 3/4 位（具体顺序对升级规则无影响）
    if (isDoubleDownPair(rankOrder)) {
      const remaining = [0, 1, 2, 3].filter((s) => !rankOrder.includes(s));
      rankOrder = [...rankOrder, remaining[0]];
    }
    if (rankOrder.length !== 3) {
      wx.showToast({ title: '请先点完 3 个人', icon: 'none' });
      return;
    }
    const names = [teamA[0] || '', teamA[1] || '', teamB[0] || '', teamB[1] || ''];
    const r = applyRound(gameState, rankOrder[0], rankOrder[1], rankOrder[2]);
    const levelBefore = r.winSide === 'A' ? gameState.levelAIdx : gameState.levelBIdx;
    const levelAfter = r.winSide === 'A' ? r.next.levelAIdx : r.next.levelBIdx;
    const meta = {
      order: r.order,
      names: [...names],
      winSide: r.winSide,
      partnerRank: r.partnerRank,
      upBase: r.upBase,
      levelBefore,
      levelAfter,
      passed: r.passed,
      taoquanTrigger: r.taoquanTrigger
    };
    meta.summary = roundSummary(meta, names);
    const newRounds = [...rounds, meta];
    const game = r.next;
    const next = {
      gameState: game,
      rounds: newRounds,
      rankOrder: [],
      rankSlots: buildRankSlots(teamA, teamB, placeholders, [], r.gameOver),
      rankPreview: null,
      // 同步显示用的级数
      levelAIndex: game.levelAIdx,
      levelA: LEVELS[game.levelAIdx],
      levelBIndex: game.levelBIdx,
      levelB: LEVELS[game.levelBIdx],
      taoquanA: game.taoquanA,
      taoquanB: game.taoquanB
    };
    if (r.gameOver) {
      next.gameOver = true;
      next.gameOverSide = r.winSide;
      next.winner = r.winSide;
    }
    this.setData(next);
    this._saveDraft();
  },

  // === 撤销上一手 ===
  onRoundUndo() {
    const { rounds, teamA, teamB, placeholders } = this.data;
    if (rounds.length === 0) return;
    const newRounds = rounds.slice(0, -1);
    // 重新从 0 状态回放
    let game = initialGameState();
    for (const m of newRounds) {
      const r = applyRound(game, m.order[0], m.order[1], m.order[2]);
      game = r.next;
    }
    this.setData({
      gameState: game,
      rounds: newRounds,
      rankOrder: [],
      rankSlots: buildRankSlots(teamA, teamB, placeholders, [], false),
      rankPreview: null,
      gameOver: false,
      gameOverSide: '',
      levelAIndex: game.levelAIdx,
      levelA: LEVELS[game.levelAIdx],
      levelBIndex: game.levelBIdx,
      levelB: LEVELS[game.levelBIdx],
      taoquanA: game.taoquanA,
      taoquanB: game.taoquanB,
      winner: ''
    });
    this._saveDraft();
  },

  onGameReset() {
    const { rounds } = this.data;
    if (rounds.length === 0) {
      this._setRankEnabled(true);
      return;
    }
    wx.showModal({
      title: '重新开始？',
      content: `将丢弃当前 ${rounds.length} 手的过程记录。确定？`,
      confirmText: '重开',
      confirmColor: '#c0392b',
      success: (res) => {
        if (res.confirm) this._setRankEnabled(true);
      }
    });
  },

  toggleHistory() {
    this.setData({ historyExpanded: !this.data.historyExpanded });
  },

  validate() {
    const { date, teamA, teamB, winner, players, rankEnabled, gameOver, rounds, currentTableIsCloud } = this.data;
    if (!players || players.length < 4) {
      const msg = currentTableIsCloud
        ? '这个云牌局还没足够玩家。先去"参与人"里加 4 个名字（不需要他们装小程序）'
        : '请先在「参与人」中添加至少 4 人';
      wx.showToast({ title: msg, icon: 'none', duration: 3000 });
      setTimeout(() => wx.navigateTo({ url: '/pages/players/players' }), 1500);
      return false;
    }
    if (!date) {
      wx.showToast({ title: '请选择日期', icon: 'none' });
      return false;
    }
    const a1 = teamA[0], a2 = teamA[1], b1 = teamB[0], b2 = teamB[1];
    if (!a1 || !a2 || !b1 || !b2) {
      wx.showToast({ title: '请选择 1 队、2 队各两人', icon: 'none' });
      return false;
    }
    if (new Set([a1, a2, b1, b2]).size !== 4) {
      wx.showToast({ title: '四人不能重复', icon: 'none' });
      return false;
    }
    if (rankEnabled) {
      if (rounds.length === 0) {
        wx.showToast({ title: '过程记录已启用但没记录任何一手', icon: 'none' });
        return false;
      }
      if (!gameOver) {
        wx.showToast({ title: '本局未结束，请打完或撤销过程', icon: 'none' });
        return false;
      }
    } else {
      if (winner !== 'A' && winner !== 'B') {
        wx.showToast({ title: '请选择获胜方（1 队或 2 队）', icon: 'none' });
        return false;
      }
    }
    return true;
  },

  async submit() {
    if (!this.validate()) return;
    const { date, teamA, teamB, winner, levelA, levelB, taoquanA, taoquanB, rankEnabled, rounds, currentTableIsCloud } = this.data;
    const score = buildScore(levelA, levelB, taoquanA, taoquanB);

    let ranks = null;
    let serializedRounds = null;
    if (rankEnabled && rounds.length > 0) {
      const last = rounds[rounds.length - 1];
      const names = last.names;
      ranks = {
        first: names[last.order[0]] || '',
        second: names[last.order[1]] || '',
        third: names[last.order[2]] || '',
        fourth: names[last.order[3]] || ''
      };
      // 简洁 round 数据用于持久化（不带 summary 文本，回看时按规则重生成）
      serializedRounds = rounds.map((m) => ({
        order: m.order,
        names: m.names,
        winSide: m.winSide,
        partnerRank: m.partnerRank,
        upBase: m.upBase,
        levelBefore: m.levelBefore,
        levelAfter: m.levelAfter,
        passed: !!m.passed,
        taoquanTrigger: !!m.taoquanTrigger
      }));
    }

    const payload = {
      date,
      teamA: teamA.filter(Boolean),
      teamB: teamB.filter(Boolean),
      winner,
      score,
      ranks,
      rounds: serializedRounds
    };

    if (currentTableIsCloud) {
      // 云牌局：写入云端 records 集合
      const tableId = storage.getCurrentTableId();
      wx.showLoading({ title: '上传中...', mask: true });
      const r = await cloud.addCloudRecord(tableId, payload);
      wx.hideLoading();
      if (!r.ok) {
        wx.showModal({
          title: '保存失败',
          content: '云端写入出错：' + (r.error || '未知'),
          showCancel: false
        });
        return;
      }
      storage.clearRecordDraft();
      wx.showToast({ title: '已上传到云', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } else {
      // 本地牌局：原有逻辑
      storage.addRecord(payload);
      storage.clearRecordDraft();
      wx.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    }
  },

  goBack() {
    wx.navigateBack();
  },

  goPlayers() {
    wx.navigateTo({ url: '/pages/players/players' });
  }
});
