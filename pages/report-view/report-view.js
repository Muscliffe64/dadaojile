const storage = require('../../utils/storage');

Page({
  data: {
    report: '',
    reportId: ''
  },

  onLoad(options) {
    wx.showShareMenu({
      menus: ['shareAppMessage', 'shareTimeline']
    });
    const { id, from } = options || {};
    if (id) {
      const item = storage.getReportById(id);
      this.setData({
        report: (item && item.report) || '报告不存在或已删除',
        reportId: id
      });
      return;
    }
    if (from === 'timeline' || from === 'share') {
      wx.redirectTo({ url: '/pages/report-list/report-list' });
      return;
    }
    try {
      const raw = wx.getStorageSync('guandan_ai_report_temp');
      const report = raw || '';
      wx.removeStorageSync('guandan_ai_report_temp');
      this.setData({ report: report || '报告为空' });
    } catch (e) {
      this.setData({ report: '报告加载失败' });
    }
  },

  goList() {
    wx.navigateTo({ url: '/pages/report-list/report-list' });
  },

  copyReport() {
    const report = (this.data.report || '').trim();
    if (!report || report === '报告不存在或已删除' || report === '报告为空' || report === '报告加载失败') {
      wx.showToast({ title: '无内容可复制', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: report,
      success: () => wx.showToast({ title: '已复制，可粘贴到微信发给好友或发朋友圈', icon: 'success' })
    });
  },

  onShareAppMessage() {
    return {
      title: '掼蛋比赛 AI 分析报告 - 打到几了',
      path: '/pages/report-list/report-list?from=share'
    };
  },

  onShareTimeline() {
    return {
      title: '掼蛋比赛 AI 分析报告 - 打到几了',
      query: 'from=timeline'
    };
  }
});
