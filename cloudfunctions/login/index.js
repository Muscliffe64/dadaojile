// 云函数：login
// 唯一职责：把当前调用者的 openid 安全地返回给客户端。
// 客户端无法自己拿到 openid（这是微信的安全设计），必须通过云函数获取。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID || null
  };
};
