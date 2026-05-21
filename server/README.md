# 打到几了 AI 报告 API

AI 报告功能已暂停。当前服务保留健康检查和 `/analyze` 占位接口，但不会连接 DeepSeek API，也不需要配置 API Key。

## 启动

```bash
cd server
npm install
npm start
```

## 接口

- `GET /health`
  - 返回: `{ "ok": true, "service": "guandan-ai-report", "aiReportEnabled": false }`
- `POST /analyze`
  - 返回 503: `{ "message": "AI 报告功能已暂停，当前不会连接 DeepSeek API。" }`

## 恢复说明

恢复 AI 报告时，需要重新接入模型服务、恢复小程序入口，并确认 API Key 只通过环境变量或安全后端配置管理，不要写进代码。
