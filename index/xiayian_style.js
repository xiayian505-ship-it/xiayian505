(function () {
  "use strict";
  const now = new Date();
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const month = document.getElementById("today-month");
  const year = document.getElementById("today-year");
  const date = document.getElementById("today-date");
  if (month) month.textContent = months[now.getMonth()];
  if (year) year.textContent = String(now.getFullYear());
  if (date) date.textContent = String(now.getDate());

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
