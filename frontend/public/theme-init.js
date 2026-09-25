// Apply the saved theme before first paint so there's no flash. "system"
// (or nothing saved) leaves data-theme unset and the OS decides.
// A separate file rather than inline, so the Content-Security-Policy can stay script-src 'self'.
(function () {
  try {
    var t = localStorage.getItem("fw-theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
