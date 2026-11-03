/**
 * Minirobo K9V2.1 — Central de Controle Local
 * - Ponte Ultra-Rápida WebSocket <-> UDP (50Hz, ~2-5ms latência)
 * - Ponte MQTT opcional (v1/devices/K9V21/cmd/# e /tele)
 * - Auto-Discovery do ESP32-CAM na LAN (k9.local + Broadcast UDP 4210)
 *
 * Segurança: comandos validados por whitelist, números limitados, origem do
 * WebSocket restrita à própria página, token opcional (HUB_TOKEN) e failsafe
 * que para o robô se o cliente que dirige sumir.
 */

const express = require('express');
const { gaitPacket, rearPacket } = require('./gait-params');
const { createCameraRelay } = require('./camera-relay');
const { criarNome } = require('./robot-name');
const http = require('http');
const dgram = require('dgram');
const dns = require('dns');
const net = require('net');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');
const { validarWifi, enviarWifi } = require('./wifi-config');

let mqtt = null;
try {
  mqtt = require('mqtt');
} catch (_) {
  // Opcional se não instalado
}

const PORT = Number(process.env.PORT) || 3080;
const HOST = process.env.HOST || '0.0.0.0';
const K9_UDP_PORT = 4210;
const DEVICE_CODE = /^[A-Za-z0-9_-]+$/.test(process.env.DEVICE_CODE || '') ? process.env.DEVICE_CODE : 'K9V21';
const CAM_DEVICE_CODE = 'K9CAM';          // ESP32-CAM: camera + flashlight only
const MQTT_URL = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const HUB_TOKEN = process.env.HUB_TOKEN || '';

const DRIVE_WATCHDOG_MS = 400;      // sem drive novo por isso => manda parada
const TELEMETRY_EMIT_MS = 100;      // máx 10 Hz para os navegadores
const MQTT_TELE_MS = 500;           // máx 2 Hz para o broker
const FLASH_AUTO_OFF_MS = 5 * 60 * 1000;

// ─── Validação compartilhada (socket, REST e MQTT passam por aqui) ───────────
const CMDS = new Set([
  ...Array.from({length:21}, (_, i) => `sound_volume_${i * 5}`),
  'emotion_happy', 'emotion_sad', 'emotion_confused', 'emotion_angry', 'emotion_curious', 'emotion_laugh',
  'sound_mute', 'sound_unmute', 'sound_auto_on', 'sound_auto_off',
  'sound_wake', 'sound_spell', 'sound_sad', 'sound_laugh', 'sound_crazy',
  'sound_beep', 'sound_hello', 'sound_alert', 'sound_robot', 'sound_whistle', 'sound_pulse', 'sound_march', 'sound_arcade', 'sound_cosmos', 'sound_alarm', 'sound_stop',
  'jog0plus', 'jog0less', 'jog1plus', 'jog1less', 'jog2plus', 'jog2less', 'jog3plus', 'jog3less',
  'wake', 'sleep', 'emotion_shy', 'emotion_celebrate', 'emotion_greet', 'emotion_glitch',
  'stop', 'stand', 'sit', 'lie', 'wave', 'waveleft', 'getup', 'dance', 'cal', 'gait', 'gait1', 'gait2', 'gait3', 'gait4', 'gait5', 'gait6',
  'bow', 'stretch', 'wag', 'dig', 'wiggle', 'scratch', 'beg',
  'flash', 'flashon', 'flashoff', 'test0', 'test1', 'test2', 'test3'
]);
const clamp = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0;
};

function buildUdp(kind, a = {}) {
  switch (kind) {
    case 'drive':
      return `D ${clamp(a.fwd, -1, 1).toFixed(2)} ${clamp(a.turn, -1, 1).toFixed(2)}`;
    case 'trim': {
      const leg = Number(a.leg);
      if (!Number.isInteger(leg) || leg < 0 || leg > 3) return null;
      return `T ${leg} ${Math.round(clamp(a.delta, -50, 50))}`;
    }
    case 'flash':
      return `L ${Math.round(clamp(a.level, 0, 100))}`;
    case 'cmd':
      return typeof a.cmd === 'string' && CMDS.has(a.cmd) ? `C ${a.cmd}` : null;
    default:
      return null;
  }
}

const app = express();
app.disable('x-powered-by');
const httpServer = http.createServer(app);

const lanIp = getLocalLanIp();
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, `http://${lanIp}:${PORT}`
]);
const io = new Server(httpServer, {
  cors: { origin: [...ALLOWED_ORIGINS] },
  allowRequest: (req, cb) => {
    const origin = req.headers.origin;
    cb(null, !origin || ALLOWED_ORIGINS.has(origin));   // sem Origin = ferramentas locais
  }
});

