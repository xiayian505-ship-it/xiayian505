SBS IMG 驗證修正版 v4｜2026-10-26

已確定 v3 的 Cloudflare Workers 驗證請求含 redirect: "error"，
而 Cloudflare Workers 的 fetch 不支援此模式，會在送往 Supabase 前直接拋出例外。

本版改用 redirect: "manual"，並明確拒絕所有 3xx 回應。
保留 Bearer Token、Supabase 使用者驗證、管理員 UID 檢查，
不關閉任何管理 API 身分驗證，不變更 R2 的圖片資料、網址與索引。

請先把 GitHub ZIP 的 img/_worker.js 更新到你的儲存庫；
然後才用 Cloudflare ZIP 更新 sbs-img-gateway 正式專案。
若出現問題，請回復上一個已知可正常使用的舊部署。

診斷頁：/_sbs_gateway_health
預期 build：sbs-img-auth-v4-20261026

警告：這份通過語法及模擬測試，但未經使用者真實 Session 驗證。
