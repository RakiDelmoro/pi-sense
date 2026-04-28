import { initMqtt } from "./mqtt";
import { initDashboard } from "./dashboard";
import { loadTheme, saveTheme } from "./storage";

function initTheme() {
  const theme = loadTheme();
  document.documentElement.dataset.theme = theme;
  updateThemeIcon(theme);

  const toggleBtn = document.getElementById("theme-toggle") as HTMLButtonElement | null;
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      const next = current === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      saveTheme(next);
      updateThemeIcon(next);
    });
  }
}

function updateThemeIcon(theme: "light" | "dark") {
  const toggleBtn = document.getElementById("theme-toggle") as HTMLButtonElement | null;
  if (toggleBtn) {
    toggleBtn.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    toggleBtn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initMqtt();
  initDashboard();
});
