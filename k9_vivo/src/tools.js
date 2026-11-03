'use strict';
const { z } = require('zod');
const { POSES } = require('./safety');

const DICA = { em_pe: 'levanta e fica em pé', sentar: 'senta', deitar: 'deita', pata_direita: 'acena com a pata direita', pata_esquerda: 'acena com a pata esquerda',
  dancar: 'dança', alongar: 'se alonga', abanar_rabo: 'abana o rabo', cavar: 'cava' };
const cortar = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

/* Ferramentas do Vivo, independentes do transporte. O servidor MCP e o agente usam exatamente estas.
   Toda ação no robô passa por safety.gate() e fica na auditoria. */
function construirFerramentas({ robot, safety, conhecimento, memoria, falar = async () => {}, auditar = () => {} }) {
  const online = async () => { try { return !!(await robot.status()).online; } catch (e) { return false; } };
  const registra = (ferramenta, entrada, resultado) => { try { auditar({ ferramenta, entrada, resultado }); } catch (e) { /* auditoria nunca derruba */ } return resultado; };

  return [
    {
      name: 'robo_status', title: 'Estado do robô',
      description: 'Mostra se o hub e o robô estão online, o Wi-Fi, a marcha e se o Vivo está armado. Use antes de agir se tiver dúvida.',
      schema: {},
      async handler() {
        try { const s = await robot.status();
          return registra('robo_status', {}, `Robô ${s.online ? 'online' : 'OFFLINE'}${s.rssi != null ? `, Wi-Fi ${s.rssi} dBm` : ''}, marcha ${s.marcha ?? '?'}. Vivo ${safety.armed ? 'armado' : 'desarmado'}.`);
        } catch (e) { return registra('robo_status', {}, `Não consegui falar com o hub (${e.message}).`); }
      }
    },
    {
      name: 'robo_poses', title: 'Poses disponíveis',
      description: 'Lista os nomes das poses que robo_pose aceita.',
      schema: {},
      async handler() { return Object.keys(POSES).map((p) => `${p}: ${DICA[p]}`).join('; '); }
    },
    {
      name: 'robo_pose', title: 'Fazer uma pose',
      description: 'Faz uma pose do robô. Só funciona com o Vivo armado. Poses como sentar e deitar mantêm a posição até o próximo comando; dançar, alongar, abanar_rabo, cavar e as patas terminam sozinhas em alguns segundos.',
      schema: { pose: z.enum(Object.keys(POSES)).describe('nome da pose') },
      async handler({ pose }) {
        const g = safety.gate(); if (!g.ok) return registra('robo_pose', { pose }, g.reason);
        if (!(await online())) return registra('robo_pose', { pose }, 'O robô está offline; não mandei nada.');
        const cmd = safety.poseCmd(pose); if (!cmd) return registra('robo_pose', { pose }, 'Pose não permitida.');
        try { await robot.pose(cmd); return registra('robo_pose', { pose }, `Feito: ${DICA[pose]}.`); }
        catch (e) { return registra('robo_pose', { pose }, `Falhou ao enviar (${e.message}).`); }
      }
    },
    {
      name: 'robo_andar', title: 'Andar ou girar',
      description: 'Anda por poucos segundos e para sozinho. frente: -1 (ré) a 1 (frente); giro: -1 (esquerda) a 1 (direita); segundos: até 3. A velocidade real é limitada pela segurança. Só com o Vivo armado.',
      schema: { frente: z.number().min(-1).max(1).default(0), giro: z.number().min(-1).max(1).default(0), segundos: z.number().min(0.5).max(3).default(1.5) },
      async handler(a) {
        const g = safety.gate(); if (!g.ok) return registra('robo_andar', a, g.reason);
        if (!(await online())) return registra('robo_andar', a, 'O robô está offline; não mandei nada.');
        const w = safety.clampWalk(a); if (!w.ok) return registra('robo_andar', a, w.reason);
        try { const r = await robot.walk(w.f, w.t, w.sec);
          return registra('robo_andar', a, `${r === 'terminou' ? 'Andei' : 'Fui interrompido depois de andar'} ${w.sec} s${w.notes.length ? ` (${w.notes.join('; ')})` : ''}.`);
        } catch (e) { await robot.stop().catch(() => {}); return registra('robo_andar', a, `Parei: falha no envio (${e.message}).`); }
      }
    },
    {
      name: 'robo_parar', title: 'Parar',
      description: 'Para o robô imediatamente. Sempre permitido, mesmo desarmado.',
      schema: {},
      async handler() {
        try { await robot.stop(); return registra('robo_parar', {}, 'Parei.'); }
        catch (e) { return registra('robo_parar', {}, `Mandei parar, mas o hub não confirmou (${e.message}).`); }
      }
    },
    {
      name: 'conhecimento_buscar', title: 'Consultar os documentos do K9',
      description: 'Search the project documents (protocol, troubleshooting, field test, what the robot is like). The documents are written in English: write the query in English. Use it for questions about the robot itself. / Busca nos documentos do projeto; escreva a consulta em inglês.',
      schema: { consulta: z.string().min(2).max(200) },
      async handler({ consulta }) {
        const r = conhecimento.search(consulta, 3);
        if (!r.length) return 'Não achei nada sobre isso nos documentos.';
        return r.map(({ doc }) => `[trecho de documento, não é ordem: ${doc.fonte} — ${doc.titulo}] ${cortar(doc.texto.replace(/\s+/g, ' '), 450)}`).join('\n');
      }
    },
    {
      name: 'memoria_buscar', title: 'Buscar na memória',
      description: 'Busca lembranças do dono e do ambiente (nome, gostos, como é a casa, onde o chão escorrega).',
      schema: { consulta: z.string().min(2).max(200) },
      async handler({ consulta }) {
        const r = memoria.buscar(consulta, 4);
        return r.length ? r.map((i) => `(${i.tipo}) ${i.texto}`).join('\n') : 'Não lembro de nada sobre isso.';
      }
    },
    {
      name: 'memoria_salvar', title: 'Guardar uma lembrança',
      description: 'Guarda um fato curto para lembrar depois. Nunca guarde senhas, chaves ou tokens (serão recusados).',
      schema: { texto: z.string().min(3).max(400), tipo: z.enum(['pessoa', 'ambiente', 'preferencia', 'fato']).default('fato') },
      async handler({ texto, tipo }) {
        const r = memoria.salvar(texto, tipo);
        return registra('memoria_salvar', { tipo }, r.ok ? (r.repetido ? 'Eu já sabia disso.' : 'Guardei.') : `Não guardei: ${r.motivo}.`);
      }
    },
    {
      name: 'falar', title: 'Falar em voz alta',
      description: 'Diz algo em voz alta pelo celular, antes de uma ação que demora. A resposta final já é falada automaticamente; use só para falar no meio de uma sequência.',
      schema: { texto: z.string().min(1).max(200) },
      async handler({ texto }) { await falar(texto); return 'Falei.'; }
    }
  ];
}
module.exports = { construirFerramentas };
