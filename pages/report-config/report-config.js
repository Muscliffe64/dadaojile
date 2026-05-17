// 生成报告配置：选择牌局、报告侧重、自定义说明
const storage = require('../../utils/storage');
const aiReport = require('../../utils/aiReport');

const FOCUS_OPTIONS = [
  { value: 'individual', label: '👤 个人实力', desc: '谁最强、谁进步了' },
  { value: 'pair', label: '🤝 搭档协同', desc: '和谁搭最好、谁和谁最默契' },
  { value: 'rivalry', label: '⚔️ 对抗关系', desc: '谁难打、谁克谁' },
  { value: 'fun', label: '🎉 趣味盘点', desc: '轻松标签、适合分享' },
  { value: 'full', label: '📊 综合全面', desc: '各方面都说说' },
  // === 基于"过程记录"的新维度（推荐在打了过程的对局上启用）===
  { value: 'handFlow', label: '🎵 打牌节奏', desc: '顺风通关 vs 拉锯战，挑典型对局讲故事（需过程记录）' },
  { value: 'clutch', label: '🔥 关键时刻', desc: '打 A1/A2/A3 顶得住吗？过A率、套圈鸽王（需过程记录）' },
  { value: 'leader', label: '🏆 头游榜', desc: '谁是出牌核心？手胜率 vs 对局胜率的反差（需过程记录）' }
];

function buildFocusChecked(arr) {
  const map = {};
  for (const opt of FOCUS_OPTIONS) {
    map[opt.value] = Array.isArray(arr) && arr.indexOf(opt.value) !== -1;
  }
  return map;
}

function buildTableChecked(ids, tables) {
  const map = {};
  for (const t of tables || []) {
    map[t.id] = Array.isArray(ids) && ids.indexOf(t.id) !== -1;
  }
  return map;
}

Page({
  data: {
    tables: [],
    selectedIds: [],
    tableChecked: {},
    selectedFocus: ['full'],
    focusChecked: { individual: false, pair: false, rivalry: false, fun: false, full: true, handFlow: false, clutch: false, leader: false },
    focusOptions: FOCUS_OPTIONS,
    customInput: '',
    loading: false,
    counts: {},
    historyCount: 0
  },

  onLoad() {},

  onShow() {
    this.load();
  },

  load() {
    const tables = storage.getTables();
    const allRecords = storage.getRecords();
    const counts = {};
    for (const t of tables) {
      counts[t.id] = (allRecords || []).filter((r) => (r.tableId || storage.DEFAULT_TABLE_ID) === t.id).length;
    }
    const currentId = storage.getCurrentTableId();
    const selectedIds = tables.some((t) => t.id === currentId) ? [currentId] : (tables[0] ? [tables[0].id] : []);
    const tableChecked = buildTableChecked(selectedIds, tables);
    const history = storage.getReportHistory() || [];
    this.setData({
      tables,
      counts,
      selectedIds: selectedIds.length > 0 ? selectedIds : [],
      tableChecked,
      historyCount: history.length
    });
  },

  goHistoryReports() {
    wx.navigateTo({ url: '/pages/report-list/report-list' });
  },

  onTableTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    let ids = [...(this.data.selectedIds || [])];
    const idx = ids.indexOf(id);
    if (idx >= 0) {
      ids.splice(idx, 1);
    } else {
      ids.push(id);
    }
    const tableChecked = buildTableChecked(ids, this.data.tables);
    this.setData({ selectedIds: ids, tableChecked });
  },

  onFocusTap(e) {
    const value = e.currentTarget.dataset.value;
    if (!value) return;
    let arr = [...(this.data.selectedFocus || [])];
    const idx = arr.indexOf(value);
    if (idx >= 0) {
      arr.splice(idx, 1);
    } else {
      arr.push(value);
    }
    const focusChecked = buildFocusChecked(arr);
    this.setData({ selectedFocus: arr, focusChecked });
  },

  onCustomInput(e) {
    this.setData({ customInput: (e.detail.value || '').trim() });
  },

  goApiConfig() {
    wx.navigateTo({ url: '/pages/api-config/api-config' });
  },

  validate() {
    const { selectedIds, tables } = this.data;
    if (!selectedIds || selectedIds.length === 0) {
      wx.showToast({ title: '请至少选择 1 个牌局', icon: 'none' });
      return false;
    }
    const allRecords = storage.getRecords();
    let total = 0;
    for (const id of selectedIds) {
      total += (allRecords || []).filter((r) => (r.tableId || storage.DEFAULT_TABLE_ID) === id).length;
    }
    if (total === 0) {
      wx.showToast({ title: '所选牌局暂无对局数据', icon: 'none' });
      return false;
    }
    if (!aiReport.getDeepSeekApiKey()) {
      wx.showToast({ title: '请先配置 API Key', icon: 'none' });
      return false;
    }
    return true;
  },

  submit() {
    if (!this.validate() || this.data.loading) return;
    const { selectedIds, selectedFocus, customInput } = this.data;
    const focus = (selectedFocus && selectedFocus.length > 0) ? selectedFocus : ['full'];
    const allRecords = storage.getRecords();
    const records = [];
    for (const id of selectedIds) {
      const list = (allRecords || []).filter((r) => (r.tableId || storage.DEFAULT_TABLE_ID) === id);
      records.push(...list);
    }
    records.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));

    this.setData({ loading: true });
    wx.showLoading({ title: '生成中…', mask: true });
    aiReport
      .requestReport({ records, focus, customInput })
      .then((report) => {
        wx.hideLoading();
        const stats = storage.computeReportStats(records);
        const item = storage.addReportToHistory({
          report,
          gameCount: stats.totalGames,
          dateRange: stats.dateRange
        });
        this.setData({ loading: false });
        wx.redirectTo({ url: `/pages/report-view/report-view?id=${item.id}` });
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ loading: false });
        const msg = (err && err.message) ? String(err.message).slice(0, 50) : '生成失败';
        wx.showToast({ title: msg, icon: 'none' });
      });
  }
});
