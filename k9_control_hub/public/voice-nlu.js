/* Comandos de voz do K9 em português: uma única fonte para o painel (navegador) e para o Vivo (Node).
   Só reconhece o que é óbvio; na dúvida, não age. Parar é sempre reconhecido primeiro. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.K9Voz = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  // "para" também é preposição ("anda para frente"): só vale como parada em frases curtas e sem outro verbo.
  const FILLER = ['k9', 'robo', 'ei', 'oi', 'ola', 'ok', 'ai', 'ja', 'agora', 'por', 'favor', 'tudo', 'ta', 'bom'];
  const ALWAYS = new Set(['stop', 'chega', 'quieto', 'quieta', 'socorro', 'emergencia', 'pare', 'parar', 'parado', 'parada', 'quietinho', 'quietinha']);
  function isStopPhrase(texto, nome) {
    const w = norm(texto).split(' ').filter(Boolean);
    if (!w.length) return false;
    if (w.some((x) => ALWAYS.has(x))) return true;                                 // pare/chega/stop em QUALQUER frase: falso positivo de parar é barato, falso negativo é perigoso
    const vazios = new Set([...FILLER, ...norm(nome).split(' ').filter(Boolean)]);
    const core = w.filter((x) => !vazios.has(x));
    if (core.length === 1 && core[0] === 'para') return true;                       // "para", "Tobias para", "para tudo"
    return core[0] === 'para' && core[1] === 'de';                                  // "para de andar"
  }

  // O comando citou o nome do robô? Devolve o resto da frase sem o nome ("Tobias, senta" -> "senta").
  function distancia(a, b) {                                                        // Levenshtein
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  // O reconhecedor erra o nome ("to bias", "tobia"): vale o nome exato, duas palavras coladas que formam o nome, ou 1 letra de diferença (nomes de 5+ letras).
  function removerNome(texto, nome) {
    const n = norm(nome).replace(/ /g, ''), t = norm(texto), w = t.split(' ').filter(Boolean);
    if (!n) return { citou: false, resto: t };
    for (let i = 0; i < w.length; i++) {
      if (w[i] === n || (n.length >= 5 && w[i].length >= 4 && distancia(w[i], n) <= 1)) return { citou: true, resto: [...w.slice(0, i), ...w.slice(i + 1)].join(' ') };
      if (i + 1 < w.length && w[i] + w[i + 1] === n) return { citou: true, resto: [...w.slice(0, i), ...w.slice(i + 2)].join(' ') };
    }
    return { citou: false, resto: t };
  }

  // ---- Interpretação de comandos ----
  // Texto normalizado (sem acento, minúsculo). O comando precisa ser o PEDIDO: depois de tirar palavras de
  // introdução ("pode", "quero que você", "vai", "por favor"…), a frase começa pelo verbo. Casamos palavras inteiras,
  // então "assentamento", "dançarino" e "andaime" não contam. Negação em qualquer ponto cancela tudo.
  const NEGACAO = new Set(['nao', 'nunca', 'jamais', 'nem', 'sem']);
  const INTRO = new Set(['pode', 'podes', 'poderia', 'podia', 'quero', 'queria', 'gostaria', 'que', 'voce', 'voces', 'vc', 'eu', 'vai', 'va', 'vamos', 'bora',
    'ja', 'agora', 'entao', 'me', 'se', 'te', 'por', 'favor', 'pf', 'pfv', 'so', 'ai', 'aqui', 'la', 'ta', 'bom', 'ei', 'ok', 'oi', 'ola', 'k9', 'robo', 'e',
    'um', 'uma', 'faz', 'faca', 'fazer', 'fazendo', 'fica', 'fique', 'ficar', 'tenta', 'tente', 'tem', 'precisa', 'sim', 'tudo', 'bem', 'cachorro', 'cachorrinho']);
  const SOBRA = new Set(['ai', 'aqui', 'la', 'ca', 'logo', 'agora', 'ja', 'mais', 'devagar', 'devagarinho', 'depressa', 'rapido', 'rapidinho', 'um', 'uma', 'pouco',
    'pouquinho', 'so', 'de', 'novo', 'mesmo', 'por', 'favor', 'pra', 'para', 'mim', 'bem', 'bastante', 'k9', 'robo']);
  const tirarIntro = (t) => { const w = t.split(' ').filter(Boolean); let i = 0; while (i < w.length && INTRO.has(w[i])) i++; return w.slice(i).join(' '); };
  const ini = (alts) => new RegExp('^(?:' + alts + ')(?: |$)');

  const POSES = [
    [ini('sent(?:a|e|ar|ado|ada|adinho|adinha|ando)|centa'), 'sentar', 'Sentei.'],                                // "centa": erro comum do reconhecedor
    [ini('deit(?:a|e|ar|ado|ada|adinho|adinha|ando)'), 'deitar', 'Deitei.'],
    [ini('levant(?:a|e|ar|ando)|(?:em|de) pe'), 'em_pe', 'Levantei.'],
    [ini('dan[cs](?:a|e|ar|ando|inha)'), 'dancar', 'Lá vai a dança!'],
    [ini('along(?:a|ue|ar|ando)|espreguic(?:a|e|ar|ando)'), 'alongar', 'Ahh, que bom.'],
    [ini('abana|abane|abanar|abanando|(?:balanca|balance|balancar|balancando|mexe|mexa|mexer|sacode|sacuda|sacudir|agita|agite)(?: [a-z0-9]+){0,3}? (?:rabo|rabinho|cauda)'), 'abanar_rabo', 'Abanando!'],
    [ini('cav(?:a|e|ar|ando)|escav(?:a|e|ar|ando)'), 'cavar', 'Cavando.']
  ];

  // "dá a pata": só com verbo de oferecer, ou a palavra sozinha ("pata", "a patinha direita"). "a pata do cavalo" não é pedido.
  const PATA_VERBO = /^(?:(?:da|de|dar|dai|dando) (?:(?:a|uma|sua|essa|minha|aquela) )?(?:pata|patinha|mao|maozinha)|(?:estende|estenda|levanta|levante|levantar|ergue|erga|mostra|mostre|oferece|ofereca) (?:(?:a|uma|sua|essa|minha) )?(?:pata|patinha))(?: |$)/;
  const PATA_SOZINHA = /^(?:(?:a|uma|sua) )?(?:pata|patinha)(?: (direita|esquerda))?$/;
  const PATA_CUMPRIMENTO = /^(?:(?:aperta|aperte|apertar) (?:a|minha) mao|cumprimenta|cumprimente|cumprimentar|acena|acene|acenar)(?: |$)/;
  function pata(r) {
    const m = PATA_VERBO.exec(r), s = PATA_SOZINHA.exec(r);
    if (m) return /^(?:\S+ )?esquerda\b/.test(r.slice(m[0].length)) ? 'pata_esquerda' : 'pata_direita';
    if (s) return s[1] === 'esquerda' ? 'pata_esquerda' : 'pata_direita';
    return PATA_CUMPRIMENTO.test(r) ? 'pata_direita' : null;
  }

  const OBJ_LUZ = '(?:luz|luzinha|lanterna|lanterninha|flash|lampada|farol)';
  const reLuz = (verbos) => new RegExp('^(?:' + verbos + ')(?: [a-z0-9]+){0,3}? ' + OBJ_LUZ + '(?: |$)');
  const LUZ_LIGA = reLuz('liga|ligar|ligue|ligando|acende|acender|acenda|acendendo'), LUZ_DESLIGA = reLuz('desliga|desligar|desligue|desligando|apaga|apagar|apague|apagando');

  // Movimento: o verbo diz o tipo; a direção vem logo depois. Verbo de virar sem lado não age (ambíguo).
  const DIRECOES = { frente: 'F', adiante: 'F', tras: 'B', atras: 'B', re: 'B', esquerda: 'L', direita: 'R' };
  const direcao = (palavras) => { for (const p of palavras.slice(0, 6)) if (DIRECOES[p]) return DIRECOES[p]; return null; };
  const soSobra = (palavras) => palavras.every((p) => SOBRA.has(p));
  const MOV_FRENTE = new Set(['anda', 'andar', 'ande', 'andando', 'caminha', 'caminhar', 'caminhe', 'caminhando', 'avanca', 'avance', 'avancar', 'avancando']);
  const MOV_GIRA = new Set(['gira', 'girar', 'gire', 'girando', 'vira', 'virar', 'vire', 'virando']);
  const MOV_VOLTA = new Set(['volta', 'voltar', 'volte', 'voltando', 'recua', 'recuar', 'recue', 'recuando']);
  const MOV_VEM = new Set(['vem', 'venha', 'vir']);
  const ANDAR = { F: [1, 0, 2, 'Andando.'], B: [-1, 0, 1.5, 'Indo para trás.'], L: [0, -1, 1.5, 'Girando.'], R: [0, 1, 1.5, 'Girando.'] };
  const mover = (d) => ({ acao: 'andar', frente: ANDAR[d][0], giro: ANDAR[d][1], segundos: ANDAR[d][2], fala: ANDAR[d][3] });
  function movimento(r) {
    if (/^(?:da|dar|de|dai) (?:uma )?re(?: |$)/.test(r)) return mover('B');                                         // "dá ré"
    const m = /^(?:(?:pra|para|pro|de) )?(frente|adiante|tras|atras|re|esquerda|direita)$/.exec(r);
    if (m && (/^(?:pra|para|pro|de) /.test(r) || m[1] === 'frente' || m[1] === 're')) return mover(DIRECOES[m[1]]);   // "pra frente", "ré"
    const w = r.split(' '), v = w[0], resto = w.slice(1), d = direcao(resto);
    if (MOV_FRENTE.has(v) || MOV_VEM.has(v)) return d ? mover(d) : soSobra(resto) ? mover('F') : null;
    if (MOV_GIRA.has(v)) return d === 'L' || d === 'R' ? mover(d) : null;
    if (MOV_VOLTA.has(v)) return d ? mover(d) : soSobra(resto) ? mover('B') : null;
    return null;
  }

  function comando(r) {
    if (!r) return null;
    if (LUZ_DESLIGA.test(r) || /^(?:apaga|apague|apagar)$/.test(r)) return { acao: 'luz', ligar: false, fala: 'Apaguei a luz.' };
    if (LUZ_LIGA.test(r) || /^(?:acende|acenda|acender)$/.test(r)) return { acao: 'luz', ligar: true, fala: 'Luz ligada.' };
    const pt = pata(r);
    if (pt) return { acao: 'pose', pose: pt, fala: 'Oi!' };
    if (/^(?:(?:o|um|seu) )?(?:rabo|rabinho)$/.test(r)) return { acao: 'pose', pose: 'abanar_rabo', fala: 'Abanando!' };
    for (const [re, p, fala] of POSES) if (re.test(r)) return { acao: 'pose', pose: p, fala };
    return movimento(r);
  }
  function interpretar(texto) {
    const t = norm(texto);
    if (!t || t.split(' ').some((p) => NEGACAO.has(p))) return null;                                                // "não senta": não faz nada
    // "vem aqui": 10 passos para frente e depois senta. Os 6,7 s abaixo valem para a marcha 6 (1,5 passo/s); o painel recalcula pela marcha ativa (segundosParaPassos).
    if (/^(?:(?:tobias|k9) )?(?:vem|venha|vir) (?:(?:pra|para|ate) )?(?:aqui|ca|aca|mim)$/.test(t)) return { acao: 'andar', frente: 1, giro: 0, segundos: 6.7, passos: 10, depois: 'sentar', fala: 'Indo até você.' };
    const r = tirarIntro(t);
    const direto = comando(r);
    if (direto) return direto;
    if (/^(?:vem|venha) /.test(r)) return comando(tirarIntro(r.replace(/^\S+ /, '')));                              // "vem sentar"
    return null;
  }

  // Quantos segundos andar para dar N passos: 1 passo por ciclo, então N / frequência da marcha ativa (Hz), mais a rampa de amplitude
  // do arranque (~0,7 s com poucos centímetros de avanço). Sem frequência válida, usa 1,25 Hz (marcha 5, a marcha de partida).
  const FREQ_PADRAO_HZ = 1.25, RAMPA_ARRANQUE_S = 0.7;
  function segundosParaPassos(passos, freqHz) {
    const f = Number.isFinite(freqHz) && freqHz >= 0.5 && freqHz <= 3 ? freqHz : FREQ_PADRAO_HZ;
    return Math.round((passos / f + RAMPA_ARRANQUE_S) * 10) / 10;
  }

  // Nome aceito para o robô: 1 a 24 caracteres (letras, números, espaço, hífen, apóstrofo).
  function nomeValido(nome) {
    if (typeof nome !== 'string') return null;                                       // número, objeto, null: não é nome
    const n = nome.normalize('NFC').trim().replace(/\s+/g, ' ');
    return n.length >= 1 && n.length <= 24 && /^[\p{L}\p{N}][\p{L}\p{N} '’-]*$/u.test(n) ? n : null;
  }
  return { norm, isStopPhrase, removerNome, interpretar, nomeValido, segundosParaPassos };
});