// Vivo (IA) pela rede: o gateway continua só em 127.0.0.1:3090; o hub repassa o WebSocket em /vivo.
// Assim o app do celular fala com UMA porta (3080) pelo Wi-Fi, sem adb reverse.
const { WebSocketServer, WebSocket: WsCliente } = require('ws');
const VIVO_URL = process.env.VIVO_WS || 'ws://127.0.0.1:3090/ws';
const vivoPonte = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
httpServer.on('upgrade', (req, socket, head) => {
  if (!/^\/vivo(\?|$)/.test(req.url || '')) return;                       // o resto é do socket.io
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) { socket.destroy(); return; } // navegador de outro site: não
  vivoPonte.handleUpgrade(req, socket, head, (cli) => {
    const gw = new WsCliente(VIVO_URL, { headers: { Host: 'localhost:3090' } });
    const fila = [];
    cli.on('message', (d, bin) => { if (gw.readyState === WsCliente.OPEN) gw.send(d, { binary: bin }); else if (fila.length < 20) fila.push([d, bin]); });
    gw.on('open', () => { for (const [d, bin] of fila.splice(0)) gw.send(d, { binary: bin }); });
    gw.on('message', (d, bin) => { if (cli.readyState === WsCliente.OPEN) cli.send(d, { binary: bin }); });
    const fecha = () => { try { cli.close(); } catch (_) {} try { gw.close(); } catch (_) {} };
    gw.on('close', fecha); gw.on('error', fecha); cli.on('close', fecha); cli.on('error', fecha);
  });
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '4kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function tokenOk(provided) {
  return !HUB_TOKEN || provided === HUB_TOKEN;
}
io.use((socket, next) => {
  tokenOk(socket.handshake.auth && socket.handshake.auth.token)
    ? next() : next(new Error('unauthorized'));
});

// ─── Estado do Robô e Rede ───────────────────────────────────────────────────
const RobotState = {
  ip: net.isIPv4(process.env.K9_IP || '') ? process.env.K9_IP : null,
  online: false,
  lastSeenMs: 0,
  rttMs: 0,
  lastPingSentMs: 0,
  cam: { ip: null, lastSeenMs: 0, flash: 0, preset: 1, strobe: 0, opt: [0, 0, 0, 0, 12] },   // the camera/flashlight board
  telemetry: {
    device: DEVICE_CODE,
    ip: 'Procurando...',
    ssid: '-',
    rssi: 0,
    uptime: 0,
    fwd: 0,
    turn: 0,
    gait: 1,
    hold: false,
    flash: 0,
    trim: [1500, 1500, 1500, 1500],
    us: [1500, 1500, 1500, 1500],
    deg: [0, 0, 0, 0]
  }
};

// ─── Socket UDP para Comunicação Instantânea (Porta 4210) ────────────────────
const udpSocket = dgram.createSocket('udp4');

udpSocket.on('error', (err) => {
  console.error('[UDP] erro:', err.message);
});

udpSocket.on('listening', () => {
  udpSocket.setBroadcast(true);
  const addr = udpSocket.address();
  console.log(`[UDP] Escutando respostas do K9 na porta ${addr.port}`);
});

const isNumArray = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);

function sanitizeTelemetry(d) {
  const out = {};
  out.firmwareVersion = typeof d.firmwareVersion === "string" ? d.firmwareVersion.slice(0, 32) : null;
  if (typeof d.ssid === 'string') out.ssid = d.ssid.slice(0, 40);
  for (const k of ['rssi', 'uptime', 'fwd', 'turn', 'gait', 'controlsVersion']) {
    if (Number.isFinite(d[k])) out[k] = d[k];
  }
  if (Number.isFinite(d.flash)) out.flash = Math.round(clamp(d.flash, 0, 100));
  if (isNumArray(d.gaitParams, 5)) out.gaitParams = d.gaitParams;
  if (Number.isFinite(d.rearDuty)) out.rearDuty = d.rearDuty;          // firmware 1.1.0+: rear-return variation
  if (isNumArray(d.phase, 4)) out.phase = d.phase;
  if (Number.isInteger(d.activity) && d.activity >= -1 && d.activity <= 25) out.activity = d.activity;
  if (Number.isFinite(d.activityTime) && d.activityTime >= 0) out.activityTime = d.activityTime;
  if (typeof d.hold === 'boolean') out.hold = d.hold;
  if (typeof d.soundMusic === 'string' && (d.soundMusic === '' || /^sound_(pulse|march|arcade|cosmos|alarm)$/.test(d.soundMusic))) out.soundMusic = d.soundMusic;
  if (Number.isInteger(d.soundVolume) && d.soundVolume >= 0 && d.soundVolume <= 100 && d.soundVolume % 5 === 0) out.soundVolume = d.soundVolume;
  for (const k of ['soundMuted', 'soundAutomatic']) if (typeof d[k] === 'boolean') out[k] = d[k];
  for (const k of ['trim', 'us', 'deg']) {
    if (isNumArray(d[k], 4)) out[k] = d[k];
  }
  return out;
}

