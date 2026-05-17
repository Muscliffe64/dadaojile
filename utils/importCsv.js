/**
 * 解析导入用 CSV，格式：
 * 日期,甲1,甲2,乙1,乙2,获胜方,比分[,头游,二游,三游,末游[,手数过程]]
 * 首行可为表头，会自动跳过；获胜方 A 或 B；比分任意非空字符串。
 * 若只有 5 列（日期+四人），按 获胜方=A、比分=- 补全并给出警告。
 * 第 8-11 列可选：头游/二游/三游/末游姓名；若提供必须 4 个齐全且都来自本行四人。
 * 第 12 列可选：手数过程，格式 "头游/二游/三游/末游;头游/二游/三游/末游..."
 */
const aiReport = require('./aiReport');

function parseCsv(text) {
  let raw = (text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  // 跳过 # 开头的注释行（v2 顶部标记格式版本与编码说明）
  lines = lines.filter((l) => !l.startsWith('#'));
  if (lines.length === 0) return { rows: [], errors: ['内容为空'], warnings: [] };

  const header = lines[0].toLowerCase();
  const isHeader = /日期|甲1|甲2|乙1|乙2|获胜|比分|头游|二游|三游|末游|手数过程/.test(header);
  const start = isHeader ? 1 : 0;
  const rows = [];
  const errors = [];
  const warnings = [];

  for (let i = start; i < lines.length; i++) {
    const rawLine = lines[i];
    const parts = splitCsvLine(rawLine).map(p => p.trim());
    if (parts.length < 5) {
      errors.push(`第 ${i + 1} 行：列数不足（当前 ${parts.length} 列，需 7 列），请补全 日期,甲1,甲2,乙1,乙2,获胜方,比分`);
      continue;
    }
    let date, a1, a2, b1, b2, winner, score;
    if (parts.length >= 7) {
      [date, a1, a2, b1, b2, winner, score] = parts.slice(0, 7);
    } else if (parts.length === 6) {
      [date, a1, a2, b1, b2, winner, score] = [...parts.slice(0, 6), '-'];
    } else {
      [date, a1, a2, b1, b2, winner, score] = [...parts.slice(0, 5), 'A', '-'];
    }
    const err4 = validateDateAndPlayers(date, a1, a2, b1, b2, i + 1);
    if (err4) {
      errors.push(err4);
      continue;
    }
    if (parts.length === 5) {
      warnings.push(`第 ${i + 1} 行：缺获胜方、比分，已按 获胜方=A、比分=- 导入，请到历史记录中核对修改`);
    } else if (parts.length === 6) {
      warnings.push(`第 ${i + 1} 行：缺比分，已按 - 导入，请到历史记录中核对修改`);
    }
    const err = validateRow(date, a1, a2, b1, b2, winner, score, i + 1);
    if (err) {
      errors.push(err);
      continue;
    }
    const w = (winner || '').toUpperCase() === 'B' ? 'B' : 'A';
    const dateNorm = (date || '').replace(/\//g, '-');
    // 排名列可选；若有任意一个非空就要求 4 个都齐
    let ranks = null;
    if (parts.length >= 8) {
      const rk = parts.slice(7, 11).map((s) => (s || '').trim());
      const provided = rk.filter(Boolean).length;
      if (provided > 0) {
        if (provided < 4 || rk.length < 4) {
          warnings.push(`第 ${i + 1} 行：排名列只填了 ${provided} 个，已忽略；如要保存请把头/二/三/末游 4 列填齐`);
        } else {
          const fourPlayers = new Set([a1, a2, b1, b2]);
          const rkSet = new Set(rk);
          if (rkSet.size !== 4) {
            warnings.push(`第 ${i + 1} 行：排名 4 人有重复，已忽略`);
          } else if (![...rkSet].every((n) => fourPlayers.has(n))) {
            warnings.push(`第 ${i + 1} 行：排名中的姓名与本行 4 人不一致，已忽略`);
          } else {
            ranks = { first: rk[0], second: rk[1], third: rk[2], fourth: rk[3] };
          }
        }
      }
    }
    // 第 12 列：手数过程
    let rounds = null;
    if (parts.length >= 12) {
      const roundsStr = (parts[11] || '').trim();
      if (roundsStr) {
        rounds = aiReport.parseRoundsField(roundsStr, [a1, a2, b1, b2]);
        if (!rounds) {
          warnings.push(`第 ${i + 1} 行：手数过程字段无法解析，已忽略（请检查 / 与 ; 分隔与本行四人姓名是否一致）`);
        }
      }
    }
    const row = {
      date: dateNorm,
      teamA: [a1, a2],
      teamB: [b1, b2],
      winner: w,
      score: (score || '').trim() || '-'
    };
    if (ranks) row.ranks = ranks;
    if (rounds) row.rounds = rounds;
    rows.push(row);
  }

  return { rows, errors, warnings };
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuote = !inQuote;
    } else if ((c === ',' && !inQuote) || (c === '\t' && !inQuote)) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function validateDateAndPlayers(date, a1, a2, b1, b2, lineNum) {
  if (!date) return `第 ${lineNum} 行：日期为空`;
  const normalized = (date || '').replace(/\//g, '-');
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) {
    return `第 ${lineNum} 行：日期格式应为 YYYY-MM-DD 或 YYYY/M/D`;
  }
  if (!a1 || !a2 || !b1 || !b2) return `第 ${lineNum} 行：四人姓名均不能为空`;
  const all = [a1, a2, b1, b2];
  if (new Set(all).size !== 4) return `第 ${lineNum} 行：四人不能重复`;
  return null;
}

function validateRow(date, a1, a2, b1, b2, winner, score, lineNum) {
  const err = validateDateAndPlayers(date, a1, a2, b1, b2, lineNum);
  if (err) return err;
  const w = (winner || '').toUpperCase();
  if (w !== 'A' && w !== 'B') return `第 ${lineNum} 行：获胜方应为 A 或 B`;
  if (!(score || '').trim()) return `第 ${lineNum} 行：比分为空`;
  return null;
}

function collectNames(rows) {
  const set = new Set();
  for (const r of rows) {
    (r.teamA || []).concat(r.teamB || []).forEach(n => set.add(n));
  }
  return [...set];
}

module.exports = {
  parseCsv,
  collectNames
};
