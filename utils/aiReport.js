/**
 * 比赛数据导出与 AI 报告生成
 * 调用 DeepSeek 提供的 OpenAI 兼容接口（https://api.deepseek.com/chat/completions）
 * 注意：发版前需在小程序后台 → 开发设置 → 服务器域名 添加 https://api.deepseek.com
 */
const storage = require('./storage');

const CSV_HEADER = '日期,甲1,甲2,乙1,乙2,获胜方,比分,头游,二游,三游,末游,手数过程';
// v2 顶部注释行：说明手数过程列的编码规则，并标记版本，importCsv 据此切换解析模式
const CSV_V2_COMMENT = '# v=2 手数过程列：每手 4 位数字 = 头/二/三/末游的座位号；1=甲1, 2=甲2, 3=乙1, 4=乙2';

/**
 * 把每手序列化成 1234 编码：1=甲1(slot 0), 2=甲2(slot 1), 3=乙1(slot 2), 4=乙2(slot 3)
 * 例如：order=[3,1,0,2] → "4213"（头游=乙2、二游=甲2、三游=甲1、末游=乙1）
 * 多手用 ";" 分隔。注意 v2 编码不再用名字，所以名字里有任何特殊字符都不会污染。
 */
function serializeRounds(rounds) {
  if (!Array.isArray(rounds) || rounds.length === 0) return '';
  const parts = [];
  for (const r of rounds) {
    if (!r || !Array.isArray(r.order)) continue;
    if (r.order.length !== 4) continue;
    const valid = r.order.every((s) => Number.isInteger(s) && s >= 0 && s <= 3);
    if (!valid) continue;
    parts.push(r.order.map((s) => String(s + 1)).join(''));
  }
  return parts.join(';');
}

/**
 * 反序列化"手数过程"列。同时兼容：
 *   - v2: "4213;1234" 纯数字（每位 1-4，对应 甲1/甲2/乙1/乙2）
 *   - v1: "张三/李四/王五/赵六;..." 老格式（用 / 分隔 4 个名字）
 * 自动按字符特征判别（不依赖 # 注释，更稳）。
 */
function parseRoundsField(str, namesInRow) {
  if (!str || typeof str !== 'string') return null;
  const handStrs = str.split(';').map((s) => s.trim()).filter(Boolean);
  if (handStrs.length === 0) return null;
  const out = [];
  // 检测 v2：第一段是 4 个 1-4 数字
  const looksLikeV2 = /^[1-4]{4}$/.test(handStrs[0]);
  if (looksLikeV2) {
    for (const h of handStrs) {
      if (!/^[1-4]{4}$/.test(h)) continue;
      const order = [h[0], h[1], h[2], h[3]].map((c) => parseInt(c, 10) - 1);
      if (new Set(order).size !== 4) continue;
      out.push({
        order,
        names: namesInRow ? [...namesInRow] : [],
        winSide: order[0] <= 1 ? 'A' : 'B'
      });
    }
    return out.length > 0 ? out : null;
  }
  // v1 兼容
  const nameSet = new Set(namesInRow || []);
  const nameToSlot = {};
  if (namesInRow && namesInRow.length === 4) {
    for (let i = 0; i < 4; i++) nameToSlot[namesInRow[i]] = i;
  }
  for (const h of handStrs) {
    const four = h.split('/').map((x) => x.trim());
    if (four.length !== 4 || four.some((n) => !n)) continue;
    if (nameSet.size === 4 && !four.every((n) => nameSet.has(n))) continue;
    const order = four.map((n) => nameToSlot[n]).filter((x) => Number.isFinite(x));
    if (order.length !== 4 || new Set(order).size !== 4) continue;
    out.push({
      order,
      names: namesInRow ? [...namesInRow] : four,
      winSide: order[0] <= 1 ? 'A' : 'B'
    });
  }
  return out.length > 0 ? out : null;
}

