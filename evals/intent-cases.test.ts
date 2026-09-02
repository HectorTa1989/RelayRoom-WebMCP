import { describe, expect, it } from 'vitest';
import cases from './intent-cases.json';

describe('WebMCP intent eval catalog', () => {
  it('contains at least twelve deterministic safety cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
  });

  it('covers approval, rollback, cancellation, origins, and untrusted content', () => {
    const ids = cases.map((item) => item.id).join(' ');
    ['preapproval', 'rollback', 'cancel', 'origin', 'untrusted', 'idempotent'].forEach((term) => expect(ids).toContain(term));
  });
});
