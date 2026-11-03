/* Comandos de voz do K9 em inglês, espanhol, francês, alemão e mandarim. O português continua em voice-nlu.js (K9Voz).
   Mesma ideia do português: só age no que é óbvio; "parar" é reconhecido primeiro e em qualquer frase; negação cancela.
   API: K9VozL.interpretar(texto, lang) · isStopPhrase(texto, nome, lang) · removerNome(texto, nome, lang)
   O resultado de interpretar() tem o mesmo formato do K9Voz (acao: pose | luz | andar). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../voice-nlu.js')); else root.K9VozL = factory(root.K9Voz);
})(typeof self !== 'undefined' ? self : this, function (PT) {
  'use strict';
  // minúsculas, sem acento, letras de qualquer alfabeto mantidas (para o mandarim não sumir), pontuação vira espaço
  const norm = (t) => String(t || '').toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

  const mover = (f, g, s, fala) => ({ acao: 'andar', frente: f, giro: g, segundos: s, fala });
  const POSE = (pose) => ({ acao: 'pose', pose });
  const LUZ = (ligar) => ({ acao: 'luz', ligar });
  const VEM = { acao: 'andar', frente: 1, giro: 0, segundos: 6.7, passos: 10, depois: 'sentar', fala: '' };

  // Cada idioma: stop (palavras que param em qualquer frase), stopCurto (só valem em frase curta), neg, intro (palavras ignoradas no começo),
  // filler (palavras soltas numa frase de parada curta) e regras [regex, resultado] testadas na ordem sobre o texto já sem a introdução.
  const L = {
    en: {
      stop: ['stop', 'halt', 'freeze', 'enough', 'quiet', 'emergency', 'help', 'whoa'],
      stopCurto: [], neg: ['not', 'dont', 'never', 'no', 'without', 'cant'],
      intro: ['please', 'can', 'could', 'would', 'will', 'you', 'now', 'just', 'go', 'ahead', 'hey', 'ok', 'okay', 'k9', 'robot', 'i', 'want', 'to', 'the', 'a', 'let', 'lets', 'then', 'and', 'good', 'boy', 'dog'],
      regras: [
        [/^(?:turn |switch )?(?:off|out)(?: the)? (?:light|lights|flashlight|torch|lamp|flash)(?: |$)|^(?:light|lights|flashlight|torch|lamp|flash) off(?: |$)|^(?:turn|switch) (?:the )?(?:light|lights|flashlight|torch|lamp|flash) off/, LUZ(false)],
        [/^(?:turn |switch )?on(?: the)? (?:light|lights|flashlight|torch|lamp|flash)(?: |$)|^(?:light|lights|flashlight|torch|lamp|flash) on(?: |$)|^(?:turn|switch) (?:the )?(?:light|lights|flashlight|torch|lamp|flash) on|^light up/, LUZ(true)],
        [/^(?:give|offer|raise|lift|shake|hold out)(?: me)?(?: your| a| the| that)? left (?:paw|hand)|^left paw/, POSE('pata_esquerda')],
        [/^(?:give|offer|raise|lift|shake|hold out)(?: me)?(?: your| a| the| that)?(?: right)? (?:paw|hand)|^(?:paw|shake|high five|wave|shake hands)(?: |$)/, POSE('pata_direita')],
        [/^(?:sit|sit down|take a seat)(?: |$)/, POSE('sentar')],
        [/^(?:lie|lay|lie down|lay down|down|get down)(?: |$)/, POSE('deitar')],
        [/^(?:stand|stand up|get up|up|rise)(?: |$)/, POSE('em_pe')],
        [/^(?:dance|dancing)(?: |$)/, POSE('dancar')],
        [/^(?:stretch|stretching)(?: |$)/, POSE('alongar')],
        [/^(?:wag|wiggle|shake|swish)(?: your)? tail|^(?:wag|wagging)(?: |$)/, POSE('abanar_rabo')],
        [/^(?:dig|digging)(?: |$)/, POSE('cavar')],
        [/^(?:come here|come over|come|here boy|here)(?: |$)/, VEM],
        [/^(?:turn|spin|rotate)(?: around)?(?: to the| to| towards)? left|^left(?: turn)?$/, mover(0, -1, 1.5, '')],
        [/^(?:turn|spin|rotate)(?: around)?(?: to the| to| towards)? right|^right(?: turn)?$/, mover(0, 1, 1.5, '')],
        [/^(?:go |move |walk |step |come )?(?:back|backward|backwards|reverse)(?: |$)|^(?:back up|reverse)(?: |$)/, mover(-1, 0, 1.5, '')],
        [/^(?:go |move |walk |step |come )?(?:forward|forwards|ahead|straight)(?: |$)|^(?:walk|go|move|run)$/, mover(1, 0, 2, '')]
      ]
    },
    es: {
      stop: ['stop', 'alto', 'basta', 'detente', 'detener', 'frena', 'frenar', 'socorro', 'emergencia', 'quieto', 'quieta', 'quietecito'],
      stopCurto: ['para', 'pare', 'parar'], neg: ['no', 'nunca', 'jamas', 'ni', 'sin'],
      intro: ['por', 'favor', 'puedes', 'podrias', 'quiero', 'que', 'tu', 'ahora', 'ya', 'vamos', 'oye', 'ey', 'hola', 'ok', 'k9', 'robot', 'un', 'una', 'el', 'la', 'a', 've', 'y', 'entonces', 'perro', 'perrito', 'bien', 'venga'],
      regras: [
        [/^(?:apaga|apagar|apague|desactiva|desactivar)(?: [a-z0-9]+){0,2}? (?:luz|linterna|lampara|flash|foco)(?: |$)|^apaga$/, LUZ(false)],
        [/^(?:enciende|encender|encienda|prende|prender|activa|activar)(?: [a-z0-9]+){0,2}? (?:luz|linterna|lampara|flash|foco)(?: |$)|^enciende$/, LUZ(true)],
        [/^(?:da|dame|dar|ofrece|levanta|levantar|estira|estirar|muestra)(?: me)?(?: la| una| tu| esa)? (?:pata|patita|mano)(?: [a-z]+)? izquierda|^pata izquierda/, POSE('pata_esquerda')],
        [/^(?:da|dame|dar|ofrece|levanta|levantar|estira|estirar|muestra)(?: me)?(?: la| una| tu| esa)? (?:pata|patita|mano)(?: |$)|^(?:pata|patita|choca|saluda|saludar)(?: |$)/, POSE('pata_direita')],
        [/^(?:sientate|siente|sentarse|sentar|sentado|siéntate)(?: |$)|^sient(?:a|ate|ese)(?: |$)/, POSE('sentar')],
        [/^(?:echate|acuestate|tumbate|echarse|acostarse|tumbarse|tumbado|acostado|abajo)(?: |$)/, POSE('deitar')],
        [/^(?:levantate|levantarse|levanta|ponte de pie|de pie|parate|arriba)(?: |$)/, POSE('em_pe')],
        [/^(?:baila|bailar|bailando|danza)(?: |$)/, POSE('dancar')],
        [/^(?:estirate|estirar|estira|estiramiento)(?: |$)/, POSE('alongar')],
        [/^(?:mueve|menea|agita|mover|menear|sacude)(?: [a-z]+){0,2}? cola|^(?:colita|cola)$/, POSE('abanar_rabo')],
        [/^(?:cava|cavar|excava|excavar)(?: |$)/, POSE('cavar')],
        [/^(?:ven|ven aqui|ven aca|venir|acercate|ven conmigo)(?: |$)/, VEM],
        [/^(?:gira|girar|da la vuelta|voltea|dobla|vira|gira hacia)(?: [a-z]+){0,3}? izquierda|^izquierda$/, mover(0, -1, 1.5, '')],
        [/^(?:gira|girar|da la vuelta|voltea|dobla|vira|gira hacia)(?: [a-z]+){0,3}? derecha|^derecha$/, mover(0, 1, 1.5, '')],
        [/^(?:retrocede|retroceder|reversa|marcha atras|ve atras|anda atras|camina atras|atras)(?: |$)/, mover(-1, 0, 1.5, '')],
        [/^(?:anda|andar|camina|caminar|avanza|avanzar|ve|ir)(?: [a-z]+){0,2}? (?:adelante|delante|frente|recto|derecho)(?: |$)|^(?:adelante|avanza|camina|anda)$/, mover(1, 0, 2, '')]
      ]
    },
    fr: {
      stop: ['stop', 'stoppe', 'stoppez', 'arrete', 'arretes', 'arretez', 'halte', 'assez', 'urgence', 'secours', 'immobile', 'bouge pas'],
      stopCurto: [], neg: ['pas', 'jamais', 'non', 'sans', 'ne', 'ni'],
      intro: ['s', 'il', 'te', 'plait', 'peux', 'tu', 'veux', 'voudrais', 'maintenant', 'allez', 'vas', 'va', 'hey', 'salut', 'ok', 'k9', 'robot', 'un', 'une', 'le', 'la', 'et', 'alors', 'chien', 'chienchien', 'bien', 'bon', 'je', 'que', 'tu', 'me'],
      regras: [
        [/^(?:eteins|eteindre|eteignez|coupe|couper)(?: [a-z0-9]+){0,2}? (?:lumiere|lampe|torche|flash|lanterne)(?: |$)|^eteins$/, LUZ(false)],
        [/^(?:allume|allumer|allumez|active|activer)(?: [a-z0-9]+){0,2}? (?:lumiere|lampe|torche|flash|lanterne)(?: |$)|^allume$/, LUZ(true)],
        [/^(?:donne|donnez|tends|tendre|leve|lever|montre)(?: moi)?(?: la| ta| une)? (?:patte|main)(?: [a-z]+)? gauche|^patte gauche/, POSE('pata_esquerda')],
        [/^(?:donne|donnez|tends|tendre|leve|lever|montre)(?: moi)?(?: la| ta| une)? (?:patte|main)(?: |$)|^(?:patte|salue|saluer|serre moi la main|coucou)(?: |$)/, POSE('pata_direita')],
        [/^(?:assis|assieds|assois|assoir|asseois|asseyez)(?: |$)|^assis toi|^assieds toi/, POSE('sentar')],
        [/^(?:couche|couchez|allonge|allongez|couche toi|allonge toi|couchee|couches)(?: |$)/, POSE('deitar')],
        [/^(?:debout|leve toi|releve toi|lever|releve|leve)(?: |$)/, POSE('em_pe')],
        [/^(?:danse|danser|dansez|dansant)(?: |$)/, POSE('dancar')],
        [/^(?:etire|etirer|etire toi|etirement|etirez)(?: |$)/, POSE('alongar')],
        [/^(?:remue|agite|secoue|remuer|agiter|frétille|fretille)(?: [a-z]+){0,2}? queue|^queue$/, POSE('abanar_rabo')],
        [/^(?:creuse|creuser|creusez)(?: |$)/, POSE('cavar')],
        [/^(?:viens|venez|venir|approche)(?: ici| la)?$|^viens ici|^viens la/, VEM],
        [/^(?:tourne|tournez|tourner|vire|pivote)(?: [a-z]+){0,3}? gauche|^gauche$/, mover(0, -1, 1.5, '')],
        [/^(?:tourne|tournez|tourner|vire|pivote)(?: [a-z]+){0,3}? droite|^droite$/, mover(0, 1, 1.5, '')],
        [/^(?:recule|reculer|reculez|marche arriere|en arriere|arriere)(?: |$)/, mover(-1, 0, 1.5, '')],
        [/^(?:avance|avancer|avancez|marche|marcher|va|aller)(?: [a-z]+){0,2}? (?:devant|avant|droit|tout droit)(?: |$)|^(?:avance|en avant|marche)$/, mover(1, 0, 2, '')]
      ]
    },
    de: {
      stop: ['stop', 'stopp', 'halt', 'anhalten', 'notaus', 'hilfe', 'genug', 'ruhig', 'aufhoren', 'nicht bewegen'],
      stopCurto: [], neg: ['nicht', 'nie', 'niemals', 'kein', 'keine', 'ohne'],
      intro: ['bitte', 'kannst', 'du', 'koennte', 'konntest', 'jetzt', 'mal', 'mach', 'machen', 'hey', 'hallo', 'ok', 'k9', 'roboter', 'ein', 'eine', 'den', 'die', 'das', 'und', 'dann', 'hund', 'hundchen', 'brav', 'ich', 'will', 'moechte', 'dich', 'zu', 'lass', 'uns', 'gehe', 'geh'],
      regras: [
        [/^(?:mach|schalte|schalt|mache)(?: [a-z]+){0,2}? (?:licht|lampe|taschenlampe|blitz)(?: [a-z]+)? aus|^(?:licht|lampe|taschenlampe) aus|^lichter aus/, LUZ(false)],
        [/^(?:mach|schalte|schalt|mache)(?: [a-z]+){0,2}? (?:licht|lampe|taschenlampe|blitz)(?: [a-z]+)? an|^(?:licht|lampe|taschenlampe) an|^lichter an|^leuchte/, LUZ(true)],
        [/^(?:gib|gebe|reich|heb|hebe|zeig)(?: mir)?(?: die| deine| eine)? linke (?:pfote|hand)|^linke pfote/, POSE('pata_esquerda')],
        [/^(?:gib|gebe|reich|heb|hebe|zeig)(?: mir)?(?: die| deine| eine)?(?: rechte)? (?:pfote|hand)|^(?:pfote|pfotchen|winke|winken|high five|gib pfote)(?: |$)/, POSE('pata_direita')],
        [/^(?:sitz|setz dich|setz|hinsetzen|sitzen|setzen|mach sitz)(?: |$)/, POSE('sentar')],
        [/^(?:platz|leg dich|leg dich hin|hinlegen|legen|leg|mach platz)(?: |$)/, POSE('deitar')],
        [/^(?:steh auf|aufstehen|steh|stehen|auf|steh gerade)(?: |$)/, POSE('em_pe')],
        [/^(?:tanz|tanze|tanzen|tanzt)(?: |$)/, POSE('dancar')],
        [/^(?:streck dich|strecken|streck|strecke|dehn dich|dehnen|dehne)(?: |$)/, POSE('alongar')],
        [/^(?:wedel|wedle|wedeln|schwanz wedeln|wackel|wackle)(?: [a-z]+){0,2}? schwanz|^(?:wedel|wedle|wedeln)$|^schwanz$/, POSE('abanar_rabo')],
        [/^(?:grab|grabe|graben|buddel|buddle|buddeln)(?: |$)/, POSE('cavar')],
        [/^(?:komm her|komm|komme|hierher|komm zu mir|her)(?: |$)/, VEM],
        [/^(?:dreh|drehe|drehen|wende|wenden)(?: [a-z]+){0,3}? links|^links$/, mover(0, -1, 1.5, '')],
        [/^(?:dreh|drehe|drehen|wende|wenden)(?: [a-z]+){0,3}? rechts|^rechts$/, mover(0, 1, 1.5, '')],
        [/^(?:ruckwarts|zuruck|geh zuruck|lauf zuruck|rueckwaerts|ruckwaerts)(?: |$)|^(?:geh|lauf|gehe|laufe)(?: [a-z]+){0,2}? (?:ruckwarts|zuruck)/, mover(-1, 0, 1.5, '')],
        [/^(?:geh|lauf|gehe|laufe|geh nach|lauf nach|vorwarts|vorwaerts|vorne|geradeaus|laufen|gehen)(?: [a-z]+){0,2}? (?:vorne|vorwarts|vorwaerts|geradeaus|vor)(?: |$)|^(?:vorwarts|vorwaerts|geradeaus|vor|geh|lauf|laufen|gehen)$/, mover(1, 0, 2, '')]
      ]
    },
    zh: { // sem espaços: as regras procuram trechos dentro da frase
      stop: ['停', '停止', '别动', '不要动', '急停', '站住', '够了', '救命', '紧急', '不许动'],
      stopCurto: [], neg: ['不', '别', '没', '勿', '莫'],
      intro: [],
      regras: [
        [/关.{0,2}(灯|手电|灯光|闪光)|灭灯|熄灯/, LUZ(false)],
        [/(开|打开|点亮|亮).{0,2}(灯|手电|灯光|闪光)/, LUZ(true)],
        [/(左爪|左手|左脚|左前爪)|(伸|抬|举|给).{0,3}左/, POSE('pata_esquerda')],
        [/握手|伸爪|伸出爪|抬爪|举爪|给我爪|打招呼|爪子|右爪|挥手/, POSE('pata_direita')],
        [/坐下|坐好|坐|蹲下/, POSE('sentar')],
        [/趴下|躺下|卧倒|卧下|趴/, POSE('deitar')],
        [/站起来|站起|起立|站好|起来|站直/, POSE('em_pe')],
        [/跳舞|跳个舞|舞蹈|扭一扭/, POSE('dancar')],
        [/伸懒腰|伸展|拉伸|舒展/, POSE('alongar')],
        [/摇尾巴|摇摇尾巴|摆尾巴|摇尾/, POSE('abanar_rabo')],
        [/挖地|挖|刨/, POSE('cavar')],
        [/过来|来这里|到这边来|来我这|过来这里|过来吧/, VEM],
        [/(向|往|朝)?左转|转左|向左|往左/, mover(0, -1, 1.5, '')],
        [/(向|往|朝)?右转|转右|向右|往右/, mover(0, 1, 1.5, '')],
        [/后退|往后|倒退|退后|向后/, mover(-1, 0, 1.5, '')],
        [/前进|向前|往前|往前走|向前走|走吧|^走$|^走路$|散步/, mover(1, 0, 2, '')]
      ]
    }
  };

  const palavras = (t) => norm(t).split(' ').filter(Boolean);
  const emPt = (lang) => !lang || lang === 'pt' || !L[lang];

  function isStopPhrase(texto, nome, lang) {
    if (emPt(lang)) return PT.isStopPhrase(texto, nome);
    const d = L[lang], t = norm(texto);
    if (!t) return false;
    if (lang === 'zh') return d.stop.some((s) => t.includes(s));
    const w = t.split(' ');
    if (d.stop.some((s) => (s.includes(' ') ? t.includes(s) : w.includes(s)))) return true;       // parar em QUALQUER frase: falso positivo é barato
    if (d.stopCurto.length) {
      const vazios = new Set([...d.intro, 'k9', 'robot', ...norm(nome).split(' ')]);
      const core = w.filter((x) => !vazios.has(x));
      if (core.length === 1 && d.stopCurto.includes(core[0])) return true;
    }
    return false;
  }

  function removerNome(texto, nome, lang) {
    if (lang !== 'zh') return PT.removerNome(texto, nome);                    // letras latinas: mesma lógica do português (1 letra de diferença, palavras coladas)
    const n = norm(nome).replace(/ /g, ''), t = norm(texto).replace(/ /g, '');
    const i = n ? t.indexOf(n) : -1;                                          // o reconhecedor chinês costuma escrever o nome em letras latinas: aceita como trecho
    return i < 0 ? { citou: false, resto: t } : { citou: true, resto: t.slice(0, i) + t.slice(i + n.length) };
  }

  function interpretar(texto, lang) {
    if (emPt(lang)) return PT.interpretar(texto);
    const d = L[lang], t = norm(texto);
    if (!t) return null;
    if (lang === 'zh') {
      const nt = t.replace(/ /g, '');
      if (d.neg.some((x) => nt.includes(x))) return null;
      for (const [re, r] of d.regras) if (re.test(nt)) return { ...r };
      return null;
    }
    const w = t.split(' ');
    if (w.some((x) => d.neg.includes(x))) return null;
    let i = 0; const intro = new Set(d.intro);
    while (i < w.length && intro.has(w[i])) i++;
    const r = w.slice(i).join(' ');
    if (!r) return null;
    for (const [re, res] of d.regras) if (re.test(r)) return { ...res };
    return null;
  }

  return { norm, interpretar, isStopPhrase, removerNome, LANGS: Object.keys(L) };
});
