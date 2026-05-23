// utils/cloud.js
// 微信云开发的薄封装：
// - 提供 isReady() 检查
// - 提供一个连通测试方法 ping()
// - 后续会陆续加：用户 / 牌局 / 成员 / 对局 等读写接口

const ENV_ID = 'cloud1-d9g99grlv05fa2724';
const TEST_COLLECTION = 'cloud_health_check';

/**
 * 云开发是否可用
 *   - wx.cloud 不存在 → false（基础库太老）
 *   - app.globalData.cloudReady === true → true
 */
function isReady() {
  if (typeof wx === 'undefined' || typeof wx.cloud === 'undefined') return false;
  try {
    const app = getApp();
    return !!(app && app.globalData && app.globalData.cloudReady);
  } catch (e) {
    return true; // app 拿不到时降级为按 wx.cloud 存在判断
  }
}

/**
 * 拿数据库实例。所有读写都走它。
 * 调用方拿到 db 后 db.collection('xxx').add({data: {...}}) 等等。
 */
function db() {
  return wx.cloud.database();
}

/**
 * 连通测试：写一条 + 读一条 + 删一条。
 * 返回 Promise<{ok, openid, writeId, latencyMs, error?}>
 * 任何一步失败，error 字段会告诉你卡在哪。
 */
async function ping() {
  if (!isReady()) {
    return { ok: false, error: '云开发未初始化（请检查 app.js 里 wx.cloud.init 和环境 ID）' };
  }
  const t0 = Date.now();
  try {
    // 1. 拿当前用户的 openid（云开发自动用微信账号识别，不需要登录页）
    const cf = await wx.cloud.callFunction({
      name: '__nonexistent__'
    }).catch(() => null);
    // 上面的 callFunction 故意失败，目的是触发一次轻量请求拿到上下文；真正拿 openid 用下面的方式
    // 但更简单的方式：直接用 db 的 _openid 字段在新增时自动填

    // 2. 写一条测试数据
    const writeRes = await db().collection(TEST_COLLECTION).add({
      data: {
        kind: 'ping',
        at: db().serverDate(),
        from: 'cloud.js'
      }
    });

    // 3. 立刻读回来
    const readRes = await db().collection(TEST_COLLECTION).doc(writeRes._id).get();

    // 4. 顺手删掉（避免测试数据堆积）
    await db().collection(TEST_COLLECTION).doc(writeRes._id).remove();

    return {
      ok: true,
      writeId: writeRes._id,
      openid: readRes.data && readRes.data._openid,
      latencyMs: Date.now() - t0
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error: err && (err.errMsg || err.message || String(err))
    };
  }
}

/**
 * 拿当前微信用户的 openid。
 * - 客户端拿不到 openid（微信安全限制），必须通过云函数。
 * - 第一次调用后缓存到内存 + wx.storage，避免每次都跑云函数。
 */
const OPENID_CACHE_KEY = 'guandan_my_openid';
let _openidCache = null;

async function getOpenid() {
  if (_openidCache) return _openidCache;
  // 从 storage 取
  try {
    const cached = wx.getStorageSync(OPENID_CACHE_KEY);
    if (cached && typeof cached === 'string') {
      _openidCache = cached;
      return cached;
    }
  } catch (e) {}
  if (!isReady()) return null;
  try {
    const res = await wx.cloud.callFunction({ name: 'login' });
    const openid = res && res.result && res.result.openid;
    if (openid) {
      _openidCache = openid;
      try { wx.setStorageSync(OPENID_CACHE_KEY, openid); } catch (e) {}
      return openid;
    }
  } catch (e) {
    // 云函数没部署或调用失败，返回 null，调用方降级
    console.error('[cloud.getOpenid] callFunction failed:', e);
  }
  return null;
}

/**
 * 确保 users 集合里有当前用户。第一次进入时插入一条；之后只更新 lastSeenAt。
 * 返回 { openid, profile } 或 null（云不可用时）。
 * profile: { name, avatar, createdAt, lastSeenAt }
 */
