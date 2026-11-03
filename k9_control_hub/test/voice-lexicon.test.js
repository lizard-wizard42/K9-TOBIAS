const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../public/i18n/voice-lexicon.js');

const ver = (lang, s) => { const r = V.interpretar(V.removerNome(s, 'Tobias', lang).resto, lang); return r && (r.acao === 'pose' ? r.pose : r.acao === 'luz' ? (r.ligar ? 'luz+' : 'luz-') : r.passos ? 'vem' : `andar ${r.frente} ${r.giro}`); };

const CASOS = {
  en: [['Tobias, sit down', 'sentar'], ['lie down', 'deitar'], ['stand up', 'em_pe'], ['please dance', 'dancar'], ['stretch', 'alongar'], ['wag your tail', 'abanar_rabo'], ['dig', 'cavar'],
    ['give me your paw', 'pata_direita'], ['give me your left paw', 'pata_esquerda'], ['turn on the light', 'luz+'], ['turn off the flashlight', 'luz-'], ['come here', 'vem'],
    ['walk forward', 'andar 1 0'], ['go back', 'andar -1 0'], ['turn left', 'andar 0 -1'], ['turn right', 'andar 0 1']],
  es: [['Tobias, siéntate', 'sentar'], ['échate', 'deitar'], ['levántate', 'em_pe'], ['baila', 'dancar'], ['estírate', 'alongar'], ['mueve la cola', 'abanar_rabo'], ['cava', 'cavar'],
    ['dame la pata', 'pata_direita'], ['da la pata izquierda', 'pata_esquerda'], ['enciende la luz', 'luz+'], ['apaga la linterna', 'luz-'], ['ven aquí', 'vem'],
    ['camina hacia adelante', 'andar 1 0'], ['retrocede', 'andar -1 0'], ['gira a la izquierda', 'andar 0 -1'], ['gira a la derecha', 'andar 0 1']],
  fr: [['Tobias, assis', 'sentar'], ['couche toi', 'deitar'], ['debout', 'em_pe'], ['danse', 'dancar'], ['étire toi', 'alongar'], ['remue la queue', 'abanar_rabo'], ['creuse', 'cavar'],
    ['donne la patte', 'pata_direita'], ['donne la patte gauche', 'pata_esquerda'], ['allume la lumière', 'luz+'], ['éteins la lampe', 'luz-'], ['viens ici', 'vem'],
    ['avance tout droit', 'andar 1 0'], ['recule', 'andar -1 0'], ['tourne à gauche', 'andar 0 -1'], ['tourne à droite', 'andar 0 1']],
  de: [['Tobias, Sitz', 'sentar'], ['Platz', 'deitar'], ['steh auf', 'em_pe'], ['tanz', 'dancar'], ['streck dich', 'alongar'], ['wedel mit dem Schwanz', 'abanar_rabo'], ['grab', 'cavar'],
    ['gib Pfote', 'pata_direita'], ['gib mir die linke Pfote', 'pata_esquerda'], ['mach das Licht an', 'luz+'], ['Licht aus', 'luz-'], ['komm her', 'vem'],
    ['geh vorwärts', 'andar 1 0'], ['geh zurück', 'andar -1 0'], ['dreh dich links', 'andar 0 -1'], ['dreh dich rechts', 'andar 0 1']],
  zh: [['Tobias 坐下', 'sentar'], ['趴下', 'deitar'], ['站起来', 'em_pe'], ['跳舞', 'dancar'], ['伸懒腰', 'alongar'], ['摇尾巴', 'abanar_rabo'], ['挖地', 'cavar'],
    ['握手', 'pata_direita'], ['伸出左爪', 'pata_esquerda'], ['开灯', 'luz+'], ['关灯', 'luz-'], ['过来', 'vem'],
    ['向前走', 'andar 1 0'], ['后退', 'andar -1 0'], ['向左转', 'andar 0 -1'], ['向右转', 'andar 0 1']]
};
for (const [lang, casos] of Object.entries(CASOS)) {
  test(`${lang}: comandos óbvios viram a ação certa`, () => { for (const [fala, esperado] of casos) assert.equal(ver(lang, fala), esperado, `${lang}: ${fala}`); });
}

test('parar vale em qualquer frase, em todos os idiomas, e preposição não para', () => {
  const para = { en: ['stop', 'Tobias stop!', 'please stop walking now', 'halt'], es: ['alto', 'para', 'Tobias, para', 'basta ya'], fr: ['stop', 'arrête', 'Tobias arrête-toi', 'assez'],
    de: ['Stopp', 'halt', 'Tobias, Stopp!', 'genug'], zh: ['停', '停止', '别动', 'Tobias 停下来'] };
  for (const [l, fs] of Object.entries(para)) for (const f of fs) assert.ok(V.isStopPhrase(f, 'Tobias', l), `${l}: ${f}`);
  assert.ok(!V.isStopPhrase('camina para adelante', 'Tobias', 'es'));
  assert.ok(!V.isStopPhrase('steh auf', 'Tobias', 'de'));
  assert.ok(!V.isStopPhrase('sit', 'Tobias', 'en'));
});

test('negação cancela e frase solta não mexe o robô', () => {
  assert.equal(ver('en', "don't sit"), null); assert.equal(ver('es', 'no te sientes'), null); assert.equal(ver('fr', 'ne danse pas'), null);
  assert.equal(ver('de', 'sitz nicht'), null); assert.equal(ver('zh', '不要坐下'), null);
  for (const [l, f] of [['en', 'what is the capital of France'], ['es', 'hola qué tal'], ['fr', 'bonjour'], ['de', 'guten Morgen'], ['zh', '今天天气怎么样']]) assert.equal(ver(l, f), null, f);
});

test('o português continua igual (delega ao K9Voz)', () => {
  assert.equal(ver('pt', 'Tobias senta'), 'sentar'); assert.ok(V.isStopPhrase('pare', 'Tobias', 'pt'));
});

test('nome: citado no meio da frase, e em mandarim', () => {
  assert.equal(V.removerNome('Hey Tobias sit', 'Tobias', 'en').citou, true);
  assert.equal(V.removerNome('Tobias 坐下', 'Tobias', 'zh').citou, true);
  assert.equal(V.removerNome('坐下', 'Tobias', 'zh').citou, false);
});
