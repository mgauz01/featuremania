"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "theme";

function storedTheme(): "light" | "dark" | null {
  const value = window.localStorage.getItem(STORAGE_KEY);
  if (value === "light" || value === "dark") {
    return value;
  }
  return null;
}

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const next = storedTheme() ?? systemTheme();
    setTheme(next);
    if (storedTheme()) {
      document.documentElement.setAttribute("data-theme", next);
    }
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  const dark = theme === "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? "Light mode" : "Dark mode"}
    </button>
  );
}
