// 掼蛋宝 - 存储与统计工具
const RECORDS_KEY = 'guandan_records';
const PLAYERS_KEY = 'guandan_players';
const TABLES_KEY = 'guandan_tables';
const CURRENT_TABLE_ID_KEY = 'guandan_current_table_id';
const DEFAULT_TABLE_ID = 'default';
const LAST_IMPORT_IDS_KEY = 'guandan_last_import_ids';
const DEEPSEEK_API_KEY_KEY = 'guandan_deepseek_api_key';
const REPORT_HISTORY_KEY = 'guandan_ai_report_history';
const REPORT_HISTORY_MAX = 50;
const MIN_GAMES_FOR_RANK_KEY = 'guandan_min_games_for_rank';
const MIN_GAMES_PER_TABLE_KEY = 'guandan_min_games_per_table';
const DEFAULT_MIN_GAMES_FOR_RANK = 5;
const PAIRING_MODE_KEY = 'guandan_pairing_mode';
const DEFAULT_PAIRING_MODE = '12-34';
const PAIRING_MODES = ['12-34', '13-24', '14-23'];
const RECORD_DRAFT_KEY = 'guandan_record_draft';
const SHOW_RECENT_PAIRINGS_KEY = 'guandan_show_recent_pairings';

function getRecords(tableId) {
  try {
    const raw = wx.getStorageSync(RECORDS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!tableId) return list;
    return list.filter((r) => (r.tableId || DEFAULT_TABLE_ID) === tableId);
  } catch (e) {
    return [];
  }
}

function setRecords(list) {
  wx.setStorageSync(RECORDS_KEY, JSON.stringify(list || []));
}

function clearAllData() {
  wx.setStorageSync(RECORDS_KEY, '[]');
  wx.setStorageSync(PLAYERS_KEY, '[]');
  wx.setStorageSync(TABLES_KEY, JSON.stringify([{ id: DEFAULT_TABLE_ID, name: '默认牌局' }]));
  wx.setStorageSync(CURRENT_TABLE_ID_KEY, DEFAULT_TABLE_ID);
  wx.removeStorageSync(LAST_IMPORT_IDS_KEY);
  wx.removeStorageSync(REPORT_HISTORY_KEY);
  wx.removeStorageSync(DEEPSEEK_API_KEY_KEY);
  wx.removeStorageSync(MIN_GAMES_PER_TABLE_KEY);
  wx.removeStorageSync(RECORD_DRAFT_KEY);
  wx.removeStorageSync(SHOW_RECENT_PAIRINGS_KEY);
}

function normalizeRanks(ranks) {
  if (!ranks || typeof ranks !== 'object') return null;
  const first = (ranks.first || '').toString().trim();
  const second = (ranks.second || '').toString().trim();
  const third = (ranks.third || '').toString().trim();
  const fourth = (ranks.fourth || '').toString().trim();
  // 必须四个名字都存在且互不相同才视为有效
  const arr = [first, second, third, fourth];
  if (arr.some((n) => !n)) return null;
  if (new Set(arr).size !== 4) return null;
  return { first, second, third, fourth };
}

/** 校验一条 round 元数据：必须有 order(4个不重的 0..3) 和 names(4个非空) */
function normalizeRound(r) {
  if (!r || typeof r !== 'object') return null;
  const order = Array.isArray(r.order) ? r.order.map((x) => parseInt(x, 10)) : null;
  if (!order || order.length !== 4) return null;
  if (order.some((x) => !Number.isFinite(x) || x < 0 || x > 3)) return null;
  if (new Set(order).size !== 4) return null;
  const names = Array.isArray(r.names) ? r.names.map((n) => (n == null ? '' : String(n))) : null;
  if (!names || names.length !== 4 || names.some((n) => !n)) return null;
  const winSide = r.winSide === 'A' || r.winSide === 'B' ? r.winSide : (order[0] <= 1 ? 'A' : 'B');
  return {
    order,
    names,
    winSide,
    partnerRank: parseInt(r.partnerRank, 10) || 0,
    upBase: parseInt(r.upBase, 10) || 0,
    levelBefore: parseInt(r.levelBefore, 10),
    levelAfter: parseInt(r.levelAfter, 10),
    passed: !!r.passed,
    taoquanTrigger: !!r.taoquanTrigger
  };
}

