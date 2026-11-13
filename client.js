/**
 * Client half.
 *
 * Three surfaces share one module-level store keyed by session id:
 *   - a pill in `conversation.input.right` (toggle, Alt+O),
 *   - the panel in `conversation.input.overlay` (streaming result, actions),
 *   - a preference row in `settings.general.item` (route and defaults).
 *
 * Generation streams from the Host's SSE route, so reasoning arrives first and
 * the rewrite fills in token by token; the request can be cancelled mid-flight.
 * Only `react` is required from the browser module table.
 */

window.__ModuleLoader__.load({
  id: '@seon0616/dsh-prompt-template',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const OPTIMIZE_ROUTE = '/plugins/dsh-prompt-template/optimize';
    const CONFIG_ROUTE = '/plugins/dsh-prompt-template/config';

    const TEXT = {
      zh: {
        trigger: '提示词优化',
        title: '提示词优化',
        subtitle: '把当前草稿重写为更可用的提示词',
        emptyDraft: '输入框里还没有内容。先写下想优化的提示词。',
        mode: '优化方式',
        modeSystem: '系统提示词（角色 + 规则 + 工作流）',
        modeUser: '用户提示词（澄清请求）',
        modeIterate: '迭代改进（在现有基础上调整）',
        requirements: '想怎么改（迭代模式必填）',
        requirementsPlaceholder: '例如：输出改成 JSON 格式，不要多轮确认',
        run: '开始优化',
        running: '优化中…',
        cancel: '取消',
        reasoning: '推理过程',
        result: '优化结果',
        apply: '填入输入框',
        copy: '复制',
        retry: '重新优化',
        dismiss: '关闭',
        failed: '优化失败',
        copied: '已复制',
        vars: '检测到变量占位符：{vars}（已要求模型逐字保留）',
        noVars: '未检测到变量占位符',
        route: '模型：{route}',
        // settings row
        settingsTitle: '提示词优化',
        settingsDesc: '优化器使用的模型与默认参数',
        endpointTitle: '自定义端点（可选）',
        endpointHint: '留空则使用当前会话默认模型；填写后优先进走该 OpenAI 兼容端点。',
        baseURL: '接口地址',
        model: '模型名',
        apiKey: 'API Key',
        apiKeySet: '已保存',
        apiKeyClear: '清除已保存的 Key',
        temperature: '温度',
        maxTokens: '最大输出 token',
        timeout: '超时（毫秒）',
        defaultTemplate: '默认优化方式',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        saveFailed: '保存失败',
        unavailable: '当前配置无法读取',
      },
      en: {
        trigger: 'Optimize prompt',
        title: 'Optimize prompt',
        subtitle: 'Rewrite the current draft into a stronger prompt',
        emptyDraft: 'The composer is empty. Write the prompt you want to optimize first.',
        mode: 'Mode',
        modeSystem: 'System prompt (role + rules + workflow)',
        modeUser: 'User prompt (clarify a request)',
        modeIterate: 'Iterate (adjust an existing prompt)',
        requirements: 'What to change (required for iterate)',
        requirementsPlaceholder: 'e.g. output JSON, no back-and-forth confirmation',
        run: 'Optimize',
        running: 'Optimizing…',
        cancel: 'Cancel',
        reasoning: 'Reasoning',
        result: 'Result',
        apply: 'Use this',
        copy: 'Copy',
        retry: 'Run again',
        dismiss: 'Close',
        failed: 'Optimization failed',
        copied: 'Copied',
        vars: 'Variables found: {vars} (the model is told to keep them verbatim)',
        noVars: 'No variable placeholders found',
        route: 'Model: {route}',
        settingsTitle: 'Prompt optimizer',
        settingsDesc: 'Model and defaults used by the optimizer',
        endpointTitle: 'Custom endpoint (optional)',
        endpointHint: 'Leave empty to use the session default model. When set, this OpenAI-compatible endpoint is used instead.',
        baseURL: 'Base URL',
        model: 'Model',
        apiKey: 'API key',
        apiKeySet: 'Saved',
        apiKeyClear: 'Clear saved key',
        temperature: 'Temperature',
        maxTokens: 'Max output tokens',
        timeout: 'Timeout (ms)',
        defaultTemplate: 'Default mode',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        saveFailed: 'Save failed',
        unavailable: 'Settings are unavailable',
      },
    };

    const VARIABLE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
    function variablesOf(text) {
      const found = new Set();
      for (const match of text.matchAll(VARIABLE)) found.add(match[1]);
      return [...found].sort();
    }

    // ---- per-session store -------------------------------------------------
    const EMPTY = {
      open: false, template: 'system', requirements: '',
      phase: 'idle', reasoning: '', streaming: '', result: '', route: '', error: '',
      notice: '', vars: [],
    };
    const states = new Map();
    const listeners = new Map();
    /** Default template from the settings row, applied to new and untouched sessions. */
    let defaultTemplate = 'system';

    function stateOf(id) {
      let state = states.get(id);
      if (state === undefined) {
        state = { ...EMPTY, template: defaultTemplate };
        states.set(id, state);
      }
      return state;
    }
    function patch(id, next) {
      states.set(id, { ...stateOf(id), ...next });
      for (const listener of listeners.get(id) ?? []) listener();
    }
    function subscribe(id, listener) {
      let set = listeners.get(id);
      if (set === undefined) {
        set = new Set();
        listeners.set(id, set);
      }
      set.add(listener);
      return () => set.delete(listener);
    }
    /** Live per-session state as a React value. */
    function useSessionState(id) {
      const [state, setState] = React.useState(() => stateOf(id));
      React.useEffect(() => {
        setState(stateOf(id));
        return subscribe(id, () => setState({ ...stateOf(id) }));
      }, [id]);
      return state;
    }

    const controllers = new Map();

    /** Parse and apply one SSE frame. */
    function applyFrame(id, frameText) {
      let event = 'message';
      let data = '';
      for (const line of frameText.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data.length === 0) return;
      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        return;
      }
      const state = stateOf(id);
      switch (event) {
        case 'reasoning':
          patch(id, { reasoning: state.reasoning + (payload.text ?? '') });
          return;
        case 'delta':
          patch(id, { streaming: state.streaming + (payload.text ?? '') });
          return;
        case 'result':
          patch(id, { result: payload.text ?? '', route: payload.route ?? '' });
          return;
        case 'done':
          patch(id, { phase: stateOf(id).result.length > 0 ? 'done' : 'error' });
          return;
        case 'error':
          patch(id, { phase: 'error', error: payload.message ?? 'failed' });
          return;
        default:
          return;
      }
    }

    /** Run one optimization for a session, streaming into the store. */
    async function run(id, prompt) {
      const state = stateOf(id);
      if (prompt.trim().length === 0) {
        patch(id, { phase: 'error', error: TEXT[currentLang()].emptyDraft });
        return;
      }
      controllers.get(id)?.abort();
      const controller = new AbortController();
      controllers.set(id, controller);
        patch(id, { phase: 'streaming', reasoning: '', streaming: '', result: '', route: '', error: '', notice: '' });

      try {
        const response = await fetch(OPTIMIZE_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ prompt, template: state.template, requirements: state.requirements }),
          signal: controller.signal,
        });
        if (!response.ok || response.body === null) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.message ?? `HTTP ${response.status}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const frameText = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');
            applyFrame(id, frameText);
          }
        }
        if (stateOf(id).phase === 'streaming') {
          patch(id, { phase: stateOf(id).result.length > 0 ? 'done' : 'error' });
        }
      } catch (error) {
        if (controller.signal.aborted) patch(id, { phase: 'idle' });
        else patch(id, { phase: 'error', error: error instanceof Error ? error.message : String(error) });
      } finally {
        if (controllers.get(id) === controller) controllers.delete(id);
      }
    }

    let lang = 'zh';
    /** Read the configured default template once, and adopt it for idle sessions. */
    async function loadDefaults() {
      try {
        const response = await fetch(CONFIG_ROUTE, { credentials: 'same-origin' });
        const body = await response.json();
        const template = body?.value?.settings?.defaultTemplate;
        if (body?.ok !== true || typeof template !== 'string') return;
        defaultTemplate = template;
        for (const [id, state] of states) {
          if (state.phase === 'idle' && state.result.length === 0) {
            patch(id, { template });
          }
        }
      } catch {
        /* settings unavailable: keep the built-in default */
      }
    }
    function currentLang() {
      return lang;
    }
    function localeLang(locale) {
      const active = locale?.getSnapshot?.()?.active;
      return typeof active === 'string' && active.toLowerCase().startsWith('en') ? 'en' : 'zh';
    }

    // ---- styles -----------------------------------------------------------
    const STYLE = `
