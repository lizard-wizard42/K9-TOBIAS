'use strict';
/* Adaptador da OpenAI (Chat Completions com ferramentas) com a MESMA interface que o agente usa para a Anthropic:
   `messages.create({ model, max_tokens, system, tools, messages })` -> { stop_reason, content:[text|tool_use] }.
   Assim o agente, o MCP e a segurança não mudam. */

function paraOpenAI({ model, max_tokens, system, tools = [], messages }) {
  const out = [{ role: 'system', content: system || '' }];
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    if (m.role === 'assistant') {
      const texto = m.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
      const chamadas = m.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
      out.push({ role: 'assistant', content: texto || null, ...(chamadas.length ? { tool_calls: chamadas } : {}) });
    } else {
      for (const b of m.content) {
        if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: String(b.content) });
        else if (b.type === 'text') out.push({ role: 'user', content: b.text });
      }
    }
  }
  const corpo = { model, messages: out, max_completion_tokens: max_tokens || 400 };
  if (tools.length) corpo.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  return corpo;
}

function deOpenAI(resposta) {
  const escolha = resposta && resposta.choices && resposta.choices[0];
  if (!escolha) throw new Error('resposta da OpenAI sem escolhas');
  const msg = escolha.message || {};
  const content = [];
  if (msg.content) content.push({ type: 'text', text: msg.content });
  (msg.tool_calls || []).forEach((c, n) => {
    let input = {}; try { input = typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : (c.function.arguments || {}); } catch (e) { input = {}; }
    content.push({ type: 'tool_use', id: c.id || `call_${Date.now()}_${n}`, name: c.function.name, input });     // modelos locais às vezes não mandam id
  });
  return { stop_reason: (msg.tool_calls || []).length ? 'tool_use' : 'end_turn', content };
}

function criarClienteOpenAI({ apiKey, fetchImpl = fetch, base = 'https://api.openai.com/v1' }) {
  return {
    messages: {
      async create(req, opts = {}) {
        const r = await fetchImpl(`${base}/chat/completions`, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(paraOpenAI(req)), signal: AbortSignal.timeout(opts.timeout || 25000)
        });
        if (!r.ok) {                                                            // a mensagem nunca leva a chave nem o corpo do pedido
          let detalhe = ''; try { detalhe = (await r.json()).error.message || ''; } catch (e) { /* sem corpo */ }
          throw new Error(`OpenAI respondeu ${r.status}${detalhe ? ': ' + detalhe.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-…').slice(0, 160) : ''}`);
        }
        return deOpenAI(await r.json());
      }
    }
  };
}
module.exports = { criarClienteOpenAI, paraOpenAI, deOpenAI };
