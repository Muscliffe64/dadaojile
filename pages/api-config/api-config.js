const storage = require('../../utils/storage');
const cloud = require('../../utils/cloud');

function buildOverrides() {
  const tables = storage.getTables() || [];
  const map = storage.getMinGamesPerTable() || {};
  const list = [];
  for (const t of tables) {
    if (map[t.id] != null) {
      list.push({ id: t.id, name: t.name || '(未命名)', value: map[t.id] });
    }
  }
  return list;
}

Page({
  data: {
    apiKey: '',
    tables: [],
    tableNames: [],
    pickerIndex: 0,
    addInput: '',
    overrides: [],
    cloudPinging: false,
    cloudResult: null,
    // 我的云身份
    myOpenid: '',
    openidMasked: '',
    myName: '',
    myNameEditing: '',
    myAvatar: '',
    canSaveName: false,
    saveStatus: ''
  },

  onShow() {
    const key = storage.getDeepSeekApiKey() || '';
    const tables = storage.getTables() || [];
    this.setData({
      apiKey: key,
      tables,
      tableNames: tables.map((t) => t.name || '(未命名)'),
      pickerIndex: 0,
      addInput: '',
      overrides: buildOverrides()
    });
    this._loadMyProfile();
  },

  async _loadMyProfile() {
    if (!cloud.isReady()) return;
    const openid = await cloud.getOpenid();
    if (!openid) return;
    const profile = (await cloud.getMyProfile()) || {};
    this.setData({
      myOpenid: openid,
      openidMasked: openid.slice(0, 4) + '****' + openid.slice(-4),
      myName: profile.name || openid.slice(-6),
      myNameEditing: profile.name || '',
      myAvatar: profile.avatar || ''
    });
  },

  onChooseAvatar(e) {
    const url = e.detail && e.detail.avatarUrl;
    if (!url) return;
    this.setData({ myAvatar: url, saveStatus: '正在保存头像...' });
    cloud.saveProfile({ avatar: url }).then((r) => {
      if (r.ok) {
        this.setData({ saveStatus: '✅ 头像已保存到云' });
        wx.showToast({ title: '头像已更新', icon: 'success' });
      } else {
        const msg = '保存失败：' + (r.error || '未知错误');
        console.error('[api-config.onChooseAvatar]', r.error);
        this.setData({ saveStatus: '❌ ' + msg });
        wx.showToast({ title: msg.slice(0, 30), icon: 'none', duration: 3000 });
      }
    });
  },

  onNameInput(e) {
    const v = (e.detail.value || '');
    this.setData({
      myNameEditing: v,
      canSaveName: v.trim().length > 0 && v.trim() !== this.data.myName
    });
  },

  async onNameSave() {
    const name = (this.data.myNameEditing || '').trim();
    if (!name) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }
    if (name === this.data.myName) {
      this.setData({ saveStatus: '昵称没变，无需保存' });
      return;
    }
    this.setData({ saveStatus: '正在保存昵称...' });
    const r = await cloud.saveProfile({ name });
    if (r.ok) {
      this.setData({
        myName: name,
        canSaveName: false,
        saveStatus: '✅ 昵称已保存到云：' + name
      });
      wx.showToast({ title: '昵称已保存', icon: 'success' });
    } else {
      const msg = '保存失败：' + (r.error || '未知错误');
      console.error('[api-config.onNameSave]', r.error);
      this.setData({ saveStatus: '❌ ' + msg });
      wx.showToast({ title: msg.slice(0, 30), icon: 'none', duration: 3000 });
    }
  },

  /** 用户离开页面时，如果输入框还有未保存的修改，自动兜底保存一次 */
  async onHide() {
    if (this.data.canSaveName) {
      const name = (this.data.myNameEditing || '').trim();
      if (name && name !== this.data.myName) {
        await cloud.saveProfile({ name }).catch(() => {});
      }
    }
  },

  onInput(e) {
    this.setData({ apiKey: e.detail.value || '' });
  },

  onApiKeyFocus() {
    this.setData({ apiKeyFocus: true });
  },

  onApiKeyBlur() {
    this.setData({ apiKeyFocus: false });
  },

  onPickerChange(e) {
    const i = parseInt(e.detail.value, 10) || 0;
    this.setData({ pickerIndex: i });
  },

  onAddInput(e) {
    this.setData({ addInput: (e.detail.value || '').trim() });
  },

  save() {
    const key = (this.data.apiKey || '').trim();
    storage.setDeepSeekApiKey(key);
    wx.showToast({
      title: key ? '已保存' : '已清空',
      icon: 'success'
    });
  },

  addOverride() {
    const { tables, pickerIndex, addInput } = this.data;
    const t = tables[pickerIndex];
    if (!t) {
      wx.showToast({ title: '请选择牌局', icon: 'none' });
      return;
    }
    const v = parseInt(addInput, 10);
    if (!Number.isFinite(v) || v < 1 || v > 100) {
      wx.showToast({ title: '请输入 1-100 的整数', icon: 'none' });
      return;
    }
    if (storage.setMinGamesForTable(t.id, v)) {
      this.setData({
        overrides: buildOverrides(),
        addInput: ''
      });
      wx.showToast({ title: `已设：${t.name} ${v} 局`, icon: 'success' });
    } else {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  removeOverride(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    storage.clearMinGamesForTable(id);
    this.setData({ overrides: buildOverrides() });
    wx.showToast({ title: '已移除', icon: 'none' });
  },

  async onCloudPing() {
    if (this.data.cloudPinging) return;
    this.setData({ cloudPinging: true, cloudResult: null });
    const res = await cloud.ping();
    this.setData({ cloudPinging: false, cloudResult: res });
    if (res.ok) {
      wx.showToast({ title: '云开发通了', icon: 'success' });
    } else {
      wx.showToast({ title: '失败：' + (res.error || '未知').slice(0, 30), icon: 'none', duration: 3000 });
    }
  }
});