function normalizeRounds(rounds) {
  if (!Array.isArray(rounds) || rounds.length === 0) return null;
  const out = [];
  for (const r of rounds) {
    const n = normalizeRound(r);
    if (n) out.push(n);
  }
  return out.length > 0 ? out : null;
}

function addRecord(record) {
  const tableId = record.tableId || getCurrentTableId();
  const list = getRecords();
  const now = new Date();
  const writtenAt = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const ranks = normalizeRanks(record.ranks);
  const rounds = normalizeRounds(record.rounds);
  const item = {
    id: '' + Date.now(),
    tableId,
    date: record.date,
    writtenAt: record.writtenAt != null ? record.writtenAt : writtenAt,
    teamA: record.teamA || [],
    teamB: record.teamB || [],
    winner: record.winner,
    score: record.score || '',
    createdAt: Date.now()
  };
  if (ranks) item.ranks = ranks;
  if (rounds) item.rounds = rounds;
  list.unshift(item);
  setRecords(list);
  return item;
}

function removeRecord(id) {
  const list = getRecords().filter((r) => r.id !== id);
  setRecords(list);
}

function getPlayers() {
  try {
    const raw = wx.getStorageSync(PLAYERS_KEY);
    if (raw !== '' && raw != null) {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    }
    return [];
  } catch (e) {
    return [];
  }
}