let lastTeleEmitMs = 0;
let lastMqttTeleMs = 0;
let teleTrailing = null;
// Limita a 10 Hz, mas nunca perde o ÚLTIMO estado: um pacote que cai dentro da janela de 100 ms (por exemplo o que
// confirma a troca de marcha) agora é reenviado no fim da janela. Antes ele era descartado e o painel só se corrigia no F5.
function emitTelemetry(now) {
  if (now - lastTeleEmitMs >= TELEMETRY_EMIT_MS) {
    lastTeleEmitMs = now; clearTimeout(teleTrailing); teleTrailing = null;
    io.emit('k9:telemetry', telemetryPayload());
  } else if (!teleTrailing) {
    teleTrailing = setTimeout(() => { teleTrailing = null; lastTeleEmitMs = Date.now(); io.emit('k9:telemetry', telemetryPayload()); },
      TELEMETRY_EMIT_MS - (now - lastTeleEmitMs) + 5);
  }
}

udpSocket.on('message', (msg, rinfo) => {
  const text = msg.toString().trim();
  const now = Date.now();

  if (!text.startsWith('{')) {
    // ACK de comando: só aceita do robô conhecido, e não repassa o spam dos "D"
    if (rinfo.address === RobotState.ip && text !== 'ACK_D') {
      io.emit('k9:ack', { reply: text.slice(0, 80) });
    }
    return;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    return; // JSON parcial
  }
  if (!data) return;
  if (data.device === CAM_DEVICE_CODE) {               // placa da câmera + lanterna
    RobotState.cam.firmwareVersion = typeof data.firmwareVersion === "string" ? data.firmwareVersion.slice(0, 32) : null;
    RobotState.cam.ip = rinfo.address;
    RobotState.cam.lastSeenMs = now;
    RobotState.cam.rssi = Number.isFinite(data.rssi) ? data.rssi : null;
    RobotState.cam.uptime = Number.isFinite(data.uptime) ? data.uptime : null;
    RobotState.cam.flash = Number.isFinite(data.flash) ? Math.round(clamp(data.flash, 0, 100)) : 0;
    if (Array.isArray(data.opt) && data.opt.length === 5 && data.opt.every(Number.isFinite)) RobotState.cam.opt = data.opt;
    RobotState.cam.strobe = Number.isFinite(data.strobe) ? Math.round(clamp(data.strobe, 0, 30)) : 0;
    if (Number.isFinite(data.cam)) RobotState.cam.preset = Math.round(clamp(data.cam, 0, 2));
    emitTelemetry(now);
    return;
  }
  if (data.device !== DEVICE_CODE) return;             // só aceita as nossas placas

  RobotState.ip = rinfo.address;
  RobotState.online = true;
  RobotState.lastSeenMs = now;
  if (RobotState.lastPingSentMs > 0) {
    RobotState.rttMs = Math.max(1, now - RobotState.lastPingSentMs);
  }
  RobotState.telemetry = { ...RobotState.telemetry, ...sanitizeTelemetry(data), ip: rinfo.address };

  emitTelemetry(now);
  if (now - lastMqttTeleMs >= MQTT_TELE_MS) {
    lastMqttTeleMs = now;
    publishMqttTelemetry();
  }
});

function sendUdp(payload, targetIp) {
  const buf = Buffer.from(payload);
  udpSocket.send(buf, 0, buf.length, K9_UDP_PORT, targetIp, (err) => {
    if (err) console.error('[UDP] envio falhou:', err.message);
  });
}

const CAM_TTL_MS = 4000;
const camOnline = () => !!RobotState.cam.ip && Date.now() - RobotState.cam.lastSeenMs < CAM_TTL_MS;

// Telemetria que o navegador recebe: pernas (placa de movimento) + câmera/lanterna (placa da câmera)
function telemetryPayload() {
  return {
    online: RobotState.online,
    rttMs: RobotState.rttMs,
    ...RobotState.telemetry,
    camIp: RobotState.cam.ip,
    camPreset: RobotState.cam.preset,
    camStrobe: RobotState.cam.strobe,
    camOpt: RobotState.cam.opt,
    camOnline: camOnline(),
    camFirmwareVersion: RobotState.cam.firmwareVersion || null,
    flash: RobotState.cam.flash
  };
}

