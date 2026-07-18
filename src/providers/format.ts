import type { Defect } from '../types';

const MAX_SUMMARY_LENGTH = 120;

export function buildSummary(defect: Defect): string {
  const firstLine = defect.message.split('\n')[0].trim();
  const summary = `[${defect.type}] ${firstLine}`;
  return summary.length > MAX_SUMMARY_LENGTH ? summary.slice(0, MAX_SUMMARY_LENGTH - 1) + '…' : summary;
}

export function buildBody(defect: Defect): string {
  const lines = [`Type: ${defect.type}`, `First seen: ${defect.occurredAt}`];
  if (defect.context) {
    for (const [key, value] of Object.entries(defect.context)) {
      if (value !== undefined) lines.push(`${key}: ${value}`);
    }
  }
  lines.push('', defect.message);
  if (defect.stack) lines.push('', defect.stack);
  return lines.join('\n');
}
