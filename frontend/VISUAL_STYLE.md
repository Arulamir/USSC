# Monitoring visuals

All public monitoring pages use the style loaded by `MainLayout`.

- `app/monitoring.css` defines the light/dark colors and table rules.
- `lib/monitoring-charts.ts` registers a shared Chart.js line-chart plugin.
- `MonitoringStyles` refreshes existing line charts when the theme changes.

Line charts share line thickness, points, typography, horizontal grid lines,
bottom legends, and tooltips. Existing signal color families are normalized to
one accessible palette. Dense series omit idle points while retaining hover
targets. Dataset values, null gaps, scale types/ranges, unit labels, tooltip
callbacks, and legend visibility remain configured by each page. Bar charts
keep their existing configuration.

For data tables, add `ussc-data-table` to the table and `ussc-table-scroll` to
its existing scroll container. This provides consistent headers, spacing,
alternating rows, hover/focus colors, and tabular numerals. Preserve column
groups, column widths, sticky headers, pagination, filters, and exports.

Check both themes and mobile horizontal scrolling when adding a new chart or
table. Use actual data or explicit browser fixtures during visual checks.
