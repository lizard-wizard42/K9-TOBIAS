const test = require('node:test');
const assert = require('node:assert/strict');
const { norm, isStopPhrase, removerNome, interpretar, nomeValido } = require('../public/voice-nlu.js');

test('frases de parada: curtas, com ou sem o nome, sem confundir "para" preposição', () => {
  for (const s of ['para', 'Para!', 'pare', 'pare agora', 'K9 para', 'Tobias para', 'Tobias, pare!', 'para tudo', 'para de andar', 'chega', 'stop', 'quero que pare', 'por favor, pare', 'socorro']) assert.ok(isStopPhrase(s, 'Tobias'), s);
  for (const s of ['anda para frente', 'Tobias anda para frente', 'vai para a esquerda', 'gira para a direita', 'olá', 'senta', 'faz uma dança para mim', '']) assert.ok(!isStopPhrase(s, 'Tobias'), s);
});

test('removerNome acha o nome em qualquer lugar da frase e ignora acentos e maiúsculas', () => {
  assert.deepEqual(removerNome('Tobias, senta!', 'Tobias'), { citou: true, resto: 'senta' });
  assert.deepEqual(removerNome('ei TOBIAS anda para frente', 'Tobias'), { citou: true, resto: 'ei anda para frente' });
  assert.deepEqual(removerNome('senta tobias', 'Tobias'), { citou: true, resto: 'senta' });
  assert.equal(removerNome('senta aí', 'Tobias').citou, false);
  assert.equal(removerNome('tobiasinho senta', 'Tobias').citou, false);                 // palavra inteira
  assert.equal(removerNome('João, senta', 'João').citou, true);
});

test('interpretar entende comandos óbvios e ignora o resto', () => {
  const t = (s) => { const r = interpretar(s); return r && (r.acao === 'pose' ? r.pose : `andar ${r.frente} ${r.giro} ${r.segundos}`); };
  assert.equal(t('senta aí'), 'sentar'); assert.equal(t('deita'), 'deitar'); assert.equal(t('dança pra mim'), 'dancar');
  assert.equal(t('levanta'), 'em_pe'); assert.equal(t('dá a pata'), 'pata_direita'); assert.equal(t('pata esquerda'), 'pata_esquerda');
  assert.equal(t('anda para frente'), 'andar 1 0 2'); assert.equal(t('anda para trás'), 'andar -1 0 1.5');
  assert.equal(t('gira para a esquerda'), 'andar 0 -1 1.5'); assert.equal(t('vira à direita'), 'andar 0 1 1.5');
  assert.equal(t('qual é a capital da França'), null); assert.equal(t(''), null);
});

test('nomeValido: aceita nomes normais e recusa lixo', () => {
  for (const [entrada, saida] of [['Tobias', 'Tobias'], ['  Tobias   Jr ', 'Tobias Jr'], ['Zé', 'Zé'], ['K9-2', 'K9-2'], ["D'Artagnan", "D'Artagnan"]]) assert.equal(nomeValido(entrada), saida);
  for (const ruim of ['', '   ', 'a'.repeat(25), '<script>', 'nome; rm -rf', '--x', null, undefined, 42 && '😀😀']) assert.equal(nomeValido(ruim), null, String(ruim));
  assert.equal(norm('Tobias'), 'tobias');
});

test('variações de como a pessoa realmente fala (e como o reconhecedor escreve)', () => {
  const p = (s) => { const r = interpretar(removerNome(s, 'Tobias').resto); return r && (r.acao === 'pose' ? r.pose : `andar ${r.frente} ${r.giro}`); };
  for (const f of ['dá a pata', 'Tobias, dá a pata', 'dá pata', 'me dá a patinha', 'dá a mão', 'cumprimenta', 'pata']) assert.equal(p(f), 'pata_direita', f);
  for (const f of ['Tobias oi', 'oi tudo bem', 'olá pessoal']) assert.equal(p(f), null, f);          // cumprimento solto não mexe o robô
  assert.equal(p('pata esquerda'), 'pata_esquerda');                                     // a regra da esquerda vem antes
  for (const f of ['Tobias senta', 'Tobias, sente.', 'senta aqui', 'fica sentado', 'Tobias sentar']) assert.equal(p(f), 'sentar', f);
  for (const f of ['Tobias deita', 'deitado']) assert.equal(p(f), 'deitar', f);
  assert.equal(p('anda para frente'), 'andar 1 0');
});

test('lanterna por voz: liga e desliga, sem confundir com outros comandos', () => {
  const l = (s) => { const r = interpretar(removerNome(s, 'Tobias').resto); return r && r.acao === 'luz' ? (r.ligar ? 'liga' : 'desliga') : (r ? r.acao : null); };
  for (const f of ['Tobias liga o flash', 'liga a lanterna', 'acende a luz', 'Tobias, ligue a luz']) assert.equal(l(f), 'liga', f);
  for (const f of ['desliga o flash', 'Tobias apaga a luz', 'desligue a lanterna']) assert.equal(l(f), 'desliga', f);
  assert.equal(l('senta'), 'pose'); assert.equal(l('anda para frente'), 'andar');
});

