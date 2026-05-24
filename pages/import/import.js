const storage = require('../../utils/storage');
const { parseCsv, collectNames } = require('../../utils/importCsv');
const aiReport = require('../../utils/aiReport');
const cloud = require('../../utils/cloud');

const RANGE_OPTIONS = [
  { value: 'all', label: '本牌局全部' },
  { value: '30d', label: '近 30 天' },
  { value: '100', label: '近 100 场' },
  { value: 'custom', label: '自定义日期' }
];
const FORMAT_OPTIONS = [
  { value: 'full', label: '完整版', desc: '备份 / 朋友互导' },
  { value: 'hands', label: '按手展开', desc: '看表格 / 发 AI' }
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

Page({
  data: {
    tableName: '',
    textarea: '',
    result: null,
    loading: false,
    importMode: 'append',
    dedupe: true,
    canUndo: false,
    recordCount: 0,
    isCloudTable: false,
    // 导出范围 / 格式 / 自定义日期
    exportRange: 'all',
    exportRangeIndex: 0,
    exportRangeOptions: RANGE_OPTIONS,
    exportRangeLabels: RANGE_OPTIONS.map((o) => o.label),
    exportFormat: 'full',
    exportFormatOptions: FORMAT_OPTIONS,
    customStart: '',
    customEnd: '',
    exportPreviewCount: 0
  },

  async onShow() {
    const tableId = storage.getCurrentTableId();
    const isCloudTable = storage.isCurrentTableCloud();
    const tables = storage.getTables();
    const cur = tables.find((t) => t.id === tableId) || tables[0];
    let tableName = (cur && cur.name) || '默认牌局';
    let recordCount = 0;
    if (isCloudTable) {
      // 云表用云接口拿名字 + 数量
      const myTables = (cloud.isReady() && await cloud.listMyTables()) || [];
      const t = myTables.find((x) => x._id === tableId);
      if (t) {
        tableName = '☁️ ' + t.name;
      }
      // 数量不在导入流程里用，先给 0；展示用
      recordCount = 0;
    } else {
      recordCount = storage.getRecords(tableId).length;
    }
    this.setData({
      tableName,
      recordCount,
      isCloudTable,
      canUndo: storage.getLastImportIds().length > 0,
      customStart: this.data.customStart || daysAgoStr(30),
      customEnd: this.data.customEnd || todayStr()
    });
    this._refreshPreviewCount();
  },

  onExportRangeChange(e) {
    const i = parseInt(e.detail.value, 10) || 0;
    const opt = RANGE_OPTIONS[i] || RANGE_OPTIONS[0];
    this.setData({ exportRangeIndex: i, exportRange: opt.value });
    this._refreshPreviewCount();
  },

  onExportFormatTap(e) {
    const v = e.currentTarget.dataset.value;
    if (v) this.setData({ exportFormat: v });
  },

  onCustomStartChange(e) {
    this.setData({ customStart: e.detail.value });
    this._refreshPreviewCount();
  },

  onCustomEndChange(e) {
    this.setData({ customEnd: e.detail.value });
    this._refreshPreviewCount();
  },

  _filteredRecords() {
    const tableId = storage.getCurrentTableId();
    const all = storage.getRecords(tableId);
    if (!all || all.length === 0) return [];
    const { exportRange, customStart, customEnd } = this.data;
    if (exportRange === 'all') return all;
    if (exportRange === '100') {
      const sorted = all.slice().sort((a, b) =>
        (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0)
      );
      return sorted.slice(0, 100);
    }
    if (exportRange === '30d') {
      const since = daysAgoStr(30);
      return all.filter((r) => (r.date || '') >= since);
    }
    if (exportRange === 'custom') {
      const s = customStart || '0000-00-00';
      const e = customEnd || '9999-99-99';
      return all.filter((r) => {
        const d = r.date || '';
        return d >= s && d <= e;
      });
    }
    return all;
  },

  _refreshPreviewCount() {
    this.setData({ exportPreviewCount: this._filteredRecords().length });
  },

  onInput(e) {
    this.setData({ textarea: e.detail.value || '', result: null });
  },

  onImportModeChange(e) {
    this.setData({ importMode: e.detail.value || 'append' });
  },

  setImportMode(e) {
    const v = e.currentTarget.dataset.value;
    if (v) this.setData({ importMode: v });
  },

  onDedupeChange(e) {
    this.setData({ dedupe: !!e.detail.value });
  },

  chooseFile() {
    const that = this;
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv', 'txt'],
      success(res) {
        wx.getFileSystemManager().readFile({
          filePath: res.tempFiles[0].path,
          encoding: 'utf-8',
          success(inner) {
            that.setData({ textarea: inner.data || '', result: null });
            wx.showToast({ title: '已加载', icon: 'success' });
          }
        });
      }
    });
  },

  clear() {
    this.setData({ textarea: '', result: null });
  },

  copySample() {
    const sample = `日期,甲1,甲2,乙1,乙2,获胜方,比分,头游,二游,三游,末游,手数过程
2026-01-03,张三,李四,王五,赵六,A,A1:A2,,,,,
2026-01-03,张三,王五,李四,赵六,B,A2:A2 2队套圈,王五,张三,李四,赵六,王五/张三/李四/赵六;王五/张三/赵六/李四`;
    wx.setClipboardData({
      data: sample,
      success: () => wx.showToast({ title: '已复制示例', icon: 'success' })
    });
  },

  doImport() {
    // 拦截：当前是云牌局时 CSV 导入暂不支持
    if (this.data.isCloudTable) {
      wx.showModal({
        title: '云牌局暂不支持导入',
        content: '请先在首页 picker 切到一个本地牌局，再来导入 CSV。\n\n如要把本地数据迁到云，请去"牌局管理"用本地牌局的"☁️ 转为云"功能。',
        showCancel: false
      });
      return;
    }
    const text = (this.data.textarea || '').trim();
    if (!text) {
      wx.showToast({ title: '请粘贴或选择 CSV', icon: 'none' });
      return;
    }
    const { importMode, dedupe } = this.data;
    const tableId = storage.getCurrentTableId();
    this.setData({ loading: true, result: null });
    const { rows, errors, warnings } = parseCsv(text);
    if (rows.length === 0) {
      this.setData({
        loading: false,
        result: { success: 0, fail: errors.length, skipped: 0, errors: errors.length ? errors : ['没有可导入的行'], warnings: [] }
      });
      this.onShow();
      return;
    }
    if (importMode === 'clear') {
      const all = storage.getRecords();
      const kept = all.filter((r) => (r.tableId || storage.DEFAULT_TABLE_ID) !== tableId);
      storage.setRecords(kept);
      storage.clearLastImportIds();
    }
    const existing = storage.getRecords(tableId);
    const keySet = new Set(existing.map(storage.recordKey));
    const toAdd = [];
    for (const r of rows) {
      const k = storage.recordKey(r);
      if (dedupe && keySet.has(k)) continue;
      toAdd.push(r);
      keySet.add(k);
    }
    const skipped = rows.length - toAdd.length;
    const names = collectNames(toAdd);
    const players = storage.getPlayers();
    storage.setPlayers([...players, ...names.filter((n) => !players.includes(n))]);
    const { count, ids } = storage.addRecords(toAdd, tableId);
    storage.setLastImportIds(ids);
    const warningsOut = (warnings || []).slice(0, 20);
    if (skipped > 0) warningsOut.unshift(`去重跳过 ${skipped} 条`);
    this.setData({
      loading: false,
      result: {
        success: count,
        fail: errors.length,
        skipped,
        errors: (errors || []).slice(0, 20),
        warnings: warningsOut
      }
    });
    wx.showToast({ title: count > 0 ? `导入 ${count} 条` : '未导入新数据', icon: count > 0 ? 'success' : 'none' });
    this.onShow();
  },

  undoImport() {
    if (storage.getLastImportIds().length === 0) return;
    wx.showModal({
      title: '确认撤销',
      content: '将删除上一轮导入，确定？',
      success: (res) => {
        if (res.confirm) {
          const { undone } = storage.undoLastImport();
          this.onShow();
          wx.showToast({ title: `已撤销 ${undone} 条`, icon: 'success' });
          this.setData({ result: null });
        }
      }
    });
  },

  clearAllData() {
    wx.showModal({
      title: '确认清空',
      content: '将清空所有对局、参与人、牌局和报告历史，仅保留默认牌局。此操作不可恢复，确定？',
      confirmText: '清空',
      confirmColor: '#c0392b',
      success: (res) => {
        if (res.confirm) {
          storage.clearAllData();
          this.setData({ textarea: '', result: null });
          this.onShow();
          wx.showToast({ title: '已清空，可重新测试', icon: 'success' });
          setTimeout(() => {
            wx.reLaunch({ url: '/pages/index/index' });
          }, 1200);
        }
      }
    });
  },

  /** 按当前范围 + 格式取 CSV；空数据时返回 null 并 toast */
  _buildCsv() {
    const records = this._filteredRecords();
    if (records.length === 0) {
      wx.showToast({ title: '当前范围内暂无数据', icon: 'none' });
      return null;
    }
    const { exportFormat } = this.data;
    const csv = exportFormat === 'hands'
      ? aiReport.formatRecordsAsHandsCsv(records)
      : aiReport.formatRecordsAsCsv(records);
    return { records, csv, format: exportFormat };
  },

  // === 主入口：发送 .csv 文件（推荐路径）===
  shareExport() {
    const b = this._buildCsv();
    if (!b) return;
    const fs = wx.getFileSystemManager();
    const ymd = todayStr();
    const tag = b.format === 'hands' ? '按手' : '完整';
    const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_');
    const fileName = `${safe(this.data.tableName) || '掼蛋'}_${ymd}_${tag}_${b.records.length}场.csv`;
    const tempPath = `${wx.env.USER_DATA_PATH}/${fileName}`;
    try {
      // 加 BOM，让 Excel/Numbers 默认按 UTF-8 打开避免中文乱码
      fs.writeFileSync(tempPath, '﻿' + b.csv, 'utf-8');
    } catch (e) {
      wx.showToast({ title: '生成文件失败', icon: 'none' });
      return;
    }
    wx.shareFileMessage({
      filePath: tempPath,
      fileName,
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') > -1) return;
        wx.openDocument({
          filePath: tempPath,
          fileType: 'csv',
          showMenu: true,
          fail: () => wx.showToast({ title: '分享失败：' + (err && err.errMsg || ''), icon: 'none' })
        });
      }
    });
  },

  // === 次入口：复制到剪贴板（适合小批量数据）===
  copyExport() {
    const b = this._buildCsv();
    if (!b) return;
    // 提前提醒太大可能被截断
    if (b.csv.length > 130000) {
      wx.showModal({
        title: '内容偏大',
        content: `已生成 ${(b.csv.length / 1024).toFixed(1)} KB，剪贴板可能被截断。建议改用"发送 .csv 文件"。仍要复制吗？`,
        confirmText: '仍复制',
        success: (res) => { if (res.confirm) this._doCopy(b); }
      });
      return;
    }
    this._doCopy(b);
  },

  _doCopy(b) {
    wx.setClipboardData({
      data: b.csv,
      success: () => {
        const lines = b.csv.split('\n').filter((l) => l && !l.startsWith('#')).length - 1;
        wx.showToast({ title: `已复制 ${b.records.length} 场 / ${lines} 行`, icon: 'success' });
      }
    });
  }
});