// Lanterna e câmera ficam na placa ESP32-CAM, não na que anda.
function sendToCam(payload) {
  if (RobotState.cam.ip) sendUdp(payload, RobotState.cam.ip);
}

// Comandos de controle vão só para o robô conhecido (nunca em broadcast).
function sendToRobot(payload) {
  if (RobotState.ip) sendUdp(payload, RobotState.ip);
}

function getBroadcastAddresses() {
  const list = ['255.255.255.255'];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const nif of ifaces[name] || []) {
      if (nif.family === 'IPv4' && !nif.internal) {
        const parts = nif.address.split('.');
        parts[3] = '255';
        list.push(parts.join('.'));
      }
    }
  }
  return [...new Set(list)];
}

function getLocalLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const nif of ifaces[name] || []) {
      if (nif.family === 'IPv4' && !nif.internal && !name.startsWith('docker') && !name.startsWith('virbr') && !name.startsWith('br-')) {
        return nif.address;
      }
    }
  }
  return 'localhost';
}

// ─── Failsafe de drive ───────────────────────────────────────────────────────
let lastDriveMs = 0;
let driveActive = false;
let driverSocketId = null;

function noteDrive(fwd, turn, socketId) {
  driveActive = fwd !== 0 || turn !== 0;
  lastDriveMs = Date.now();
  driverSocketId = socketId || null;
}

function stopDrive(reason) {
  if (!driveActive) return;
  driveActive = false;
  sendToRobot('D 0.00 0.00');
  console.log(`[failsafe] drive parado (${reason})`);
}

setInterval(() => {
  if (driveActive && Date.now() - lastDriveMs > DRIVE_WATCHDOG_MS) stopDrive('sem comandos');
}, 100);

let flashOffTimer = null;
function noteFlash(pct) {
  clearTimeout(flashOffTimer);
  if (pct > 0) flashOffTimer = setTimeout(() => sendToCam('L 0'), FLASH_AUTO_OFF_MS);
}

// Arranque suave: a velocidade pedida SOBE no máximo RAMP_PER_S por segundo (0 a 100% em ~0,8 s); reduzir,
// inverter ou parar é imediato. Um salto de 0 a 100% faz os 4 servos partirem juntos e derrubou a tensão
// da placa das pernas (BROWNOUT no log).
const RAMP_PER_S = 1.25;
const ramp = { fwd: 0, turn: 0, t: 0 };
function rampAxis(cur, target, dt) {
  if (target === 0) return 0;                                   // parar: imediato
  const step = RAMP_PER_S * dt;
  const same = cur === 0 || Math.sign(cur) === Math.sign(target);
  const base = same ? Math.abs(cur) : 0;                        // inverter o sentido recomeça do zero
  if (same && Math.abs(target) <= base) return target;          // reduzir: imediato
  return Math.sign(target) * Math.min(Math.abs(target), base + step);
}

function routeDrive(a, socketId) {
  const now = Date.now();
  const dt = Math.min(0.1, Math.max(0, (now - ramp.t) / 1000));
  if (now - ramp.t > DRIVE_WATCHDOG_MS) { ramp.fwd = 0; ramp.turn = 0; }   // ficou parado: recomeça do zero
  ramp.t = now;
  const fwd = rampAxis(ramp.fwd, clamp(a.fwd, -1, 1), dt);
  const turn = rampAxis(ramp.turn, clamp(a.turn, -1, 1), dt);
  ramp.fwd = fwd; ramp.turn = turn;
  noteDrive(fwd, turn, socketId);
  sendToRobot(buildUdp('drive', { fwd, turn }));
}

// UDP is fire-and-forget: a lost 'off' once left the flashlight on. Resend until the camera board's own
// telemetry shows the new value (3 retries over ~1 s); a newer command cancels the older one.
let confirmSeq = 0;
function sendUntilConfirmed(pkt, isDone) {
  const my = ++confirmSeq;
  sendToCam(pkt);
  for (const delay of [120, 350, 700, 1200]) {
    setTimeout(() => {
      if (my !== confirmSeq || isDone()) return;
      sendToCam(pkt);
      sendToCam('PING');
    }, delay);
  }
  setTimeout(() => sendToCam('PING'), 60);
}

