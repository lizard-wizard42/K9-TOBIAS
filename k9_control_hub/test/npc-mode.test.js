const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ctx = { globalThis: null };
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/npc.js'), 'utf8'), ctx);
const { PADRAO, ACOES, normalizar, criarEstado, humor, escolher, aplicar, pausa, duracao } = ctx.K9NPC;

// Sorteio com semente fixa: os testes têm que dar o mesmo resultado sempre.
function semente(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Vive `n` ações seguidas e devolve o histórico { id, antes, depois, passos }.
function viver(n, cfg = normalizar(null), rnd = semente(1), estado = criarEstado()) {
  const h = [];
  for (let i = 0; i < n; i++) {
    const id = escolher(estado, cfg, rnd);
    if (!id) break;
    const passos = ACOES[id].passos(rnd, { ...cfg, pataEsquerda: true });
    const depois = aplicar(estado, id, duracao(passos) / 1000 + pausa(estado, cfg, rnd) / 1000);
    h.push({ id, antes: estado, depois, passos });
    estado = depois;
  }
  return h;
}

test('normalizar devolve configuração válida para entradas ruins', () => {
  for (const lixo of [null, undefined, 'x', 42, [], { ritmo: 'voando', velocidade: 'abc', limiteMin: -5 }]) {
    const c = normalizar(lixo);
    assert.ok(['calmo', 'normal', 'agitado'].includes(c.ritmo));
    assert.ok(c.velocidade >= 20 && c.velocidade <= 100);
    assert.ok(c.limiteMin >= 0 && c.limiteMin <= 240);
  }
  assert.equal(normalizar({ passeios: true }).passeios, true);
  assert.equal(normalizar(null).passeios, false);                 // por padrão o robô fica no lugar
});

test('só faz o que é possível na postura: deitado ou sentado nunca faz gesto, gira ou anda', () => {
  const h = viver(3000);
  for (const { id, antes } of h) {
    assert.ok(ACOES[id].de.includes(antes.postura), `${id} a partir de ${antes.postura}`);
    if (antes.postura !== 'stand') assert.ok(['levantar', 'dormir', 'cocar'].includes(id), `${id} fora de pé`);          // sentado também coça a barriga (a animação termina em pé)
  }
});

test('sentado e deitado só saem ficando em pé (nunca sentar direto para deitar)', () => {
  for (const { id, antes, depois } of viver(3000, normalizar(null), semente(7))) {
    if (antes.postura === 'sit') assert.ok((id === 'levantar' || id === 'cocar') && depois.postura === 'stand', id);
    if (antes.postura === 'lie' && id !== 'dormir') assert.equal(id, 'levantar');
  }
});

test('aparece a sequência da vida de cachorro: sentar, ficar em pé, deitar', () => {
  const h = viver(4000, normalizar(null), semente(3)).map((x) => x.id);
  const ocorre = (...seq) => h.some((_, i) => seq.every((s, k) => h[i + k] === s));
  assert.ok(ocorre('sentar', 'levantar', 'deitar'), 'sentar → levantar → deitar');
  assert.ok(h.includes('girar_esq') && h.includes('girar_dir'), 'gira para os dois lados');
});

test('dorme cansado e acorda se espreguiçando', () => {
  const h = viver(6000, normalizar(null), semente(11));
  assert.ok(h.some((x) => x.id === 'dormir'), 'dormiu');
  for (let i = 0; i < h.length - 2; i++) {
    if (h[i].id === 'levantar' && h[i].antes.dormindo) assert.equal(h[i + 1].id, 'alongar', 'depois de acordar vem o alongamento');
  }
  assert.ok(h.filter((x) => x.id === 'dormir').every((x) => x.antes.postura === 'lie'));
});

test('sem a opção dormir ele nunca dorme; sem gestos nunca faz gesto; sem girar nunca gira', () => {
  const cfg = normalizar({ dormir: false, gestos: false, girar: false, olhar: false });
  const ids = new Set(viver(3000, cfg, semente(5)).map((x) => x.id));
  for (const id of ['dormir', 'abanar', 'pata', 'alongar', 'cavar', 'dancar', 'girar_esq', 'girar_dir', 'olhar', 'passeio']) assert.ok(!ids.has(id), id);
  assert.ok(ids.has('sentar') && ids.has('levantar'));
});

test('por padrão nunca sai do lugar; com passeios ligados anda para a frente', () => {
  const anda = (h) => h.some((x) => x.passos.some((p) => p.k === 'walk' && p.f !== 0));
  assert.equal(anda(viver(3000, normalizar(null), semente(2))), false);
  assert.equal(anda(viver(3000, normalizar({ passeios: true }), semente(2))), true);
});

test('os giros são equilibrados entre esquerda e direita e alternam o lado', () => {
  const g = viver(8000, normalizar(null), semente(9)).filter((x) => x.id === 'girar_esq' || x.id === 'girar_dir');
  const esq = g.filter((x) => x.id === 'girar_esq').length;
  assert.ok(g.length > 40);
  assert.ok(esq / g.length > 0.35 && esq / g.length < 0.65, `esquerda ${esq} de ${g.length}`);
  let repetidos = 0;
  for (let i = 1; i < g.length; i++) if (g[i].id === g[i - 1].id) repetidos++;
  assert.ok(repetidos / g.length < 0.5, 'alterna o lado mais do que repete');
});

test('energia alta dança e abana mais; sono alto deita e dorme mais', () => {
  const contar = (est, ids, n = 1500) => { let c = 0; const rnd = semente(21); for (let i = 0; i < n; i++) if (ids.includes(escolher(est, normalizar(null), rnd))) c++; return c; };
  const animado = { ...criarEstado(), energia: 0.95, sono: 0.05, tedio: 0.5 };
  const calmo = { ...criarEstado(), energia: 0.25, sono: 0.05, tedio: 0.5 };
  assert.ok(contar(animado, ['dancar', 'abanar']) > contar(calmo, ['dancar', 'abanar']) * 1.5);
  const sonolento = { ...criarEstado(), energia: 0.2, sono: 0.9 };
  const desperto = { ...criarEstado(), energia: 0.9, sono: 0.05 };
  assert.ok(contar(sonolento, ['deitar']) > contar(desperto, ['deitar']) * 5);
});

test('não fica repetitivo: nunca a mesma ação três vezes seguidas', () => {
  const h = viver(5000, normalizar(null), semente(13)).map((x) => x.id);
  for (let i = 2; i < h.length; i++) assert.ok(!(h[i] === h[i - 1] && h[i] === h[i - 2]), `${h[i]} 3x seguidas`);
});

test('as necessidades ficam entre 0 e 1 e o humor é sempre um dos conhecidos', () => {
  const humores = new Set(['dormindo', 'sonolento', 'cansado', 'animado', 'tranquilo']);
  for (const { depois } of viver(4000, normalizar(null), semente(17))) {
    for (const k of ['energia', 'sono', 'tedio']) assert.ok(depois[k] >= 0 && depois[k] <= 1, `${k}=${depois[k]}`);
    assert.ok(humores.has(humor(depois)));
  }
});

test('passos têm tempos razoáveis e movimentos dentro de -1..1', () => {
  const cfg = normalizar({ passeios: true, velocidade: 100 });
  for (const { passos } of viver(2000, cfg, semente(4))) {
    for (const p of passos) {
      assert.ok(p.ms >= 300 && p.ms <= 90000, `${p.k} ${p.ms} ms`);
      if (p.k === 'walk') assert.ok(Math.abs(p.f) <= 1 && Math.abs(p.g) <= 1);
      if (p.k === 'walk') assert.ok(p.ms <= 3000, 'cada movimento dura poucos segundos');
    }
  }
});

test('o ritmo escala as pausas: calmo > normal > agitado', () => {
  const e = criarEstado();
  const media = (r) => { const rnd = semente(8); let s = 0; for (let i = 0; i < 200; i++) s += pausa(e, normalizar({ ritmo: r }), rnd); return s / 200; };
  assert.ok(media('calmo') > media('normal') && media('normal') > media('agitado'));
});

test('todo comando do NPC é aceito pelo hub e há padrão válido', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const lista = server.match(/const CMDS = new Set\(\[([\s\S]*?)\]\)/)[1];
  for (const a of Object.values(ACOES)) for (const c of a.cmds) assert.ok(lista.includes(`'${c}'`), c);
  for (const c of ['stand', 'sit', 'lie']) assert.ok(lista.includes(`'${c}'`), c);
  assert.ok(PADRAO.limiteMin > 0 && PADRAO.velocidade <= 100);
});

