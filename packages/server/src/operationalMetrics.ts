export type OperationalMetricEvent =
  | 'authentication.session_started'
  | 'authentication.session_approved'
  | 'authentication.session_denied'
  | 'authentication.session_expired'
  | 'miniapp.session_created';

export interface OperationalMetricInput {
  eventType: OperationalMetricEvent;
  outcome: 'started' | 'success' | 'approved' | 'denied' | 'expired' | 'failed';
  bucketStartedAt: Date;
  windowMinutes: 5 | 15 | 60;
  count: number;
}

export function createOperationalMetricsReporter(options: {
  serviceId: string;
  controlPlaneBaseUrl: string;
  providerKey: string;
  fetch?: typeof globalThis.fetch;
}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch_unavailable');
  return {
    async report(input: OperationalMetricInput): Promise<void> {
      if (!Number.isSafeInteger(input.count) || input.count < 1 || input.count > 1_000_000) throw new Error('metric_count_invalid');
      const bucketStartedAt = input.bucketStartedAt.toISOString();
      const response = await fetchImpl(`${options.controlPlaneBaseUrl.replace(/\/+$/, '')}/v2/providers/operational-metrics`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-unet-provider-key': options.providerKey,
        },
        body: JSON.stringify({ serviceId: options.serviceId, ...input, bucketStartedAt }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(result.errorCode ?? 'operational_metric_rejected'));
      }
    },
  };
}
