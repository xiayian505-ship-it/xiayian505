(function () {
  "use strict";
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
