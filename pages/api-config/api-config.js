const storage = require('../../utils/storage');

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
    overrides: []
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
  }
});
