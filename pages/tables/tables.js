const storage = require('../../utils/storage');

Page({
  data: {
    list: [],
    counts: {},
    defaultTableId: 'default'
  },

  onShow() {
    const list = storage.getTables();
    const allRecords = storage.getRecords();
    const counts = {};
    for (const t of list) {
      counts[t.id] = (allRecords || []).filter((r) => (r.tableId || storage.DEFAULT_TABLE_ID) === t.id).length;
    }
    this.setData({ list, counts, defaultTableId: storage.DEFAULT_TABLE_ID });
  },

  onAdd() {
    wx.showModal({
      title: '新建牌局',
      editable: true,
      placeholderText: '输入牌局名称',
      success: (res) => {
        if (res.confirm && res.content) {
          storage.addTable((res.content || '').trim() || '新牌局');
          this.onShow();
          wx.showToast({ title: '已添加', icon: 'success' });
        }
      }
    });
  },

  onRename(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '重命名',
      editable: true,
      placeholderText: name,
      success: (res) => {
        if (res.confirm && res.content) {
          storage.updateTable(id, (res.content || '').trim() || name);
          this.onShow();
          wx.showToast({ title: '已修改', icon: 'success' });
        }
      }
    });
  },

  onDelete(e) {
    const { id, name } = e.currentTarget.dataset;
    const count = this.data.counts[id] || 0;
    const list = storage.getTables();
    const others = list.filter((t) => t.id !== id);
    if (others.length === 0) {
      wx.showToast({ title: '至少保留一个牌局', icon: 'none' });
      return;
    }
    let content;
    if (id === storage.DEFAULT_TABLE_ID && count > 0) {
      content = `「${name}」中 ${count} 条对局将并入「${others[0].name}」，确定删除？`;
    } else if (count > 0) {
      content = `「${name}」中 ${count} 条对局将删除，确定？`;
    } else {
      content = `确定删除「${name}」？`;
    }
    wx.showModal({
      title: '删除牌局',
      content,
      success: (res) => {
        if (res.confirm && storage.removeTable(id)) {
          this.onShow();
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  }
});
