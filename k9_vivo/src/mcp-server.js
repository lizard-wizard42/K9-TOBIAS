'use strict';
/* Servidor MCP do Vivo. Usado de dois jeitos:
   - em memória, pelo agente embutido (src/agent.js);
   - por stdio, por qualquer cliente MCP (Claude Code, Claude Desktop): `node src/mcp-server.js`.
   No modo stdio o Vivo nasce DESARMADO; quem arma é uma pessoa (VIVO_ARMAR=1 no ambiente). */
const path = require('node:path');
const fs = require('node:fs');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const cfg = require('./config');
const { construirFerramentas } = require('./tools');

function criarServidorMcp(deps) {
  const server = new McpServer({ name: 'k9-vivo', version: '0.1.0' });
  for (const t of construirFerramentas(deps)) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.schema }, async (args) => ({
      content: [{ type: 'text', text: String(await t.handler(args || {})) }]
    }));
  }
  return server;
}

function auditoriaEmArquivo(dir) {
  const arq = path.join(dir, 'auditoria.jsonl');
  return (ev) => { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(arq, JSON.stringify({ quando: new Date().toISOString(), ...ev }) + '\n'); };
}

function dependenciasReais({ falar } = {}) {
  const { Safety } = require('./safety');
  const { createRobot } = require('./robot');
  const { carregarConhecimento } = require('./rag/knowledge');
  const { Memoria } = require('./rag/memory');
  return {
    robot: createRobot({ hubUrl: cfg.hubUrl, token: cfg.hubToken, tickMs: cfg.driveTickMs }),
    safety: new Safety(cfg),
    conhecimento: carregarConhecimento(cfg.repo),
    memoria: new Memoria(path.join(cfg.dataDir, 'memoria.jsonl')),
    auditar: auditoriaEmArquivo(cfg.dataDir),
    falar
  };
}

module.exports = { criarServidorMcp, dependenciasReais };

if (require.main === module) {
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  const deps = dependenciasReais();
  if (process.env.VIVO_ARMAR === '1') deps.safety.arm();
  criarServidorMcp(deps).connect(new StdioServerTransport()).then(() => console.error(`[k9-vivo] MCP em stdio; Vivo ${deps.safety.armed ? 'ARMADO' : 'desarmado'}`));
}
