(function () {
  "use strict";

  // 頁面 UI 層目前保持極薄：只補上鍵盤使用時的 focus 樣式識別。
  // 功能與資料邏輯都留在 cycle.js；軍火庫元件本身不在這裡重寫。
  document.documentElement.classList.add("cycle-js");
})();
