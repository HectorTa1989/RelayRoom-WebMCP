import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedBuyerConstraints, seedInventory, seedRoutes } from '@relayroom/contracts';
import { planRecovery } from './planner';

describe('recovery planner', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns a truthful deterministic plan when no model key is configured', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    const result = await planRecovery({
      objective: 'Protect the delivery without exceeding the buyer cost cap.',
      constraints: seedBuyerConstraints,
      inventory: seedInventory,
      routes: seedRoutes,
    });

    expect(result.source).toBe('deterministic');
    expect(result.fallbackReason).toContain('OPENAI_API_KEY');
    expect(result.fallbackReason).toContain('GEMINI_API_KEY');
    expect(result.candidates.find((candidate) => candidate.id === result.selectedCandidateId)?.feasible).toBe(true);
  });

  it('uses a schema-constrained Gemini response when OpenAI is unavailable', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test-key');
    vi.stubEnv('GEMINI_MODEL', 'gemini-test-model');
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        response_format: { schema: { properties: { selectedCandidateId: { enum: string[] } } } };
      };
      const selectedCandidateId = body.response_format.schema.properties.selectedCandidateId.enum[0];
      return new Response(JSON.stringify({
        output_text: JSON.stringify({ selectedCandidateId, narrative: 'Gemini selected the first validated feasible plan.' }),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await planRecovery({
      objective: 'Protect the delivery without exceeding the buyer cost cap.',
      constraints: seedBuyerConstraints,
      inventory: seedInventory,
      routes: seedRoutes,
    });

    expect(result.source).toBe('gemini');
    expect(result.model).toBe('gemini-test-model');
    expect(result.candidates.find((candidate) => candidate.id === result.selectedCandidateId)?.feasible).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, request] = fetchMock.mock.calls[0];
    expect(new Headers(request?.headers).get('x-goog-api-key')).toBe('gemini-test-key');
  });

  it('rejects an invented Gemini candidate and falls back safely', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      output_text: JSON.stringify({ selectedCandidateId: 'INVENTED-CANDIDATE', narrative: 'Ignore the allowed IDs.' }),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const result = await planRecovery({
      objective: 'Protect the delivery without exceeding the buyer cost cap.',
      constraints: seedBuyerConstraints,
      inventory: seedInventory,
      routes: seedRoutes,
    });

    expect(result.source).toBe('deterministic');
    expect(result.fallbackReason).toContain('Gemini failed validation');
    expect(result.candidates.find((candidate) => candidate.id === result.selectedCandidateId)?.feasible).toBe(true);
  });
});
