/**
 * Host half.
 *
 * One implementation of "rewrite a prompt", shared by three callers:
 *   - POST /plugins/dsh-prompt-template/optimize  (SSE stream, used by the composer UI)
 *   - POST/GET /plugins/dsh-prompt-template/config (settings row read/write)
 *   - the `optimize_prompt` agent tool
 *
 * Two routes for generation, in this order:
 *   1. the harness `llm` service on the configured default model (zero config),
 *   2. a user-configured OpenAI-compatible endpoint, used when no default model
 *      exists — so the plugin still works on a profile without a model route.
 *
 * Configuration lives in the loader row (`Config`, all fields volatile so a
 * settings edit applies without a restart) and the endpoint API key lives in the
 * credential store as `DSH_PROMPT_OPTIMIZER_API_KEY`, never in configuration.
 */

import z from '@deepseek-ai/schemastery';
import { TEMPLATES, TEMPLATE_ORDER, renderTemplate } from './templates.js';

const NAME = '@seon0616/dsh-prompt-template';

/** Route paths owned by this bundle. */
const OPTIMIZE_ROUTE = '/plugins/dsh-prompt-template/optimize';
const CONFIG_ROUTE = '/plugins/dsh-prompt-template/config';

/** Credential reference holding the custom endpoint key. */
const API_KEY_REF = 'DSH_PROMPT_OPTIMIZER_API_KEY';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_INPUT_CHARS = 32000;

/** Live loader config handed in by `apply`; read through volatile handles. */
let liveConfig = {};

/** Loader schema; every field is volatile so edits apply in place. */
export const Config = z.object({
  defaultTemplate: z.union(TEMPLATE_ORDER).default('system').volatile(),
  baseURL: z.string().default('').volatile(),
  model: z.string().default('').volatile(),
  temperature: z.number().min(0).max(2).default(0.7).volatile(),
  maxOutputTokens: z.number().step(1).min(256).max(32768).default(2048).volatile(),
  timeoutMs: z.number().step(1000).min(5000).max(600000).default(120000).volatile(),
});

/** Read a value that may be a volatile handle rather than a plain field. */
function valueOf(field, fallback) {
  const raw = typeof field?.get === 'function' ? field.get() : field;
  return raw === undefined || raw === null ? fallback : raw;
}

/** Detached snapshot of the current settings. */
function settingsOf(config) {
  return {
    defaultTemplate: valueOf(config.defaultTemplate, 'system'),
    baseURL: valueOf(config.baseURL, ''),
    model: valueOf(config.model, ''),
    temperature: valueOf(config.temperature, 0.7),
    maxOutputTokens: valueOf(config.maxOutputTokens, 2048),
    timeoutMs: valueOf(config.timeoutMs, 120000),
  };
}

/**
 * Strip the things a model adds despite being told not to: a code fence around
 * the whole answer, and a lead-in line such as "优化后的提示词：".
 * @param value - raw model output.
 * @returns the prompt text alone.
 */
function cleanOutput(value) {
  let text = typeof value === 'string' ? value.trim() : '';
  const fenced = /^```[a-zA-Z0-9_+-]*\r?\n([\s\S]*?)\r?\n?```$/u.exec(text);
  if (fenced !== null) text = fenced[1].trim();
  text = text.replace(/^优化(?:后|过的|后的)?[ \t]*(?:提示词|Prompt|prompt|内容|结果|指令)(?:如下)?[ \t]*[\s：:][ \t]*/u, '');
  text = text.replace(/^(?:Optimized|Rewritten|Refined)\s+(?:prompt|instruction|content|result|draft)[\s：:][ \t]*/iu, '');
  return text.trim();
}

/** Resolve the zero-config route from the configured default model. */
function defaultRoute(ctx) {
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
  if (selection === null || selection === undefined) return undefined;
  if (typeof selection.provider !== 'string' || typeof selection.model !== 'string') return undefined;
  return { provider: selection.provider, model: selection.model };
}

