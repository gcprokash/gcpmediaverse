/* MediaVerse Theme Switcher — palettes are independently editable in /themes/*.css */
(() => {
  "use strict";
  const THEMES = [
    { id: "deep-teal", file: "themes/deep-teal.css", color: "#012A23" },
    { id: "pure-white", file: "themes/pure-white.css", color: "#FFFFFF" },
    { id: "amoled-black", file: "themes/amoled-black.css", color: "#080808" },
    { id: "ocean-blue", file: "themes/ocean-blue.css", color: "#102A56" },
    { id: "sunset-amber", file: "themes/sunset-amber.css", color: "#24140B" }
  ];
  const STORAGE_KEY = "mediaverse-theme";
  const stylesheet = document.getElementById("mediaverse-theme");
  const button = document.getElementById("themeToggle");
  const picker = document.getElementById("themePicker");
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (!stylesheet || !button || !picker) return;

  function applyTheme(id) {
    const theme = THEMES.find(item => item.id === id) || THEMES[0];
    stylesheet.href = theme.file;
    document.documentElement.dataset.theme = theme.id;
    if (metaTheme) metaTheme.content = theme.color;
    try { localStorage.setItem(STORAGE_KEY, theme.id); } catch (_) {}
    picker.querySelectorAll("[data-theme-choice]").forEach(swatch => {
      const selected = swatch.dataset.themeChoice === theme.id;
      swatch.classList.toggle("is-active", selected);
      swatch.setAttribute("aria-pressed", String(selected));
    });
  }
  THEMES.forEach(theme => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "theme-swatch";
    swatch.dataset.themeChoice = theme.id;
    swatch.style.setProperty("--swatch-color", theme.color);
    swatch.setAttribute("aria-label", "Select theme " + theme.id);
    swatch.setAttribute("aria-pressed", "false");
    swatch.addEventListener("click", () => {
      applyTheme(theme.id);
      picker.hidden = true;
      button.setAttribute("aria-expanded", "false");
    });
    picker.appendChild(swatch);
  });
  button.addEventListener("click", () => {
    picker.hidden = !picker.hidden;
    button.setAttribute("aria-expanded", String(!picker.hidden));
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".theme-dock")) {
      picker.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      picker.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
  });
  let saved = "";
  try { saved = localStorage.getItem(STORAGE_KEY) || ""; } catch (_) {}
  applyTheme(saved);
})();