#pragma once
#include "../firmware_version.h"

#ifdef BOARD_ESP32CAM
#include <WiFi.h>
#include <WiFiUdp.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <Preferences.h>
#include "esp_camera.h"
#include "esp_wifi.h"
#include "esp_timer.h"
#include <new>
#include <sys/socket.h>
#include <errno.h>
#include "radio_diag_config.h"
#include "freertos/semphr.h"

#include "k9_log.h"

#if __has_include("secrets.h")
#include "secrets.h"
#endif

// Credenciais padrão do Wi-Fi residencial (configure em src/secrets.h)
#ifndef DEFAULT_HOME_SSID
#define DEFAULT_HOME_SSID "YOUR_WIFI_SSID"
#endif
#ifndef DEFAULT_HOME_PASS
#define DEFAULT_HOME_PASS "YOUR_WIFI_PASS"
#endif
// Two-board robot: the plain ESP32 ("k9", device K9V21) drives the legs; the ESP32-CAM
// (-DK9_CAM_ONLY: "k9cam", device K9CAM) does ONLY camera + flashlight. The hub tells them
// apart by the telemetry "device" field.
#ifdef K9_CAM_ONLY
#define K9_MDNS_HOST "k9cam"
#define K9_DEVICE_NAME "K9CAM"
#endif
#ifndef K9_DEVICE_NAME
#define K9_DEVICE_NAME "K9V21"
#endif
#ifndef K9_MDNS_HOST
#define K9_MDNS_HOST "k9"
#endif
#define K9_UDP_PORT 4210
// K9_AP_PASS (>= 8 chars, emergency access point) and K9_OTA_PASS (network flashing) come from src/secrets.h,
// which is not in git. There are deliberately NO default passwords: a shared default would let anyone join the robot.
#ifndef K9_AP_PASS
#error "K9_AP_PASS is not set. Copy src/secrets.example.h to src/secrets.h and set your own passwords."
#endif
#ifndef K9_OTA_PASS
#error "K9_OTA_PASS is not set. Copy src/secrets.example.h to src/secrets.h and set your own passwords."
#endif

// AI-Thinker ESP32-CAM Pinout
#define CAM_PIN_PWDN    32
#define CAM_PIN_RESET   -1
#define CAM_PIN_XCLK     0
#define CAM_PIN_SIOD    26
#define CAM_PIN_SIOC    27

#define CAM_PIN_D7      35
#define CAM_PIN_D6      34
#define CAM_PIN_D5      39
#define CAM_PIN_D4      36
#define CAM_PIN_D3      21
#define CAM_PIN_D2      19
#define CAM_PIN_D1      18
#define CAM_PIN_D0       5
#define CAM_PIN_VSYNC   25
#define CAM_PIN_HREF    23
#define CAM_PIN_PCLK    22

// Flashlight: the on-board white LED (AI-Thinker GPIO4, shared with the SD card
// data line, which we never use). PWM on a LOW-SPEED LEDC channel (8+) so it can
// never touch the camera's XCLK timer (high-speed timer 2) or the servo channels 0-3.
// The LED is very bright and has no heatsink, so it is capped and auto-switches off.
#define FLASH_PIN          4
#define FLASH_LEDC_CH      8
#define FLASH_PWM_HZ       5000
#define FLASH_PWM_BITS     8
#define FLASH_MAX_PERCENT  60            // hard cap on duty (thermal)
#define FLASH_AUTO_OFF_MS  300000UL      // 5 min

static int           flashPercent = 0;   // 0..100 as requested by the user
static unsigned long flashOnSinceMs = 0;

static void flashWriteDuty(int duty) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(FLASH_PIN, duty);
#else
  ledcWrite(FLASH_LEDC_CH, duty);
#endif
}

inline void initFlash() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(FLASH_PIN, FLASH_PWM_HZ, FLASH_PWM_BITS);
#else
  ledcSetup(FLASH_LEDC_CH, FLASH_PWM_HZ, FLASH_PWM_BITS);
  ledcAttachPin(FLASH_PIN, FLASH_LEDC_CH);
#endif
  flashWriteDuty(0);
}

// Strobe: the flash LED blinks at strobeHz (1..30 Hz, 50 % duty), at the current brightness.
// Timed in updateFlash() with millis(), so nothing blocks the Wi-Fi loop. WARNING: 3-30 Hz
// flashing can trigger photosensitive epilepsy; it shares the 5-minute auto-off.
#define STROBE_MAX_HZ 30
static int           strobeHz = 0;
static bool          strobeOn = false;
static unsigned long strobeLastMs = 0;

static void flashDuty(bool on) {
  int capped = (flashPercent * FLASH_MAX_PERCENT) / 100;
  flashWriteDuty(on ? (capped * ((1 << FLASH_PWM_BITS) - 1)) / 100 : 0);
}

static void setStrobe(int hz) {
  hz = constrain(hz, 0, STROBE_MAX_HZ);
  if (hz == 0) {                                  // stop: LED off
    strobeHz = 0; strobeOn = false;
    flashPercent = 0; flashWriteDuty(0);
    return;
  }
  if (flashPercent == 0) { flashPercent = 100; flashOnSinceMs = millis(); }
  strobeHz = hz; strobeOn = true; strobeLastMs = millis();
  flashDuty(true);
}

static void setFlash(int percent) {
  strobeHz = 0; strobeOn = false;                 // a steady level cancels any strobe
  percent = constrain(percent, 0, 100);
  if (percent > 0 && flashPercent == 0) flashOnSinceMs = millis();
  flashPercent = percent;
  int capped = (percent * FLASH_MAX_PERCENT) / 100;
  flashWriteDuty((capped * ((1 << FLASH_PWM_BITS) - 1)) / 100);
}

static void updateFlash() {
  if (flashPercent > 0 && millis() - flashOnSinceMs > FLASH_AUTO_OFF_MS) { setFlash(0); return; }
  if (strobeHz > 0) {
    unsigned long half = 500UL / strobeHz;        // half period in ms
    unsigned long now = millis();
    if (now - strobeLastMs >= half) {
      strobeLastMs += half;
      if (now - strobeLastMs > half) strobeLastMs = now;   // fell behind (busy loop): resync
      strobeOn = !strobeOn;
      flashDuty(strobeOn);
    }
  }
}

// Survival profile: all preset IDs use the selected diagnostic image profile.
#define CAM_PRESETS 3
static int camPreset = 0;   // default: Rapida (the profile that stayed stable on the bench)
static bool isOv3660 = false;
static bool fieldMode = false;

static void applyCamPreset(int p) {
  static const framesize_t FS_2640[CAM_PRESETS] = { K9_CAM_FRAME_SIZE, K9_CAM_FRAME_SIZE, K9_CAM_FRAME_SIZE };
  static const int          Q_2640[CAM_PRESETS] = { K9_CAM_JPEG_QUALITY, K9_CAM_JPEG_QUALITY, K9_CAM_JPEG_QUALITY };
  // Keep every preset on the image profile under measurement.
  static const framesize_t FS_3660[CAM_PRESETS] = { K9_CAM_FRAME_SIZE, K9_CAM_FRAME_SIZE, K9_CAM_FRAME_SIZE };
  static const int          Q_3660[CAM_PRESETS] = { K9_CAM_JPEG_QUALITY, K9_CAM_JPEG_QUALITY, K9_CAM_JPEG_QUALITY };
  p = constrain(p, 0, CAM_PRESETS - 1);
  sensor_t* s = esp_camera_sensor_get();
  if (s) {
    isOv3660 = (s->id.PID == OV3660_PID);
    s->set_framesize(s, isOv3660 ? FS_3660[p] : FS_2640[p]);
    s->set_quality(s, isOv3660 ? Q_3660[p] : Q_2640[p]);
  }
  camPreset = p;
}

