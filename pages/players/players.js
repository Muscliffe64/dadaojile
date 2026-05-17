// 参与人管理：添加、列表、删除；记录页用此列表
const storage = require('../../utils/storage');

Page({
  data: {
    list: [],
    inputVal: ''
  },

  onLoad() {},

  onShow() {
    this.load();
  },

  load() {
    const list = storage.getPlayers();
    this.setData({ list: [...list] });
  },

  onInput(e) {
    this.setData({ inputVal: (e.detail.value || '').trim() });
  },

  add() {
    const name = this.data.inputVal.trim();
    if (!name) {
      wx.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }
    const list = [...this.data.list];
    if (list.includes(name)) {
      wx.showToast({ title: '已存在', icon: 'none' });
      return;
    }
    list.push(name);
    storage.setPlayers(list);
    this.setData({ list, inputVal: '' });
    wx.showToast({ title: '已添加', icon: 'success' });
  },

  remove(e) {
    const { index } = e.currentTarget.dataset;
    const list = [...this.data.list];
    list.splice(index, 1);
    storage.setPlayers(list);
    this.setData({ list });
    wx.showToast({ title: '已删除', icon: 'none' });
  }
});
