// Sales CRM — Shared chart primitive
// Ported from intern source (src/components/ui/Chart.tsx) verbatim — pure
// hand-rolled SVG (bar/column/line/area/pie/donut), zero chart library
// dependency. Styles come from dashboard.module.css's analytics-chart-*
// classes (ported there since Dashboard is this component's first real
// consumer); a future Analytics-module port can reuse this same file.

import React from "react";
import styles from "@/styles/sales-crm/dashboard.module.css";

export type ChartType = "bar" | "column" | "line" | "area" | "pie" | "donut";

export interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

interface ChartProps {
  type: ChartType;
  data: ChartDataPoint[];
  title?: string;
  height?: number;
}

export default function Chart({ type, data, title, height = 250 }: ChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className={styles["analytics-chart-placeholder"]}>
        <p className={styles["settings-text-muted"]}>No data available.</p>
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value));
  const getPaletteColor = (index: number) => {
    const palette = [
      "var(--color-primary)",
      "var(--color-success)",
      "var(--color-warning)",
      "var(--color-info)",
      "var(--color-danger)",
    ];
    return palette[index % palette.length];
  };

  const renderBarOrColumn = (isColumn: boolean) => {
    const chartHeight = 100;
    const chartWidth = 100;
    const gap = 3;
    const barCount = Math.max(data.length, 1);
    const columnWidth = (chartWidth - gap * (barCount - 1)) / barCount;

    return (
      <div className={styles["analytics-chart-line-container"]}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={styles["analytics-chart-svg"]}>
        {data.map((d, i) => {
          const percentage = maxValue > 0 ? (d.value / maxValue) * 100 : 0;
          const barLength = Math.max(percentage, d.value > 0 ? 3 : 0);
          const x = isColumn ? i * (columnWidth + gap) : 0;
          const y = isColumn ? chartHeight - barLength : i * (chartHeight / barCount) + 2;
          const width = isColumn ? columnWidth : barLength;
          const rowHeight = Math.max(6, chartHeight / barCount - 4);
          const rectHeight = isColumn ? barLength : rowHeight;

          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={width}
              height={rectHeight}
              rx="2"
              fill={d.color || getPaletteColor(i)}
            >
              <title>{`${d.label}: ${d.value}`}</title>
            </rect>
          );
        })}
        </svg>
        <div className={styles["analytics-chart-x-labels"]}>
          {data.map((d, i) => (
            <span key={i} className={styles["analytics-chart-x-label"]}>{d.label}</span>
          ))}
        </div>
      </div>
    );
  };

  const renderPieOrDonut = (isDonut: boolean) => {
    let cumulativePercent = 0;
    const total = data.reduce((sum, d) => sum + d.value, 0);

    const slices = data.map((d, i) => {
      const percentage = total > 0 ? (d.value / total) * 100 : 0;
      const startAngle = (cumulativePercent / 100) * 360;
      cumulativePercent += percentage;

      const endAngle = (cumulativePercent / 100) * 360;
      const largeArcFlag = percentage > 50 ? 1 : 0;

      // Coordinates for SVG arc
      const startX = 50 + 50 * Math.cos((Math.PI * startAngle) / 180);
      const startY = 50 + 50 * Math.sin((Math.PI * startAngle) / 180);
      const endX = 50 + 50 * Math.cos((Math.PI * endAngle) / 180);
      const endY = 50 + 50 * Math.sin((Math.PI * endAngle) / 180);

      const pathData = `M 50 50 L ${startX} ${startY} A 50 50 0 ${largeArcFlag} 1 ${endX} ${endY} Z`;

      const color = d.color || getPaletteColor(i);

      return <path key={i} d={pathData} fill={color}><title>{`${d.label}: ${d.value}`}</title></path>;
    });

    return (
      <div className={styles["analytics-chart-pie-container"]}>
        <svg viewBox="0 0 100 100" className={styles["analytics-chart-pie-svg"]}>
          {slices}
          {isDonut && <circle cx="50" cy="50" r="30" fill="var(--color-bg-elevated)" />}
        </svg>
        <div className={styles["analytics-chart-pie-legend"]}>
          {data.map((d, i) => (
            <div key={i} className={styles["analytics-chart-legend-item"]}>
              <div className={`${styles["analytics-chart-legend-swatch"]} ${styles[`analytics-swatch-${i % 5}`]}`} />
              <span>{d.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderLineOrArea = (isArea: boolean) => {
    const points = data
      .map((d, i) => {
        const x = (i / (data.length - 1 || 1)) * 100;
        const y = 100 - (maxValue > 0 ? (d.value / maxValue) * 100 : 0);
        return `${x},${y}`;
      })
      .join(" ");

    const areaPoints = `0,100 ${points} 100,100`;

    return (
      <div className={styles["analytics-chart-line-container"]}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={styles["analytics-chart-svg"]}>
          {/* Grid lines */}
          <line x1="0" y1="25" x2="100" y2="25" stroke="var(--color-border)" strokeWidth="0.5" strokeDasharray="2 2" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="var(--color-border)" strokeWidth="0.5" strokeDasharray="2 2" />
          <line x1="0" y1="75" x2="100" y2="75" stroke="var(--color-border)" strokeWidth="0.5" strokeDasharray="2 2" />

          {isArea && <polyline points={areaPoints} fill="var(--color-primary)" opacity="0.2" />}
          <polyline points={points} fill="none" stroke="var(--color-primary)" strokeWidth="2" />

          {data.map((d, i) => {
            const x = (i / (data.length - 1 || 1)) * 100;
            const y = 100 - (maxValue > 0 ? (d.value / maxValue) * 100 : 0);
            return (
              <circle key={i} cx={x} cy={y} r="3" fill="var(--color-primary)"><title>{`${d.label}: ${d.value}`}</title></circle>
            );
          })}
        </svg>
        <div className={styles["analytics-chart-x-labels"]}>
           {data.map((d, i) => (
             <span key={i} className={styles["analytics-chart-x-label"]}>{d.label}</span>
           ))}
        </div>
      </div>
    );
  };

  return (
    <div className={height >= 300 ? `${styles["analytics-chart-container"]} ${styles["analytics-chart-container-tall"]}` : styles["analytics-chart-container"]}>
      {title && <h4 className={styles["analytics-chart-title"]}>{title}</h4>}
      <div className={styles["analytics-chart-body"]}>
        {type === "bar" && renderBarOrColumn(false)}
        {type === "column" && renderBarOrColumn(true)}
        {type === "pie" && renderPieOrDonut(false)}
        {type === "donut" && renderPieOrDonut(true)}
        {type === "line" && renderLineOrArea(false)}
        {type === "area" && renderLineOrArea(true)}
      </div>
    </div>
  );
}
