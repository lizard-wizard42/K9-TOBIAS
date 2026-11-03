const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretar } = require('../src/nlu-local');
const { Cerebro } = require('../src/cerebro');
const { Safety } = require('../src/safety');
const { construirFerramentas } = require('../src/tools');
const cfg = require('../src/config');

test('interpretador local entende comandos óbvios e ignora o resto', () => {
  const t = (s) => { const r = interpretar(s); return r && `${r.tool}:${JSON.stringify(r.args)}`; };
  assert.equal(t('senta aí'), 'robo_pose:{"pose":"sentar"}');
  assert.equal(t('K9, deita'), 'robo_pose:{"pose":"deitar"}');
  assert.equal(t('dança pra mim'), 'robo_pose:{"pose":"dancar"}');
  assert.equal(t('anda para frente'), 'robo_andar:{"frente":1,"giro":0,"segundos":2}');
  assert.equal(t('anda para trás'), 'robo_andar:{"frente":-1,"giro":0,"segundos":1.5}');
  assert.equal(t('gira para a esquerda'), 'robo_andar:{"frente":0,"giro":-1,"segundos":1.5}');
  assert.equal(t('vira à direita'), 'robo_andar:{"frente":0,"giro":1,"segundos":1.5}');
  assert.equal(t('qual é a capital da França'), null);
  assert.equal(t(''), null);
});

function montar({ agente = null, armado = false, nome = () => 'K9' } = {}) {
  const log = [], falas = [];
  const robot = { status: async () => ({ online: true }), pose: async (c) => log.push(['pose', c]), stop: async () => log.push(['stop']), walk: async (f, t, s) => { log.push(['walk', f, t, s]); return 'terminou'; } };
  const safety = new Safety({ ...cfg, actionsPerMin: 50 }); if (armado) safety.arm();
  const ferramentas = construirFerramentas({ robot, safety, conhecimento: { search: () => [] }, memoria: { buscar: () => [], salvar: () => ({ ok: true }) } });
  const cerebro = new Cerebro({ safety, robot, ferramentas, agente, falar: async (t) => falas.push(t), nome });
  return { cerebro, log, falas, safety };
}

test('desarmado não obedece, mas "para" funciona sempre, sem IA', async () => {
  let chamadasIa = 0;
  const { cerebro, log, falas } = montar({ agente: { responder: async () => { chamadasIa++; return 'x'; } } });
  await cerebro.tratar('senta'); assert.deepEqual(log, []); assert.match(falas.at(-1), /desarmado/);
  await cerebro.tratar('para'); assert.deepEqual(log, [['stop']]);
  assert.equal(chamadasIa, 0);
});

test('armar por voz, obedecer, e desarmar', async () => {
  const { cerebro, log, falas, safety } = montar();
  await cerebro.tratar('ativar vivo'); assert.equal(safety.armed, true);
  await cerebro.tratar('senta'); assert.deepEqual(log.at(-1), ['pose', 'sit']); assert.equal(falas.at(-1), 'Sentei.');
  await cerebro.tratar('anda para frente'); assert.deepEqual(log.at(-1), ['walk', 0.5, 0, 2]);
  await cerebro.tratar('desligar vivo'); assert.equal(safety.armed, false); assert.deepEqual(log.at(-1), ['stop']);
});

test('"anda para frente" nunca é tomado por parada', async () => {
  const { cerebro, log } = montar({ armado: true });
  await cerebro.tratar('anda para frente');
  assert.ok(log.some((l) => l[0] === 'walk')); assert.ok(!log.some((l) => l[0] === 'stop'));
});

test('IA responde e age pelo agente; se a IA falha, para e usa o plano B', async () => {
  const boa = montar({ armado: true, agente: { responder: async () => 'Pronto, sentei.' } });
  await boa.cerebro.tratar('você poderia fazer o favor de sentar'); assert.equal(boa.falas.at(-1), 'Pronto, sentei.');
  const ruim = montar({ armado: true, agente: { responder: async () => { throw new Error('sem rede'); } } });
  await ruim.cerebro.tratar('senta');
  assert.deepEqual(ruim.log.slice(0, 2), [['stop'], ['pose', 'sit']]);                 // parou, depois obedeceu pelo plano B
  await ruim.cerebro.tratar('quem descobriu o Brasil'); assert.match(ruim.falas.at(-1), /Não consegui pensar/);
});

