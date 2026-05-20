const counters = new Map<string, number>();

export function increment(name: string, labels?: Record<string, string>): void {
  let key = name;
  if (labels && Object.keys(labels).length > 0) {
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
    key = `${name}{${labelStr}}`;
  }
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

export function renderMetrics(): string {
  const lines: string[] = [
    "# HELP process_uptime_seconds Process uptime in seconds",
    "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${process.uptime().toFixed(3)}`,
    "",
    "# HELP process_memory_rss_bytes Resident set size in bytes",
    "# TYPE process_memory_rss_bytes gauge",
    `process_memory_rss_bytes ${process.memoryUsage().rss}`,
    "",
    "# HELP http_requests_total Total HTTP requests by method, route, and status code",
    "# TYPE http_requests_total counter",
  ];

  for (const [key, value] of counters) {
    lines.push(`${key} ${value}`);
  }

  return lines.join("\n") + "\n";
}