let celebrationTimers = [], celebrationLamp = false;
function cancelCelebrationLight(manual = false) {
  celebrationTimers.forEach(clearTimeout); celebrationTimers = [];
  if (celebrationLamp && !manual) sendToCam('L 0');
  celebrationLamp = false;
}
function celebrateLight() {
  cancelCelebrationLight();
  if (!camOnline() || RobotState.cam.flash || RobotState.cam.strobe) return;
  celebrationLamp = true;
  for (const ms of [1000,2000,3000,4000]) {
    celebrationTimers.push(setTimeout(() => { if(celebrationLamp) sendToCam('L 30'); }, ms));
    celebrationTimers.push(setTimeout(() => { if(celebrationLamp) sendToCam('L 0'); }, ms+250));
  }
  celebrationTimers.push(setTimeout(() => cancelCelebrationLight(), 4500));
}
function routeFlash(level) {
  cancelCelebrationLight(true);
  const pct = Math.round(clamp(level, 0, 100));
  noteFlash(pct);
  sendUntilConfirmed(buildUdp('flash', { level: pct }), () => RobotState.cam.flash === pct);
}

function routeCmd(cmd) {
  const pkt = buildUdp('cmd', { cmd });
  if (!pkt) return false;
  if (!cmd.startsWith('sound_')) cancelCelebrationLight(/^flash/.test(cmd));
  if (cmd === 'emotion_celebrate') celebrateLight();
  if (cmd === 'stop') stopDrive('stop');
  else if (!/^(flash|sound_)/.test(cmd)) stopDrive('pose');                    // pose/teste: para de andar antes
  if (/^flash/.test(cmd)) sendToCam(pkt); else sendToRobot(pkt);   // lanterna vai para a câmera
  return true;
}

// ─── Auto-Discovery Contínuo (mDNS k9.local + Broadcast PING) ────────────────
let dnsInFlight = false;

function probeRobot() {
  RobotState.lastPingSentMs = Date.now();
  if (RobotState.ip) sendUdp('PING', RobotState.ip);
  if (RobotState.cam.ip) sendUdp('PING', RobotState.cam.ip);

  // Sem resposta há mais de 3.5s: tenta k9.local, broadcast e o IP padrão do AP
  if (Date.now() - RobotState.lastSeenMs > 3500) {
    if (RobotState.online) {
      RobotState.online = false;
      io.emit('k9:status', { online: false, ip: RobotState.ip });
    }
  }
  if (Date.now() - RobotState.lastSeenMs > 3500 || !camOnline()) {   // acha as duas placas por broadcast
    for (const bcast of getBroadcastAddresses()) sendUdp('PING', bcast);
    sendUdp('PING', '192.168.4.1');
    sendUdp('PING', '192.168.0.124'); // IP dedicado das pernas
    sendUdp('PING', '192.168.0.240'); // IP dedicado da camera
    if (!dnsInFlight) {
      dnsInFlight = true;
      dns.lookup('k9.local', { family: 4 }, (err, address) => {
        dnsInFlight = false;
        if (!err && address) sendUdp('PING', address);
      });
      dns.lookup('k9cam.local', { family: 4 }, (err, address) => {
        if (!err && address) sendUdp('PING', address);
      });
    }
  }
}

const probeTimer = setInterval(probeRobot, 1000);

// ─── Ponte MQTT (v1/devices/K9V21/...) ────────────────────
let mqttClient = null;
let mqttConnected = false;

if (mqtt) {
  const availTopic = `v1/devices/${DEVICE_CODE}/avail`;
  mqttClient = mqtt.connect(MQTT_URL, {
    reconnectPeriod: 10000,
    connectTimeout: 4000,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASS,
    will: { topic: availTopic, payload: 'offline', retain: true }
  });

  mqttClient.on('connect', () => {
    mqttConnected = true;
    const cmdTopic = `v1/devices/${DEVICE_CODE}/cmd/#`;
    mqttClient.subscribe(cmdTopic);
    mqttClient.publish(availTopic, 'online', { retain: true });
    console.log(`[MQTT] Conectado ao broker ${MQTT_URL} — inscrito em ${cmdTopic}`);
  });
  mqttClient.on('close', () => { mqttConnected = false; });
  mqttClient.on('offline', () => { mqttConnected = false; });
  mqttClient.on('error', () => { mqttConnected = false; });

  mqttClient.on('message', (topic, message) => {
    const prefix = `v1/devices/${DEVICE_CODE}/cmd/`;
    if (!topic.startsWith(prefix)) return;
    const subCmd = topic.slice(prefix.length);
    const msgStr = message.toString().trim();

    let body = {};
    try { body = msgStr.startsWith('{') ? JSON.parse(msgStr) : {}; } catch (_) { return; }

    if (subCmd === 'drive') routeDrive(body, 'mqtt');
    else if (subCmd === 'trim') sendToRobot(buildUdp('trim', body) || '');
    else if (subCmd === 'flash') routeFlash(body.level ?? msgStr);
    else routeCmd(subCmd === 'action' ? msgStr : subCmd);
  });
}