test('o modo aleatório foi removido do painel e o NPC não escuta voz', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(!/randBtn|random\.js|random\.css/.test(html));
  assert.ok(html.includes('id="npcBtn"') && html.includes('/npc.js'));
  const npc = fs.readFileSync(path.join(__dirname, '../public/npc.js'), 'utf8');
  assert.ok(npc.includes("'k9:npc'") && npc.includes('vozBtn'));        // liga o NPC: a voz desliga e o botão Voz fica bloqueado
  const voz = fs.readFileSync(path.join(__dirname, '../public/nome-voz.js'), 'utf8');
  assert.ok(voz.includes("addEventListener('k9:npc'"));
});

test('o NPC coça a barriga: acontece, vem de pé ou sentado, termina em pé e o comando existe no hub', () => {
  const h = viver(6000, normalizar(null), semente(41));
  const coca = h.filter((x) => x.id === 'cocar');
  assert.ok(coca.length > 10, `coçou ${coca.length} vezes`);
  assert.ok(coca.every((x) => ['stand', 'sit'].includes(x.antes.postura) && x.depois.postura === 'stand'));
  assert.ok(coca.every((x) => x.passos.length === 1 && x.passos[0].cmd === 'scratch' && x.passos[0].ms >= 12000 && x.passos[0].ms <= 15000));
  assert.equal(viver(3000, normalizar({ gestos: false }), semente(41)).some((x) => x.id === 'cocar'), false);   // sem gestos, nada de coçar
});
