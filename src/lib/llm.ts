import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from './db';

export type LLMProvider = 'gemini' | 'deepseek';
export type ModelSlot = 'fast' | 'pro';

export class LLMCapExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMCapExceededError';
  }
}

const DEFAULT_DAILY_CAP = 500;

function getDailyCap(): number {
  const raw = process.env.STROM_LLM_DAILY_CAP;
  if (!raw) return DEFAULT_DAILY_CAP;
  const n = parseInt(raw, 10);
  return isNaN(n) || n < 0 ? DEFAULT_DAILY_CAP : n;
}

function todayCountSinceMidnightLocal(): number {
  const db = getDb();
  // SQLite's date('now') is UTC; the host runs UTC on this VM, so this is fine.
  const row = db.prepare(
    "SELECT COUNT(*) c FROM llm_calls WHERE substr(called_at, 1, 10) = date('now')"
  ).get() as { c: number };
  return row.c;
}

export function getTodayLLMStats(): {
  date: string;
  total: number;
  cap: number;
  remaining: number;
  byContext: Record<string, number>;
  byProvider: Record<string, number>;
  errors: number;
} {
  const db = getDb();
  const cap = getDailyCap();
  const totalRow = db.prepare(
    "SELECT COUNT(*) c FROM llm_calls WHERE substr(called_at, 1, 10) = date('now')"
  ).get() as { c: number };
  const errorsRow = db.prepare(
    "SELECT COUNT(*) c FROM llm_calls WHERE substr(called_at, 1, 10) = date('now') AND status = 'error'"
  ).get() as { c: number };
  const byContextRows = db.prepare(
    "SELECT COALESCE(NULLIF(context, ''), '(unspecified)') AS k, COUNT(*) AS c FROM llm_calls WHERE substr(called_at, 1, 10) = date('now') GROUP BY k"
  ).all() as { k: string; c: number }[];
  const byProviderRows = db.prepare(
    "SELECT provider AS k, COUNT(*) AS c FROM llm_calls WHERE substr(called_at, 1, 10) = date('now') GROUP BY k"
  ).all() as { k: string; c: number }[];
  const dateRow = db.prepare("SELECT date('now') AS d").get() as { d: string };

  return {
    date: dateRow.d,
    total: totalRow.c,
    cap,
    remaining: Math.max(0, cap - totalRow.c),
    byContext: Object.fromEntries(byContextRows.map(r => [r.k, r.c])),
    byProvider: Object.fromEntries(byProviderRows.map(r => [r.k, r.c])),
    errors: errorsRow.c,
  };
}

function recordLLMCall(args: {
  provider: LLMProvider;
  model: string;
  context: string;
  status: 'success' | 'error';
  durationMs: number;
  errorMessage?: string;
}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO llm_calls (provider, model, context, status, duration_ms, error_message)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    args.provider,
    args.model,
    args.context,
    args.status,
    args.durationMs,
    args.errorMessage || '',
  );
}

const MODEL_MAP: Record<LLMProvider, Record<ModelSlot, string>> = {
  gemini: {
    fast: 'gemini-2.0-flash',
    pro: 'gemini-2.5-pro',
  },
  deepseek: {
    fast: 'deepseek-chat',
    pro: 'deepseek-reasoner',
  },
};

export function getActiveProvider(): LLMProvider {
  const raw = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  return raw === 'deepseek' ? 'deepseek' : 'gemini';
}

export function resolveModelName(slot: ModelSlot, provider: LLMProvider = getActiveProvider()): string {
  return MODEL_MAP[provider][slot];
}

function getApiKey(provider: LLMProvider): string {
  const envKey = provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'GEMINI_API_KEY';
  const key = process.env[envKey];
  if (!key || key === 'your_gemini_api_key_here' || key === 'your_deepseek_api_key_here') {
    throw new Error(`${envKey} not set in .env.local`);
  }
  return key;
}

export interface GenerateContentParams {
  prompt: string;
  model?: ModelSlot;
  json?: boolean;
  /**
   * Tag identifying which feature triggered this call (e.g. 'goals', 'impact',
   * 'pairwise', 'cluster', 'document', 'admin-test'). Used for the daily-cap
   * accounting and the stats panel. Defaults to 'unspecified'.
   */
  context?: string;
}

export interface GenerateContentResult {
  text: string;
  provider: LLMProvider;
  modelUsed: string;
}

export async function generateContent({
  prompt,
  model = 'fast',
  json = false,
  context = 'unspecified',
}: GenerateContentParams): Promise<GenerateContentResult> {
  const provider = getActiveProvider();
  const modelName = resolveModelName(model, provider);

  // Daily cap check — runs before the API call so a runaway loop can't blow past the budget.
  const cap = getDailyCap();
  if (cap > 0) {
    const used = todayCountSinceMidnightLocal();
    if (used >= cap) {
      throw new LLMCapExceededError(
        `Daily LLM call cap reached (${used}/${cap}). Set STROM_LLM_DAILY_CAP to raise it.`
      );
    }
  }

  const startedAt = Date.now();
  try {
    const text = provider === 'gemini'
      ? await callGemini(prompt, modelName, json)
      : await callDeepSeek(prompt, modelName, json);

    recordLLMCall({
      provider, model: modelName, context, status: 'success',
      durationMs: Date.now() - startedAt,
    });

    return { text, provider, modelUsed: modelName };
  } catch (err: unknown) {
    recordLLMCall({
      provider, model: modelName, context, status: 'error',
      durationMs: Date.now() - startedAt,
      errorMessage: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
    });
    throw err;
  }
}

async function callGemini(prompt: string, modelName: string, json: boolean): Promise<string> {
  const apiKey = getApiKey('gemini');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: json ? { responseMimeType: 'application/json' } : undefined,
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function callDeepSeek(prompt: string, modelName: string, json: boolean): Promise<string> {
  const apiKey = getApiKey('deepseek');
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: 'user', content: prompt }],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`DeepSeek API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new Error('DeepSeek API returned no content');
  }
  return text;
}

export async function pingProvider(): Promise<{ provider: LLMProvider; model: string; reply: string }> {
  const provider = getActiveProvider();
  const modelName = resolveModelName('fast', provider);
  const expected = `${provider === 'deepseek' ? 'DeepSeek' : 'Gemini'} connection OK. Model: ${modelName}.`;
  const { text } = await generateContent({
    prompt: `Reply with exactly: "${expected}" Nothing else.`,
    model: 'fast',
    context: 'admin-test',
  });
  return { provider, model: modelName, reply: text.trim() };
}