/** Read the stored custom-endpoint key, if any. */
async function readApiKey(ctx) {
  const credentials = ctx.get('credentials');
  if (credentials === undefined) return undefined;
  try {
    const hit = await credentials.resolve(API_KEY_REF);
    return typeof hit?.value === 'string' && hit.value.length > 0 ? hit.value : undefined;
  } catch {
    return undefined;
  }
}

/** Validate one request body into a typed optimization request. */
function requestOf(body) {
  const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
  if (prompt.trim().length === 0) return { error: 'empty-prompt', message: 'Prompt cannot be empty.' };
  if (prompt.length > MAX_INPUT_CHARS) {
    return { error: 'prompt-too-long', message: `Prompt is ${prompt.length} characters; the limit is ${MAX_INPUT_CHARS}.` };
  }
  const template = typeof body?.template === 'string' && TEMPLATES[body.template] !== undefined ? body.template : 'system';
  const requirements = typeof body?.requirements === 'string' ? body.requirements : '';
  if (template === 'iterate' && requirements.trim().length === 0) {
    return { error: 'empty-requirements', message: 'Iterating needs requirements describing what to change.' };
  }
  return { prompt, template, requirements };
}

/**
 * Stream one rewrite from an OpenAI-compatible endpoint.
 * @param options - endpoint, credentials, request text, and sinks.
 * @returns the accumulated text.
 */
async function streamCustomEndpoint(options) {
  const { baseURL, model, apiKey, system, user, temperature, maxOutputTokens, signal, onReasoning, onDelta } = options;
  const response = await fetch(`${baseURL.replace(/\/+$/u, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` },
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature,
      max_tokens: maxOutputTokens,
      stream: true,
    }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`endpoint answered HTTP ${response.status}${detail.length === 0 ? '' : `: ${detail.slice(0, 300)}`}`);
  }
  if (response.body === null) throw new Error('endpoint returned no body');

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload.length === 0 || payload === '[DONE]') continue;
        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = parsed?.choices?.[0]?.delta;
        const reasoning = delta?.reasoning_content ?? delta?.reasoning;
        if (typeof reasoning === 'string' && reasoning.length > 0) onReasoning(reasoning);
        if (typeof delta?.content === 'string' && delta.content.length > 0) {
          text += delta.content;
          onDelta(delta.content);
        }
      }
    }
  }
  return text;
}

/**
 * Stream one rewrite from the harness LLM service on the default model.
 * @param options - service, route, request text, and sinks.
 * @returns the accumulated text.
 */
async function streamHarness(options) {
  const { ctx, route, system, user, maxOutputTokens, signal, onReasoning, onDelta } = options;
  const llm = ctx.get('llm');
  if (llm === undefined) throw new Error('The LLM service is unavailable.');
  const prepared = await llm.prepareCall(
    { provider: route.provider, model: route.model, maxTokens: maxOutputTokens },
    signal,
  );
  let text = '';
  for await (const chunk of prepared.stream({
    ...prepared.config,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    system,
    purpose: 'prompt-optimizer',
    signal,
  })) {
    if (chunk.type === 'reasoning-delta') onReasoning(chunk.text);
    else if (chunk.type === 'text-delta') {
      text += chunk.text;
      onDelta(chunk.text);
    } else if (chunk.type === 'finish' && chunk.reason.kind !== 'stop') {
      const detail = chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted'
        ? `: ${chunk.reason.failure.message}`
        : '';
      throw new Error(`The model ended with ${chunk.reason.kind}${detail}`);
    }
  }
  return text;
}

/**
 * Run one rewrite, streaming to the supplied sinks.
 * @returns the cleaned prompt text and the route that produced it.
 */