static WebServer server(80);
static WiFiUDP udp;
static Preferences k9Prefs;
static bool camInitialized = false;
static int cameraInitCore = -1, setupCore = -1;
extern int k9CameraDriverCore;
static SemaphoreHandle_t cameraInitDone = nullptr;
static TaskHandle_t cameraService = nullptr;
static SemaphoreHandle_t cameraLock = nullptr;
static QueueHandle_t captureJobs = nullptr;
static SemaphoreHandle_t captureSlot = nullptr;
static portMUX_TYPE diagMux = portMUX_INITIALIZER_UNLOCKED;
struct CameraDiag {
  uint32_t fbGetUs = 0, sendUs = 0, bytes = 0, completed = 0, failures = 0;
  uint32_t updatedMs = 0;
  uint32_t streamGetUs = 0, streamSendUs = 0, streamMaxSendUs = 0;
  uint32_t streamFrames = 0, streamDrops = 0;
  bool busy = false;
};
static CameraDiag cameraDiag;
static CameraDiag readCameraDiag() {
  portENTER_CRITICAL(&diagMux);
  CameraDiag result = cameraDiag;
  portEXIT_CRITICAL(&diagMux);
  return result;
}
static void applyRadioSurvival() {
  bool sleepOk = WiFi.setSleep(false);
  esp_err_t ps = esp_wifi_set_ps(WIFI_PS_NONE);
  bool txOk = WiFi.setTxPower(K9_CAM_TX_POWER);
  k9Logf("radio survival sleep_changed=%d ps=%d tx=%d", sleepOk, (int)ps, txOk);
}

static unsigned long lastWifiCheckMs = 0;

// Callbacks provided by main.cpp
void  webOnDrive(float fwd, float turn);
void  webOnAnim(int animCode);
void  webOnCalibrate(bool hold);
void  webOnGait(int gaitIdx);
void  webOnTestServo(int idx);
void  webOnNudgeTrim(int idx, int deltaUs);
int   webGetTrimUs(int idx);
void  webSetTrimUs(int idx, int us);
int   webGetLastUs(int idx);
float webGetLegDeg(int idx);
int   webGetGaitSel();
float webGetDriveFwd();
float webGetDriveTurn();
bool  webGetHoldCenter();

inline void loadNvsTrim() {
  k9Prefs.begin("k9-cal", true);
  const char* keys[4] = { "c0", "c1", "c2", "c3" };
  for (int i = 0; i < 4; i++) {
    int saved = k9Prefs.getInt(keys[i], 1500);
    webSetTrimUs(i, saved);
  }
  k9Prefs.end();
}

inline void saveNvsTrim() {
  k9Prefs.begin("k9-cal", false);
  const char* keys[4] = { "c0", "c1", "c2", "c3" };
  for (int i = 0; i < 4; i++) {
    int us = webGetTrimUs(i);
    if (k9Prefs.getInt(keys[i], -1) != us) k9Prefs.putInt(keys[i], us);   // spare the flash
  }
  k9Prefs.end();
}

static String buildTelemetryJson() {
  String ipStr = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : WiFi.softAPIP().toString();
  int rssi = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : 0;
  String ssidSafe = (WiFi.status() == WL_CONNECTED) ? WiFi.SSID() : String("Minirobo-K9 (AP)");
  ssidSafe.replace("\"", "'");
  ssidSafe.replace("\\", "/");
  char buf[520];
  snprintf(buf, sizeof(buf),
    "{\"firmwareVersion\":\"" K9_FIRMWARE_VERSION "\",\"device\":\"" K9_DEVICE_NAME "\",\"ip\":\"%s\",\"ssid\":\"%s\",\"rssi\":%d,\"uptime\":%lu,\"heap\":%u,"
    "\"fwd\":%.2f,\"turn\":%.2f,\"gait\":%d,\"hold\":%s,\"flash\":%d,\"strobe\":%d,\"cam\":%d,"
    "\"trim\":[%d,%d,%d,%d],\"us\":[%d,%d,%d,%d],\"deg\":[%.1f,%.1f,%.1f,%.1f]}",
    ipStr.c_str(),
    ssidSafe.c_str(),
    rssi,
    millis() / 1000UL,
    (unsigned)ESP.getFreeHeap(),
    webGetDriveFwd(),
    webGetDriveTurn(),
    webGetGaitSel() + 1,
    webGetHoldCenter() ? "true" : "false",
    flashPercent,
    strobeHz,
    camPreset,
    webGetTrimUs(0), webGetTrimUs(1), webGetTrimUs(2), webGetTrimUs(3),
    webGetLastUs(0), webGetLastUs(1), webGetLastUs(2), webGetLastUs(3),
    webGetLegDeg(0), webGetLegDeg(1), webGetLegDeg(2), webGetLegDeg(3)
  );
  return String(buf);
}

