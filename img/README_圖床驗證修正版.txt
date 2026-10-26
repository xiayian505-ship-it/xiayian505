SBS 圖床 v3｜驗證流程修正版（2026-10-26）

這份為重建版，並非從 Cloudflare 取回的舊版原始碼。
本次只修驗證與錯誤診斷；沿用原有圖片管理、R2 圖片路徑及前端樣式。

重要事項
1. Cloudflare 的 _worker.js 與 GitHub 的 img/sbs_img.js 都要更新；只更新其中一邊，仍無法完整診斷。
2. GitHub 完整備份版內是 img/ 資料夾，可放回目前的 GitHub 倉庫。
3. Cloudflare ZIP 內 _worker.js 位於根目錄，適合 Pages 網頁直接上傳。
4. Cloudflare Pages 環境的 R2 Binding 必須維持 SBS_IMAGES -> sbs-img。
5. 避免直接在正式站做刪除測試。預設推薦先用測試部署並使用測試儲存桶。
6. 若出錯，前端將顯示管理員驗證失敗（錯誤代碼、HTTP狀態）。可提供代碼，不要提供 Access Token。

公開健康檢查（無需登入）：
https://sbs-img-gateway.pages.dev/_sbs_gateway_health
預期 build 為 sbs-img-auth-v3-20261026；r2Binding 表示是否綁定，不代表圖片可讀寫。

新增已登入測試路由： GET /_manage/auth-check
只有驗證成功的管理員會收到 authorized:true；請不要把 Access Token 分享給任何人。

驗證順序：
前端會先送 Authorization: Bearer <Supabase JWT>；只有收到 missing_token 後才以 X-SBS-Auth 備援重新送出。
這樣可先把前端更新到 GitHub，舊版後端不會因為新自訂標頭而拒絕正常請求。
後端仍會帶著 API publishable key + JWT 向 Supabase 的 /auth/v1/user 驗證，並檢查管理員 UID。
不會直接相信前端的 UID 或未驗證的 JWT 內容。

代碼說明：
missing_token：後端完全收不到憑證
invalid_authorization_header：標頭格式不是 Bearer
invalid_token_format：收到的內容不是三段式 JWT
upstream_auth_rejected：Supabase 拒絕 JWT（HTTP 401/403）
upstream_http_error：Supabase 返回其他 HTTP 錯誤
upstream_unavailable / upstream_timeout：Cloudflare 無法連線或逾時
invalid_user_response：Supabase 回應缺少使用者 UID
not_admin：驗證成功但 UID 不在管理員名單

限制：
離線模擬測試不能代替實際 Cloudflare + Supabase 連線驗證。
R2 A/B 類操作統計暫未重建。
