const storage = require('../../utils/storage');
const { decorateRounds } = require('../../utils/handsReplay');

Page({
  data: {
    tableName: '',
    list: [],
    expanded: {}, // {recordId: true}
    isEmpty: true
  },

  onShow() {
    const tableId = storage.getCurrentTableId();
    const tables = storage.getTables();
    const cur = tables.find((t) => t.id === tableId) || tables[0];
    const list = (storage.getRecords(tableId) || []).map((r) => {
      const rounds = decorateRounds(r.rounds);
      return {
        ...r,
        hasRounds: !!(rounds && rounds.length > 0),
        roundsView: rounds || []
      };
    });
    this.setData({
      tableName: (cur && cur.name) || '默认牌局',
      list,
      expanded: {},
      isEmpty: list.length === 0
    });
  },

  toggleRounds(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const expanded = { ...(this.data.expanded || {}) };
    expanded[id] = !expanded[id];
    this.setData({ expanded });
  },

  onDelete(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定删除？',
      success: (res) => {
        if (res.confirm) {
          storage.removeRecord(id);
          this.onShow();
          wx.showToast({ title: '已删除', icon: 'none' });
        }
      }
    });
  }
});