static const char HTML_INDEX[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>🤖 Minirobo K9V2.1 — Campo & FPV</title>
  <style>
    * { box-sizing: border-box; touch-action: manipulation; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0d1117; color: #f0f6fc;
      margin: 0; padding: 10px;
      display: flex; flex-direction: column; align-items: center;
      min-height: 100vh;
    }
    .header {
      display: flex; justify-content: space-between; align-items: center;
      width: 100%; max-width: 400px; margin-bottom: 6px;
    }
    h1 { font-size: 1.05rem; margin: 0; color: #58a6ff; }
    .badge { font-size: 0.7rem; background: #1f6feb; padding: 3px 8px; border-radius: 12px; font-family: monospace; }
    .cam-box {
      width: 100%; max-width: 400px; aspect-ratio: 4/3;
      background: #161b22; border-radius: 12px; overflow: hidden;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid #30363d; margin-bottom: 6px; position: relative;
    }
    .cam-box img { width: 100%; height: 100%; object-fit: contain; }
    .status {
      font-size: 0.75rem; color: #3fb950; margin-bottom: 8px;
      background: #161b22; padding: 6px 10px; border-radius: 12px; border: 1px solid #30363d;
      width: 100%; max-width: 400px; text-align: center; font-family: monospace;
    }
    .ctrl-wrap {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      width: 100%; max-width: 400px; margin-bottom: 8px;
    }
    .joy-zone {
      width: 146px; height: 146px; border-radius: 50%; position: relative; flex: none;
      touch-action: none; user-select: none; border: 2px solid #388bfd;
      background: radial-gradient(circle, #1f2937 0%, #0d1117 100%);
    }
    .joy-stick {
      position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px;
      border-radius: 50%; pointer-events: none;
      background: radial-gradient(circle at 35% 30%, #79c0ff, #1f6feb);
      box-shadow: 0 4px 10px rgba(0,0,0,0.6);
    }
    .d-pad {
      display: grid; grid-template-columns: repeat(3, 68px); grid-template-rows: repeat(3, 46px);
      gap: 5px;
    }
    .btn {
      background: #21262d; border: 1px solid #363b42; border-radius: 10px;
      color: #f0f6fc; font-size: 0.95rem; font-weight: bold;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent;
    }
    .btn:active { background: #388bfd; color: #fff; transform: scale(0.96); }
    .btn span { font-size: 0.6rem; font-weight: normal; margin-top: 1px; color: #8b949e; }
    .btn-stop { background: #da3633; border-color: #f85149; }
    .slider-box {
      width: 100%; max-width: 400px; background: #161b22; border: 1px solid #30363d;
      border-radius: 10px; padding: 6px 10px; margin-bottom: 8px; font-size: 0.75rem;
    }
    .slider-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 3px 0; }
    .slider-row input[type=range] { flex: 1; accent-color: #388bfd; }
    .section-title { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 1px; color: #8b949e; margin: 4px 0; width: 100%; max-width: 400px; }
    .actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; width: 100%; max-width: 400px; margin-bottom: 8px; }
    .actions .btn { font-size: 0.75rem; height: 38px; }
    .trim-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; width: 100%; max-width: 400px; margin-bottom: 8px; }
    .trim-card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 6px; font-size: 0.72rem; }
    .trim-head { display: flex; justify-content: space-between; margin-bottom: 4px; font-weight: bold; }
    .trim-btns { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; }
    .trim-btns .btn { height: 30px; font-size: 0.72rem; }
    .calib-box {
      width: 100%; max-width: 400px; background: #161b22;
      border: 1px dashed #d29922; border-radius: 10px; padding: 6px; text-align: center;
    }
    .calib-btn { background: #d29922; color: #000; font-weight: bold; border: none; padding: 8px; border-radius: 8px; width: 100%; cursor: pointer; font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🤖 K9V2.1 Campo</h1>
    <span class="badge" id="netBadge">Conectando...</span>
  </div>
  <div class="cam-box">
    <img id="stream" alt="Câmera FPV (porta 81)">
  </div>
  <div class="status" id="statusTxt">✅ Pronto — Joystick Analógico, D-Pad ou WASD</div>

  <div class="ctrl-wrap">
    <div class="joy-zone" id="joyZone">
      <div class="joy-stick" id="joyStick"></div>
    </div>
    <div class="d-pad">
      <div></div>
      <button class="btn" onpointerdown="startDrive(1,0)" onpointerup="stopDrive()" onpointerleave="stopDrive()">⬆️<span>Frente</span></button>
      <div></div>
      <button class="btn" onpointerdown="startDrive(0,-1)" onpointerup="stopDrive()" onpointerleave="stopDrive()">⬅️<span>Esq</span></button>
      <button class="btn btn-stop" onclick="stopDrive(); sendCmd('stop')">⏹️<span>PARAR</span></button>
      <button class="btn" onpointerdown="startDrive(0,1)" onpointerup="stopDrive()" onpointerleave="stopDrive()">➡️<span>Dir</span></button>
      <div></div>
      <button class="btn" onpointerdown="startDrive(-1,0)" onpointerup="stopDrive()" onpointerleave="stopDrive()">⬇️<span>Trás</span></button>
      <div></div>
    </div>
  </div>

  <div class="slider-box">
    <div class="slider-row">
      <span>⚡ Velocidade: <b id="spdVal">60%</b></span>
      <input type="range" id="spdRange" min="15" max="100" step="5" value="60" oninput="document.getElementById('spdVal').innerText=this.value+'%'">
    </div>
    <div class="slider-row">
      <span>🔦 Lanterna: <b id="flVal">0%</b></span>
      <input type="range" id="flRange" min="0" max="100" step="10" value="0" onchange="sendCmd('level&v='+this.value); document.getElementById('flVal').innerText=this.value+'%'">
      <button class="btn" style="height:26px;padding:0 8px;font-size:0.7rem" onclick="sendCmd('camq&v=0')">QVGA</button>
      <button class="btn" style="height:26px;padding:0 8px;font-size:0.7rem" onclick="sendCmd('camq&v=1')">CIF</button>
      <button class="btn" style="height:26px;padding:0 8px;font-size:0.7rem" onclick="sendCmd('camq&v=2')">VGA</button>
    </div>
  </div>

  <div class="section-title">Marchas & Poses</div>
  <div class="actions">
    <button class="btn" onclick="sendCmd('stand')">🧍 Em pé</button>
    <button class="btn" onclick="sendCmd('sit')">🪑 Sentar</button>
    <button class="btn" onclick="sendCmd('lie')">🛌 Deitar</button>
    <button class="btn" onclick="sendCmd('getup')">⬆️ Levantar</button>
    <button class="btn" onclick="sendCmd('wave')">🐾 Pata D</button>
    <button class="btn" onclick="sendCmd('waveleft')">🐾 Pata E</button>
    <button class="btn" onclick="sendCmd('dance')">💃 Dançar</button>
    <button class="btn" onclick="sendCmd('bow')">🙇 Reverência</button>
    <button class="btn" onclick="sendCmd('stretch')">🐕 Esticar</button>
    <button class="btn" onclick="sendCmd('wag')">🐕 Abanar</button>
    <button class="btn" onclick="sendCmd('dig')">🐾 Cavar</button>
    <button class="btn" onclick="sendCmd('wiggle')">🕺 Rebolar</button>
    <button class="btn" onclick="sendCmd('gait1')">Marcha 1</button>
    <button class="btn" onclick="sendCmd('gait2')">Marcha 2</button>
    <button class="btn" onclick="sendCmd('gait3')">Marcha 3</button>
    <button class="btn" onclick="sendCmd('gait4')">Marcha 4</button>
  </div>

  <div class="section-title">Trim NVS & Teste Individual de Servos</div>
  <div class="trim-grid">
    <div class="trim-card">
      <div class="trim-head"><span>FL (IO14)</span><span id="tr0">1500us</span></div>
      <div class="trim-btns">
        <button class="btn" onclick="nudgeTrim(0,-15)">-1.5°</button>
        <button class="btn" onclick="nudgeTrim(0,15)">+1.5°</button>
        <button class="btn" onclick="sendCmd('test0')">Test</button>
      </div>
    </div>
    <div class="trim-card">
      <div class="trim-head"><span>FR (IO15)</span><span id="tr1">1500us</span></div>
      <div class="trim-btns">
        <button class="btn" onclick="nudgeTrim(1,-15)">-1.5°</button>
        <button class="btn" onclick="nudgeTrim(1,15)">+1.5°</button>
        <button class="btn" onclick="sendCmd('test1')">Test</button>
      </div>
    </div>
    <div class="trim-card">
      <div class="trim-head"><span>RL (IO13)</span><span id="tr2">1500us</span></div>
      <div class="trim-btns">
        <button class="btn" onclick="nudgeTrim(2,-15)">-1.5°</button>
        <button class="btn" onclick="nudgeTrim(2,15)">+1.5°</button>
        <button class="btn" onclick="sendCmd('test2')">Test</button>
      </div>
    </div>
    <div class="trim-card">
      <div class="trim-head"><span>RR (IO2)</span><span id="tr3">1500us</span></div>
      <div class="trim-btns">
        <button class="btn" onclick="nudgeTrim(3,-15)">-1.5°</button>
        <button class="btn" onclick="nudgeTrim(3,15)">+1.5°</button>
        <button class="btn" onclick="sendCmd('test3')">Test</button>
      </div>
    </div>
  </div>

  <div class="calib-box">
    <button class="calib-btn" onclick="sendCmd('cal')">🎯 Travar 90° (Alinhamento dos Servos)</button>
  </div>

  <script>
    const statusEl = document.getElementById('statusTxt');
    const streamImg = document.getElementById('stream');
    let driveTimer = null;

    function loadStream() {
      streamImg.src = 'http://' + window.location.hostname + ':81/stream?t=' + Date.now();
    }
    streamImg.addEventListener('error', () => { setTimeout(loadStream, 3000); });

    function pollStatus() {
      fetch('/status', { cache: 'no-store' }).then(r => r.json()).then(d => {
        const heapKb = d.heap ? Math.round(d.heap / 1024) + 'KB' : '';
        document.getElementById('netBadge').innerText = d.ip + ' | ' + d.rssi + 'dBm ' + heapKb;
        if (d.trim) for (let i = 0; i < 4; i++) {
          const el = document.getElementById('tr' + i);
          if (el) el.innerText = d.trim[i] + 'us';
        }
      }).catch(()=>{});
    }

    window.addEventListener('DOMContentLoaded', () => {
      loadStream();
      pollStatus();
      setInterval(pollStatus, 2500);
    });

    function getSpeed() {
      return parseInt(document.getElementById('spdRange').value, 10) / 100.0;
    }

    function sendCmd(c) {
      fetch('/cmd?c=' + c, { cache: 'no-store' })
        .then(r => r.text())
        .then(t => { statusEl.innerText = '✅ ' + c.toUpperCase() + ' -> ' + t; pollStatus(); })
        .catch(() => { statusEl.innerText = '⚠️ Sem resposta HTTP'; });
    }

    function nudgeTrim(leg, d) {
      fetch('/cmd?c=trim&leg=' + leg + '&d=' + d, { cache: 'no-store' })
        .then(r => r.text())
        .then(t => { statusEl.innerText = '🔧 ' + t; pollStatus(); });
    }

    function sendDrive(f, t) {
      const s = getSpeed();
      const fs = f * s, ts = t * s;
      fetch('/cmd?c=drive&f=' + fs.toFixed(2) + '&t=' + ts.toFixed(2), { cache: 'no-store' })
        .then(() => { statusEl.innerText = '🕹️ F=' + fs.toFixed(2) + ' T=' + ts.toFixed(2); })
        .catch(() => {});
    }

    function startDrive(f, t) {
      stopDrive(false);
      sendDrive(f, t);
      driveTimer = setInterval(() => sendDrive(f, t), 220);
    }

    function stopDrive(sendStop = true) {
      if (driveTimer) {
        clearInterval(driveTimer);
        driveTimer = null;
      }
      if (sendStop) sendCmd('stop');
    }

    // Joystick Analogico Virtual Touch
    const joyZone = document.getElementById('joyZone');
    const joyStick = document.getElementById('joyStick');
    let joyId = null, joyF = 0, joyT = 0;
    function updateJoy(cx, cy) {
      const r = joyZone.getBoundingClientRect();
      const maxR = 46;
      let dx = cx - (r.left + r.width / 2);
      let dy = cy - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; }
      joyStick.style.transform = `translate(${dx}px, ${dy}px)`;
      joyF = -dy / maxR; joyT = dx / maxR;
    }
    joyZone.addEventListener('pointerdown', e => {
      joyId = e.pointerId; joyZone.setPointerCapture(joyId);
      updateJoy(e.clientX, e.clientY);
      stopDrive(false);
      sendDrive(joyF, joyT);
      driveTimer = setInterval(() => sendDrive(joyF, joyT), 180);
    });
    joyZone.addEventListener('pointermove', e => { if (e.pointerId === joyId) updateJoy(e.clientX, e.clientY); });
    const endJoy = e => {
      if (joyId === null || (e && e.pointerId !== joyId)) return;
      joyId = null; joyStick.style.transform = 'translate(0px,0px)';
      stopDrive(true);
    };
    ['pointerup','pointercancel','lostpointercapture'].forEach(ev => joyZone.addEventListener(ev, endJoy));

    const keys = {};
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (keys[k]) return;
      keys[k] = true;
      if (k === 'w' || k === 'arrowup') startDrive(1, 0);
      else if (k === 's' || k === 'arrowdown') startDrive(-1, 0);
      else if (k === 'a' || k === 'arrowleft') startDrive(0, -1);
      else if (k === 'd' || k === 'arrowright') startDrive(0, 1);
      else if (k === ' ') { stopDrive(true); }
    });
    window.addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      keys[k] = false;
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) stopDrive(true);
    });
  </script>
</body>
</html>
)rawliteral";

