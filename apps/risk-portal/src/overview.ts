import type { AlertSummary } from './client.ts';

export const riskDimensions = [
  { key: 'fraud_score', label: 'fraud' },
  { key: 'mule_network_score', label: 'mule_network' },
  { key: 'aml_suspicion_score', label: 'aml' },
] as const;

// Deliberately page-scoped. Never turn missing or unevaluated indices into zero.
export function summarizeAlerts(items: readonly AlertSummary[]) {
  const states = { open: 0, acknowledged: 0, reviewed: 0 };
  for (const item of items) states[item.state]++;
  return {
    total: items.length,
    states,
    pending: items.length - states.reviewed,
    priority: items.filter(item => item.severity === 'high' || item.severity === 'critical').length,
    incomplete: items.filter(item => item.assessment_status === 'partial' || riskDimensions.some(d => item[d.key].value === null)).length,
    dimensions: riskDimensions.map(d => {
      const values = items.flatMap(item => item[d.key].status === 'available' && item[d.key].value !== null ? [item[d.key].value!] : []);
      return { ...d, available: values.length, unavailable: items.length - values.length,
        average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null };
    }),
  };
}

export function prioritizeAlerts(items: readonly AlertSummary[]) {
  const severity = { critical: 3, high: 2, medium: 1, low: 0 };
  return [...items].sort((a, b) => Number(a.state === 'reviewed') - Number(b.state === 'reviewed')
    || severity[b.severity] - severity[a.severity] || b.created_at.localeCompare(a.created_at));
}
