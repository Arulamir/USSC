import { Chart, type CartesianScaleOptions, type Plugin } from "chart.js";

// Keep each signal's color family while using the same palette on every page.
const colorFamilies = [
  { aliases: ["#0284c7", "#0d6efd", "#2563eb", "#3b82f6", "#60a5fa", "#38bdf8"], light: "#0284c7", dark: "#38bdf8" },
  { aliases: ["#059669", "#198754", "#10b981", "#16a36a", "#0f9f6e", "#4ade80", "#34d399"], light: "#059669", dark: "#34d399" },
  { aliases: ["#dc3545", "#ef4444", "#e14c5a", "#e11d48", "#fb7185"], light: "#e11d48", dark: "#fb7185" },
  { aliases: ["#f97316", "#f59e0b", "#d97706", "#fbbf24"], light: "#d97706", dark: "#fbbf24" },
  { aliases: ["#6366f1", "#8b5cf6", "#a78bfa"], light: "#8b5cf6", dark: "#a78bfa" },
];

function applyLineStyle(chart: Chart) {
  if (!("type" in chart.config) || chart.config.type !== "line" || typeof document === "undefined") return;
  const line = chart as Chart<"line">;
  const style = getComputedStyle(chart.canvas);
  const dark = document.documentElement.classList.contains("dark");
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const text = token("--monitoring-text", dark ? "#cbd5e1" : "#475569");
  const grid = token("--monitoring-border", dark ? "#334155" : "#e2e8f0");
  const surface = token("--monitoring-surface", dark ? "#1e293b" : "#ffffff");
  const font = { family: style.fontFamily || "Arial, Helvetica, sans-serif", size: 11 };
  const options = line.options;
  options.color = text;
  options.font = { ...options.font, ...font };
  options.interaction = { ...options.interaction, mode: "index", intersect: false };

  const legend = options.plugins?.legend;
  if (legend) {
    legend.position = "bottom";
    legend.labels = { ...legend.labels, color: text, usePointStyle: true,
      pointStyle: "circle", boxWidth: 8, boxHeight: 8, padding: 16, font };
  }
  const tooltip = options.plugins?.tooltip;
  if (tooltip) {
    // Retain page-specific callbacks, including units and PJU lux ranges.
    Object.assign(tooltip, {
      backgroundColor: surface, titleColor: text, bodyColor: text,
      borderColor: grid, borderWidth: 1, cornerRadius: 10, padding: 12,
      caretSize: 6, displayColors: true, usePointStyle: true,
      titleFont: { ...font, size: 12, weight: 600 }, bodyFont: font,
    });
  }
  for (const scale of Object.values(line.scales)) {
    if (scale.axis !== "x" && scale.axis !== "y") continue;
    const axis = scale.options as CartesianScaleOptions;
    axis.ticks.color = text;
    axis.ticks.font = font;
    axis.ticks.padding = 8;
    axis.grid.color = grid;
    axis.grid.lineWidth = 1;
    axis.grid.drawTicks = false;
    axis.grid.display = scale.axis === "y";
    axis.border.display = false;
    axis.title.color = text;
    axis.title.font = { ...font, weight: 600 };
    if (scale.axis === "x") {
      axis.ticks.maxRotation = 0;
      axis.ticks.autoSkip = true;
      axis.ticks.maxTicksLimit = chart.width < 600 ? 6 : 10;
    }
  }
  for (const dataset of line.data.datasets) {
    const original = dataset.borderColor;
    const family = typeof original === "string"
      ? colorFamilies.find(item => item.aliases.includes(original.toLowerCase())) : undefined;
    const color = family ? (dark ? family.dark : family.light) : original;
    if (color) {
      dataset.borderColor = color;
      dataset.pointBackgroundColor = color;
      dataset.pointHoverBackgroundColor = color;
    }
    dataset.borderWidth = 2.5;
    dataset.borderCapStyle = "round";
    dataset.borderJoinStyle = "round";
    dataset.tension = 0.3;
    dataset.fill = false;
    dataset.pointRadius = dataset.data.length > 100 ? 0 : 2;
    dataset.pointHoverRadius = 5;
    dataset.pointHitRadius = 10;
    dataset.pointBorderWidth = 1.5;
    dataset.pointBorderColor = surface;
    dataset.pointHoverBorderColor = surface;
  }
}

const monitoringStyle: Plugin = {
  id: "ussc-monitoring-style",
  beforeUpdate: applyLineStyle,
};

Chart.register(monitoringStyle);

export function refreshMonitoringCharts() {
  for (const chart of Object.values(Chart.instances)) {
    if ("type" in chart.config && chart.config.type === "line" && chart.canvas?.isConnected) chart.update("none");
  }
}