function publishMqttTelemetry() {
  if (mqttClient && mqttConnected) {
    mqttClient.publish(`v1/devices/${DEVICE_CODE}/tele`, JSON.stringify(RobotState.telemetry));
  }
}

// ─── WebSocket Tempo Real (Navegador PC / Celular <-> Hub) ───────────────────
io.on('connection', (socket) => {
  socket.emit('k9:nome', { nome: robotName.get() });
  socket.emit('k9:telemetry', telemetryPayload());

  // Drive contínuo proporcional (Joystick / WASD / Gamepad) -> UDP direto
  socket.on('k9:drive', (a) => routeDrive(a || {}, socket.id));

  // Comandos discretos (sit, stand, dance, lie, wave, gait, cal, flash, test0..3)
  socket.on('k9:cmd', (a) => { routeCmd(a && a.cmd); });

  // O painel pede o estado atual (o mesmo que recebe ao conectar) depois de trocar de marcha: o que o F5 fazia à mão.
  socket.on('k9:snapshot', () => {
    socket.emit('k9:telemetry', telemetryPayload());
    if (RobotState.ip) sendUdp('PING', RobotState.ip);
  });

  socket.on('k9:gait_params', (a, ack) => {
    // 5 números (freq, passo, duty, postura, proporção), 9: os 5 + a fase das 4 patas (FL, FR, RL, RR, 0..360),
    // ou 10: os 9 + o duty extra das traseiras (variações 1-5 da marcha principal, firmware 1.1.0+)
    const n = Array.isArray(a) ? a.length : 0;
    const fase = n === 9 || n === 10 ? a.slice(5, 9) : null;
    const pkt = gaitPacket(fase ? a.slice(0, 5) : a);
    const faseOk = !fase || fase.every(v => typeof v === 'number' && v >= 0 && v <= 360);
    const rear = n === 10 ? rearPacket(a.slice(0, 5), a[9]) : null;
    if (!pkt || !faseOk || (n === 10 && !rear) || !(RobotState.telemetry.controlsVersion >= 2) || !RobotState.ip) {
      if (typeof ack === 'function') ack({ ok: false });
      return;
    }
    stopDrive('ajuste de marcha');
    sendToRobot(pkt);                                                         // "G" também zera a traseira no firmware 1.1.0
    if (fase) sendToRobot('H ' + fase.map(n => n.toFixed(0)).join(' '));   // a fase vem junto, para o teste não depender da marcha anterior
    if (rear) sendToRobot(rear);                                              // depois do G, que zera
    setTimeout(() => sendToRobot('PING'), 80);
    if (typeof ack === 'function') ack({ ok: true }); // receipt by hub, not board confirmation
  });

  // Fase entre as patas (experimento de marcha): [FL, FR, RL, RR] em graus, 0..360
  socket.on('k9:gait_phase', (a, ack) => {
    const ok = Array.isArray(a) && a.length === 4 && a.every(v => typeof v === 'number' && v >= 0 && v <= 360);
    if (!ok || !RobotState.ip) { if (typeof ack === 'function') ack({ ok: false }); return; }
    stopDrive('ajuste de fase');
    sendToRobot('H ' + a.map(n => n.toFixed(0)).join(' '));
    if (typeof ack === 'function') ack({ ok: true });
  });

  // Qualidade da imagem da câmera: 0 rápida, 1 equilibrada, 2 nítida
  // Opções de imagem: 1 brilho -2..2, 2 espelhar, 3 inverter, 4 modo noite, 5 limite de fps 5..15
  socket.on('k9:camopt', (a) => {
    const key = Math.round(clamp(a && a.key, 1, 5));
    const lim = { 1: [-2, 2], 2: [0, 1], 3: [0, 1], 4: [0, 1], 5: [5, 15] }[key];
    if (!lim) return;
    const val = Math.round(clamp(a && a.val, lim[0], lim[1]));
    RobotState.cam.opt[key - 1] = val;
    sendToCam(`O ${key} ${val}`);
  });

  socket.on('k9:cam', (a) => {
    const p = Math.round(clamp(a && a.preset, 0, 2));
    RobotState.cam.preset = p;
    sendToCam(`Q ${p}`);
  });

  // Strobo do flash: 0 desliga, 1..30 Hz (liga a 5 min de auto-desligamento no robô)
  socket.on('k9:strobe', (a) => {
    cancelCelebrationLight(true);
    const hz = Math.round(clamp(a && a.hz, 0, 30));
    noteFlash(hz);
    sendUntilConfirmed(`S ${hz}`, () => RobotState.cam.strobe === hz);
  });

  // Lanterna: 0..100 %
  socket.on('k9:flash', (a) => routeFlash(a && a.level));

  // Ajuste fino de Trim por pata (salva na NVS do ESP32)
  socket.on('k9:trim', (a) => {
    const pkt = buildUdp('trim', a || {});
    if (!pkt) return;
    sendToRobot(pkt);
    setTimeout(() => sendToRobot('PING'), 80);
  });

  // Define manualmente o IP do robô (só IPv4 válido)
  socket.on('k9:set_ip', (a) => {
    const ip = a && typeof a.ip === 'string' ? a.ip.trim() : '';
    if (!net.isIPv4(ip)) return;
    RobotState.ip = ip;
    probeRobot();
  });

  // Quem estava dirigindo sumiu: para o robô e apaga a lanterna
  socket.on('disconnect', () => {
    if (driverSocketId === socket.id) stopDrive('cliente desconectou');
    if (io.engine.clientsCount === 0) {
      clearTimeout(flashOffTimer);
      sendToCam('L 0');
    }
  });
});