async function rewrite(ctx, request, sinks, signal) {
  const settings = settingsOf(liveConfig);
  const { system, user } = renderTemplate(request.template, request.prompt, request.requirements);

  const route = defaultRoute(ctx);
  const endpointReady = settings.baseURL.length > 0 && settings.model.length > 0;
  if (route === undefined && !endpointReady) {
    throw Object.assign(new Error('No default model is configured and no custom endpoint is set. Configure one in Settings → Prompt optimizer.'), { code: 'no-route' });
  }

  const raw = route !== undefined && !(settings.baseURL.length > 0 && settings.model.length > 0)
    ? await streamHarness({
      ctx, route, system, user,
      maxOutputTokens: settings.maxOutputTokens,
      signal,
      onReasoning: sinks.onReasoning,
      onDelta: sinks.onDelta,
    })
    : await streamCustomEndpoint({
      baseURL: settings.baseURL,
      model: settings.model,
      apiKey: await readApiKey(ctx),
      system, user,
      temperature: settings.temperature,
      maxOutputTokens: settings.maxOutputTokens,
      signal,
      onReasoning: sinks.onReasoning,
      onDelta: sinks.onDelta,
    });

  return {
    text: cleanOutput(raw),
    route: route !== undefined ? `harness:${route.provider}/${route.model}` : `endpoint:${settings.model}`,
  };
}

