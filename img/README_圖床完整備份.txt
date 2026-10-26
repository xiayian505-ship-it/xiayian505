SBS 圖床｜前端＋後端原始碼備份（2026-10-26）
================================================
此版本根據已保存的前端、R2 物件結構和名稱索引重建後端，並非原始部署檔案。
尚未部署 Cloudflare 正式站，也未經正式環境操作驗證。

【GitHub 備份】
可將 img/ 資料夾內容覆蓋到原本 GitHub repository 的 img/ 資料夾，再 commit + push。
img/_worker.js 是「後端原始碼備份」，GitHub Pages 不會執行它。

【Cloudflare Pages 網頁部署】
請用另附 sbs_img_cloudflare_pages_deploy_20261026.zip；該 ZIP 的 _worker.js 放在根目錄。
Cloudflare Pages 專案：sbs-img-gateway
R2 Binding：SBS_IMAGES → sbs-img
既有正式網域：https://img.stillnessbyslowly.com/

【已包含】
- 原圖儲存（不修改圖片二進位內容），多種圖片格式上傳，獨立 WebP 縮圖
- Supabase Auth 管理員驗證、圖片清單、圖片網址、圖片顯示名稱修改、刪除
- 圖片容量統計，保留舊的原圖及縮圖路徑規則、名稱索引格式
- GitHub 前端仍使用正式 API https://img.stillnessbyslowly.com/_manage

【操作統計】
- A／B 類操作 API 暫回傳 status:not-configured。前端顯示警示，但其他管理功能不受影響。
- R2 物件容量統計可使用；不代表能重算歷史操作次數。

【上線前的提醒】
- 新後端為相容性重建，並非完整取回舊版；所有線上登入、上傳、刪除尚未實際驗證。
- 請保留 Pages 舊部署，必要時可 Rollback；Rollback 無法復原已改寫或刪除的 R2 物件。
- 若網站遭部署覆蓋，原本 Pages 的靜態主頁可能被部署 ZIP 的簡單狀態頁替換；圖床前端位於 GitHub 的 img/。
- 目前不依賴 Cloudflare Analytics Token；程式碼內只使用 Supabase 的公開 publishable key。
- 不要把 Cloudflare Secret 值提交到 GitHub。

【離線模擬回歸測試】
已通過：清單、縮圖、清除別名、原檔位元組保存、讀取、容量統計、刪除、未登入禁止管理、統計停用。
沒有宣稱完成線上端到端測試。
