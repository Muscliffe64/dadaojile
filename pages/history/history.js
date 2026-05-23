const storage = require('../../utils/storage');
const cloud = require('../../utils/cloud');
const { decorateRounds } = require('../../utils/handsReplay');

Page({
  data: {
    tableName: '',
    list: [],
    expanded: {},     // {recordId: true}
    isEmpty: true,
    isCloud: false,
    myOpenid: ''
  },

  async onShow() {
    const tableId = storage.getCurrentTableId();
    const isCloud = storage.isCurrentTableCloud();
    const localTables = storage.getTables();
    const localCur = localTables.find((t) => t.id === tableId);
    let tableName = (localCur && localCur.name) || '默认牌局';

    // 拉 records
    let rawList;
    if (isCloud) {
      rawList = await cloud.getCloudRecords(tableId, 200);
      // 给 tableName 取个云牌局名字
      const myTables = await cloud.listMyTables();
      const t = (myTables || []).find((x) => x._id === tableId);
      if (t) tableName = '☁️ ' + t.name;
    } else {
      rawList = storage.getRecords(tableId) || [];
    }

    const myOpenid = isCloud ? (await cloud.getOpenid()) : '';
    const list = rawList.map((r) => {
      const rounds = decorateRounds(r.rounds);
      return {
        ...r,
        hasRounds: !!(rounds && rounds.length > 0),
        roundsView: rounds || [],
        // 仅当前用户录的云对局可删（本地全部可删，保持原行为）
        canDelete: !isCloud || r._openid === myOpenid
      };
    });

    this.setData({
      tableName,
      list,
      expanded: {},
      isEmpty: list.length === 0,
      isCloud,
      myOpenid
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
    const isCloud = this.data.isCloud;
    wx.showModal({
      title: '确认删除',
      content: isCloud ? '云端的这条对局会被删除，所有成员都看不到了。确定？' : '删除后无法恢复，确定删除？',
      confirmText: '删除',
      confirmColor: '#c0392b',
      success: async (res) => {
        if (!res.confirm) return;
        if (isCloud) {
          wx.showLoading({ title: '删除中...', mask: true });
          const r = await cloud.deleteCloudRecord(id);
          wx.hideLoading();
          if (r.ok) {
            this.onShow();
            wx.showToast({ title: '已删除', icon: 'success' });
          } else {
            wx.showModal({ title: '删除失败', content: r.error || '未知', showCancel: false });
          }
        } else {
          storage.removeRecord(id);
          this.onShow();
          wx.showToast({ title: '已删除', icon: 'none' });
        }
      }
    });
  }
});
