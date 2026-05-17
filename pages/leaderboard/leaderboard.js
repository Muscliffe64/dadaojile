const storage = require('../../utils/storage');

Page({
  data: {
    tableName: '',
    list: [],
    isEmpty: true,
    minGames: 5
  },

  onShow() {
    const tableId = storage.getCurrentTableId();
    const tables = storage.getTables();
    const cur = tables.find((t) => t.id === tableId) || tables[0];
    const records = storage.getRecords(tableId);
    const stats = storage.computeReportStats(records);
    const minGames = storage.getMinGamesForRank(tableId);
    let list = (stats.players || [])
      .map((p) => ({ ...p, lowSample: p.appearances < minGames }))
      .sort((a, b) => {
        if (a.lowSample !== b.lowSample) return a.lowSample ? 1 : -1;
        return parseFloat(b.winRate) - parseFloat(a.winRate);
      });
    let displayRank = 0;
    let lastRate = null;
    list = list.map((p) => {
      const rate = p.winRate;
      if (lastRate === null || parseFloat(rate) !== parseFloat(lastRate)) {
        displayRank += 1;
        lastRate = rate;
      }
      const medal = displayRank === 1 ? 'gold' : (displayRank === 2 ? 'silver' : (displayRank === 3 ? 'bronze' : null));
      const rankClass = displayRank === 1 ? 'first' : (displayRank === 2 ? 'second' : (displayRank === 3 ? 'third' : ''));
      return {
        ...p,
        displayRank,
        medal,
        rankClass
      };
    });
    this.setData({
      tableName: (cur && cur.name) || '默认牌局',
      list,
      isEmpty: list.length === 0,
      minGames
    });
  }
});