// ─── Endpoints REST Auxiliares ───────────────────────────────────────────────
function requireToken(req, res, next) {
  const given = req.get('x-hub-token') || (req.query && req.query.token);
  return tokenOk(given) ? next() : res.status(401).json({ ok: false, error: 'unauthorized' });
}

const robotName = criarNome(path.join(process.env.K9_DATA_DIR || path.join(__dirname, 'data'), 'nome.json'));

// Nome do robô: leitura livre na rede local; troca só com o token do hub (se houver token).
app.get('/api/nome', requireToken, (req, res) => res.json({ ok: true, nome: robotName.get() }));
app.post('/api/nome', requireToken, (req, res) => {
  const v = robotName.set(req.body && req.body.nome);
  if (!v) return res.status(400).json({ ok: false, error: 'nome inválido (1 a 24 letras, números, espaço ou hífen)' });
  io.emit('k9:nome', { nome: v });
  res.json({ ok: true, nome: v });
});

// Troca de Wi-Fi das placas (pernas ou câmera). Exige o token do hub (se houver), origem do próprio painel e no máximo 1 pedido a cada 5 s.
// A senha só passa em memória: não vai para log nem para a resposta.
let ultimoWifiMs = 0;
app.post('/api/wifi', requireToken, async (req, res) => {
  const origin = req.get('origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ ok: false, error: 'origem' });
  const v = validarWifi(req.body);
  if (!v.ok) return res.status(400).json({ ok: false, error: v.erro });
  const ip = v.alvo === 'cam' ? RobotState.cam.ip : RobotState.ip;
  if (!net.isIPv4(ip || '')) return res.status(503).json({ ok: false, error: 'placa_offline' });
  if (Date.now() - ultimoWifiMs < 5000) return res.status(429).json({ ok: false, error: 'aguarde' });
  ultimoWifiMs = Date.now();
  const r = await enviarWifi(ip, v.ssid, v.pass);
  console.log(`[wifi] ${v.alvo}: ${r.ok ? 'rede nova enviada (a placa reinicia)' : 'falhou (' + r.erro + ')'}`);
  res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true } : { ok: false, error: r.erro });
});

const cameraRelay = createCameraRelay({
  getTarget: () => net.isIPv4(RobotState.cam.ip || '') ? { hostname: RobotState.cam.ip, port: 81, path: '/stream' } : null
});
app.get('/api/camera/stream', requireToken, cameraRelay.handle);

// One JPEG per request, same-origin access from the dashboard.
app.get('/api/camera/capture', requireToken, (req, res) => {
  const ip = RobotState.cam.ip;
  if (!net.isIPv4(ip || '')) return res.status(503).end('Camera indisponivel');
  const up = http.get({ hostname: ip, port: 80, path: '/capture', agent: false, timeout: 5000 }, r => {
    if (r.statusCode !== 200 || !String(r.headers['content-type']).startsWith('image/jpeg')) {
      r.destroy(); res.status(503).end('Captura indisponivel'); return;
    }
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
    r.pipe(res);
    r.on('error', () => res.destroy());
  });
  const deadline = setTimeout(() => up.destroy(new Error('capture deadline')), 8000);
  up.on('socket', socket => socket.setNoDelay(true));
  up.on('timeout', () => up.destroy(new Error('capture timeout')));
  up.on('error', () => { if (!res.headersSent) res.status(503).end('Camera indisponivel'); else res.destroy(); });
  res.on('close', () => { clearTimeout(deadline); up.destroy(); });
});