test('sem IA e sem entender: diz que não entendeu e não age', async () => {
  const { cerebro, log, falas } = montar({ armado: true });
  await cerebro.tratar('fale sobre a teoria da relatividade'); assert.deepEqual(log, []); assert.match(falas.at(-1), /Não entendi/);
});

test('escuta contínua só obedece citando o nome; "para" nunca exige o nome', async () => {
  const log = [], falas = [];
  const robot = { status: async () => ({ online: true }), pose: async (c) => log.push(['pose', c]), stop: async () => log.push(['stop']), walk: async () => 'terminou' };
  const safety = new Safety({ ...cfg, actionsPerMin: 50 }); safety.arm();
  const ferramentas = construirFerramentas({ robot, safety, conhecimento: { search: () => [] }, memoria: { buscar: () => [], salvar: () => ({ ok: true }) } });
  const cerebro = new Cerebro({ safety, robot, ferramentas, falar: async (t) => falas.push(t), nome: () => 'Tobias' });
  await cerebro.tratar('senta', { continuo: true });                      // conversa ao fundo: ignora, sem resposta
  assert.deepEqual(log, []); assert.deepEqual(falas, []);
  await cerebro.tratar('Tobias, senta', { continuo: true });
  assert.deepEqual(log, [['pose', 'sit']]);
  await cerebro.tratar('deita');                                          // apertar para falar: não precisa do nome
  assert.deepEqual(log.at(-1), ['pose', 'lie']);
  log.length = 0; await cerebro.tratar('para', { continuo: true });
  assert.deepEqual(log, [['stop']]);
  await cerebro.tratar('Tobias para', { continuo: true }); assert.deepEqual(log.at(-1), ['stop']);
});

test('o Vivo nunca mexe na lanterna, mesmo que peçam', () => {
  assert.equal(interpretar('liga o flash'), null);
  assert.equal(interpretar('acende a luz'), null);
});

test('escuta contínua: "ativar vivo" sem o nome NÃO arma (conversa alheia); com o nome arma', async () => {
  const { cerebro, safety } = montar({ nome: () => 'Tobias' });
  await cerebro.tratar('ativar vivo', { continuo: true }); assert.equal(safety.armed, false);
  await cerebro.tratar('Tobias, ativar vivo', { continuo: true }); assert.equal(safety.armed, true);
});

test('desarmado: a IA pode conversar (sem ferramentas físicas); comando físico continua recusado', async () => {
  const pedidos = [];
  const agente = { responder: async (t, o) => { pedidos.push([t, o]); return 'Sou o Tobias.'; } };
  const { cerebro, log, falas } = montar({ agente });
  await cerebro.tratar('quem é você'); assert.deepEqual(pedidos, [['quem é você', { fisico: false, lang: 'pt' }]]); assert.equal(falas.at(-1), 'Sou o Tobias.');
  await cerebro.tratar('senta'); assert.equal(pedidos.length, 1); assert.deepEqual(log, []); assert.match(falas.at(-1), /desarmado/);
});

test('outros idiomas: parar, armar e obedecer em inglês, espanhol, francês, alemão e mandarim', async () => {
  const casos = { en: ['stop', 'enable vivo', 'sit down'], es: ['alto', 'activar vivo', 'siéntate'], fr: ['stop', 'activer vivo', 'assis'], de: ['Stopp', 'Vivo aktivieren', 'Sitz'], zh: ['停', '启用vivo', '坐下'] };
  for (const [lang, [parar, armar, sentar]] of Object.entries(casos)) {
    const { cerebro, log, safety } = montar();
    await cerebro.tratar(parar, { lang }); assert.deepEqual(log, [['stop']], `${lang}: parar`);
    await cerebro.tratar(armar, { lang }); assert.equal(safety.armed, true, `${lang}: armar`);
    await cerebro.tratar(sentar, { lang }); assert.deepEqual(log.at(-1), ['pose', 'sit'], `${lang}: sentar`);
  }
  const { cerebro, log } = montar({ armado: true });
  await cerebro.tratar('sit', { lang: 'xx' }); assert.deepEqual(log, [], 'idioma inválido cai no português: "sit" não é comando');
});
