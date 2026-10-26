SBS IMG v5｜短網址功能（2026-10-26）

目的：保留所有既有圖片與外連網址，新增 /i/{代碼}-{UTC上傳年月日時分秒}.{副檔名} 的公開短網址。

【GitHub 備份】
此 ZIP 的 img/ 目錄對應原 GitHub 的 img/ 目錄。請完整備份再部署。
修改：img/index.html、img/sbs_img.js、img/sbs_img_style.js、img/_worker.js。
原有兩份 CSS 完全不動。

【Cloudflare Pages】
部署專案：sbs-img-gateway，必須保留原有 R2 binding 名稱 SBS_IMAGES，指向 sbs-img。
請使用單獨的 Pages ZIP 上傳，根目錄必須是 _worker.js 與 index.html。
Cloudflare Pages 沒有連 GitHub，更新 GitHub 不會自動部署。

【新功能】
- 原長網址與短網址共存，原圖片不搬動、不轉檔。
- 短網址前綴固定 /i/，代碼由原 R2 Key UUID 的一部分 + 原始上傳 UTC 時間產生；保留原副檔名。
- 上傳時建立短網址；圖片庫每次登入讀清單時，替舊圖補建缺少的短網址指向紀錄。
- 短網址對照紀錄存於同一 R2：_sbs_img/short_links_v1/<短檔名>.json；不會複製圖片。
- 圖片庫、上傳成功區及圖片詳情各有「複製網址」和「複製短網址」。
- 刪除原圖時，會同步刪除對應縮圖及短網址對照。重新命名不影響任何網址。
- 目前不處理 A/B 類操作統計。

【重要】
- 新增短網址需要真實 Pages 環境驗收。舊版 v4 已實際驗收登入、上傳、刪除、重新命名，請保留可回復版本。
- 請先用不重要的圖片測試短網址是否顯示原圖，再確認既有長網址；測試刪除時只使用測試圖片。
- 新版短網址補建會產生少量 R2 管理用 JSON 物件，屬正常設計，圖片數量統計不受影響，但 R2 總物件數與少量容量會增加。
- 只有在 Cloudflare Pages 和前端皆部署此新版後，兩顆複製按鈕才能同時運作。
