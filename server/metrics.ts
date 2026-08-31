export interface HistogramData {
  buckets: Record<string, number>
  sum: number
  count: number
}

export interface CounterData {
  value: number
}

export interface GaugeData {
  value: number
}

export interface MetricLabels {
  [key: string]: string
}

export interface MetricSample {
  labels: MetricLabels
  value: number
}

const HISTOGRAM_BOUNDARIES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]

const BOUNDED_ROUTES = ['/search', '/images', '/news', '/ai/chat', '/health', '/metrics', '/']
const BOUNDED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
const BOUNDED_STATUS_CODES = ['2xx', '3xx', '4xx', '5xx']
const BOUNDED_ERROR_TYPES = ['none', 'validation', 'serper_error', 'groq_error', 'payment_error', 'internal_error', 'timeout']

function boundRoute(route: string): string {
  return BOUNDED_ROUTES.includes(route) ? route : 'other'
}

function boundMethod(method: string): string {
  return BOUNDED_METHODS.includes(method) ? method : 'other'
}

function boundStatusCode(code: number): string {
  const group = `${Math.floor(code / 100)}xx`
  return BOUNDED_STATUS_CODES.includes(group) ? group : 'unknown'
}

function boundErrorType(type: string): string {
  return BOUNDED_ERROR_TYPES.includes(type) ? type : 'other'
}

function normalizeLabels(labels: MetricLabels): MetricLabels {
  const result: MetricLabels = {}
  for (const [k, v] of Object.entries(labels)) {
    result[k] = v
  }
  return result
}

class HistogramMetric {
  private data: HistogramData = { buckets: {}, sum: 0, count: 0 }

  constructor() {
    for (const b of HISTOGRAM_BOUNDARIES) {
      this.data.buckets[`${b}`] = 0
    }
    this.data.buckets['+Inf'] = 0
  }

  observe(value: number): void {
    this.data.sum += value
    this.data.count++
    for (const b of HISTOGRAM_BOUNDARIES) {
      if (value <= b) {
        this.data.buckets[`${b}`]++
      }
    }
    this.data.buckets['+Inf']++
  }

  getData(): HistogramData {
    return { ...this.data, buckets: { ...this.data.buckets } }
  }
}

class LabeledHistogram {
  private metrics = new Map<string, HistogramMetric>()

  observe(labels: MetricLabels, value: number): void {
    const key = JSON.stringify(labels)
    let metric = this.metrics.get(key)
    if (!metric) {
      metric = new HistogramMetric()
      this.metrics.set(key, metric)
    }
    metric.observe(value)
  }

  getSamples(): Array<{ labels: MetricLabels; data: HistogramData }> {
    const result: Array<{ labels: MetricLabels; data: HistogramData }> = []
    for (const [key, metric] of this.metrics) {
      result.push({ labels: JSON.parse(key), data: metric.getData() })
    }
    return result
  }
}

class LabeledCounter {
  private metrics = new Map<string, number>()

  inc(labels: MetricLabels, value: number = 1): void {
    const key = JSON.stringify(labels)
    this.metrics.set(key, (this.metrics.get(key) || 0) + value)
  }

  getSamples(): MetricSample[] {
    const result: MetricSample[] = []
    for (const [key, value] of this.metrics) {
      result.push({ labels: JSON.parse(key), value })
    }
    return result
  }
}

class LabeledGauge {
  private metrics = new Map<string, number>()

  set(labels: MetricLabels, value: number): void {
    const key = JSON.stringify(labels)
    this.metrics.set(key, value)
  }

  inc(labels: MetricLabels): void {
    const key = JSON.stringify(labels)
    this.metrics.set(key, (this.metrics.get(key) || 0) + 1)
  }

  dec(labels: MetricLabels): void {
    const key = JSON.stringify(labels)
    this.metrics.set(key, (this.metrics.get(key) || 0) - 1)
  }

  getSamples(): MetricSample[] {
    const result: MetricSample[] = []
    for (const [key, value] of this.metrics) {
      result.push({ labels: JSON.parse(key), value })
    }
    return result
  }
}

class GaugeMetric {
  private value: number = 0

  set(value: number): void {
    this.value = value
  }

  inc(): void {
    this.value++
  }

  dec(): void {
    this.value--
  }

  getValue(): number {
    return this.value
  }
}

export class MetricsCollector {
  private httpRequestDuration = new LabeledHistogram()
  private httpRequestTotal = new LabeledCounter()
  private httpErrorsTotal = new LabeledCounter()
  private httpInFlight = new GaugeMetric()
  private providerHealth = new LabeledGauge()
  private providerLatency = new LabeledHistogram()
  private paymentTotal = new LabeledCounter()

