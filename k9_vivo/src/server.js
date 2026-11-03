'use strict';
/* Gateway do Vivo: serve a página de voz e recebe o que o celular ouviu por WebSocket.
   Escuta só em 127.0.0.1; o celular chega por `adb reverse tcp:3090 tcp:3090`. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const cfg = require('./config');
const { dependenciasReais, criarServidorMcp } = require('./mcp-server');
const { construirFerramentas } = require('./tools');
const { Cerebro } = require('./cerebro');
const { Agente, escolherIa } = require('./agent');

const WEB = path.join(cfg.root, 'web');
const I18N_DIR = path.join(__dirname, '..', '..', 'k9_control_hub', 'public', 'i18n');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const origemOk = (o) => !o || new Set([`http://localhost:${cfg.port}`, `http://127.0.0.1:${cfg.port}`]).has(o);   // navegador sempre manda Origin; app nativo não
const hostOk = (h) => new Set([`localhost:${cfg.port}`, `127.0.0.1:${cfg.port}`]).has(String(h || ''));              // contra DNS rebinding

async function iniciar() {
  const clientes = new Set();
  const enviar = (o) => { const m = JSON.stringify(o); for (const ws of clientes) if (ws.readyState === 1) ws.send(m); };
  const falar = async (text) => enviar({ type: 'say', text });
  const deps = dependenciasReais({ falar });
  const { safety, robot } = deps;

  let nomeRobo = 'K9';
  const atualizaNome = async () => { try { nomeRobo = await robot.nome(); } catch (e) { /* mantém o último */ } };
  await atualizaNome();

  let agente = null;
  const cli = await escolherIa();
  let usoIa = { principal: 0, reserva: 0 };
  if (cli) {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
    const [a, b] = InMemoryTransport.createLinkedPair();
    const mcp = new Client({ name: 'k9-vivo-agente', version: '0.1.0' });
    await Promise.all([criarServidorMcp(deps).connect(a), mcp.connect(b)]);
    agente = new Agente({ ia: cli.ia, mcp, memoria: deps.memoria, safety, model: cli.modelo, knowledgeDir: cfg.knowledgeDir, nome: () => nomeRobo, reserva: cli.reserva, aoUsar: (q) => { usoIa[q]++; } });
  }

  let linkRobot = { online: false };
  const estado = async (aviso) => {
    await atualizaNome();
    try { linkRobot = await robot.status(); } catch (e) { linkRobot = { online: false }; }
    enviar({ type: 'state', nome: nomeRobo, armed: safety.armed, ia: !!agente, modelo: cli ? `${cli.provedor}:${cli.modelo}` : null, usoIa, hub: true, robot: !!linkRobot.online, aviso: aviso || null });
  };
  const cerebro = new Cerebro({ safety, robot, ferramentas: construirFerramentas(deps), agente, falar, avisar: estado, nome: () => nomeRobo });

  const servidor = http.createServer((req, res) => {
    if (!hostOk(req.headers.host)) { res.writeHead(403).end('host não permitido'); return; }
    const url = req.url.split('?')[0];
    if (url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, armed: safety.armed, ia: !!agente })); return; }
    // /i18n/<arquivo>.js: o motor de idiomas e o dicionário vêm do hub (fonte única, sem cópia)
    const i18n = /^\/i18n\/([\w-]+\.js)$/.exec(url);
    const nome = url === '/' ? 'index.html' : i18n ? i18n[1] : url.replace(/^\//, '');
    const base = i18n ? I18N_DIR : WEB;
    const arq = path.join(base, nome);
    if (!/^[\w.-]+$/.test(nome) || !arq.startsWith(base + path.sep) || !fs.existsSync(arq)) { res.writeHead(404).end('não achei'); return; }
    res.writeHead(200, { 'content-type': TIPOS[path.extname(arq)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(fs.readFileSync(arq));
  });

  const wss = new WebSocketServer({ server: servidor, path: '/ws', maxPayload: 8192, verifyClient: ({ origin, req }) => origemOk(origin) && hostOk(req.headers.host) });
  wss.on('connection', (ws) => {
    clientes.add(ws); estado();
    ws.on('message', async (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      if (!m || typeof m.type !== 'string') return;
      try {
        if (m.type === 'transcript' && typeof m.text === 'string') { enviar({ type: 'heard', text: m.text.slice(0, 300) }); await cerebro.tratar(m.text.slice(0, 300), { continuo: m.continuo === true, lang: typeof m.lang === 'string' ? m.lang : 'pt' }); }
        else if (m.type === 'arm') { safety.arm(); await falar('Vivo ativado.'); }
        else if (m.type === 'disarm') { await cerebro.parar(); safety.disarm(); await falar('Vivo desligado.'); }
        else if (m.type === 'stop') { await cerebro.parar(); safety.disarm(); await falar('Parei e desarmei.'); }   // o botão PARAR também desarma
        await estado();
      } catch (e) { await cerebro.parar(); safety.disarm(); enviar({ type: 'state', armed: false, aviso: 'erro: ' + e.message }); }
    });
    ws.on('close', async () => {
      clientes.delete(ws);
      if (!clientes.size && safety.armed) { await cerebro.parar(); safety.disarm(); }        // celular sumiu: para e desarma
    });
  });

  const vigia = setInterval(async () => {
    if (safety.idleExpired()) { await cerebro.parar(); safety.disarm(); await falar('Desarmei por inatividade.'); }
    if (clientes.size) estado();
  }, 3000);

  const sair = async () => { clearInterval(vigia); await robot.stop().catch(() => {}); process.exit(0); };
  process.on('SIGINT', sair); process.on('SIGTERM', sair);

  servidor.listen(cfg.port, cfg.host, () => console.log(`[vivo] http://${cfg.host}:${cfg.port}  |  IA: ${cli ? cli.provedor + ' ' + cli.modelo + (cli.reserva ? ' (reserva: ' + cli.reserva.provedor + ' ' + cli.reserva.modelo + ')' : '') : 'desligada (sem IA local nem chave; só comandos simples)'}  |  hub: ${cfg.hubUrl}  |  DESARMADO`));
  return servidor;
}

module.exports = { iniciar };
if (require.main === module) iniciar().catch((e) => { console.error('[vivo] falhou:', e); process.exit(1); });
