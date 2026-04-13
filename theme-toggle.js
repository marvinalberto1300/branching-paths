(function () {
  var storageKey = "crownless-theme-mode";
  var root = document.documentElement;
  var media = window.matchMedia("(prefers-color-scheme: dark)");

  function getSavedMode() {
    var saved = localStorage.getItem(storageKey);
    if (saved === "dark" || saved === "light" || saved === "auto") {
      return saved;
    }
    return "auto";
  }

  function resolveTheme(mode) {
    if (mode === "auto") {
      return media.matches ? "dark" : "light";
    }
    return mode;
  }

  function updateButtonState(mode) {
    var buttons = document.querySelectorAll(".theme-switcher button[data-theme]");
    buttons.forEach(function (button) {
      var isActive = button.getAttribute("data-theme") === mode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function applyMode(mode) {
    root.setAttribute("data-theme", resolveTheme(mode));
    root.setAttribute("data-theme-mode", mode);
    updateButtonState(mode);
  }

  function onButtonClick(event) {
    var button = event.target.closest("button[data-theme]");
    if (!button) {
      return;
    }

    var mode = button.getAttribute("data-theme");
    localStorage.setItem(storageKey, mode);
    applyMode(mode);
  }

  function onSystemThemeChange() {
    var mode = root.getAttribute("data-theme-mode");
    if (mode === "auto") {
      applyMode("auto");
    }
  }

  document.addEventListener("click", onButtonClick);
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onSystemThemeChange);
  } else if (typeof media.addListener === "function") {
    media.addListener(onSystemThemeChange);
  }

  applyMode(getSavedMode());
})();