function setPlayers(list) {
  wx.setStorageSync(PLAYERS_KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

function getTables() {
  try {
    const raw = wx.getStorageSync(TABLES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(arr) ? arr : [];
    if (list.length === 0) {
      const def = [{ id: DEFAULT_TABLE_ID, name: '默认牌局' }];
      setTables(def);
      return def;
    }
    return list;
  } catch (e) {
    const def = [{ id: DEFAULT_TABLE_ID, name: '默认牌局' }];
    setTables(def);
    return def;
  }
}

function setTables(list) {
  wx.setStorageSync(TABLES_KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

function addTable(name) {
  const list = getTables();
  const id = 't' + Date.now();
  list.push({ id, name: (name || '').trim() || '新牌局' });
  setTables(list);
  return { id, name: list[list.length - 1].name };
}

function updateTable(id, name) {
  const list = getTables().map((t) =>
    t.id === id ? { ...t, name: (name || '').trim() || t.name } : t
  );
  setTables(list);
}

function removeTable(id) {
  const list = getTables();
  const others = list.filter((t) => t.id !== id);
  if (others.length === 0) return false;
  const allRecords = getRecords();
  const targetId = others[0].id;
  let kept;
  if (id === DEFAULT_TABLE_ID) {
    kept = allRecords.map((r) => {
      const tid = r.tableId || DEFAULT_TABLE_ID;
      if (tid === id) return { ...r, tableId: targetId };
      return r;
    });
  } else {
    kept = allRecords.filter((r) => (r.tableId || DEFAULT_TABLE_ID) !== id);
  }
  setRecords(kept);
  setTables(others);
  if (getCurrentTableId() === id) {
    setCurrentTableId(targetId);
  }
  // 顺手清掉这个牌局的独立入榜门槛
  const map = getMinGamesPerTable();
  if (map && map[id] != null) {
    delete map[id];
    setMinGamesPerTable(map);
  }
  return true;
}

function getCurrentTableId() {
  try {
    const v = wx.getStorageSync(CURRENT_TABLE_ID_KEY);
    const id = typeof v === 'string' ? v.trim() : '';
    const tables = getTables();
    const exists = tables.some((t) => t.id === id);
    return exists ? id : (tables[0] ? tables[0].id : DEFAULT_TABLE_ID);
  } catch (e) {
    return DEFAULT_TABLE_ID;
  }
}

function setCurrentTableId(id) {
  wx.setStorageSync(CURRENT_TABLE_ID_KEY, id || DEFAULT_TABLE_ID);
}

function addRecords(batch, tableId) {
  const tid = tableId || getCurrentTableId();
  const list = getRecords();
  const base = Date.now();
  const ids = [];
  for (let i = 0; i < batch.length; i++) {
    const r = batch[i];
    const id = '' + (base + i);
    ids.push(id);
    const item = {
      id,
      tableId: tid,
      date: r.date,
      teamA: r.teamA || [],
      teamB: r.teamB || [],
      winner: r.winner,
      score: r.score || '',
      createdAt: base + i
    };
    const ranks = normalizeRanks(r.ranks);
    if (ranks) item.ranks = ranks;
    const rounds = normalizeRounds(r.rounds);
    if (rounds) item.rounds = rounds;
    list.unshift(item);
  }
  setRecords(list);
  return { count: batch.length, ids };
}

function getLastImportIds() {
  try {
    const raw = wx.getStorageSync(LAST_IMPORT_IDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function setLastImportIds(ids) {
  wx.setStorageSync(LAST_IMPORT_IDS_KEY, JSON.stringify(Array.isArray(ids) ? ids : []));
}

function clearLastImportIds() {
  wx.removeStorageSync(LAST_IMPORT_IDS_KEY);
}

function undoLastImport() {
  const ids = getLastImportIds();
  if (ids.length === 0) return { undone: 0 };
  const list = getRecords().filter((r) => !ids.includes(r.id));
  setRecords(list);
  clearLastImportIds();
  return { undone: ids.length };
}

function recordKey(r) {
  const a = ((r.teamA || []).slice().sort()).join(',');
  const b = ((r.teamB || []).slice().sort()).join(',');
  return `${r.date}|${a}|${b}|${r.winner}|${(r.score || '').trim()}`;
}

function getDeepSeekApiKey() {
  try {
    const v = wx.getStorageSync(DEEPSEEK_API_KEY_KEY);
    return typeof v === 'string' ? v.trim() : '';
  } catch (e) {
    return '';
  }
}

function setDeepSeekApiKey(key) {
  wx.setStorageSync(DEEPSEEK_API_KEY_KEY, typeof key === 'string' ? key.trim() : '');
}

function getReportHistory() {
  try {
    const raw = wx.getStorageSync(REPORT_HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function addReportToHistory(payload) {
  const list = getReportHistory();
  const id = '' + Date.now();
  const item = {
    id,
    createdAt: Date.now(),
    report: payload.report || '',
    gameCount: payload.gameCount ?? 0,
    dateRange: payload.dateRange || ''
  };
  list.unshift(item);
  const trimmed = list.slice(0, REPORT_HISTORY_MAX);
  wx.setStorageSync(REPORT_HISTORY_KEY, JSON.stringify(trimmed));
  return item;
}

function getReportById(id) {
  const list = getReportHistory();
  return list.find((r) => r.id === id) || null;
}

function getThisWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return { start: mon, end: sun };
}

function dateInWeek(dateStr, start, end) {
  const d = new Date(dateStr);
  return d >= start && d <= end;
}

function getDefaultMinGames() {
  try {
    const v = wx.getStorageSync(MIN_GAMES_FOR_RANK_KEY);
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 100) return n;
    return DEFAULT_MIN_GAMES_FOR_RANK;
  } catch (e) {
    return DEFAULT_MIN_GAMES_FOR_RANK;
  }
}

function getMinGamesPerTable() {
  try {
    const raw = wx.getStorageSync(MIN_GAMES_PER_TABLE_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    return {};
  }
}

function setMinGamesPerTable(map) {
  wx.setStorageSync(MIN_GAMES_PER_TABLE_KEY, JSON.stringify(map && typeof map === 'object' ? map : {}));
}

/**
 * 取最少入榜局数：
 *   - 仅按牌局独立设置读取，没设过就返回 0（即所有玩家都进入排行榜）
 */
function getMinGamesForRank(tableId) {
  if (!tableId) return 0;
  const perTable = getMinGamesPerTable();
  const v = parseInt(perTable[tableId], 10);
  if (Number.isFinite(v) && v >= 1 && v <= 100) return v;
  return 0;
}

function setMinGamesForRank(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v) || v < 1 || v > 100) return false;
  wx.setStorageSync(MIN_GAMES_FOR_RANK_KEY, v);
  return true;
}

/**
 * 设置某牌局的入榜门槛；传 null/undefined/空串 表示"恢复默认"，会移除该 key
 */
function setMinGamesForTable(tableId, n) {
  if (!tableId) return false;
  const map = getMinGamesPerTable();
  if (n == null || n === '') {
    delete map[tableId];
    setMinGamesPerTable(map);
    return true;
  }
  const v = parseInt(n, 10);
  if (!Number.isFinite(v) || v < 1 || v > 100) return false;
  map[tableId] = v;
  setMinGamesPerTable(map);
  return true;
}

function clearMinGamesForTable(tableId) {
  return setMinGamesForTable(tableId, null);
}

/**
 * 记录页"草稿"：用户在 record 页边打边记，途中切走/退出时自动保留在 storage，
 * 下次重进时 record 页可以无感恢复。提交一条记录后清掉。
 */
function getRecordDraft() {
  try {
    const raw = wx.getStorageSync(RECORD_DRAFT_KEY);
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function setRecordDraft(draft) {
  if (!draft || typeof draft !== 'object') return;
  try {
    wx.setStorageSync(RECORD_DRAFT_KEY, JSON.stringify(draft));
  } catch (e) { /* 静默，下次再存 */ }
}

function clearRecordDraft() {
  try { wx.removeStorageSync(RECORD_DRAFT_KEY); } catch (e) {}
}

/**
 * 记录页"最近搭配"显示开关：默认 true（开启），用户关闭后持久化
 */
function getShowRecentPairings() {
  try {
    const v = wx.getStorageSync(SHOW_RECENT_PAIRINGS_KEY);
    if (v === false || v === 'false' || v === 0 || v === '0') return false;
    return true; // 默认开启
  } catch (e) {
    return true;
  }
}

function setShowRecentPairings(enabled) {
  try {
    wx.setStorageSync(SHOW_RECENT_PAIRINGS_KEY, !!enabled);
  } catch (e) { /* 静默 */ }
}

function getPairingMode() {
  try {
    const v = wx.getStorageSync(PAIRING_MODE_KEY);
    if (typeof v === 'string' && PAIRING_MODES.indexOf(v) !== -1) return v;
    return DEFAULT_PAIRING_MODE;
  } catch (e) {
    return DEFAULT_PAIRING_MODE;
  }
}

function setPairingMode(mode) {
  if (typeof mode !== 'string' || PAIRING_MODES.indexOf(mode) === -1) return false;
  wx.setStorageSync(PAIRING_MODE_KEY, mode);
  return true;
}

function getStats(records, tableId) {
  const list = records || [];
  const total = list.length;
  const { start, end } = getThisWeekRange();
  const weekRecords = list.filter((r) => dateInWeek(r.date, start, end));
  const weekTotal = weekRecords.length;
  const games = {};
  const wins = {};
  for (const r of list) {
    const teamA = r.teamA || [];
    const teamB = r.teamB || [];
    const all = [...teamA, ...teamB];
    for (const p of all) games[p] = (games[p] || 0) + 1;
    const winners = r.winner === 'A' ? teamA : teamB;
    for (const p of winners) wins[p] = (wins[p] || 0) + 1;
  }
  const minGames = getMinGamesForRank(tableId);
  const leaderboard = [];
  for (const name of Object.keys(games)) {
    if (games[name] >= minGames) {
      leaderboard.push({
        name,
        wins: wins[name] || 0,
        games: games[name],
        rate: ((wins[name] || 0) / games[name] * 100).toFixed(1)
      });
    }
  }
  leaderboard.sort((a, b) => {
    if (b.rate !== a.rate) return parseFloat(b.rate) - parseFloat(a.rate);
    return b.wins - a.wins;
  });
  return { total, weekTotal, leaderboard, records: list };
}

function computeReportStats(records) {
  const list = (records || []).slice();
  const games = {};
  const wins = {};
  const pairGames = {};
  const pairWins = {};
  for (const r of list) {
    const teamA = (r.teamA || []).slice();
    const teamB = (r.teamB || []).slice();
    const all = [...teamA, ...teamB];
    for (const p of all) {
      games[p] = (games[p] || 0) + 1;
    }
    const winners = r.winner === 'A' ? teamA : teamB;
    for (const p of winners) {
      wins[p] = (wins[p] || 0) + 1;
    }
    const pairKey = (a, b) => [a, b].sort().join(' & ');
    if (teamA.length >= 2) {
      const k = pairKey(teamA[0], teamA[1]);
      pairGames[k] = (pairGames[k] || 0) + 1;
      if (r.winner === 'A') pairWins[k] = (pairWins[k] || 0) + 1;
    }
    if (teamB.length >= 2) {
      const k = pairKey(teamB[0], teamB[1]);
      pairGames[k] = (pairGames[k] || 0) + 1;
      if (r.winner === 'B') pairWins[k] = (pairWins[k] || 0) + 1;
    }
  }
  const dates = list.map((r) => r.date).filter(Boolean);
  dates.sort();
  const dateRange = dates.length === 0 ? '' : (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} 至 ${dates[dates.length - 1]}`);
  const players = Object.keys(games).map((name) => {
    const g = games[name];
    const w = wins[name] || 0;
    return { name, appearances: g, wins: w, winRate: g > 0 ? ((w / g) * 100).toFixed(1) : '0' };
  });
  players.sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));
  const pairs = Object.keys(pairGames).map((key) => {
    const g = pairGames[key];
    const w = pairWins[key] || 0;
    return { names: key, appearances: g, wins: w, winRate: g > 0 ? ((w / g) * 100).toFixed(1) : '0' };
  });
  pairs.sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

  // === 手级统计（有 rounds 数据的对局才计入）===
  const handStats = computeHandStats(list);

  return { totalGames: list.length, dateRange, players, pairs, ...handStats };
}

const A1_IDX_S = 12;
const A3_IDX_S = 14;
const TAOQUAN_IDX_S = 1;

/**
 * 手级统计：跑每场 rounds，按规则推进级数；产出：
 *   - hands.byPlayer: 每个人在 头/二/三/末 的次数和占比
 *   - hands.atA: 每个人 自己队伍打 A 时当头游的次数 / 过A的次数 / 套圈触发次数
 *   - hands.matchPace: 每场对局打了几手（仅含手史的对局），平均/最快/最慢
 *   - hands.totals: 总手数 / 有手史的对局数
 */
function computeHandStats(records) {
  const byPlayer = {}; // { name: [head, second, third, fourth] }
  const atA = {};      // { name: { headAtA, passedAtA, taoquanTrigger } }
  const matchPace = []; // [hand count per match w/ rounds]
  let totalHands = 0;
  let matchesWithRounds = 0;

  const ensurePlayer = (n) => {
    if (!byPlayer[n]) byPlayer[n] = [0, 0, 0, 0];
    if (!atA[n]) atA[n] = { headAtA: 0, passedAtA: 0, taoquanTrigger: 0 };
  };

  for (const r of records || []) {
    const rounds = Array.isArray(r.rounds) ? r.rounds : null;
    if (!rounds || rounds.length === 0) continue;
    matchesWithRounds += 1;
    matchPace.push(rounds.length);
    // 跟踪本场级数（按规则跑一遍）
    let levelA = 0, levelB = 0;
    for (const h of rounds) {
      const order = h && Array.isArray(h.order) ? h.order : null;
      const names = h && Array.isArray(h.names) ? h.names : null;
      if (!order || !names || order.length !== 4) continue;
      totalHands += 1;
      // 个人 head/2nd/3rd/4th 计数
      for (let rank = 0; rank < 4; rank++) {
        const name = names[order[rank]] || '';
        if (!name) continue;
        ensurePlayer(name);
        byPlayer[name][rank] += 1;
      }
      // 升级 + 过A / 套圈逻辑
      const head = order[0];
      const partnerOfHead = head <= 1 ? (head === 0 ? 1 : 0) : (head === 2 ? 3 : 2);
      const partnerRank = order.indexOf(partnerOfHead) + 1;
      const upBase = partnerRank === 2 ? 3 : (partnerRank === 3 ? 2 : 1);
      const winSide = head <= 1 ? 'A' : 'B';
      const headName = names[head] || '';
      ensurePlayer(headName);
      const cur = winSide === 'A' ? levelA : levelB;
      let next = cur, passed = false, taoquanTrigger = false;
      if (cur < A1_IDX_S) {
        next = Math.min(cur + upBase, A1_IDX_S);
      } else {
        // 头游在自己队打 A
        if (headName) atA[headName].headAtA += 1;
        const canPass = cur === A1_IDX_S ? (partnerRank === 2) : (partnerRank === 2 || partnerRank === 3);
        if (canPass) {
          passed = true;
          next = cur;
          if (headName) atA[headName].passedAtA += 1;
        } else if (cur < A3_IDX_S) {
          next = cur + 1;
        } else {
          taoquanTrigger = true;
          next = TAOQUAN_IDX_S;
          if (headName) atA[headName].taoquanTrigger += 1;
        }
      }
      if (winSide === 'A') levelA = next; else levelB = next;
    }
  }

  const handPlayers = Object.keys(byPlayer).map((name) => {
    const arr = byPlayer[name];
    const total = arr[0] + arr[1] + arr[2] + arr[3];
    const a = atA[name] || { headAtA: 0, passedAtA: 0, taoquanTrigger: 0 };
    return {
      name,
      totalHands: total,
      asFirst: arr[0],
      asSecond: arr[1],
      asThird: arr[2],
      asFourth: arr[3],
      firstRate: total > 0 ? ((arr[0] / total) * 100).toFixed(1) : '0',
      fourthRate: total > 0 ? ((arr[3] / total) * 100).toFixed(1) : '0',
      headAtA: a.headAtA,
      passedAtA: a.passedAtA,
      passAtARate: a.headAtA > 0 ? ((a.passedAtA / a.headAtA) * 100).toFixed(1) : '-',
      taoquanTrigger: a.taoquanTrigger
    };
  });
  // 按 头游率 排序
  handPlayers.sort((x, y) => parseFloat(y.firstRate) - parseFloat(x.firstRate));

  const paceSummary = matchPace.length === 0 ? null : {
    matches: matchPace.length,
    totalHands,
    avg: (matchPace.reduce((s, n) => s + n, 0) / matchPace.length).toFixed(1),
    fastest: Math.min.apply(null, matchPace),
    longest: Math.max.apply(null, matchPace)
  };

  return {
    handStats: {
      totalHands,
      matchesWithRounds,
      handPlayers,
      matchPace: paceSummary
    }
  };
}

module.exports = {
  getRecords,
  setRecords,
  clearAllData,
  getStats,
  addRecord,
  addRecords,
  removeRecord,
  getPlayers,
  setPlayers,
  getTables,
  setTables,
  addTable,
  updateTable,
  removeTable,
  getCurrentTableId,
  setCurrentTableId,
  DEFAULT_TABLE_ID,
  getLastImportIds,
  setLastImportIds,
  clearLastImportIds,
  undoLastImport,
  recordKey,
  getDeepSeekApiKey,
  setDeepSeekApiKey,
  getReportHistory,
  addReportToHistory,
  getReportById,
  computeReportStats,
  getMinGamesForRank,
  setMinGamesForRank,
  getDefaultMinGames,
  getMinGamesPerTable,
  setMinGamesForTable,
  clearMinGamesForTable,
  DEFAULT_MIN_GAMES_FOR_RANK,
  getPairingMode,
  setPairingMode,
  DEFAULT_PAIRING_MODE,
  PAIRING_MODES,
  getRecordDraft,
  setRecordDraft,
  clearRecordDraft,
  getShowRecentPairings,
  setShowRecentPairings
};

// 兼容旧调用：MIN_GAMES_FOR_RANK 现在是属性 getter，读最新设置
Object.defineProperty(module.exports, 'MIN_GAMES_FOR_RANK', {
  get: getMinGamesForRank,
  enumerable: true
});
