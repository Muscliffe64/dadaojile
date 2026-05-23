const storage = require('../../utils/storage');
const cloud = require('../../utils/cloud');

Page({
  data: {
    list: [],
    counts: {},
    defaultTableId: 'default',
    // 云牌局
    cloudTables: [],
    cloudLoading: false,
    cloudReady: false
  },

  onShow() {
    const list = storage.getTables();
    const allRecords = storage.getRecords();
    const counts = {};
    for (const t of list) {
      counts[t.id] = (allRecords || []).filter((r) => (r.tableId || storage.DEFAULT_TABLE_ID) === t.id).length;
    }
    this.setData({
      list,
      counts,
      defaultTableId: storage.DEFAULT_TABLE_ID,
      cloudReady: cloud.isReady()
    });
    this._loadCloudTables();
  },

  async _loadCloudTables() {
    if (!cloud.isReady()) return;
    this.setData({ cloudLoading: true });
    const tables = await cloud.listMyTables();
    this.setData({ cloudTables: tables, cloudLoading: false });
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

  onAddCloud() {
    if (!cloud.isReady()) {
      wx.showToast({ title: '云开发未就绪', icon: 'none' });
      return;
    }
    // 注意：editable=true 时不能传 content，否则它会变成输入框的默认值
    wx.showModal({
      title: '新建云牌局',
      editable: true,
      placeholderText: '输入牌局名称，如：周三晚常驻',
      success: async (res) => {
        if (!res.confirm) return;
        const name = (res.content || '').trim();
        if (!name) {
          wx.showToast({ title: '请输入牌局名称', icon: 'none' });
          return;
        }
        wx.showLoading({ title: '创建中...', mask: true });
        const r = await cloud.createTable(name);
        wx.hideLoading();
        if (r.ok) {
          wx.showToast({ title: '已创建', icon: 'success' });
          this._loadCloudTables();
        } else {
          wx.showModal({
            title: '创建失败',
            content: r.error || '未知错误',
            showCancel: false
          });
        }
      }
    });
  },

  /** 通过邀请码加入云牌局 */
  onJoinByCode() {
    if (!cloud.isReady()) {
      wx.showToast({ title: '云开发未就绪', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '用邀请码加入',
      editable: true,
      placeholderText: '输入 6 位邀请码',
      success: async (res) => {
        if (!res.confirm) return;
        const code = (res.content || '').trim();
        if (!code) {
          wx.showToast({ title: '请输入邀请码', icon: 'none' });
          return;
        }
        wx.showLoading({ title: '查找中...', mask: true });
        const r = await cloud.joinTableByCode(code);
        wx.hideLoading();
        if (!r.ok) {
          wx.showModal({ title: '加入失败', content: r.error || '未知错误', showCancel: false });
          return;
        }
        if (r.alreadyJoined) {
          wx.showToast({ title: `已经在「${r.table.name}」里`, icon: 'none' });
        } else {
          wx.showToast({ title: `已加入「${r.table.name}」`, icon: 'success' });
        }
        this._loadCloudTables();
      }
    });
  },

  /** 删除云牌局 / 离开云牌局（自动判断是 owner 还是 member） */
  onDeleteCloud(e) {
    const tableId = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    const role = e.currentTarget.dataset.role;
    if (!tableId) return;
    if (role !== 'owner') {
      wx.showToast({ title: '暂不支持退出（只有创建者能删）', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '删除云牌局',
      content: `「${name}」将从云端彻底删除，所有成员都看不到了。确定？`,
      confirmText: '删除',
      confirmColor: '#c0392b',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中...', mask: true });
        const r = await cloud.deleteTable(tableId);
        wx.hideLoading();
        if (r.ok) {
          wx.showToast({ title: '已删除', icon: 'success' });
          this._loadCloudTables();
        } else {
          wx.showModal({ title: '删除失败', content: r.error || '未知错误', showCancel: false });
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
  },

  /** 复制邀请码到剪贴板 */
  onCopyInvite(e) {
    const code = e.currentTarget.dataset.code;
    if (!code) return;
    wx.setClipboardData({
      data: code,
      success: () => wx.showToast({ title: '已复制邀请码：' + code, icon: 'none', duration: 2000 })
    });
  }
});
