// 把每一手 {order, names} 按掼蛋规则跑一遍，生成可读的 summary 字符串
// 让 history / index / record 等多个页面共用这套回放逻辑
const LEVELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A1', 'A2', 'A3'];
const A1_IDX = 12, A3_IDX = 14;
const START_IDX = 0, TAOQUAN_IDX = 1;

function partnerOf(headSlot) {
  return headSlot <= 1 ? (headSlot === 0 ? 1 : 0) : (headSlot === 2 ? 3 : 2);
}

/**
 * 入参：rounds 数组，每项至少有 {order:[4 个 slot], names:[4 个姓名]}
 * 返回：数组，每项 {summary, passed, taoquanTrigger}
 * 没有 rounds 或解析失败时返回 null。
 */
function decorateRounds(rounds) {
  if (!Array.isArray(rounds) || rounds.length === 0) return null;
  let levelA = START_IDX, levelB = START_IDX;
  const out = [];
  for (const r of rounds) {
    if (!r || !Array.isArray(r.order) || !Array.isArray(r.names)) continue;
    const order = r.order;
    const names = r.names;
    const head = order[0];
    const winSide = head <= 1 ? 'A' : 'B';
    const partnerSlot = partnerOf(head);
    const partnerRank = order.indexOf(partnerSlot) + 1;
    const upBase = partnerRank === 2 ? 3 : (partnerRank === 3 ? 2 : 1);
    const curIdx = winSide === 'A' ? levelA : levelB;
    let nextIdx = curIdx;
    let passed = false;
    let taoquanTrigger = false;
    if (curIdx < A1_IDX) {
      nextIdx = Math.min(curIdx + upBase, A1_IDX);
    } else {
      const canPass = curIdx === A1_IDX ? (partnerRank === 2) : (partnerRank === 2 || partnerRank === 3);
      if (canPass) {
        passed = true;
      } else if (curIdx < A3_IDX) {
        nextIdx = curIdx + 1;
      } else {
        taoquanTrigger = true;
        nextIdx = TAOQUAN_IDX;
      }
    }
    if (winSide === 'A') levelA = nextIdx; else levelB = nextIdx;
    const headName = names[head] || '?';
    const partnerName = names[partnerSlot] || '?';
    const winLabel = winSide === 'A' ? '1队' : '2队';
    let summary;
    if (passed) {
      summary = `${winLabel} ${headName}+${partnerName} 过${LEVELS[curIdx]}，掼蛋成功`;
    } else if (taoquanTrigger) {
      summary = `${winLabel} ${headName}+${partnerName} A3 头末游，套圈 → 3`;
    } else if (curIdx >= A1_IDX) {
      summary = `${winLabel} ${headName}+${partnerName} ${LEVELS[curIdx]} 未过 → ${LEVELS[nextIdx]}`;
    } else {
      summary = `${winLabel} ${headName}+${partnerName} 升${upBase}级：${LEVELS[curIdx]} → ${LEVELS[nextIdx]}`;
    }
    out.push({ summary, passed, taoquanTrigger });
  }
  return out;
}

module.exports = {
  decorateRounds
};