async function ensureUser() {
  const openid = await getOpenid();
  if (!openid) return null;
  const col = db().collection('users');
  try {
    // 用 openid 作为 _id，方便后续直接 doc(openid).get()
    const res = await col.doc(openid).get().catch(() => null);
    if (res && res.data) {
      // 已存在，更新最后活跃时间
      await col.doc(openid).update({
        data: { lastSeenAt: db().serverDate() }
      }).catch(() => {});
      return { openid, profile: res.data, isNew: false };
    }
    // 不存在，创建
    const defaultName = openid.slice(-6);
    await col.add({
      data: {
        _id: openid,
        name: defaultName,
        avatar: '',
        createdAt: db().serverDate(),
        lastSeenAt: db().serverDate()
      }
    });
    return {
      openid,
      profile: { _id: openid, name: defaultName, avatar: '' },
      isNew: true
    };
  } catch (e) {
    console.error('[cloud.ensureUser] failed:', e);
    return { openid, profile: null, error: e && (e.errMsg || e.message) };
  }
}

/**
 * 更新当前用户的昵称/头像
 */
async function saveProfile({ name, avatar }) {
  const openid = await getOpenid();
  if (!openid) return { ok: false, error: '未拿到 openid' };
  const data = {};
  if (typeof name === 'string') data.name = name.trim().slice(0, 20);
  if (typeof avatar === 'string') data.avatar = avatar;
  if (Object.keys(data).length === 0) return { ok: true };
  try {
    await db().collection('users').doc(openid).update({ data });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && (e.errMsg || e.message) };
  }
}

/** 读当前用户 profile（先内存/storage，再云端） */
async function getMyProfile() {
  const openid = await getOpenid();
  if (!openid) return null;
  try {
    const res = await db().collection('users').doc(openid).get();
    return res.data || null;
  } catch (e) {
    return null;
  }
}

/** 生成 6 位随机邀请码（大写字母+数字，去掉容易混的 0 O 1 I） */
function genInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/**
 * 创建一个云牌局，自己自动作为 owner 加入。
 * 返回 { ok, table?: { _id, name, inviteCode, ... }, error? }
 */
async function createTable(name) {
  const openid = await getOpenid();
  if (!openid) return { ok: false, error: '未拿到 openid（云函数 login 未部署？）' };
  const trimmed = (name || '').trim() || '新牌局';
  const myProfile = (await getMyProfile()) || { name: openid.slice(-6), avatar: '' };
  try {
    const inviteCode = genInviteCode();
    // 1) 在 tables 集合插一条
    const tableRes = await db().collection('tables').add({
      data: {
        name: trimmed,
        ownerOpenid: openid,
        inviteCode,
        createdAt: db().serverDate(),
        updatedAt: db().serverDate(),
        memberCount: 1
      }
    });
    const tableId = tableRes._id;
    // 2) 在 table_members 加自己
    await db().collection('table_members').add({
      data: {
        tableId,
        openid,
        displayName: myProfile.name,
        avatar: myProfile.avatar || '',
        role: 'owner',
        joinedAt: db().serverDate()
      }
    });
    return {
      ok: true,
      table: {
        _id: tableId,
        name: trimmed,
        inviteCode,
        ownerOpenid: openid,
        memberCount: 1,
        role: 'owner'
      }
    };
  } catch (e) {
    console.error('[cloud.createTable]', e);
    return { ok: false, error: e && (e.errMsg || e.message || String(e)) };
  }
}

/**
 * 列出我加入的所有云牌局。
 * 返回数组，每项包含 {_id, name, inviteCode, memberCount, ownerOpenid, role, joinedAt}
 */
