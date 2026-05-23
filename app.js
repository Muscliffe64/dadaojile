// 打到几了 - 掼蛋对局统计
const cloud = require('./utils/cloud');

App({
  onLaunch() {
    // 微信云开发初始化（用于后续多人共享 / 跨设备同步）
    if (typeof wx.cloud !== 'undefined') {
      wx.cloud.init({
        env: 'cloud1-d9g99grlv05fa2724',
        traceUser: true
      });
      this.globalData.cloudReady = true;
      // 异步注册当前用户（不阻塞启动）
      cloud.ensureUser().then((res) => {
        if (res && res.openid) {
          this.globalData.openid = res.openid;
          this.globalData.profile = res.profile;
        }
      }).catch(() => {});
    } else {
      // 老版本基础库或不支持云开发，回退到纯本地模式
      this.globalData.cloudReady = false;
    }
  },
  globalData: {
    cloudReady: false,
    openid: null,
    profile: null
  }
});
