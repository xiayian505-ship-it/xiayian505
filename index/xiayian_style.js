(function () {
  "use strict";
  const calendarTarget = document.getElementById("home-calendar");
  if (calendarTarget) {
    try {
      if (!window.SlowlyCalendar?.mount) throw new Error("軍火庫日曆尚未載入。");
      window.SlowlyCalendar.mount(calendarTarget, {
        view:"month",
        gridLines:false,
        showLunar:true,
        showFestivals:true,
        showSolarTerms:true
      });
    } catch (error) {
      console.error("calendar mount failed", error);
      calendarTarget.textContent = "日曆暫時無法顯示。";
    }
  }

  document.addEventListener("click", function (event) {
    const closeButton = event.target.closest("[data-close]");
    if (closeButton) document.getElementById(closeButton.dataset.close)?.close();
  });
  document.querySelectorAll("dialog").forEach(function (dialog) {
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });
  });
})();
