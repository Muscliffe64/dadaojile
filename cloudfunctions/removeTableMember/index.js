// 云函数：removeTableMember
// 让牌局 owner 把某个成员踢出。
// 用 admin 权限绕过 table_members 集合"仅创建者可写"的限制——客户端 owner 自己改不了别人的记录。
// 入参：{ tableId, openid }（要踢的人的 openid）
// 返回：{ ok, error? }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const callerOpenid = wxContext.OPENID;
  const { tableId, openid } = event || {};
  if (!tableId || !openid) return { ok: false, error: 'invalid params' };
  if (callerOpenid === openid) {
    return { ok: false, error: '不能踢自己（自己用退出功能）' };
  }
  try {
    // 1) 校验调用方是 owner
    const tableRes = await db.collection('tables').doc(tableId).get().catch(() => null);
    if (!tableRes || !tableRes.data) return { ok: false, error: '牌局不存在' };
    if (tableRes.data.ownerOpenid !== callerOpenid) {
      return { ok: false, error: '只有牌局创建者能踢出成员' };
    }
    // 2) 找到目标成员记录
    const memRes = await db.collection('table_members')
      .where({ tableId, openid })
      .limit(1)
      .get();
    if (!memRes.data || memRes.data.length === 0) {
      return { ok: false, error: '该成员不在此牌局' };
    }
    const mem = memRes.data[0];
    if (mem.role === 'owner') {
      return { ok: false, error: 'owner 不能被踢' };
    }
    // 3) 删
    await db.collection('table_members').doc(mem._id).remove();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && (e.errMsg || e.message || String(e)) };
  }
};
