// 云函数：getRecords
// 拉取某个云牌局的所有对局记录，内部分页突破单次 100 条限制（云函数最多 100 条/次，
// 客户端 SDK 是 20 条/次——这就是为啥要走云函数）。
// 入参：{ tableId, limit?: number = 500 }
// 返回：{ records: [...], total: number, error? }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const MAX_PER_PAGE = 100;

exports.main = async (event) => {
  const tableId = event && event.tableId;
  const wantLimit = Math.min(Math.max(parseInt(event && event.limit, 10) || 500, 1), 1000);
  if (!tableId) return { records: [], total: 0, error: '缺少 tableId' };

  const all = [];
  let skip = 0;
  try {
    while (all.length < wantLimit) {
      const remaining = wantLimit - all.length;
      const pageSize = Math.min(MAX_PER_PAGE, remaining);
      const res = await db.collection('records')
        .where({ tableId })
        .orderBy('date', 'desc')
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(pageSize)
        .get();
      const batch = res.data || [];
      all.push(...batch);
      if (batch.length < pageSize) break; // 后面没了
      skip += pageSize;
    }
    return { records: all, total: all.length };
  } catch (e) {
    return {
      records: all,
      total: all.length,
      error: e && (e.errMsg || e.message || String(e))
    };
  }
};