test('parar vale em qualquer frase, mesmo longa; "para" preposição continua sendo preposição', () => {
  assert.ok(isStopPhrase('Tobias, quando eu mandar mesmo você pare de andar e fique quietinho aí', 'Tobias'));
  assert.ok(isStopPhrase('chega disso agora', 'Tobias'));
  assert.ok(!isStopPhrase('anda para frente e depois gira para a direita', 'Tobias'));
});

test('nome mal transcrito: palavras coladas, 1 letra de diferença; sem falso positivo', () => {
  for (const f of ['to bias senta', 'tobia senta', 'Tobiaz, senta', 'tobias senta']) assert.equal(removerNome(f, 'Tobias').citou, true, f);
  for (const f of ['tobi senta', 'tubo senta', 'senta', 'tobias', ]) if (f !== 'tobias') assert.equal(removerNome(f, 'Tobias').citou, false, f);
  assert.equal(removerNome('to bias senta', 'Tobias').resto, 'senta');
  assert.equal(removerNome('ana senta', 'Ana').citou, true); assert.equal(removerNome('ane senta', 'Ana').citou, false);   // nomes curtos: só exato
});

// ---------- Variações naturais (conjugações, infinitivo, polidez, erros do reconhecedor) ----------
const rotulo = (s) => {
  const r = interpretar(removerNome(s, 'Tobias').resto);
  if (!r) return null;
  if (r.acao === 'pose') return r.pose;
  if (r.acao === 'luz') return r.ligar ? 'luz_liga' : 'luz_desliga';
  return `andar ${r.frente} ${r.giro} ${r.segundos}`;
};
const FRENTE = 'andar 1 0 2', TRAS = 'andar -1 0 1.5', ESQ = 'andar 0 -1 1.5', DIR = 'andar 0 1 1.5';
const familias = {
  sentar: ['senta', 'sente', 'sentar', 'senta aí', 'sente aí', 'pode sentar', 'quero que você sente', 'eu quero que você sente', 'vai sentar',
    'senta aqui, Tobias', 'Tobias, senta', 'sentado', 'sentadinho', 'fica sentado', 'se senta', 'sente-se', 'senta por favor', 'por favor, senta',
    'sentando', 'vamos sentar', 'Tobias, pode sentar aí?', 'centa aí'],
  deitar: ['deita', 'deitar', 'deite', 'se deita', 'deita aí', 'deita aqui', 'pode deitar', 'quero que você deite', 'vai deitar', 'deitadinho',
    'fica deitado', 'deite-se', 'Tobias, deita!'],
  em_pe: ['fica de pé', 'levanta', 'em pé', 'levantar', 'se levanta', 'de pé', 'levante', 'levanta aí', 'fique em pé', 'pode levantar', 'vai levantar',
    'levantando', 'Tobias, levanta'],
  pata_direita: ['dá a pata', 'dê a pata', 'dar a pata', 'pata', 'dá a patinha', 'me dá a pata', 'da a pata', 'dá pata', 'pode dar a pata',
    'quero que você dê a pata', 'pata direita', 'dá a pata direita', 'levanta a pata', 'estende a pata', 'aperta a mão', 'cumprimenta', 'a pata',
    'patinha', 'Tobias, me dá a patinha por favor'],
  pata_esquerda: ['pata esquerda', 'dá a pata esquerda', 'me dá a pata esquerda', 'dê a patinha esquerda', 'levanta a pata esquerda', 'dar a pata esquerda'],
  dancar: ['dança', 'dançar', 'dance', 'dançando', 'dança pra mim', 'faz uma dança', 'faz uma dancinha', 'faça uma dança', 'pode dançar', 'vai dançar',
    'quero que você dance', 'dancinha', 'Tobias, dança!'],
  alongar: ['alonga', 'alongar', 'alongue', 'se espreguiça', 'espreguiçar', 'espreguiça', 'pode se espreguiçar', 'vai alongar', 'alongando', 'se alonga'],
  abanar_rabo: ['abana o rabo', 'abanar', 'abane o rabo', 'balança o rabinho', 'balançar o rabo', 'mexe o rabo', 'abana', 'rabo', 'abana o rabinho',
    'pode abanar o rabo', 'sacode o rabo', 'Tobias, balança o rabinho'],
  cavar: ['cava', 'cavar', 'cave', 'cavando', 'cava um buraco', 'pode cavar', 'vai cavar', 'escava', 'Tobias, cava!'],
  [FRENTE]: ['anda', 'andar', 'ande', 'anda para frente', 'anda pra frente', 'vai pra frente', 'vem', 'caminha', 'caminhar', 'caminhe',
    'pode andar', 'vai andar', 'quero que você ande', 'anda aí', 'vai andando', 'vá para frente', 'pra frente', 'para frente', 'avança', 'andando',
    'Tobias, anda!', 'caminha pra frente'],
  [TRAS]: ['volta', 'anda pra trás', 'anda para trás', 'ré', 'dá ré', 'recua', 'recuar', 'recue', 'vai pra trás', 'volta pra trás', 'anda de ré',
    'vai de ré', 'pra trás', 'caminha pra trás', 'voltar'],
  [ESQ]: ['gira para a esquerda', 'gira pra esquerda', 'vira à esquerda', 'vira a esquerda', 'vire à esquerda', 'girar à esquerda', 'vai pra esquerda',
    'anda para a esquerda', 'pra esquerda', 'volta pra esquerda', 'pode virar à esquerda', 'Tobias, gira pra esquerda'],
  [DIR]: ['gira para a direita', 'gira pra direita', 'vira à direita', 'vira a direita', 'vire à direita', 'girar à direita', 'vai pra direita',
    'anda para a direita', 'pra direita', 'volta pra direita', 'pode virar à direita', 'Tobias, gira pra direita'],
  luz_liga: ['liga a lanterna', 'acende a luz', 'acenda a luz', 'liga o flash', 'ligue a lanterna', 'pode ligar a luz', 'acende', 'liga a luzinha',
    'Tobias, acende a lanterna'],
  luz_desliga: ['apaga', 'apaga a luz', 'desliga o flash', 'desliga a lanterna', 'apague a luz', 'pode apagar a luz', 'desligue a luz', 'apaga o flash']
};
for (const [esperado, frases] of Object.entries(familias)) {
  test(`reconhece variações de ${esperado}`, () => { for (const f of frases) assert.equal(rotulo(f), esperado, f); });
}

