/* Configurações › Rede Wi-Fi das placas: troca a rede das pernas ou da câmera pelo hub (POST /api/wifi).
   A senha fica só no campo, nunca em localStorage, e o campo é limpo depois do envio. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const t = (k, ...a) => (window.K9I18n ? window.K9I18n.t(k, ...a) : k);
  const token = new URLSearchParams(location.search).get('token');
  const headers = { 'content-type': 'application/json', ...(token ? { 'x-hub-token': token } : {}) };
  const ERROS = {
    alvo: 'Escolha a placa: pernas ou câmera.',
    ssid: 'Nome da rede inválido (1 a 32 bytes, sem caracteres de controle).',
    senha: 'Senha inválida: use 8 a 63 caracteres, ou deixe vazio para rede aberta.',
    placa_offline: 'Essa placa está offline: não dá para enviar a rede nova.',
    aguarde: 'Aguarde alguns segundos antes de tentar de novo.',
    origem: 'Pedido recusado: origem diferente do painel.',
    unauthorized: 'Token recusado pelo hub. Verifique ?token= na URL.',
    placa: 'A placa recusou a rede nova.',
    sem_resposta: 'A placa não respondeu. Confira se ela está ligada e na rede.'
  };
  let msgKey = null, msgArgs = [];
  const msg = (k, ...a) => { msgKey = k; msgArgs = a; const el = $('wifiMsg'); if (el) el.textContent = k ? t(k, ...a) : ''; };

  async function enviar(e) {
    e.preventDefault();
    const alvo = $('wifiAlvo').value, ssid = $('wifiSsid').value, pass = $('wifiPass').value;
    if (!ssid.trim()) { msg(ERROS.ssid); $('wifiSsid').focus(); return; }
    if (pass && (pass.length < 8 || pass.length > 63)) { msg(ERROS.senha); $('wifiPass').focus(); return; }
    if (!window.confirm(t('Trocar a rede de “{0}”? A placa vai reiniciar e pode ficar fora do ar por alguns segundos.', t(alvo === 'cam' ? 'Câmera' : 'Pernas')))) return;
    $('wifiBtn').disabled = true; msg('Enviando…');
    try {
      const r = await fetch('/api/wifi', { method: 'POST', headers, body: JSON.stringify({ alvo, ssid, pass }) });
      let d = {}; try { d = await r.json(); } catch (_) { /* sem JSON */ }
      if (r.ok && d.ok) { msg('Rede enviada. A placa está reiniciando e vai entrar em “{0}”.', ssid); $('wifiPass').value = ''; }
      else msg(ERROS[d.error] || 'Não deu para trocar a rede (erro {0}).', ...(ERROS[d.error] ? [] : [r.status]));
    } catch (_) { msg('Sem conexão com o hub.'); }
    finally { $('wifiBtn').disabled = false; }
  }

  function init() {
    if (!$('wifiForm')) return;
    $('wifiForm').addEventListener('submit', enviar);
    $('wifiMostrar').addEventListener('change', () => { $('wifiPass').type = $('wifiMostrar').checked ? 'text' : 'password'; });
    document.addEventListener('k9:lang', () => { if (msgKey) msg(msgKey, ...msgArgs); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