async function listMyTables() {
  const openid = await getOpenid();
  if (!openid) return [];
  try {
    // 1) 我加入的所有 table_members 记录
    const memRes = await db().collection('table_members')
      .where({ openid })
      .orderBy('joinedAt', 'desc')
      .limit(50)
      .get();
    const members = memRes.data || [];
    if (members.length === 0) return [];
    const tableIds = members.map((m) => m.tableId);
    // 2) 对应的 tables（用 in 一次拉完）
    const _ = db().command;
    const tableRes = await db().collection('tables')
      .where({ _id: _.in(tableIds) })
      .get();
    const tableMap = {};
    for (const t of (tableRes.data || [])) tableMap[t._id] = t;
    // 3) 组合
    const out = [];
    for (const m of members) {
      const t = tableMap[m.tableId];
      if (!t) continue;
      out.push({
        _id: t._id,
        name: t.name,
        inviteCode: t.inviteCode,
        ownerOpenid: t.ownerOpenid,
        memberCount: t.memberCount || 1,
        role: m.role,
        joinedAt: m.joinedAt
      });
    }
    return out;
  } catch (e) {
    console.error('[cloud.listMyTables]', e);
    return [];
  }
}

/**
 * 删除云牌局（仅 owner 可删）。
 * 同时清掉 table_members 里所有相关记录。
 * 返回 { ok, error? }
 */
async function deleteTable(tableId) {
  const openid = await getOpenid();
  if (!openid) return { ok: false, error: '未拿到 openid' };
  try {
    // 检查所有权
    const tableRes = await db().collection('tables').doc(tableId).get().catch(() => null);
    if (!tableRes || !tableRes.data) return { ok: false, error: '牌局不存在或无权限' };
    if (tableRes.data.ownerOpenid !== openid) {
      return { ok: false, error: '只有创建者能删除' };
    }
    // 删 table_members 里所有此 tableId 的成员记录
    const memRes = await db().collection('table_members').where({ tableId }).get();
    for (const m of (memRes.data || [])) {
      await db().collection('table_members').doc(m._id).remove().catch(() => {});
    }
    // 删牌局本身
    await db().collection('tables').doc(tableId).remove();
    return { ok: true };
  } catch (e) {
    console.error('[cloud.deleteTable]', e);
    return { ok: false, error: e && (e.errMsg || e.message || String(e)) };
  }
}

/**
 * 用邀请码加入云牌局。
 * 流程：根据 inviteCode 查到 tables，再写一条 table_members（如果还没在的话）。
 * 返回 { ok, table?: {_id, name, ...}, alreadyJoined?, error? }
 */
async function joinTableByCode(inviteCode) {
  const openid = await getOpenid();
  if (!openid) return { ok: false, error: '未拿到 openid' };
  const code = (inviteCode || '').trim().toUpperCase();
  if (!code) return { ok: false, error: '请输入邀请码' };
  const myProfile = (await getMyProfile()) || { name: openid.slice(-6), avatar: '' };
  try {
    // 1) 查牌局
    const tableRes = await db().collection('tables').where({ inviteCode: code }).limit(1).get();
    const table = (tableRes.data || [])[0];
    if (!table) return { ok: false, error: '邀请码无效，请确认拼写' };
    // 2) 是不是已经加入过
    const memRes = await db().collection('table_members')
      .where({ tableId: table._id, openid })
      .limit(1)
      .get();
    if (memRes.data && memRes.data.length > 0) {
      return { ok: true, table, alreadyJoined: true };
    }
    // 3) 写入成员
    await db().collection('table_members').add({
      data: {
        tableId: table._id,
        openid,
        displayName: myProfile.name,
        avatar: myProfile.avatar || '',
        role: 'member',
        joinedAt: db().serverDate()
      }
    });
    // 4) 把 tables 的 memberCount 加 1
    const _ = db().command;
    await db().collection('tables').doc(table._id).update({
      data: { memberCount: _.inc(1), updatedAt: db().serverDate() }
    }).catch(() => {});
    return { ok: true, table, alreadyJoined: false };
  } catch (e) {
    console.error('[cloud.joinTableByCode]', e);
    return { ok: false, error: e && (e.errMsg || e.message || String(e)) };
  }
}

module.exports = {
  ENV_ID,
  isReady,
  db,
  ping,
  getOpenid,
  ensureUser,
  saveProfile,
  getMyProfile,
  createTable,
  listMyTables,
  deleteTable,
  joinTableByCode
};