.dshpo-pill{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;cursor:pointer;white-space:nowrap}
.dshpo-pill:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dshpo-pill[data-open="true"]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dshpo-anchor{position:absolute;width:0;height:0}
.dshpo-card{position:fixed;z-index:1000;width:min(620px,calc(100vw - 32px));max-height:min(72vh,640px);overflow:auto;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 12px 32px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary)}
.dshpo-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
.dshpo-title{font-size:13px;font-weight:600}
.dshpo-sub{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.dshpo-x{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:16px;line-height:1;padding:2px 4px;border-radius:6px}
.dshpo-x:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.dshpo-field{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}
.dshpo-label{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshpo-input,.dshpo-select{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-family:inherit}
.dshpo-input:disabled,.dshpo-select:disabled{opacity:.55}
.dshpo-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshpo-btn{height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer}
.dshpo-btn:hover{border-color:var(--dsw-alias-border-l2)}
.dshpo-btn[disabled]{opacity:.5;cursor:not-allowed}
.dshpo-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.dshpo-status{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshpo-error{font-size:12px;color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}
.dshpo-block{margin-top:10px}
.dshpo-block-title{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:4px}
.dshpo-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);animation:dshpo-pulse 1s ease-in-out infinite}
@keyframes dshpo-pulse{0%,100%{opacity:.35}50%{opacity:1}}
.dshpo-pre{margin:0;max-height:240px;overflow:auto;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dshpo-pre-reason{max-height:140px;color:var(--dsw-alias-label-secondary);font-size:11.5px}
.dshpo-vars{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:6px}
.dshpo-srow{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshpo-srow:last-child{border-bottom:none}
.dshpo-slabel{font-size:12.5px;color:var(--dsw-alias-label-primary)}
.dshpo-shint{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px;max-width:420px}
.dshpo-sright{display:flex;flex-direction:column;gap:6px;align-items:flex-end;min-width:220px}
.dshpo-sinput{width:220px;box-sizing:border-box;padding:5px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-family:inherit}
.dshpo-scheck{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
`;

    // ---- pill -------------------------------------------------------------
    function Pill(props) {
      const id = props.sessionId;
      const state = useSessionState(id);
      const t = TEXT[lang];

      React.useEffect(() => {
        const onKey = (event) => {
          if (!event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.key.toLowerCase() !== 'o') return;
          event.preventDefault();
          const now = stateOf(id);
          patch(id, { open: !now.open, error: '', phase: now.open ? 'idle' : now.phase });
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [id]);

      return h('button', {
        type: 'button',
        className: 'dshpo-pill',
        'data-open': state.open ? 'true' : 'false',
        title: `${t.subtitle} (Alt+O)`,
        'aria-haspopup': 'dialog',
        'aria-expanded': state.open,
        onClick: () => patch(id, { open: !state.open, error: '' }),
      }, glyph(), h('span', null, t.trigger));
    }

    // ---- panel ------------------------------------------------------------
    function Panel(props) {
      const id = props.sessionId;
      const state = useSessionState(id);
      const t = TEXT[lang];
      const markerRef = React.useRef(null);
      const cardRef = React.useRef(null);
      const [style, setStyle] = React.useState(null);

      const draftState = props.useInput?.((value) => value);
      const draftRef = React.useRef('');
      draftRef.current = typeof draftState?.draft === 'string' ? draftState.draft : '';

      // Anchor the card above the composer from the marker's own position, so
      // placement does not depend on this slot's overflow or stacking context.
      React.useLayoutEffect(() => {
        if (!state.open) return undefined;
        const place = () => {
          const rect = markerRef.current?.getBoundingClientRect();
          if (rect === undefined) return;
          const width = Math.min(620, window.innerWidth - 32);
          const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
          setStyle({ left, bottom: Math.max(16, window.innerHeight - rect.top + 8) });
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
      }, [state.open]);

      React.useEffect(() => {
        if (!state.open) return undefined;
        const onKey = (event) => {
          if (event.key === 'Escape') patch(id, { open: false });
        };
        const onDown = (event) => {
          if (cardRef.current?.contains(event.target)) return;
          if (event.target?.closest?.('.dshpo-pill') !== null) return;
          patch(id, { open: false });
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onDown, true);
        return () => {
          document.removeEventListener('keydown', onKey);
          document.removeEventListener('mousedown', onDown, true);
        };
      }, [id, state.open]);

      const start = () => {
        const prompt = draftRef.current;
        const vars = variablesOf(prompt);
        patch(id, { vars });
        run(id, prompt);
      };

      const apply = () => {
        if (state.result.length === 0) return;
        props.inputActions?.setDraft?.(state.result);
        patch(id, { open: false });
      };

      const copy = async () => {
        try {
          await navigator.clipboard.writeText(state.result);
          patch(id, { notice: t.copied });
        } catch {
          /* clipboard unavailable */
        }
      };

      const marker = h('span', { className: 'dshpo-anchor', ref: markerRef, 'aria-hidden': true });
      if (!state.open) return marker;

      const busy = state.phase === 'streaming';
      const shown = state.result.length > 0 ? state.result : state.streaming;

      const body = [
        h('div', { className: 'dshpo-head', key: 'head' }, [
          h('div', { key: 'titles' }, [
            h('div', { className: 'dshpo-title', key: 't' }, t.title),
            h('div', { className: 'dshpo-sub', key: 's' }, t.subtitle),
          ]),
          h('button', {
            key: 'x', type: 'button', className: 'dshpo-x', 'aria-label': t.dismiss,
            onClick: () => patch(id, { open: false }),
          }, '×'),
        ]),
        h('div', { className: 'dshpo-field', key: 'mode' }, [
          h('label', { className: 'dshpo-label', key: 'l', htmlFor: 'dshpo-mode' }, t.mode),
          h('select', {
            id: 'dshpo-mode', key: 's', className: 'dshpo-select', value: state.template,
            disabled: busy,
            onChange: (event) => patch(id, { template: event.target.value }),
          }, [
            h('option', { value: 'system', key: 'system' }, t.modeSystem),
            h('option', { value: 'user', key: 'user' }, t.modeUser),
            h('option', { value: 'iterate', key: 'iterate' }, t.modeIterate),
          ]),
        ]),
        state.template === 'iterate' ? h('div', { className: 'dshpo-field', key: 'req' }, [
          h('label', { className: 'dshpo-label', key: 'l', htmlFor: 'dshpo-req' }, t.requirements),
          h('input', {
            id: 'dshpo-req', key: 'i', className: 'dshpo-input', value: state.requirements,
            disabled: busy, placeholder: t.requirementsPlaceholder,
            onChange: (event) => patch(id, { requirements: event.target.value }),
          }),
        ]) : null,
        h('div', { className: 'dshpo-row', key: 'run' }, [
          h('button', {
            key: 'go', type: 'button', className: 'dshpo-btn dshpo-btn-primary',
            disabled: busy, onClick: busy ? () => controllers.get(id)?.abort() : start,
          }, busy ? t.cancel : (state.phase === 'idle' ? t.run : t.retry)),
          state.phase === 'streaming' ? h('span', { key: 's', className: 'dshpo-status' }, t.running) : null,
          state.route.length > 0 ? h('span', { key: 'r', className: 'dshpo-status' }, t.route.replace('{route}', state.route)) : null,
        ]),
        state.error.length > 0
          ? h('div', { className: 'dshpo-block', key: 'err' }, h('div', { className: 'dshpo-error' }, state.error))
          : null,
        state.reasoning.length > 0 ? h('div', { className: 'dshpo-block', key: 'reason' }, [
          h('div', { className: 'dshpo-block-title', key: 't' }, [
            busy ? h('span', { className: 'dshpo-dot', key: 'd' }) : null,
            h('span', { key: 's' }, t.reasoning),
          ]),
          h('pre', { className: 'dshpo-pre dshpo-pre-reason', key: 'p' }, state.reasoning),
        ]) : null,
        shown.length > 0 ? h('div', { className: 'dshpo-block', key: 'res' }, [
          h('div', { className: 'dshpo-block-title', key: 't' }, [
            busy ? h('span', { className: 'dshpo-dot', key: 'd' }) : null,
            h('span', { key: 's' }, t.result),
          ]),
          h('pre', { className: 'dshpo-pre', key: 'p' }, shown),
        ]) : null,
        !busy && state.result.length > 0 ? h('div', { className: 'dshpo-vars', key: 'vars' },
          (state.vars?.length ?? 0) > 0
            ? t.vars.replace('{vars}', state.vars.join(', '))
            : t.noVars) : null,
        !busy && state.result.length > 0 ? h('div', { className: 'dshpo-row', key: 'act', style: { marginTop: '8px' } }, [
          h('button', { key: 'a', type: 'button', className: 'dshpo-btn dshpo-btn-primary', onClick: apply }, t.apply),
          h('button', { key: 'c', type: 'button', className: 'dshpo-btn', onClick: copy }, t.copy),
          h('button', { key: 'r', type: 'button', className: 'dshpo-btn', onClick: start }, t.retry),
          state.notice.length > 0 ? h('span', { key: 'n', className: 'dshpo-status' }, state.notice) : null,
        ]) : null,
      ];

      return h(React.Fragment, null, marker, h('div', {
        ref: cardRef,
        className: 'dshpo-card',
        role: 'dialog',
        'aria-label': t.title,
        style: style ?? { left: 16, bottom: 120 },
      }, body));
    }

    // ---- settings row -----------------------------------------------------
    function SettingsRow() {
      const t = TEXT[lang];
      const [snapshot, setSnapshot] = React.useState(null);
      const [error, setError] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [form, setForm] = React.useState(null);
      const [apiKey, setApiKey] = React.useState('');
      const [clearKey, setClearKey] = React.useState(false);
      const [busy, setBusy] = React.useState(false);

      const load = React.useCallback(async () => {
        try {
          const response = await fetch(CONFIG_ROUTE, { credentials: 'same-origin' });
          const body = await response.json();
          if (body?.ok !== true) throw new Error(body?.message ?? `HTTP ${response.status}`);
          setSnapshot(body.value);
          setForm(body.value.settings);
          setError('');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }, []);

      React.useEffect(() => { load(); }, [load]);

      const save = async () => {
        if (form === null) return;
        setBusy(true);
        setNotice('');
        try {
          const response = await fetch(CONFIG_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              ...form,
              ...(apiKey.trim().length === 0 ? {} : { apiKey: apiKey.trim() }),
              ...(clearKey ? { clearApiKey: true } : {}),
            }),
          });
          const body = await response.json();
          if (body?.ok !== true) throw new Error(body?.message ?? `HTTP ${response.status}`);
          setSnapshot(body.value);
          setForm(body.value.settings);
          setApiKey('');
          setClearKey(false);
          setNotice(t.saved);
          setError('');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setBusy(false);
        }
      };

      if (form === null) {
        return h('div', { className: 'dshpo-srow' }, [
          h('div', { key: 'l' }, [
            h('div', { className: 'dshpo-slabel', key: 'n' }, t.settingsTitle),
            h('div', { className: 'dshpo-shint', key: 'h' }, error.length > 0 ? `${t.unavailable}: ${error}` : t.settingsDesc),
          ]),
        ]);
      }

      const number = (key, value, step = 1) => h('input', {
        className: 'dshpo-sinput', type: 'number', value: form[key], step,
        onChange: (event) => setForm({ ...form, [key]: Number(event.target.value) }),
      });

      return h('div', { className: 'dshpo-srow' }, [
        h('div', { key: 'l', style: { minWidth: '220px' } }, [
          h('div', { className: 'dshpo-slabel', key: 'n' }, t.settingsTitle),
          h('div', { className: 'dshpo-shint', key: 'h' }, t.settingsDesc),
          snapshot?.defaultRoute !== null && snapshot?.defaultRoute !== undefined
            ? h('div', { className: 'dshpo-shint', key: 'r' }, t.route.replace('{route}', snapshot.defaultRoute))
            : null,
          h('div', { className: 'dshpo-shint', key: 'e' }, t.endpointHint),
        ]),
        h('div', { key: 'r', className: 'dshpo-sright' }, [
          h('select', {
            className: 'dshpo-sinput', value: form.defaultTemplate,
            onChange: (event) => setForm({ ...form, defaultTemplate: event.target.value }),
          }, [
            h('option', { value: 'system', key: 's' }, t.modeSystem),
            h('option', { value: 'user', key: 'u' }, t.modeUser),
            h('option', { value: 'iterate', key: 'i' }, t.modeIterate),
          ]),
          h('input', {
            className: 'dshpo-sinput', placeholder: t.baseURL, value: form.baseURL,
            onChange: (event) => setForm({ ...form, baseURL: event.target.value }),
          }),
          h('input', {
            className: 'dshpo-sinput', placeholder: t.model, value: form.model,
            onChange: (event) => setForm({ ...form, model: event.target.value }),
          }),
          h('input', {
            className: 'dshpo-sinput', type: 'password', placeholder: apiKeyPlaceholder(t, snapshot),
            value: apiKey, onChange: (event) => setApiKey(event.target.value),
          }),
          snapshot?.apiKeyConfigured === true
            ? h('label', { className: 'dshpo-scheck' }, [
              h('input', {
                key: 'c', type: 'checkbox', checked: clearKey,
                onChange: (event) => setClearKey(event.target.checked),
              }),
              h('span', { key: 's' }, t.apiKeyClear),
            ])
            : null,
          h('div', { className: 'dshpo-row' }, [
            number('temperature', form.temperature, 0.1),
            number('maxOutputTokens', form.maxOutputTokens, 64),
            number('timeoutMs', form.timeoutMs, 1000),
          ]),
          h('div', { className: 'dshpo-row' }, [
            h('button', {
              key: 'save', type: 'button', className: 'dshpo-btn dshpo-btn-primary',
              disabled: busy, onClick: save,
            }, busy ? t.saving : t.save),
            notice.length > 0 ? h('span', { key: 'n', className: 'dshpo-status' }, notice) : null,
            error.length > 0 ? h('span', { key: 'e', className: 'dshpo-error' }, error) : null,
          ]),
        ]),
      ]);
    }

    function apiKeyPlaceholder(t, snapshot) {
      return snapshot?.apiKeyConfigured === true ? `${t.apiKey} · ${t.apiKeySet}` : t.apiKey;
    }

    /** Small wand glyph; inherits `currentColor` so it follows the theme. */
    function glyph() {
      return h('svg', {
        width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      }, [
        h('path', { key: 'a', d: 'M11.5 1.5l1 2 2 1-2 1-1 2-1-2-2-1 2-1z' }),
        h('path', { key: 'b', d: 'M4 8l3.2 3.2' }),
        h('path', { key: 'c', d: 'M2.5 14.5l2-2' }),
      ]);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const locale = ctx.get('locale');
        lang = localeLang(locale);
        ctx.effect(() => locale?.subscribe?.(() => {
          const next = localeLang(locale);
          if (next !== lang) {
            lang = next;
            for (const listener of [...listeners.values()].flatMap((set) => [...set])) listener();
          }
        }), 'dsh-prompt-template: locale');

        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent = STYLE;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'dsh-prompt-template: styles');

        ctx.effect(() => () => {
          for (const controller of controllers.values()) controller.abort();
          controllers.clear();
        }, 'dsh-prompt-template: abort on unload');

        ctx.effect(() => {
          loadDefaults();
          return () => {};
        }, 'dsh-prompt-template: defaults');

        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'prompt-template',
          order: 20,
          label: () => TEXT[lang].trigger,
          inject: () => ({ locale }),
        }, Pill));

        ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
          name: 'conversation.input.overlay',
          id: 'prompt-template',
          order: 5,
          inject: () => ({ locale }),
        }, Panel));

        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: 'prompt-template',
          order: 21,
          label: () => TEXT[lang].settingsTitle,
        }, SettingsRow));
      },
    };
  },
});