  recordRequest(
    route: string,
    method: string,
    statusCode: number,
    durationMs: number,
    errorType?: string
  ): void {
    const labels = {
      route: boundRoute(route),
      method: boundMethod(method),
      status_code: boundStatusCode(statusCode),
      error_type: boundErrorType(errorType ?? 'none'),
    }

    this.httpRequestDuration.observe(labels, durationMs)
    this.httpRequestTotal.inc(labels)

    if (statusCode >= 400) {
      this.httpErrorsTotal.inc(labels)
    }
  }

  setInFlight(delta: number): void {
    if (delta > 0) this.httpInFlight.inc()
    else this.httpInFlight.dec()
  }

  getInFlight(): number {
    return this.httpInFlight.getValue()
  }

  setProviderHealth(provider: string, healthy: boolean): void {
    this.providerHealth.set({ provider }, healthy ? 1 : 0)
  }

  recordProviderLatency(
    provider: string,
    status: 'success' | 'error' | 'timeout',
    durationMs: number
  ): void {
    this.providerLatency.observe({ provider, status }, durationMs)
  }

  recordPayment(status: 'success' | 'failed' | 'rejected'): void {
    this.paymentTotal.inc({ status })
  }

  getInFlightValue(): number {
    return this.httpInFlight.getValue()
  }

  toJSON() {
    return {
      http_request_duration_ms: this.httpRequestDuration.getSamples(),
      http_requests_total: this.httpRequestTotal.getSamples(),
      http_errors_total: this.httpErrorsTotal.getSamples(),
      http_requests_in_flight: this.httpInFlight.getValue(),
      provider_health: this.providerHealth.getSamples(),
      provider_request_duration_ms: this.providerLatency.getSamples(),
      payments_total: this.paymentTotal.getSamples(),
    }
  }

  toPrometheus(): string {
    const lines: string[] = []

    lines.push('# HELP http_request_duration_ms Duration of HTTP requests in ms')
    lines.push('# TYPE http_request_duration_ms histogram')
    for (const sample of this.httpRequestDuration.getSamples()) {
      const labelStr = this.formatLabels(sample.labels)
      for (const [bucket, count] of Object.entries(sample.data.buckets)) {
        const bucketLabel = bucket === '+Inf' ? '' : `,le="${bucket}"`
        lines.push(`http_request_duration_ms_bucket{${labelStr}${bucketLabel}} ${count}`)
      }
      lines.push(`http_request_duration_ms_sum{${labelStr}} ${sample.data.sum}`)
      lines.push(`http_request_duration_ms_count{${labelStr}} ${sample.data.count}`)
    }

    lines.push('# HELP http_requests_total Total number of HTTP requests')
    lines.push('# TYPE http_requests_total counter')
    for (const sample of this.httpRequestTotal.getSamples()) {
      const labelStr = this.formatLabels(sample.labels)
      lines.push(`http_requests_total{${labelStr}} ${sample.value}`)
    }

    lines.push('# HELP http_errors_total Total number of HTTP errors')
    lines.push('# TYPE http_errors_total counter')
    for (const sample of this.httpErrorsTotal.getSamples()) {
      const labelStr = this.formatLabels(sample.labels)
      lines.push(`http_errors_total{${labelStr}} ${sample.value}`)
    }

    lines.push('# HELP http_requests_in_flight Current number of HTTP requests being processed')
    lines.push('# TYPE http_requests_in_flight gauge')
    lines.push(`http_requests_in_flight ${this.httpInFlight.getValue()}`)

    lines.push('# HELP provider_health Health status of upstream providers (1=healthy, 0=unhealthy)')
    lines.push('# TYPE provider_health gauge')
    for (const sample of this.providerHealth.getSamples()) {
      const labelStr = this.formatLabels(sample.labels)
      lines.push(`provider_health{${labelStr}} ${sample.value}`)
    }

    lines.push('# HELP provider_request_duration_ms Duration of upstream provider requests in ms')
    lines.push('# TYPE provider_request_duration_ms histogram')
    for (const sample of this.providerLatency.getSamples()) {
      const labelStr = this.formatLabels(sample.labels)
      for (const [bucket, count] of Object.entries(sample.data.buckets)) {
        const bucketLabel = bucket === '+Inf' ? '' : `,le="${bucket}"`
        lines.push(`provider_request_duration_ms_bucket{${labelStr}${bucketLabel}} ${count}`)
      }
      lines.push(`provider_request_duration_ms_sum{${labelStr}} ${sample.data.sum}`)
      lines.push(`provider_request_duration_ms_count{${labelStr}} ${sample.data.count}`)
    }

    lines.push('# HELP payments_total Total number of payments processed')
    lines.push('# TYPE payments_total counter')
    for (const sample of this.paymentTotal.getSamples()) {
      const labelStr = this.formatLabels(sample.labels)
      lines.push(`payments_total{${labelStr}} ${sample.value}`)
    }

    return lines.join('\n') + '\n'
  }

  private formatLabels(labels: MetricLabels): string {
    return Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',')
  }
}

export const metrics = new MetricsCollector()
