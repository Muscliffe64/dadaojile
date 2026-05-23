// 首页：排行榜、总局数、最近对局、牌局选择
const storage = require('../../utils/storage');
const cloud = require('../../utils/cloud');
const { decorateRounds } = require('../../utils/handsReplay');

function getTeam(record, side) {
  return side === 'A' ? (record.teamA || []) : (record.teamB || []);
}

function computeCurrentWinStreaks(records) {
  // 入参 records 是"最近在前"，因此从前往后扫即"从最近一场起向更早回溯"。
  // 一旦遇到失败就标记 stopped，更早的胜场不再计入当前连胜。
  const counts = {};
  const stopped = {};
  for (const r of records || []) {
    const winnerSide = r.winner === 'B' ? 'B' : 'A';
    const loserSide = winnerSide === 'A' ? 'B' : 'A';
    const winners = getTeam(r, winnerSide);
    const losers = getTeam(r, loserSide);
    for (const name of losers) {
      if (name) stopped[name] = true;
    }
    for (const name of winners) {
      if (name && !stopped[name]) {
        counts[name] = (counts[name] || 0) + 1;
      }
    }
  }
  return Object.keys(counts)
    .filter((name) => counts[name] >= 3)
    .map((name) => ({ name, count: counts[name] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

Page({
  data: {
    tables: [],
    currentTableId: '',
    currentTableName: '',
    currentTableIndex: 0,
    total: 0,
    weekTotal: 0,
    playerCount: 0,
    topRanks: [],
    recent: [],
    recentDisplay: [],
    expandedRounds: {},
    recentExpanded: false,
    currentStreaks: [],
    isEmpty: true,
    minGames: 5
  },

  onLoad() {
    this.load();
    wx.showShareMenu({
      menus: ['shareAppMessage', 'shareTimeline']
    });
  },

  onShow() {
    this.load();
  },

  async load() {
    const tableId = storage.getCurrentTableId();
    const localTables = storage.getTables() || [];
    // 异步拉云牌局；不可用时返回空数组
    const cloudTables = cloud.isReady() ? (await cloud.listMyTables()) : [];
    // 合并：本地 + 云。给每条加 isCloud / displayName 字段
    const tables = [
      ...localTables.map((t) => ({
        id: t.id,
        name: t.name,
        isCloud: false,
        displayName: t.name
      })),
      ...cloudTables.map((t) => ({
        id: t._id,
        name: t.name,
        isCloud: true,
        role: t.role,
        memberCount: t.memberCount,
        inviteCode: t.inviteCode,
        displayName: '☁️ ' + t.name
      }))
    ];
    let cur = tables.find((t) => t.id === tableId);
    if (!cur) cur = tables[0];
    const currentTableIndex = Math.max(0, tables.findIndex((t) => t.id === (cur && cur.id)));
    const currentIsCloud = !!(cur && cur.isCloud);
    // 云牌局的对局还没接进来（下个版本做），本地表才有真实数据
    const records = currentIsCloud ? [] : storage.getRecords(cur && cur.id);
    const { total, weekTotal, leaderboard, records: list } = storage.getStats(records, cur && cur.id);
    // 截到"竞赛名次 <= 3"，并列同名次全包含；下一个名次跳到 positionInList。
    // 例：1/2/2/4 → 显示 A,B,C（D 是第 4 名，跳过）
    // 例：1/2/3/3 → 显示 A,B,C,D（都在前 3 名内）
    // 例：1/2/3/3/3 → 显示 5 人
    let displayRank = 0;
    let lastRate = null;
    let positionInList = 0;
    const topRanks = [];
    for (const p of (leaderboard || [])) {
      positionInList += 1;
      if (lastRate === null || parseFloat(p.rate) !== parseFloat(lastRate)) {
        displayRank = positionInList;
        lastRate = p.rate;
      }
      if (displayRank > 3) break;
      const medal = displayRank === 1 ? '🥇' : (displayRank === 2 ? '🥈' : (displayRank === 3 ? '🥉' : ''));
      const rankClass = displayRank === 1 ? 'first' : (displayRank === 2 ? 'second' : (displayRank === 3 ? 'third' : ''));
      topRanks.push({ ...p, displayRank, medal, rankClass });
    }
    // 最近对局 + 给有手史的对局算好回看 summary
    const rawRecent = (list || []).slice(0, 10);
    const recent = rawRecent.map((r) => {
      const decorated = decorateRounds(r.rounds);
      return {
        ...r,
        hasRounds: !!(decorated && decorated.length > 0),
        roundsView: decorated || []
      };
    });
    const recentDisplay = recent.slice(0, 3);
    const currentStreaks = computeCurrentWinStreaks(list);
    const players = storage.getPlayers();
    this.setData({
      tables,
      currentTableId: (cur && cur.id) || tableId,
      currentTableIndex,
      currentTableName: (cur && cur.name) || '默认牌局',
      currentTableIsCloud: currentIsCloud,
      total,
      weekTotal,
      playerCount: players.length,
      topRanks,
      recent,
      recentDisplay,
      recentExpanded: false,
      currentStreaks,
      isEmpty: !list || list.length === 0,
      minGames: storage.getMinGamesForRank(cur && cur.id),
      expandedRounds: {}
    });
  },

  toggleMatchRounds(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const expandedRounds = { ...(this.data.expandedRounds || {}) };
    expandedRounds[id] = !expandedRounds[id];
    this.setData({ expandedRounds });
  },

  onTableChange(e) {
    const idx = parseInt(e.detail.value, 10);
    const { tables } = this.data;
    const t = tables[idx];
    if (t) {
      storage.setCurrentTableId(t.id, t.isCloud);
      this.load();
    }
  },

  toggleRecent() {
    const { recent, recentExpanded } = this.data;
    const next = !recentExpanded;
    this.setData({
      recentExpanded: next,
      recentDisplay: next ? recent : recent.slice(0, 3)
    });
  },

  goRecord() {
    wx.navigateTo({ url: '/pages/record/record' });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  goPlayers() {
    wx.navigateTo({ url: '/pages/players/players' });
  },

  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },

  goLeaderboard() {
    wx.navigateTo({ url: '/pages/leaderboard/leaderboard' });
  },

  goTables() {
    wx.navigateTo({ url: '/pages/tables/tables' });
  },

  goAiReport() {
    wx.navigateTo({ url: '/pages/report-config/report-config' });
  },

  goApiConfig() {
    wx.navigateTo({ url: '/pages/api-config/api-config' });
  },

  onShareAppMessage() {
    return {
      title: '打到几了 - 对局统计 · 胜率排行',
      path: '/pages/index/index'
    };
  },

  onShareTimeline() {
    return {
      title: '打到几了 - 对局统计 · 胜率排行'
    };
  }
});
