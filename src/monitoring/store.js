/**
 * In-memory metrics store for the monitoring dashboard.
 */
class MetricsStore {
  constructor() {
    this.startTime = new Date();
    this.requests = {
      total: 0,
      verify: 0,
      protect: 0,
      health: 0,
    };
    this.results = {
      verified: 0,
      not_found: 0,
      invalid: 0,
      registry_unavailable: 0,
      inconclusive: 0,
      format_error: 0,
      protected_only: 0,
      error: 0,
    };
    this.identifierTypes = {};
    this.countryCounts = {};
    this.recentRequests = [];
    this.maxRecent = 200;
    this.responseTimesMs = [];
    this.maxResponseTimes = 1000;
    // Time series: per-minute counts for the last 60 minutes
    this.timeSeries = [];
  }

  recordRequest(type, data) {
    this.requests.total++;
    if (this.requests[type] !== undefined) {
      this.requests[type]++;
    }

    // Track identifier type
    if (data.identifier_type) {
      this.identifierTypes[data.identifier_type] = (this.identifierTypes[data.identifier_type] || 0) + 1;
    }

    // Track country
    if (data.issuer_country) {
      this.countryCounts[data.issuer_country] = (this.countryCounts[data.issuer_country] || 0) + 1;
    }
  }

  recordResult(status, data) {
    if (this.results[status] !== undefined) {
      this.results[status]++;
    }

    // Recent request log
    const entry = {
      timestamp: new Date().toISOString(),
      correlation_id: data.correlation_id,
      identifier_type: data.identifier_type,
      issuer_country: data.issuer_country,
      status,
      masked_value: data.masked_value,
      response_time_ms: data.response_time_ms,
      gateway_id: data.gateway_id,
    };

    this.recentRequests.unshift(entry);
    if (this.recentRequests.length > this.maxRecent) {
      this.recentRequests.length = this.maxRecent;
    }

    // Time series
    const now = new Date();
    const minuteKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}T${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}`;
    const last = this.timeSeries[this.timeSeries.length - 1];
    if (last && last.minute === minuteKey) {
      last.count++;
      last[status] = (last[status] || 0) + 1;
    } else {
      const point = { minute: minuteKey, count: 1 };
      point[status] = 1;
      this.timeSeries.push(point);
      if (this.timeSeries.length > 60) {
        this.timeSeries.shift();
      }
    }
  }

  recordResponseTime(ms) {
    this.responseTimesMs.push(ms);
    if (this.responseTimesMs.length > this.maxResponseTimes) {
      this.responseTimesMs.shift();
    }
  }

  getMetrics() {
    const uptimeMs = Date.now() - this.startTime.getTime();
    const avgResponseTime = this.responseTimesMs.length > 0
      ? Math.round(this.responseTimesMs.reduce((a, b) => a + b, 0) / this.responseTimesMs.length)
      : 0;
    const p95Index = Math.floor(this.responseTimesMs.length * 0.95);
    const sorted = [...this.responseTimesMs].sort((a, b) => a - b);
    const p95 = sorted[p95Index] || 0;

    return {
      uptime_seconds: Math.floor(uptimeMs / 1000),
      started_at: this.startTime.toISOString(),
      requests: { ...this.requests },
      results: { ...this.results },
      identifier_types: { ...this.identifierTypes },
      countries: { ...this.countryCounts },
      response_time: {
        avg_ms: avgResponseTime,
        p95_ms: p95,
        samples: this.responseTimesMs.length,
      },
      recent_requests: this.recentRequests.slice(0, 50),
      time_series: [...this.timeSeries],
    };
  }
}

module.exports = new MetricsStore();