static void handleRoot() {
  server.send_P(200, "text/html", HTML_INDEX);
}

static void handleStatus() {
  const int64_t started = esp_timer_get_time();
  CameraDiag d = readCameraDiag();
  wifi_ps_type_t ps = WIFI_PS_MIN_MODEM;
  wifi_bandwidth_t bw = WIFI_BW_HT40;
  int8_t power = 0;
  esp_err_t psResult = esp_wifi_get_ps(&ps);
  esp_wifi_get_bandwidth(WIFI_IF_STA, &bw);
  esp_wifi_get_max_tx_power(&power);
  sensor_t* sensor = esp_camera_sensor_get();
  char body[1024];
  snprintf(body, sizeof body,
    "{\"firmwareVersion\":\"" K9_FIRMWARE_VERSION "\",\"device\":\"K9CAM\",\"profile\":\"radio-survival-v1\",\"rssi\":%d,"
    "\"free_heap\":%u,\"free_psram\":%u,\"uptime\":%lu,\"camera_ready\":%s,"
    "\"last_fb_get_us\":%u,\"last_send_us\":%u,\"last_frame_bytes\":%u,"
    "\"capture_busy\":%s,\"completed\":%u,\"failures\":%u,\"updated_ms\":%u,"
    "\"xclk_hz\":%u,\"jpeg_quality\":%d,\"wifi_ps\":%d,\"bandwidth_mhz\":%d,\"tx_dbm\":%.2f,\"revision\":14,\"wifi_ps_result\":%d,"
    "\"setup_core\":%d,\"camera_init_core\":%d,\"camera_driver_core\":%d,\"stream_core\":1,"
    "\"stream_fb_get_us\":%u,\"stream_send_us\":%u,\"stream_max_send_us\":%u,"
    "\"stream_frames\":%u,\"stream_drops\":%u,"
    "\"sensor_framesize\":%d,\"sensor_quality\":%d,\"special_effect\":%d,"
    "\"raw_gma\":%d,\"lenc\":%d,\"sharpness\":%d,"
    "\"dcw\":%d,\"bpc\":%d,\"wpc\":%d,\"denoise\":%d,\"gainceiling\":%d}",
    WiFi.RSSI(), (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getFreePsram(), millis()/1000UL,
    camInitialized ? "true" : "false", d.fbGetUs, d.sendUs, d.bytes,
    d.busy ? "true" : "false", d.completed, d.failures, d.updatedMs,
    K9_CAM_XCLK_HZ, K9_CAM_JPEG_QUALITY, (int)ps, bw == WIFI_BW_HT20 ? 20 : 40, power / 4.0, (int)psResult, setupCore, cameraInitCore, k9CameraDriverCore,
    d.streamGetUs, d.streamSendUs, d.streamMaxSendUs, d.streamFrames, d.streamDrops,
    sensor ? (int)sensor->status.framesize : -1, sensor ? sensor->status.quality : -1,
    sensor ? sensor->status.special_effect : -1, sensor ? sensor->status.raw_gma : -1,
    sensor ? sensor->status.lenc : -1, sensor ? sensor->status.sharpness : -1,
    sensor ? sensor->status.dcw : -1, sensor ? sensor->status.bpc : -1,
    sensor ? sensor->status.wpc : -1, sensor ? sensor->status.denoise : -1,
    sensor ? sensor->status.gainceiling : -1);
  server.client().setNoDelay(true);
  server.sendHeader("Cache-Control", "no-store");
  // Preparation time only: excludes TCP transmission and client-side delays.
  server.sendHeader("X-Handler-Us", String((unsigned)(esp_timer_get_time() - started)));
  server.send(200, "application/json", body);
}

// ---- log endpoints (LAN only, intentionally open) -------------------------------
// GET /log            last 64 KB    GET /log?full=1   everything (old + current)
// GET /log/info       sizes         GET /log/clear    wipe
static void handleLog() {
  size_t total = k9LogSize();
  size_t want  = server.hasArg("full") ? total : min(total, (size_t)65536);
  size_t skip  = total - want;
  server.setContentLength(want);
  server.send(200, "text/plain; charset=utf-8", "");
  WiFiClient client = server.client();
  xSemaphoreTake(k9LogMux, portMAX_DELAY);
  const char* paths[2] = { K9_LOG_OLD, K9_LOG_PATH };
  uint8_t buf[512];
  for (int i = 0; i < 2; i++) {
    File f = LittleFS.open(paths[i]);
    if (!f) continue;
    size_t sz = f.size();
    if (skip >= sz) { skip -= sz; f.close(); continue; }
    if (skip) { f.seek(skip); skip = 0; }
    while (f.available() && client.connected()) {
      size_t n = f.read(buf, sizeof buf);
      if (!n || client.write(buf, n) != n) break;
    }
    f.close();
  }
  xSemaphoreGive(k9LogMux);
}

static void handleLogInfo() {
  char b[160];
  snprintf(b, sizeof b, "{\"size\":%u,\"fsTotal\":%u,\"fsUsed\":%u,\"heap\":%u,\"minHeap\":%u}",
           (unsigned)k9LogSize(), (unsigned)LittleFS.totalBytes(), (unsigned)LittleFS.usedBytes(),
           (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMinFreeHeap());
  server.send(200, "application/json", b);
}

static void handleLogClear() {
  k9LogClear();
  server.send(200, "text/plain", "cleared");
}

static void handleWifiConfig() {
  if (server.method() != HTTP_POST) {
    server.send(405, "text/plain", "POST only");
    return;
  }
  String newSsid = server.arg("ssid");
  String newPass = server.arg("pass");
  if (newSsid.isEmpty() || newSsid.length() > 32 || newPass.length() > 63) {
    server.send(400, "text/plain", "Invalid ssid/pass length");
    return;
  }
  k9Prefs.begin("k9-wifi", false);
  k9Prefs.putString("ssid", newSsid);
  k9Prefs.putString("pass", newPass);
  k9Prefs.end();
  server.send(200, "text/plain", "Saved Wi-Fi: " + newSsid + ". Rebooting...");
  delay(500);
  ESP.restart();
}

inline void enterFieldApMode();

static String dispatchCommand(const String& c, float fArg = 0.0f, float tArg = 0.0f, int legArg = 0, int deltaArg = 0) {
  if (c != "drive") k9Logf("cmd %s leg=%d d=%d", c.c_str(), legArg, deltaArg);   // drive is logged in the stat line
  if (c == "fieldap") {
    enterFieldApMode();
    return "FIELD_AP 192.168.4.1";
  } else if (c == "strobe") {               // UDP "S hz" (0 = stop), /cmd?c=strobe&v=hz
    setStrobe(deltaArg);
    return "STROBE " + String(strobeHz);
  } else if (c == "camq") {                        // image preset 0..2 (UDP "Q n", /cmd?c=camq&v=n)
    if (camInitialized) applyCamPreset(deltaArg);
    return "CAM " + String(camPreset);
  } else if (c == "flash") {                // toggle (on at 100 %)
    setFlash(flashPercent > 0 ? 0 : 100);
    return "FLASH " + String(flashPercent);
  } else if (c == "flashon") {
    setFlash(100);
    return "FLASH 100";
  } else if (c == "flashoff") {
    setFlash(0);
    return "FLASH 0";
  } else if (c == "level") {                // /cmd?c=level&v=0..100
    setFlash(deltaArg);
    return "FLASH " + String(flashPercent);
  } else if (c == "drive") {
    if (!isfinite(fArg)) fArg = 0.0f;
    if (!isfinite(tArg)) tArg = 0.0f;
    webOnDrive(constrain(fArg, -1.0f, 1.0f), constrain(tArg, -1.0f, 1.0f));
    return "DRIVE";
  } else if (c == "fwd") {
    webOnDrive(1.0f, 0.0f);
  } else if (c == "back") {
    webOnDrive(-1.0f, 0.0f);
  } else if (c == "left") {
    webOnDrive(0.0f, -1.0f);
  } else if (c == "right") {
    webOnDrive(0.0f, 1.0f);
  } else if (c == "stop") {
    webOnDrive(0.0f, 0.0f);
  } else if (c == "stand") {
    webOnAnim(1); // GC_ANIM_STAND = 1
  } else if (c == "sit") {
    webOnAnim(2); // GC_ANIM_SIT = 2
  } else if (c == "lie") {
    webOnAnim(3); // GC_ANIM_LIE = 3
  } else if (c == "wave") {
    webOnAnim(4); // GC_ANIM_WAVE_FR = 4
  } else if (c == "waveleft") {
    webOnAnim(5);
  } else if (c == "getup") {
    webOnAnim(6);
  } else if (c == "dance") {
    webOnAnim(7); // GC_ANIM_DANCE = 7
  } else if (c == "bow") {
    webOnAnim(8);
  } else if (c == "stretch") {
    webOnAnim(9);
  } else if (c == "wag") {
    webOnAnim(10);
  } else if (c == "dig") {
    webOnAnim(11);
  } else if (c == "wiggle") {
    webOnAnim(12);
  } else if (c == "cal") {
    webOnCalibrate(true);
    return "Servos 90° (1500us)";
  } else if (c == "test0") {
    webOnTestServo(0); return "Testou FL (IO14)";
  } else if (c == "test1") {
    webOnTestServo(1); return "Testou FR (IO15)";
  } else if (c == "test2") {
    webOnTestServo(2); return "Testou RL (IO13)";
  } else if (c == "test3") {
    webOnTestServo(3); return "Testou RR (IO2)";
  } else if (c == "trim") {
    static unsigned long lastTrimMs = 0;
    if (millis() - lastTrimMs < 150) return "BUSY";          // rate-limit NVS writes
    lastTrimMs = millis();
    webOnNudgeTrim(legArg, constrain(deltaArg, -50, 50));
    saveNvsTrim();
    return "Trim L" + String(legArg) + "=" + String(webGetTrimUs(legArg)) + "us";
  } else if (c == "gait" || c == "gait1" || c == "gait2" || c == "gait3" || c == "gait4") {
    const int idx = c == "gait" ? 0 : c.charAt(4) - '1';
    webOnGait(idx);
    return "Marcha " + String(idx + 1);
  }
  return "OK";
}

static void handleCmd() {
  String c = server.arg("c");
  float f = server.hasArg("f") ? server.arg("f").toFloat() : 0.0f;
  float t = server.hasArg("t") ? server.arg("t").toFloat() : 0.0f;
  int leg = server.hasArg("leg") ? server.arg("leg").toInt() : 0;
  int d   = server.hasArg("d") ? server.arg("d").toInt() : (server.hasArg("v") ? server.arg("v").toInt() : 0);
  String resp = dispatchCommand(c, f, t, leg, d);
  server.send(200, "text/plain", resp);
}

// Processa pacotes UDP de baixa latência (~2ms) na porta 4210
// Formatos aceitos:
//   "D <fwd> <turn>"     -> ex: "D 0.85 -0.20" (joystick proporcional 50Hz)
//   "C <cmd>"            -> ex: "C sit", "C stand", "C dance", "C cal", "C gait", "C test0"
//   "T <leg> <deltaUs>"  -> ex: "T 0 -10" (ajusta trim da pata e salva em NVS)
//   "PING"               -> responde imediatamente com o JSON completo de telemetria
static void handleUdpPackets() {
  int packetSize = udp.parsePacket();
  int budget = 8;                                  // never starve the gait loop
  while (packetSize > 0 && budget-- > 0) {
    char buf[128];
    int len = udp.read(buf, sizeof(buf) - 1);
    if (len > 0) {
      buf[len] = '\0';
      while (len > 0 && (buf[len - 1] == '\n' || buf[len - 1] == '\r')) buf[--len] = '\0';

      String reply = "OK";
      if (strncmp(buf, "D ", 2) == 0) {
        float f = 0.0f, t = 0.0f;
        sscanf(buf + 2, "%f %f", &f, &t);
        if (!isfinite(f)) f = 0.0f;
        if (!isfinite(t)) t = 0.0f;
        webOnDrive(constrain(f, -1.0f, 1.0f), constrain(t, -1.0f, 1.0f));
        reply = "ACK_D";
      } else if (strncmp(buf, "C ", 2) == 0) {
        reply = dispatchCommand(String(buf + 2));
      } else if (strncmp(buf, "S ", 2) == 0) {
        int hz = 0;
        sscanf(buf + 2, "%d", &hz);
        reply = dispatchCommand("strobe", 0, 0, 0, hz);
      } else if (strncmp(buf, "Q ", 2) == 0) {
        int q = 1;
        sscanf(buf + 2, "%d", &q);
        reply = dispatchCommand("camq", 0, 0, 0, q);
      } else if (strncmp(buf, "L ", 2) == 0) {
        int pct = 0;
        sscanf(buf + 2, "%d", &pct);
        reply = dispatchCommand("level", 0, 0, 0, pct);
      } else if (strncmp(buf, "T ", 2) == 0) {
        int leg = 0, delta = 0;
        sscanf(buf + 2, "%d %d", &leg, &delta);
        reply = dispatchCommand("trim", 0, 0, leg, delta);
      } else if (strncmp(buf, "PING", 4) == 0 || strncmp(buf, "STATUS", 6) == 0) {
        reply = buildTelemetryJson();
      }

      udp.beginPacket(udp.remoteIP(), udp.remotePort());
      udp.write((const uint8_t*)reply.c_str(), reply.length());
      udp.endPacket();
    }
    packetSize = udp.parsePacket();
  }
}

// One deadline covers header + JPEG + trailer. Do not use WiFiClient::write:
// Arduino 2.x retries select() for up to one second per iteration.
static bool sendBeforeDeadline(int fd, const uint8_t* data, size_t len, int64_t deadline) {
  while (len) {
    int64_t remaining = deadline - esp_timer_get_time();
    if (remaining <= 0) return false;
    int sent = send(fd, data, len, MSG_DONTWAIT);
    if (sent > 0) { data += sent; len -= sent; continue; }
    if (sent == 0) return false;
    if (errno == EINTR) continue;
    if (errno != EAGAIN && errno != EWOULDBLOCK) return false;
    remaining = deadline - esp_timer_get_time();
    if (remaining <= 0) return false;
    fd_set writable; FD_ZERO(&writable); FD_SET(fd, &writable);
    timeval timeout = { (long)(remaining / 1000000), (long)(remaining % 1000000) };
    int ready = select(fd + 1, nullptr, &writable, nullptr, &timeout);
    if (ready < 0 && errno == EINTR) continue;
    if (ready <= 0) return false;
  }
  return esp_timer_get_time() <= deadline;
}

// Task dedicada no Core 1: stream MJPEG da porta 81 para ate 3 espectadores.
// Um unico grab da camera por ciclo e enviado a todos. Espectador novo com a fila
// cheia derruba o MAIS ANTIGO (uma aba esquecida/travada nunca bloqueia ninguem).
#define MAX_STREAM_CLIENTS 3
static WiFiServer streamSrv(81);

static void streamTask(void* pvParameters) {
  (void)pvParameters;
  WiFiClient clients[MAX_STREAM_CLIENTS];
  unsigned long since[MAX_STREAM_CLIENTS] = {0};
  streamSrv.begin();

  for (;;) {
    WiFiClient nc = streamSrv.available();
    if (nc) {
      nc.setTimeout(1);
      String req = nc.readStringUntil('\n');            // "GET /stream HTTP/1.1"
      while (nc.available()) nc.read();                  // drop the other headers
      if (!camInitialized) {
        nc.print("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
        nc.stop();
      } else if (req.indexOf("/stream") < 0) {
        nc.print("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        nc.stop();
      } else {
        int slot = -1;
        for (int i = 0; i < MAX_STREAM_CLIENTS; i++) if (!clients[i].connected()) { slot = i; break; }
        if (slot < 0) {                                  // all busy: evict the oldest
          slot = 0;
          for (int i = 1; i < MAX_STREAM_CLIENTS; i++) if (since[i] < since[slot]) slot = i;
          clients[slot].stop();
        }
        nc.setNoDelay(true);
        nc.setTimeout(1);
        timeval sendTimeout = {0, 150000};
        setsockopt(nc.fd(), SOL_SOCKET, SO_SNDTIMEO, &sendTimeout, sizeof(sendTimeout));
        nc.print("HTTP/1.1 200 OK\r\nCache-Control: no-store\r\n"
                 "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n");
        clients[slot] = nc;
        since[slot] = millis();
      }
    }

    bool any = false;
    for (int i = 0; i < MAX_STREAM_CLIENTS; i++) if (clients[i].connected()) any = true;
    if (!any) { vTaskDelay(pdMS_TO_TICKS(20)); continue; }

    if (xSemaphoreTake(cameraLock, pdMS_TO_TICKS(100)) != pdTRUE) continue;
    int64_t getStarted = esp_timer_get_time();
    camera_fb_t* fb = esp_camera_fb_get();
    uint32_t getUs = (uint32_t)(esp_timer_get_time() - getStarted);
    if (!fb) { xSemaphoreGive(cameraLock); vTaskDelay(pdMS_TO_TICKS(10)); continue; }
    char hdr[96];
    int hn = snprintf(hdr, sizeof(hdr),
                      "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", (unsigned)fb->len);
    const int64_t sendStarted = esp_timer_get_time();
    const int64_t deadline = sendStarted + 150000; // global budget, even with several viewers
    uint32_t sentFrames = 0, drops = 0;
    for (int i = 0; i < MAX_STREAM_CLIENTS; i++) {
      if (!clients[i].connected()) continue;
      int fd = clients[i].fd();
      bool ok = sendBeforeDeadline(fd, (const uint8_t*)hdr, hn, deadline)
             && sendBeforeDeadline(fd, fb->buf, fb->len, deadline)
             && sendBeforeDeadline(fd, (const uint8_t*)"\r\n", 2, deadline);
      if (!ok) {
        // A partially sent multipart frame cannot be skipped on this connection.
        // Linger off: close locally without waiting for peer acknowledgements.
        linger noLinger = {0, 0};
        setsockopt(fd, SOL_SOCKET, SO_LINGER, &noLinger, sizeof(noLinger));
        clients[i].stop();
        drops++;
      } else sentFrames++;
    }
    uint32_t sendUs = (uint32_t)(esp_timer_get_time() - sendStarted);
    portENTER_CRITICAL(&diagMux);
    cameraDiag.streamGetUs = getUs;
    cameraDiag.streamSendUs = sendUs;
    if (sendUs > cameraDiag.streamMaxSendUs) cameraDiag.streamMaxSendUs = sendUs;
    cameraDiag.streamFrames += sentFrames;
    cameraDiag.streamDrops += drops;
    portEXIT_CRITICAL(&diagMux);
    esp_camera_fb_return(fb);
    xSemaphoreGive(cameraLock);
    vTaskDelay(1);
  }
}

// Arduino-ESP32 2.x WiFiClient copies share the socket handle. WebServer
// drops its copy after this handler; the worker owns the remaining copy.
// Never call WebServer methods from the worker. Queue contains pointers, not
// memcpy'd C++ WiFiClient objects. One slot includes queued + active work.
static void captureTask(void*) {
  for (;;) {
    WiFiClient* client = nullptr;
    if (xQueueReceive(captureJobs, &client, portMAX_DELAY) != pdTRUE) continue;
    camera_fb_t* fb = nullptr;
    bool locked = xSemaphoreTake(cameraLock, pdMS_TO_TICKS(200)) == pdTRUE;
    uint32_t getUs = 0, sendUs = 0, bytes = 0;
    bool ok = false;
    client->setNoDelay(true);
    client->setTimeout(2);
    if (locked) {
      int64_t start = esp_timer_get_time();
      fb = esp_camera_fb_get();
      getUs = (uint32_t)(esp_timer_get_time() - start);
    }
    if (fb) {
      bytes = fb->len;
      int64_t stamp = (int64_t)fb->timestamp.tv_sec * 1000000 + fb->timestamp.tv_usec;
      uint32_t ageUs = (uint32_t)(esp_timer_get_time() - stamp);
      char header[320];
      int n = snprintf(header, sizeof header,
        "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n"
        "Connection: close\r\nCache-Control: no-store\r\nX-Fb-Get-Us: %u\r\n"
        "X-Frame-Age-Us: %u\r\nX-RSSI: %d\r\n\r\n", bytes, getUs, ageUs, WiFi.RSSI());
      int64_t start = esp_timer_get_time();
      ok = client->write((const uint8_t*)header, n) == (size_t)n;
      // One application-level write for the entire JPEG; TCP still segments it.
      if (ok) ok = client->write(fb->buf, fb->len) == fb->len;
      sendUs = (uint32_t)(esp_timer_get_time() - start);
      esp_camera_fb_return(fb);
    } else {
      client->print("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    }
    if (locked) xSemaphoreGive(cameraLock);
    client->stop(); delete client;
    portENTER_CRITICAL(&diagMux);
    cameraDiag.fbGetUs = getUs; cameraDiag.sendUs = sendUs;
    cameraDiag.bytes = bytes; cameraDiag.updatedMs = millis();
    if (ok) cameraDiag.completed++; else cameraDiag.failures++;
    cameraDiag.busy = false;
    portEXIT_CRITICAL(&diagMux);
    xSemaphoreGive(captureSlot);
    vTaskDelay(1); // allow idle/system work; no busy loop on either core
  }
}
static void handleCapture() {
  if (!camInitialized || !captureJobs || !captureSlot || xSemaphoreTake(captureSlot, 0) != pdTRUE) {
    server.send(503, "text/plain", "Camera busy"); return;
  }
  WiFiClient* client = new (std::nothrow) WiFiClient(server.client());
  if (!client) { xSemaphoreGive(captureSlot); server.send(503, "text/plain", "No memory"); return; }
  portENTER_CRITICAL(&diagMux); cameraDiag.busy = true; portEXIT_CRITICAL(&diagMux);
  if (xQueueSend(captureJobs, &client, 0) != pdTRUE) {
    delete client;
    portENTER_CRITICAL(&diagMux); cameraDiag.busy = false; portEXIT_CRITICAL(&diagMux);
    xSemaphoreGive(captureSlot); server.send(503, "text/plain", "Camera busy");
  }
}

inline bool initCameraModule() {
  camera_config_t config = {};
  config.fb_location  = CAMERA_FB_IN_PSRAM;
  config.sccb_i2c_port = -1;
  config.ledc_channel = LEDC_CHANNEL_4;
  config.ledc_timer   = LEDC_TIMER_2;
  config.pin_d0       = CAM_PIN_D0;
  config.pin_d1       = CAM_PIN_D1;
  config.pin_d2       = CAM_PIN_D2;
  config.pin_d3       = CAM_PIN_D3;
  config.pin_d4       = CAM_PIN_D4;
  config.pin_d5       = CAM_PIN_D5;
  config.pin_d6       = CAM_PIN_D6;
  config.pin_d7       = CAM_PIN_D7;
  config.pin_xclk     = CAM_PIN_XCLK;
  config.pin_pclk     = CAM_PIN_PCLK;
  config.pin_vsync    = CAM_PIN_VSYNC;
  config.pin_href     = CAM_PIN_HREF;
  config.pin_sccb_sda = CAM_PIN_SIOD;
  config.pin_sccb_scl = CAM_PIN_SIOC;
  config.pin_pwdn     = CAM_PIN_PWDN;
  config.pin_reset    = CAM_PIN_RESET;
  config.xclk_freq_hz = K9_CAM_XCLK_HZ;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size   = K9_CAM_FRAME_SIZE;
  config.jpeg_quality = K9_CAM_JPEG_QUALITY;              // 0-63, HIGHER = smaller/faster JPEG
  config.fb_count     = 2;
  config.grab_mode    = CAMERA_GRAB_LATEST;

  cameraInitCore = xPortGetCoreID();
  esp_err_t err = esp_camera_init(&config);
  camInitialized = (err == ESP_OK);
  if (camInitialized) {
    cameraLock = xSemaphoreCreateMutex();
    if (!cameraLock) { esp_camera_deinit(); camInitialized = false; return false; }
    sensor_t* s = esp_camera_sensor_get();
    int effect = s->set_special_effect(s, 0);
    int lens = s->set_lenc(s, 1);
    int gamma = s->set_raw_gma(s, 1);
    int sharpness = s->set_sharpness(s, 1);
    applyCamPreset(camPreset);
    k9Logf("camera radio-survival-v1 PID=0x%x xclk=%u quality=%d color_result=%d lenc_result=%d gamma_result=%d sharpness_result=%d", s->id.PID, K9_CAM_XCLK_HZ, K9_CAM_JPEG_QUALITY, effect, lens, gamma, sharpness);
    Serial.printf("[cam] Camera %s inicializada com sucesso!\n", isOv3660 ? "OV3660" : "OV2640");
  } else {
    Serial.printf("[cam] Falha ao iniciar camera: 0x%x\n", err);
  }
  return camInitialized;
}

// Camera initialization and streaming share the same pinned task. The completion
// semaphore publishes initialization state before HTTP starts reading it.
static void cameraServiceTask(void*) {
#ifndef K9_NO_CAM
  initCameraModule();
#endif
  xSemaphoreGive(cameraInitDone);
  ulTaskNotifyTake(pdTRUE, portMAX_DELAY); // wait until Wi-Fi and HTTP are ready
  streamTask(nullptr);
}

inline void enterFieldApMode() {
  fieldMode = true;
  WiFi.setAutoReconnect(false);
  WiFi.disconnect(true);
  WiFi.mode(WIFI_AP);                                 // pure AP on channel 1: no background STA channel scanning
  WiFi.softAP("Minirobo-K9", K9_AP_PASS, 1, 0, 2);    // max 2 clients
  WiFi.setTxPower(WIFI_POWER_17dBm);                  // stable range in field without brownout current spikes
  Serial.print(F("[wifi] Modo Campo (WIFI_AP puro Ch 1) ativo em: http://"));
  Serial.println(WiFi.softAPIP());
}

inline void initWebServer() {
  k9LogInit();
  setupCore = xPortGetCoreID();
  cameraInitDone = xSemaphoreCreateBinary();
  if (cameraInitDone && xTaskCreatePinnedToCore(cameraServiceTask, "CamService", 8192,
                                               nullptr, 1, &cameraService, 1) == pdPASS) {
    xSemaphoreTake(cameraInitDone, portMAX_DELAY);
  } else {
    cameraService = nullptr;
    k9Logf("camera service creation failed");
  }
  if (cameraInitDone) { vSemaphoreDelete(cameraInitDone); cameraInitDone = nullptr; }
  initFlash();
  setFlash(K9_CAM_BOOT_FLASH);

  // Carrega credenciais Wi-Fi da NVS (ou usa o padrão definido em secrets.h)
  k9Prefs.begin("k9-wifi", false);
  String homeSsid = k9Prefs.getString("ssid", DEFAULT_HOME_SSID);
  String homePass = k9Prefs.getString("pass", DEFAULT_HOME_PASS);
  k9Prefs.end();

  // Station-only first: an always-on soft-AP shares the single radio with the home
  // network (channel hopping, more airtime, more current). The AP only comes up as a
  // fallback when the home Wi-Fi is not reachable.
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  esp_wifi_set_ps(WIFI_PS_NONE);
  WiFi.setAutoReconnect(true);
  WiFi.setScanMethod(WIFI_ALL_CHANNEL_SCAN);       // MESH (router + 2 nodes, same SSID): the default joins the FIRST AP found,
  WiFi.setSortMethod(WIFI_CONNECT_AP_BY_SIGNAL);   // often a far one. Look at every node and join the STRONGEST.
#ifdef K9_CAM_ONLY
  WiFi.setTxPower(K9_CAM_TX_POWER);   // adjustable RF diagnostic setting
#endif

#if defined(K9_CAM_ONLY) && defined(K9_CAM_STATIC_IP)
  IPAddress staticIp, gateway, subnet, dns;
  if (staticIp.fromString(K9_CAM_STATIC_IP) && gateway.fromString(K9_GATEWAY_IP) && subnet.fromString(K9_SUBNET_MASK)) {
    dns.fromString(K9_DNS_IP);
    WiFi.config(staticIp, gateway, subnet, dns);
    Serial.printf("[wifi] Configurando IP Estatico da Camera: %s\n", K9_CAM_STATIC_IP);
  }
#elif !defined(K9_CAM_ONLY) && defined(K9_LEGS_STATIC_IP)
  IPAddress staticIp, gateway, subnet, dns;
  if (staticIp.fromString(K9_LEGS_STATIC_IP) && gateway.fromString(K9_GATEWAY_IP) && subnet.fromString(K9_SUBNET_MASK)) {
    dns.fromString(K9_DNS_IP);
    WiFi.config(staticIp, gateway, subnet, dns);
    Serial.printf("[wifi] Configurando IP Estatico das Pernas: %s\n", K9_LEGS_STATIC_IP);
  }
#endif

  Serial.printf("[wifi] Conectando ao Wi-Fi residencial \"%s\"...\n", homeSsid.c_str());
  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
    if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
      Serial.printf("[wifi-diag] disconnected reason=%u\n", info.wifi_sta_disconnected.reason);
    } else if (event == ARDUINO_EVENT_WIFI_STA_CONNECTED) {
      Serial.printf("[wifi-diag] associated channel=%u\n", info.wifi_sta_connected.channel);
    } else if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
      Serial.println("[wifi-diag] got IP; applying survival settings");
      applyRadioSurvival();
    }
  });
  // Set bandwidth before association, not from GOT_IP: changing it on a live
  // connection can trigger a leave/reassociation cycle.
  esp_err_t bandwidthResult = esp_wifi_set_bandwidth(WIFI_IF_STA, WIFI_BW_HT20);
  Serial.printf("[wifi-diag] HT20 before connect result=%d\n", (int)bandwidthResult);
  WiFi.begin(homeSsid.c_str(), homePass.c_str());

  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    applyRadioSurvival();
    fieldMode = false;
    Serial.print(F("[wifi] Conectado na rede da casa! IP: http://"));
    Serial.println(WiFi.localIP());
  } else {
    enterFieldApMode();
  }

  // Inicia mDNS (http://k9.local) e OTA sem fio
  if (MDNS.begin(K9_MDNS_HOST)) {
    MDNS.addService("http", "tcp", 80);
    MDNS.addService("k9udp", "udp", K9_UDP_PORT);
    Serial.printf("[mdns] Disponivel em http://%s.local\n", K9_MDNS_HOST);
  }
  ArduinoOTA.setHostname(K9_MDNS_HOST);
  if (strlen(K9_OTA_PASS) > 0) ArduinoOTA.setPassword(K9_OTA_PASS);
  ArduinoOTA.onStart([]() {
    webOnCalibrate(true); // Estaciona os servos em segurança durante gravação OTA
  });
  ArduinoOTA.begin();

  captureJobs = xQueueCreate(1, sizeof(WiFiClient*));
  captureSlot = xSemaphoreCreateBinary();
  if (captureJobs && captureSlot &&
      xTaskCreatePinnedToCore(captureTask, "CamCapture", 6144, nullptr, 1, nullptr, 1) == pdPASS) {
    xSemaphoreGive(captureSlot);
  } else {
    if (captureJobs) vQueueDelete(captureJobs);
    if (captureSlot) vSemaphoreDelete(captureSlot);
    captureJobs = nullptr; captureSlot = nullptr;
    k9Logf("capture worker unavailable");
  }

  // Servidor HTTP na Porta 80
  server.on("/", handleRoot);
  server.on("/cmd", handleCmd);
  server.on("/status", handleStatus);
  server.on("/health", handleStatus);
  server.on("/capture", HTTP_GET, handleCapture);
  server.on("/wifi", handleWifiConfig);
  server.on("/log", handleLog);
  server.on("/log/info", handleLogInfo);
  server.on("/log/clear", handleLogClear);
  server.begin();

  // Servidor UDP de Baixa Latência na Porta 4210
  udp.begin(K9_UDP_PORT);

  // Servidor de Vídeo na Porta 81 em Task separada (Core 1)
  if (cameraService) xTaskNotifyGive(cameraService);

  Serial.printf("[net] HTTP:80 | Stream:81 | UDP:%d | OTA prontos!\n", K9_UDP_PORT);
}

// One status line every 5 s (1 s while driving) + Wi-Fi up/down events + NTP clock.
static void logStatus() {
  static unsigned long lastMs = 0;
  static bool wasUp = false, ntpSet = false;
  bool up = WiFi.status() == WL_CONNECTED;
  if (up != wasUp) {
    wasUp = up;
    if (up) {
      k9Logf("wifi UP %s rssi %d", WiFi.localIP().toString().c_str(), WiFi.RSSI());
      if (!ntpSet) { configTime(K9_TZ_OFFSET_S, 0, "pool.ntp.org", "time.google.com"); ntpSet = true; }
    } else {
      k9Logf("wifi DOWN");
    }
  }
  bool moving = fabsf(webGetDriveFwd()) > 0.05f || fabsf(webGetDriveTurn()) > 0.05f;
  if (millis() - lastMs < (moving ? 1000UL : 5000UL)) return;
  lastMs = millis();
  k9Logf("stat heap=%u min=%u rssi=%d fwd=%.2f turn=%.2f gait=%d flash=%d us=%d,%d,%d,%d",
         (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMinFreeHeap(), up ? WiFi.RSSI() : 0,
         webGetDriveFwd(), webGetDriveTurn(), webGetGaitSel() + 1, flashPercent,
         webGetLastUs(0), webGetLastUs(1), webGetLastUs(2), webGetLastUs(3));
}


// Mesh: the ESP32 never roams. If the signal stays weak while the robot is idle, rescan (strongest node wins).
static void weakSignalRescan() {
  if (fieldMode) return;
  static unsigned long weakSince = 0, lastRescan = 0;
  bool idle = fabsf(webGetDriveFwd()) < 0.05f && fabsf(webGetDriveTurn()) < 0.05f;
  if (WiFi.status() == WL_CONNECTED && WiFi.RSSI() < -78) { if (!weakSince) weakSince = millis(); }
  else weakSince = 0;
  if (weakSince && idle && millis() - weakSince > 30000UL && millis() - lastRescan > 120000UL) {
    lastRescan = millis(); weakSince = 0;
    k9Logf("rssi weak (%d dBm): rescanning for a stronger mesh node", WiFi.RSSI());
    WiFi.disconnect(false);
    WiFi.reconnect();
  }
}

inline void updateWebServer() {
  static unsigned long lastPsCheck = 0;
  if (millis() - lastPsCheck >= 1000UL) {
    lastPsCheck = millis();
    if (WiFi.status() == WL_CONNECTED) {
      wifi_ps_type_t ps;
      if (esp_wifi_get_ps(&ps) == ESP_OK && ps != WIFI_PS_NONE) {
        WiFi.setSleep(false);
        esp_wifi_set_ps(WIFI_PS_NONE);
        k9Logf("power save unexpectedly enabled; restored NONE");
      }
    }
  }
  weakSignalRescan();
  server.handleClient();
  logStatus();
  handleUdpPackets();
  updateFlash();
  ArduinoOTA.handle();
}

#endif