const FOCUS_PROMPTS = {
  individual: '【本次侧重】突出个人胜率与排名，可简要提谁进步了；搭档分析一笔带过即可。',
  pair: '【本次侧重】突出双人组合胜率、默契分析（谁和谁搭胜率明显高/低）；个人排名可简要提及。',
  rivalry: '【本次侧重】突出对手组合、克制关系（谁难打、谁克谁）；样本少时务必明确说明不足。',
  fun: '【本次侧重】语气轻松活泼，多用「常胜将军」「最佳拍档」「进步之星」等标签，适合发朋友圈分享。',
  full: '【本次侧重】均衡覆盖个人、搭档、对抗，结构清晰全面。',
  // === 基于手史的新增维度（仅当含 rounds 数据时才完整生效）===
  handFlow: '【本次侧重】聚焦"打牌节奏"——按对局拆解：哪些是顺风通关（连续头+二游、3-5 手就过A），哪些是拉锯战（多次 A 攻坚、套圈翻回）。参考"每对局手数分布"和"套圈触发"数据，挑 2-3 场最典型的对局讲故事；总结哪一对搭档"最快通关"、哪一对总是"打到 A 才翻车"。',
  clutch: '【本次侧重】聚焦"打A关键时刻"——分析每个人在自己队打 A1/A2/A3 时作为头游的次数和"过A率"。区分这些人物：(1) 关键时刻顶得住的"A 选手"；(2) 老在 A1 双下没拿到的"差一步先生"；(3) 经常让队伍套圈的"鸽王"。引用"个人手级表现"里的过A率数字。',
  leader: '【本次侧重】聚焦"头游榜"——统计每个人在所有手里当头游/二游/三游/末游的次数和占比（来自"个人手级表现"）。指出谁是真正的"出牌核心"（头游率高），谁老挂在末位（末游率高），以及"对局胜率高 vs 手胜率"差异——比如有人对局胜率高其实是搭档抗了一半，或者有人手胜率高但搭档老拖后腿。'
};

const SYSTEM_PROMPT =
  '你是一位幽默又专业的掼蛋比赛分析师。' +
  '请基于用户提供的对局数据生成一份生动有趣的中文比赛分析报告。' +
  '所有数字必须严格依据"基础统计"部分，不要编造或推算。' +
  '语气亲切活泼，可使用比喻、绰号；结构清晰、分段合理；总长度控制在 1500 字以内。';