// Vídeo melhorado por IA (protótipo): o serviço superres/superres.py lê o relay acima, amplia 2x na GPU do PC e serve /stream.
// Sem o serviço, responde 503 e o painel volta sozinho ao vídeo normal.
const SUPERRES = { hostname: '127.0.0.1', port: Number(process.env.K9_SR_PORT) || 3091 };
app.get('/api/camera/stream-ia', requireToken, (req, res) => {
  const up = http.get({ ...SUPERRES, path: '/stream', agent: false }, (r) => {
    if (r.statusCode !== 200) { r.destroy(); if (!res.headersSent) res.status(503).end('IA indisponivel'); return; }
    res.writeHead(200, { 'Content-Type': r.headers['content-type'] || 'multipart/x-mixed-replace; boundary=k9sr', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    r.pipe(res);
    r.on('error', () => res.destroy());
  });
  up.on('error', () => { if (!res.headersSent) res.status(503).end('IA indisponivel'); else res.destroy(); });
  res.on('close', () => up.destroy());
});
app.get('/api/camera/ia-status', requireToken, (req, res) => {
  const q = http.get({ ...SUPERRES, path: '/health', agent: false, timeout: 1500 }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => { try { res.json({ available: true, ...JSON.parse(b) }); } catch { res.json({ available: false }); } });
  });
  q.on('timeout', () => q.destroy());
  q.on('error', () => res.json({ available: false }));
});
app.get('/api/camera/status', requireToken, (req, res) => res.json({ online: camOnline(), ip: RobotState.cam.ip, rssi: RobotState.cam.rssi ?? null, uptime: RobotState.cam.uptime ?? null, ...cameraRelay.status(req.query.viewer) }));

app.get('/api/status', requireToken, (req, res) => {
  res.json({
    online: RobotState.online,
    ip: RobotState.ip,
    camIp: RobotState.cam.ip,
    rttMs: RobotState.rttMs,
    mqttConnected,
    telemetry: RobotState.telemetry
  });
});

app.post('/api/cmd', requireToken, (req, res) => {
  const body = req.body || {};
  const { cmd } = body;
  if (cmd === 'drive') {
    routeDrive(body, 'rest');
  } else if (cmd === 'trim') {
    const pkt = buildUdp('trim', body);
    if (!pkt) return res.status(400).json({ ok: false, error: 'trim inválido' });
    sendToRobot(pkt);
  } else if (cmd === 'flash') {
    routeFlash(body.level);
  } else if (!routeCmd(cmd)) {
    return res.status(400).json({ ok: false, error: 'comando desconhecido' });
  }
  res.json({ ok: true, targetIp: (cmd === 'flash' || /^flash/.test(cmd || '')) ? RobotState.cam.ip : RobotState.ip });
});

// ─── Logs do robô (ficam na flash do ESP32; só trafegam quando pedidos) ───────
function proxyRobot(req, res, robotPath, method = 'GET') {
  if (!RobotState.ip) return res.status(503).type('text').send('robô não encontrado');
  const r = http.request({ host: RobotState.ip, port: 80, path: robotPath, method, timeout: 8000 }, (up) => {
    res.status(up.statusCode || 200);
    res.type(up.headers['content-type'] || 'text/plain');
    if (up.headers['content-length']) res.set('Content-Length', up.headers['content-length']);
    up.pipe(res);
  });
  r.on('timeout', () => r.destroy(new Error('timeout')));
  r.on('error', (e) => { if (!res.headersSent) res.status(502).type('text').send('robô: ' + e.message); else res.end(); });
  r.end();
}
app.get('/api/log', requireToken, (req, res) => proxyRobot(req, res, req.query.full ? '/log?full=1' : '/log'));
app.get('/api/log/info', requireToken, (req, res) => proxyRobot(req, res, '/log/info'));
app.post('/api/log/clear', requireToken, (req, res) => proxyRobot(req, res, '/log/clear'));

function shutdown() {
  cameraRelay.close();
  clearInterval(probeTimer);
  sendToRobot('D 0.00 0.00');
  sendToCam('L 0');
  const finish = () => process.exit(0);
  if (mqttClient) {
    mqttClient.publish(`v1/devices/${DEVICE_CODE}/avail`, 'offline', { retain: true }, () => mqttClient.end(false, {}, finish));
    setTimeout(finish, 800).unref();
  } else {
    setTimeout(finish, 100);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

udpSocket.bind(0, () => {
  probeRobot();
});

httpServer.listen(PORT, HOST, () => {
  console.log('================================================================');
  console.log('🤖 Minirobo K9V2.1 — Control Hub Iniciado!');
  console.log(`🌐 Acesse no PC:      http://localhost:${PORT}`);
  console.log(`📱 Acesse no Celular: http://${lanIp}:${PORT}`);
  if (HUB_TOKEN) console.log('🔒 HUB_TOKEN ativo (use o parâmetro ?token= na página)');
  console.log('================================================================');
});