test('negações e pedidos para não fazer: não executa nada', () => {
  for (const f of ['não senta', 'Tobias, não dança', 'não anda', 'não deita', 'nunca senta', 'não precisa sentar', 'sem dançar', 'não levanta',
    'não vira à direita', 'não acende a luz', 'não dá a pata', 'quero que você não sente', 'não cava']) assert.equal(rotulo(f), null, f);
});

test('palavras parecidas e conversa comum não acionam nada', () => {
  for (const f of ['assentamento', 'dançarino', 'andaime', 'andaimes', 'a pata do cavalo', 'o pato e a pata', 'vai', 'vai embora', 'gira', 'vira',
    'balança', 'liga', 'desliga', 'o gato senta no sofá', 'ontem eu sentei', 'eu sento no sofá', 'ele dançou a noite toda', 'que horas são',
    'qual é a capital da França', 'bom dia', 'estou com sede', 'a luz está acesa', 'a lanterna acabou a pilha', 'o rabo do cachorro',
    'sentimento', 'levantamento de dados', 'alongamento', 'cavalo', 'cavalheiro', 'esquerda', 'direita', 'para', 'oi tudo bem', 'Tobias',
    'volta amanhã', 'cavaleiro', 'dançante', 'o filho da pata']) assert.equal(rotulo(f), null, f);
});

test('parar continua valendo e não é confundido com os novos comandos', () => {
  for (const s of ['fica parado', 'quietinho', 'Tobias fica quietinha']) assert.ok(isStopPhrase(s, 'Tobias'), s);
  for (const s of ['vem cá', 'anda aí', 'senta aqui', 'para frente', 'volta pra trás', 'dá a pata']) assert.ok(!isStopPhrase(s, 'Tobias'), s);
});

test('vem aqui: 10 passos para frente (único pedido de andar com mais de 3 s)', () => {
  for (const f of ['vem aqui', 'vem cá', 'venha aqui', 'vem pra cá', 'vem até mim', 'Tobias, vem aqui']) {
    const a = interpretar(f.replace(/^Tobias, /, ''));
    assert.equal(a.acao, 'andar', f); assert.equal(a.frente, 1, f); assert.equal(a.passos, 10, f); assert.equal(a.depois, 'sentar', f); assert.ok(a.segundos > 6 && a.segundos <= 7, f);
  }
  assert.equal(interpretar('anda').passos, undefined);
  assert.equal(interpretar('não vem aqui'), null);
});

test('segundosParaPassos: dura pela frequência da marcha ativa, não por um valor fixo', () => {
  const { segundosParaPassos } = require('../public/voice-nlu.js');
  assert.equal(segundosParaPassos(10, 1.25), 8.7);          // marcha 5 (partida): 10 / 1,25 + 0,7 de arranque
  assert.equal(segundosParaPassos(10, 1.5), 7.4);           // marcha 6
  assert.equal(segundosParaPassos(10, 1.6), 7);             // marcha do criador (6,95 arredonda para 7)
  for (const ruim of [undefined, null, NaN, 0, -1, 0.1, 9, '1.5']) assert.equal(segundosParaPassos(10, ruim), 8.7, String(ruim));   // sem frequência válida: 1,25 Hz
});