function escapeCsvCell(s) {
  const t = String(s == null ? '' : s).trim();
  if (t.includes(',') || t.includes('"') || t.includes('\n') || t.includes('\r')) {
    return '"' + t.replace(/"/g, '""') + '"';
  }
  return t;
}

function formatRecordsAsCsv(records) {
  const list = (records || []).slice();
  list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  // 顶部加 v2 注释行：让小程序和 LLM 都明白手数过程列的编码
  const lines = [CSV_V2_COMMENT, CSV_HEADER];
  for (const r of list) {
    const a1 = (r.teamA && r.teamA[0]) || '';
    const a2 = (r.teamA && r.teamA[1]) || '';
    const b1 = (r.teamB && r.teamB[0]) || '';
    const b2 = (r.teamB && r.teamB[1]) || '';
    const winner = r.winner || '';
    const score = (r.score || '').trim() || '-';
    const rk = r.ranks || {};
    const first = rk.first || '';
    const second = rk.second || '';
    const third = rk.third || '';
    const fourth = rk.fourth || '';
    const roundsStr = serializeRounds(r.rounds);
    const row = [r.date, a1, a2, b1, b2, winner, score, first, second, third, fourth, roundsStr].map(escapeCsvCell);
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

// 级数映射，用于"按手展开"时的可读级数
const LEVELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A1', 'A2', 'A3'];

/**
 * 按手展开的 CSV：每一手单独一行，对局信息冗余一份。
 * 没有手史的对局只输出 1 行（手序为空）。Excel/Numbers 打开后每行都很短，易读易统计。
 *
 * 表头：日期,1队甲,1队乙,2队甲,2队乙,胜方,最终比分,对局序号,手序,本场总手数,头游,二游,三游,末游,1队级数(手后),2队级数(手后),过A,套圈触发
 */
const CSV_HANDS_HEADER = '日期,1队甲,1队乙,2队甲,2队乙,胜方,最终比分,对局序号,手序,本场总手数,头游,二游,三游,末游,1队级数(手后),2队级数(手后),过A,套圈触发';

function formatRecordsAsHandsCsv(records) {
  const list = (records || []).slice();
  list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const lines = [CSV_HANDS_HEADER];
  let matchIdx = 0;
  for (const r of list) {
    matchIdx += 1;
    const a1 = (r.teamA && r.teamA[0]) || '';
    const a2 = (r.teamA && r.teamA[1]) || '';
    const b1 = (r.teamB && r.teamB[0]) || '';
    const b2 = (r.teamB && r.teamB[1]) || '';
    const winner = r.winner === 'A' ? '1队' : (r.winner === 'B' ? '2队' : (r.winner || ''));
    const score = (r.score || '').trim() || '-';
    const rounds = Array.isArray(r.rounds) ? r.rounds : null;
    if (!rounds || rounds.length === 0) {
      // 无手史：只输出 1 行
      const row = [r.date, a1, a2, b1, b2, winner, score, 'G' + matchIdx, '', 0, '', '', '', '', '', '', '', ''];
      lines.push(row.map(escapeCsvCell).join(','));
      continue;
    }
    let levelA = 0, levelB = 0; // 跟踪本场级数（按规则跑一遍，输出"手后"）
    const A1_IDX = 12, A3_IDX = 14, TAOQUAN_IDX = 1;
    for (let i = 0; i < rounds.length; i++) {
      const h = rounds[i];
      const order = h.order || [];
      const names = h.names || [a1, a2, b1, b2];
      const head = order[0];
      const partnerOfHead = head <= 1 ? (head === 0 ? 1 : 0) : (head === 2 ? 3 : 2);
      const partnerRank = order.indexOf(partnerOfHead) + 1;
      const upBase = partnerRank === 2 ? 3 : (partnerRank === 3 ? 2 : 1);
      const winSide = head <= 1 ? 'A' : 'B';
      let passed = false, taoquanTrigger = false;
      const cur = winSide === 'A' ? levelA : levelB;
      let next = cur;
      if (cur < A1_IDX) {
        next = Math.min(cur + upBase, A1_IDX);
      } else {
        const canPass = cur === A1_IDX ? (partnerRank === 2) : (partnerRank === 2 || partnerRank === 3);
        if (canPass) { passed = true; next = cur; }
        else if (cur < A3_IDX) { next = cur + 1; }
        else { taoquanTrigger = true; next = TAOQUAN_IDX; }
      }
      if (winSide === 'A') levelA = next; else levelB = next;
      const firstN = names[order[0]] || '';
      const secondN = names[order[1]] || '';
      const thirdN = names[order[2]] || '';
      const fourthN = names[order[3]] || '';
      const row = [
        r.date, a1, a2, b1, b2, winner, score,
        'G' + matchIdx, i + 1, rounds.length,
        firstN, secondN, thirdN, fourthN,
        LEVELS[levelA], LEVELS[levelB],
        passed ? 'Y' : '', taoquanTrigger ? 'Y' : ''
      ];
      lines.push(row.map(escapeCsvCell).join(','));
    }
  }
  return lines.join('\n');
}

function buildUserPrompt(records, csv, opts) {
  const { focus, customInput = '' } = opts || {};
  const stats = storage.computeReportStats(records);
  const lines = [
    '【基础统计】',
    `总局数：${stats.totalGames}`,
    `时间范围：${stats.dateRange || '-'}`,
    '',
    '玩家 | 出场 | 胜场 | 胜率',
    ...(stats.players || []).map((p) => `${p.name} | ${p.appearances} | ${p.wins} | ${p.winRate}%`),
    '',
    '双人组合 | 搭档次数 | 胜场 | 胜率',
    ...(stats.pairs || []).map((p) => `${p.names} | ${p.appearances} | ${p.wins} | ${p.winRate}%`)
  ];
  // 若有手史数据，补一段"手级统计"。注意单位是"手"，与上面"局/对局"不是同一维度。
  const hs = stats.handStats;
  if (hs && hs.totalHands > 0) {
    lines.push('');
    lines.push(`【手级统计】（基于 ${hs.matchesWithRounds} 场有过程记录的对局，共 ${hs.totalHands} 手）`);
    if (hs.matchPace) {
      lines.push(`每对局手数：平均 ${hs.matchPace.avg} 手，最快 ${hs.matchPace.fastest}，最慢 ${hs.matchPace.longest}`);
    }
    lines.push('');
    lines.push('个人手级表现（按头游率排序）：');
    lines.push('玩家 | 总手数 | 头游 | 二游 | 三游 | 末游 | 头游率 | 末游率 | 打A当头游次数 | 过A率 | 触发套圈');
    for (const p of (hs.handPlayers || [])) {
      lines.push(`${p.name} | ${p.totalHands} | ${p.asFirst} | ${p.asSecond} | ${p.asThird} | ${p.asFourth} | ${p.firstRate}% | ${p.fourthRate}% | ${p.headAtA} | ${p.passAtARate === '-' ? '-' : p.passAtARate + '%'} | ${p.taoquanTrigger}`);
    }
  }
  const base = lines.join('\n');
  const arr = Array.isArray(focus) && focus.length > 0 ? focus : ['full'];
  const parts = arr.map((f) => (FOCUS_PROMPTS[f] || FOCUS_PROMPTS.full).replace(/^【本次侧重】\s*/, ''));
  const focusPrompt = parts.length > 1
    ? `【本次侧重】综合以下方面：\n${parts.map((p, i) => `${i + 1}）${p}`).join('\n')}`
    : `【本次侧重】${parts[0]}`;
  let extra = `\n\n${focusPrompt}`;
  if (customInput && customInput.trim()) {
    extra += `\n\n【用户额外说明】\n${customInput.trim()}\n\n请结合上述说明调整报告侧重点和风格。`;
  }
  return `下面有机器预统计与原始 CSV。请你**严格依据基础统计**写报告，所有数字必须以基础统计为准。

${base}

---

原始 CSV：
\`\`\`
${csv}
\`\`\`
${extra}

请生成一份比赛分析报告。`;
}

function getDeepSeekApiKey() {
  return storage.getDeepSeekApiKey();
}

function requestReport(opts) {
  const { records, focus, customInput } = opts || {};
  if (!records || !records.length) {
    return Promise.reject(new Error('暂无对局数据'));
  }
  const apiKey = getDeepSeekApiKey();
  if (!apiKey) {
    return Promise.reject(new Error('请先配置 API Key'));
  }
  const csv = formatRecordsAsCsv(records);
  const userPrompt = buildUserPrompt(records, csv, { focus, customInput });

  return new Promise((resolve, reject) => {
    wx.request({
      url: 'https://api.deepseek.com/chat/completions',
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      data: {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 2400,
        stream: false
      },
      timeout: 60000,
      success(res) {
        if (res.statusCode !== 200) {
          const errMsg =
            (res.data && res.data.error && res.data.error.message) ||
            (res.data && res.data.message) ||
            `HTTP ${res.statusCode}`;
          reject(new Error(errMsg));
          return;
        }
        const content =
          res.data &&
          res.data.choices &&
          res.data.choices[0] &&
          res.data.choices[0].message &&
          res.data.choices[0].message.content;
        if (!content || !String(content).trim()) {
          reject(new Error('返回内容为空'));
          return;
        }
        resolve(String(content).trim());
      },
      fail(err) {
        const msg = (err && err.errMsg) || '网络请求失败';
        // 给"域名未在白名单"这种常见错给个更友好的提示
        if (/url not in domain list/i.test(msg) || /合法域名/.test(msg)) {
          reject(new Error('域名未配置：请在小程序后台添加 https://api.deepseek.com'));
        } else {
          reject(new Error(msg));
        }
      }
    });
  });
}

module.exports = {
  formatRecordsAsCsv,
  formatRecordsAsHandsCsv,
  serializeRounds,
  parseRoundsField,
  getDeepSeekApiKey,
  requestReport
};
