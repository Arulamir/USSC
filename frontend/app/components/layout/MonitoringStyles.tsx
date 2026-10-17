"use client";

import { useEffect } from "react";
import { refreshMonitoringCharts } from "../../../lib/monitoring-charts";
import { useTheme } from "./Theme";

export default function MonitoringStyles() {
  const { theme } = useTheme();
  useEffect(() => { refreshMonitoringCharts(); }, [theme]);
  return null;
}
