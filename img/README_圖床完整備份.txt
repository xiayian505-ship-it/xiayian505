SBS 圖床後端重建版 2｜備份與部署說明

這是從前端 API 與 Cloudflare R2 物件結構重新製作的後端，不是原始後端的完整取回。

GitHub 備份版：img/_worker.js 與 img/ 前端檔案一起保存。
Cloudflare 上傳版：_worker.js 放在 ZIP 最外層，另有 index.html。
請勿把 GitHub 備份 ZIP 直接當 Cloudflare Pages 的部署壓縮檔。

已實作：
- Supabase Auth /auth/v1/user 登入權限驗證（只接受原本的管理員 UID）。
- 原圖取得、原始檔案上傳、WebP 縮圖、清單、重新命名、刪除、容量統計。
- 舊圖物件 Key 和 thumbs/images/...webp、_sbs_img/image_names_v1.json 格式。
- /_sbs_gateway_health 公開健康檢查（只回傳版本、R2 綁定狀態）。
- 驗證失敗時，API 會回傳 code 區分 token 缺失、驗證服務錯誤、非管理員。

未實作：R2 A/B 操作統計，/_manage/usage/operations 會回傳 not-configured。

離線測試：
node --check 檢查 JS 語法；以模擬 R2 測試上傳、縮圖、刪除、重新命名、圖片與容量清單、驗證失敗、診斷路由。
尚未在 Cloudflare 正式 Pages 實際執行。舊版曾在正式環境出現登入可用、API 全部失效，
因此離線通過並不能保證這一版實際運作正常。

上線建議：使用另一個 Pages 測試部署／預覽環境並綁定測試 R2；
先測 /_sbs_gateway_health，確認回傳 status:ok 和 r2Binding:true，
再測登入圖片庫。不直接測試刪除真實圖片。

正式 Pages 專案：sbs-img-gateway
正式 R2 binding 名稱：SBS_IMAGES，儲存桶 sbs-img
此套件不包含 Supabase 私密憑證，也不含 R2 圖片資料。
並未對你的 Cloudflare 執行部署或變更任何資料。
