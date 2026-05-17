const storage = require('../../utils/storage');

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

Page({
  data: {
    list: [],
    loading: false
  },

  onLoad() {
    wx.showShareMenu({
      menus: ['shareAppMessage', 'shareTimeline']
    });
  },

  onShow() {
    const list = storage.getReportHistory().map((r) => ({
      ...r,
      dateStr: formatDate(r.createdAt)
    }));
    this.setData({ list });
  },

  goGenerate() {
    wx.navigateTo({ url: '/pages/report-config/report-config' });
  },

  openReport(e) {
    const { id } = e.currentTarget.dataset;
    if (id) wx.navigateTo({ url: `/pages/report-view/report-view?id=${id}` });
  },

  onShareAppMessage() {
    return { title: '掼蛋宝 - AI 比赛分析', path: '/pages/report-list/report-list' };
  },
  onShareTimeline() {
    return { title: '掼蛋宝 - AI 比赛分析' };
  }
});
