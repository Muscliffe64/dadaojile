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
    cloudReady: false,
    // 当前用户的 openid（用来判断"自己"，决定要不要显示踢出按钮）
    myOpenid: '',
    // 哪些云牌局展开了成员列表 { tableId: true }
    expandedMembers: {},
    // 各云牌局的成员名单 { tableId: [{displayName, role, ...}] }
    membersMap: {}
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
    const [tables, openid] = await Promise.all([
      cloud.listMyTables(),
      cloud.getOpenid()
    ]);
    this.setData({ cloudTables: tables, cloudLoading: false, myOpenid: openid || '' });
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
  },

  /** 一键把本地牌局转成云牌局：复制所有对局到云，本地原牌局保留待用户自行删除 */
  onConvertToCloud(e) {
    const { id, name } = e.currentTarget.dataset;
    if (!id) return;
    if (!cloud.isReady()) {
      wx.showToast({ title: '云开发未就绪', icon: 'none' });
      return;
    }
    const allRecords = storage.getRecords(id) || [];
    if (allRecords.length === 0) {
      wx.showModal({
        title: '本地牌局为空',
        content: '这个本地牌局没有对局，直接"新建云牌局"即可，不需要迁移。',
        showCancel: false
      });
      return;
    }
    wx.showModal({
      title: '转为云牌局',
      content: `将"${name}"复制到云端（${allRecords.length} 条对局）。完成后会出现新的云牌局，可以邀请朋友加入。\n\n本地原牌局会保留，验证云上数据无误后你可以手动删除。`,
      confirmText: '开始迁移',
      success: async (res) => {
        if (!res.confirm) return;
        const total = allRecords.length;
        wx.showLoading({ title: '创建云牌局...', mask: true });
        const r = await cloud.copyLocalTableToCloud(name, allRecords, (i) => {
          wx.showLoading({ title: `上传 ${i}/${total}...`, mask: true });
        });
        wx.hideLoading();
        if (!r.ok) {
          wx.showModal({ title: '迁移失败', content: r.error || '未知', showCancel: false });
          return;
        }
        const msg = `✅ 已迁移到云牌局"${r.table.name}"
邀请码：${r.table.inviteCode}
上传成功 ${r.uploaded} 条${r.failed > 0 ? '，失败 ' + r.failed + ' 条' : ''}

本地原牌局还在，等你验证云上数据 OK 再手动删它。`;
        wx.showModal({
          title: '迁移完成',
          content: msg,
          confirmText: '好',
          showCancel: false,
          success: () => this._loadCloudTables()
        });
      }
    });
  },

  /** 非 owner 退出云牌局 */
  onLeaveCloud(e) {
    const tableId = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    if (!tableId) return;
    wx.showModal({
      title: '退出云牌局',
      content: `退出"${name}"后，这个牌局从你这边消失。你之前录的对局会保留在云端，其他成员仍能看到。\n\n确定退出？`,
      confirmText: '退出',
      confirmColor: '#c0392b',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '退出中...', mask: true });
        const r = await cloud.leaveTable(tableId);
        wx.hideLoading();
        if (r.ok) {
          wx.showToast({ title: '已退出', icon: 'success' });
          this._loadCloudTables();
        } else {
          wx.showModal({ title: '退出失败', content: r.error || '未知', showCancel: false });
        }
      }
    });
  },

  /** Owner 把成员踢出 */
  onKickMember(e) {
    const tableId = e.currentTarget.dataset.tableid;
    const memberOpenid = e.currentTarget.dataset.openid;
    const memberName = e.currentTarget.dataset.name;
    if (!tableId || !memberOpenid) return;
    wx.showModal({
      title: '踢出成员',
      content: `把"${memberName}"踢出后，他在这个牌局看不到了。他之前录的对局会保留。\n\n确定？`,
      confirmText: '踢出',
      confirmColor: '#c0392b',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中...', mask: true });
        const r = await cloud.kickMember(tableId, memberOpenid);
        wx.hideLoading();
        if (!r.ok) {
          wx.showModal({ title: '踢出失败', content: r.error || '未知', showCancel: false });
          return;
        }
        wx.showToast({ title: '已踢出', icon: 'success' });
        // 刷成员列表 + 成员数
        await this._loadCloudTables();
        const members = await cloud.getTableMembers(tableId);
        const newMap = { ...(this.data.membersMap || {}) };
        newMap[tableId] = members;
        this.setData({ membersMap: newMap });
      }
    });
  },

  /** 展开/收起某云牌局的成员名单；每次展开都重新拉，避免昵称变了还显示旧的 */
  async onToggleMembers(e) {
    const tableId = e.currentTarget.dataset.id;
    if (!tableId) return;
    const expanded = { ...(this.data.expandedMembers || {}) };
    const willOpen = !expanded[tableId];
    expanded[tableId] = willOpen;
    this.setData({ expandedMembers: expanded });
    if (willOpen) {
      // 每次展开都从云端实时取，不用缓存
      const members = await cloud.getTableMembers(tableId);
      const map = { ...(this.data.membersMap || {}) };
      map[tableId] = members;
      this.setData({ membersMap: map });
    }
  }
});