/** Read one bounded request body as UTF-8 text. */
async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY_BYTES) throw new Error('request-too-large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Write one JSON response with caching disabled. */
function replyJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Start a text/event-stream response. */
function openEventStream(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders?.();
}

/** Write one SSE frame. */
function frame(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const name = NAME;
export const inject = ['tools', 'webServer', 'systemPrompt'];

/**
 * Register the routes, the tool, and the model-facing guidance.
 * @param ctx - plugin context.
 * @param config - loader config.
 */
export function apply(ctx, config) {
  liveConfig = config ?? {};

  let admission;
  ctx.inject(['connection'], (connectionCtx) => {
    admission = (request) => connectionCtx.connection.requestRejection(request);
  });

  const guard = (req, res) => {
    const rejection = admission?.(req);
    if (rejection !== undefined) {
      replyJson(res, rejection, { ok: false, error: 'unauthorized' });
      return false;
    }
    return true;
  };

  // ---- settings ----
  const settingsPayload = async () => {
    const settings = settingsOf(config);
    const credentials = ctx.get('credentials');
    let apiKeyConfigured = false;
    try {
      apiKeyConfigured = credentials === undefined
        ? false
        : (await credentials.describe(API_KEY_REF)).configured === true;
    } catch {
      apiKeyConfigured = false;
    }
    const route = defaultRoute(ctx);
    return {
      settings,
      apiKeyConfigured,
      templates: TEMPLATE_ORDER,
      defaultRoute: route === undefined ? null : `${route.provider}/${route.model}`,
    };
  };

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CONFIG_ROUTE,
    handler: async (req, res) => {
      if (!guard(req, res)) return;
      if (req.method === 'GET') return replyJson(res, 200, { ok: true, value: await settingsPayload() });
      if (req.method !== 'POST') return replyJson(res, 405, { ok: false, error: 'method-not-allowed' });
      if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        return replyJson(res, 415, { ok: false, error: 'json-required' });
      }

      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return replyJson(res, 400, { ok: false, error: 'invalid-json' });
      }
      if (body === null || typeof body !== 'object') return replyJson(res, 400, { ok: false, error: 'invalid-json' });

      const current = settingsOf(config);
      const candidate = {
        defaultTemplate: typeof body.defaultTemplate === 'string' ? body.defaultTemplate : current.defaultTemplate,
        baseURL: typeof body.baseURL === 'string' ? body.baseURL.trim() : current.baseURL,
        model: typeof body.model === 'string' ? body.model.trim() : current.model,
        temperature: typeof body.temperature === 'number' ? body.temperature : current.temperature,
        maxOutputTokens: typeof body.maxOutputTokens === 'number' ? body.maxOutputTokens : current.maxOutputTokens,
        timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : current.timeoutMs,
      };

      const entry = ctx.fiber?.entry;
      const editor = ctx.get('configEditor');
      if (entry === undefined || editor === undefined) {
        return replyJson(res, 501, { ok: false, error: 'config-unavailable', message: 'This profile cannot persist settings.' });
      }

      try {
        await editor.edit(entry, (existing) => ({ ...existing, ...candidate }));
      } catch (error) {
        return replyJson(res, 422, {
          ok: false,
          error: 'rejected',
          message: error instanceof Error ? error.message : String(error),
        });
      }

      const credentials = ctx.get('credentials');
      if (body.clearApiKey === true) {
        await credentials?.unset?.(API_KEY_REF).catch(() => {});
      } else if (typeof body.apiKey === 'string' && body.apiKey.trim().length > 0) {
        if (credentials === undefined) {
          return replyJson(res, 501, { ok: false, error: 'credentials-unavailable', message: 'No credential store in this profile.' });
        }
        await credentials.set(API_KEY_REF, body.apiKey.trim());
      }

      return replyJson(res, 200, { ok: true, value: await settingsPayload() });
    },
  }), `${NAME}: config route`);

  // ---- streaming optimize ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: OPTIMIZE_ROUTE,
    handler: async (req, res) => {
      if (!guard(req, res)) return;
      if (req.method !== 'POST') return replyJson(res, 405, { ok: false, error: 'method-not-allowed' });
      if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        return replyJson(res, 415, { ok: false, error: 'json-required' });
      }

      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return replyJson(res, 400, { ok: false, error: 'invalid-json' });
      }

      const request = requestOf(body);
      if (request.error !== undefined) return replyJson(res, 422, { ok: false, ...request });

      const settings = settingsOf(config);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
      // A closed browser connection must cancel the model call, not leak it.
      req.on('close', () => controller.abort());

      openEventStream(res);
      frame(res, 'meta', { template: request.template, timeoutMs: settings.timeoutMs });

      try {
        const outcome = await rewrite(ctx, request, {
          onReasoning: (text) => frame(res, 'reasoning', { text }),
          onDelta: (text) => frame(res, 'delta', { text }),
        }, controller.signal);
        frame(res, 'result', { text: outcome.text, route: outcome.route });
        frame(res, 'done', { ok: true });
      } catch (error) {
        const aborted = controller.signal.aborted;
        frame(res, 'error', {
          code: aborted ? 'timeout-or-cancel' : (error?.code ?? 'request-failed'),
          message: aborted
            ? 'The optimizer was cancelled or timed out.'
            : (error instanceof Error ? error.message : String(error)),
        });
      } finally {
        clearTimeout(timer);
        res.end();
      }
    },
  }), `${NAME}: optimize route`);

  // ---- agent tool ----
  ctx.effect(() => ctx.tools.register({
    name: 'optimize_prompt',
    description: [
      'Rewrite a prompt so it works better, instead of answering it.',
      'Use this when the user asks to improve, restructure, or iterate on a prompt they are writing, or when their draft instructions are vague enough that restating them as clear rules would help.',
      'Returns the rewritten prompt text.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: "The prompt to rewrite: the user's own wording, not an answer to it.",
        },
        template: {
          type: 'string',
          enum: TEMPLATE_ORDER,
          description: 'How to restructure it. `system` rebuilds it as a role prompt with skills, rules, and workflow; `user` clarifies a request; `iterate` folds `requirements` into an existing prompt.',
        },
        requirements: {
          type: 'string',
          description: "What to change, in the user's words. Required when template is `iterate`, ignored otherwise.",
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { optimized: { type: 'string' } },
        required: ['optimized'],
      },
      render: (_args, value) => [{ type: 'text', text: value.optimized }],
    },
    async execute(args) {
      const request = requestOf(args ?? {});
      if (request.error !== undefined) throw new Error(request.message);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), settingsOf(config).timeoutMs);
      try {
        const outcome = await rewrite(ctx, request, { onReasoning: () => {}, onDelta: () => {} }, controller.signal);
        if (outcome.text.length === 0) throw new Error('The model returned an empty result.');
        return { optimized: outcome.text };
      } finally {
        clearTimeout(timer);
      }
    },
  }), `${NAME}: optimize_prompt tool`);

  // ---- model-facing guidance ----
  ctx.effect(() => ctx.systemPrompt.section({
    name: `${NAME}/when-to-use`,
    order: 120,
    text: 'When the user is clearly drafting a prompt and wants it improved rather than executed, call optimize_prompt with their wording instead of rewriting it inside your reply.',
  }), `${NAME}: prompt section`);
}
