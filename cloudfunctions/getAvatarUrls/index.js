// 云函数：getAvatarUrls
// 用 admin 权限批量把 cloud:// 文件 ID 转成 https:// 临时 URL。
// 为啥要走云函数：免费版云存储默认权限是"仅创建者可读写"，
// 客户端直接调 wx.cloud.getTempFileURL 只能拿到自己上传的文件。
// 云函数运行时使用 env admin 权限，不受存储读权限限制。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  const fileList = Array.isArray(event && event.fileList) ? event.fileList : [];
  if (fileList.length === 0) return { urls: {} };
  try {
    const res = await cloud.getTempFileURL({ fileList });
    const urls = {};
    for (const f of (res.fileList || [])) {
      if (f.status === 0 && f.tempFileURL) {
        urls[f.fileID] = f.tempFileURL;
      }
    }
    return { urls };
  } catch (e) {
    return { urls: {}, error: e && (e.errMsg || e.message || String(e)) };
  }
};
