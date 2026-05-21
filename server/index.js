/**
 * 打到几了 AI 报告 API
 * AI 报告功能已暂停，当前服务不会连接 DeepSeek API。
 */
require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json({ limit: '2mb' }));

// 允许小程序跨域请求
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'guandan-ai-report', aiReportEnabled: false });
});

app.post('/analyze', async (req, res) => {
  return res.status(503).json({ message: 'AI 报告功能已暂停，当前不会连接 DeepSeek API。' });
});

const port = parseInt(process.env.PORT, 10) || 3000;
app.listen(port, () => {
  console.log(`AI 报告 API 已暂停: http://localhost:${port}`);
  console.log('健康检查: GET http://localhost:' + port + '/health');
});
