#include "speaker.h"
#include "action_sounds.h"
#pragma once
#include "firmware_version.h"

#ifdef BOARD_ESP32CAM
#include <WiFi.h>
#include <WiFiUdp.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <Preferences.h>
#include "esp_camera.h"
#include <lwip/sockets.h>
#include <errno.h>

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
#define FLASH_PWM_HZ       20000      // above the camera rolling-shutter banding range
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

static int           flashApplied = 0;       // level actually driven; ramps toward flashPercent
static unsigned long flashRampMs  = 0;

// Level 0..100 -> raw duty: squared curve (the slider's middle LOOKS like the middle) + thermal cap.
static int flashDutyFor(int level) {
  int shaped = (level * level) / 100;
  int capped = (shaped * FLASH_MAX_PERCENT) / 100;
  return (capped * ((1 << FLASH_PWM_BITS) - 1)) / 100;
}
static void flashDuty(bool on) { flashWriteDuty(on ? flashDutyFor(flashPercent) : 0); }

static void setStrobe(int hz) {
  hz = constrain(hz, 0, STROBE_MAX_HZ);
  if (hz == 0) {                                  // stop: LED off
    strobeHz = 0; strobeOn = false;
    flashPercent = 0; flashApplied = 0; flashWriteDuty(0);
    return;
  }
  if (flashPercent == 0) { flashPercent = 100; flashOnSinceMs = millis(); }
  strobeHz = hz; strobeOn = true; strobeLastMs = millis();
  flashDuty(true);
}

static void setFlash(int percent) {
  if (strobeHz > 0) { strobeHz = 0; strobeOn = false; flashApplied = 0; flashWriteDuty(0); }   // a steady level cancels the strobe
  percent = constrain(percent, 0, 100);
  if (percent > 0 && flashPercent == 0) flashOnSinceMs = millis();
  flashPercent = percent;
  if (percent == 0) { flashApplied = 0; flashWriteDuty(0); }   // off is immediate, on is a short ramp (updateFlash)
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
  } else if (flashApplied != flashPercent && millis() - flashRampMs >= 25) {
    flashRampMs = millis();                       // ~100 ms to full: avoids a current step the instant the AEC reacts
    flashApplied += constrain(flashPercent - flashApplied, -25, 25);
    flashWriteDuty(flashDutyFor(flashApplied));
  }
}

static Preferences k9Prefs;

// Image presets, switchable at runtime from the dashboard (no reboot, no reflash).
// The camera is INITIALISED at the biggest preset (CIF) so its frame buffers fit; changing
// framesize/quality afterwards only reprograms the sensor. All sizes up to CIF use the OV2640's
// native CIF mode, so switching between them does not change the sensor mode (esp32-camera ov2640.c).
//   0 Rapida       240x176 q24   light on Wi-Fi/power, default
//   1 Equilibrada  320x240 q20   clearly sharper
//   2 Nitida       400x296 q18   best picture; roughly 3x the bytes of preset 0
#define CAM_PRESETS 3
static int camPreset = 0;
static bool isOv3660 = false;
static bool fieldMode = false;
// Extra image options (all persisted in NVS "k9-cam"): UDP "O <key> <val>" / dashboard.
//   1 brightness -2..2   2 mirror 0/1   3 flip 0/1   4 night mode 0/1   5 fps cap 5..15
static int camBri = 0, camHm = 0, camVf = 0, camNight = 0, camFpsCap = 12;

static void camPrefsLoad() {
  k9Prefs.begin("k9-cam", true);
  camPreset = constrain(k9Prefs.getInt("preset", 0), 0, CAM_PRESETS - 1);
  camBri = constrain(k9Prefs.getInt("bri", 0), -2, 2);
  camHm = k9Prefs.getInt("hm", 0) ? 1 : 0;
  camVf = k9Prefs.getInt("vf", 0) ? 1 : 0;
  camNight = k9Prefs.getInt("night", 0) ? 1 : 0;
  camFpsCap = constrain(k9Prefs.getInt("fps", 12), 5, 15);
  k9Prefs.end();
}
static void camPrefsSave() {                       // only called on a user change: NVS wear is negligible
  k9Prefs.begin("k9-cam", false);
  k9Prefs.putInt("preset", camPreset); k9Prefs.putInt("bri", camBri); k9Prefs.putInt("hm", camHm);
  k9Prefs.putInt("vf", camVf); k9Prefs.putInt("night", camNight); k9Prefs.putInt("fps", camFpsCap);
  k9Prefs.end();
}

// framesize writes the sensor's window/JPEG registers, so this is re-applied after every size change.
static void applyImageTuning(sensor_t* s) {
  s->set_gain_ctrl(s, 1); s->set_exposure_ctrl(s, 1);
  s->set_whitebal(s, 1);  s->set_awb_gain(s, 1);
  // Reference defaults (easytarget): aec2 off, ae_level 0, driver-default gain ceiling. The first
  // 'improved' tuning (aec2 + level +1 + 16X) made the picture worse, so only night mode departs from default.
  s->set_aec2(s, camNight ? 1 : 0);
  s->set_ae_level(s, camNight ? 2 : 0);
  s->set_gainceiling(s, camNight ? GAINCEILING_32X : GAINCEILING_8X);
  s->set_lenc(s, 1); s->set_wpc(s, 1); s->set_bpc(s, 1); s->set_raw_gma(s, 1); s->set_dcw(s, 1);
  s->set_brightness(s, camBri);
  s->set_hmirror(s, camHm); s->set_vflip(s, camVf);
}

static void applyCamPreset(int p) {
  static const framesize_t FS_2640[CAM_PRESETS] = { FRAMESIZE_HQVGA, FRAMESIZE_QVGA, FRAMESIZE_CIF };
  static const int          Q_2640[CAM_PRESETS] = { 24, 20, 18 };
  static const framesize_t FS_3660[CAM_PRESETS] = { FRAMESIZE_QVGA, FRAMESIZE_CIF, FRAMESIZE_VGA };
  static const int          Q_3660[CAM_PRESETS] = { 28, 22, 18 };
  p = constrain(p, 0, CAM_PRESETS - 1);
  sensor_t* s = esp_camera_sensor_get();
  if (s) {
    isOv3660 = (s->id.PID == OV3660_PID);
    s->set_framesize(s, isOv3660 ? FS_3660[p] : FS_2640[p]);
    s->set_quality(s, isOv3660 ? Q_3660[p] : Q_2640[p]);
    applyImageTuning(s);
  }
  camPreset = p;
}

static void setCamOpt(int key, int v) {
  switch (key) {
    case 1: camBri = constrain(v, -2, 2); break;
    case 2: camHm = v ? 1 : 0; break;
    case 3: camVf = v ? 1 : 0; break;
    case 4: camNight = v ? 1 : 0; break;
    case 5: camFpsCap = constrain(v, 5, 15); break;
    default: return;
  }
  sensor_t* s = esp_camera_sensor_get();
  if (s) applyImageTuning(s);
  camPrefsSave();
}

// Stream statistics (written by the stream task, reported by logStatus)
static volatile uint32_t streamFrames = 0, streamBytes = 0;

static WebServer server(80);
static WiFiUDP udp;
static bool camInitialized = false;
static unsigned long lastWifiCheckMs = 0;

// Callbacks provided by main.cpp
void  webOnDrive(float fwd, float turn);
void  webOnAnim(int animCode);
#ifdef K9_SPEAKER_GPIO
bool webDanceActive();
float webLaughTime();
int webActivity();
unsigned short webScratchHz();
float webActivityTime();
void webOnHalt();
#endif
void  webOnCalibrate(bool hold);
void  webOnGait(int gaitIdx);
void  webOnTestServo(int idx);
#ifndef K9_CAM_ONLY
void webOnManualServo(int idx, int step);
#endif
void  webOnNudgeTrim(int idx, int deltaUs);
int   webGetTrimUs(int idx);
void  webSetTrimUs(int idx, int us);
int   webGetLastUs(int idx);
float webGetLegDeg(int idx);
int   webGetGaitSel();
bool webOnTune(float freq, float stride, float duty, float posture, float ratio);
bool webOnPhase(float fl, float fr, float rl, float rr);   // leg phase offsets in degrees (0..360)
bool webOnBegTune(float front, float rear, float burstDegS, float burstTo);   // live angles of the beg pose, UDP "B <front> <rear> [burstDegS burstTo]"
float webGetGaitParam(int i);
bool  webOnRearDuty(float add);   // rear-return variation, UDP "R <add>" (0 = off)
float webGetRearDuty();
float webGetLegPhase(int i);
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
  char buf[760];
  snprintf(buf, sizeof(buf),
    "{\"firmwareVersion\":\"" K9_FIRMWARE_VERSION "\",\"device\":\"" K9_DEVICE_NAME "\",\"ip\":\"%s\",\"ssid\":\"%s\",\"rssi\":%d,\"uptime\":%lu,\"heap\":%u,"
    "\"fwd\":%.2f,\"turn\":%.2f,\"gait\":%d,\"controlsVersion\":2,\"hold\":%s,\"flash\":%d,\"strobe\":%d,\"cam\":%d,\"opt\":[%d,%d,%d,%d,%d],"
    "\"gaitParams\":[%.2f,%.2f,%.2f,%.2f,%.2f],\"rearDuty\":%.2f,\"phase\":[%.0f,%.0f,%.0f,%.0f],"
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
    camBri, camHm, camVf, camNight, camFpsCap,
    webGetGaitParam(0), webGetGaitParam(1), webGetGaitParam(2), webGetGaitParam(3), webGetGaitParam(4),
    webGetRearDuty(),
    webGetLegPhase(0), webGetLegPhase(1), webGetLegPhase(2), webGetLegPhase(3),
    webGetTrimUs(0), webGetTrimUs(1), webGetTrimUs(2), webGetTrimUs(3),
    webGetLastUs(0), webGetLastUs(1), webGetLastUs(2), webGetLastUs(3),
    webGetLegDeg(0), webGetLegDeg(1), webGetLegDeg(2), webGetLegDeg(3)
  );
  String result(buf);
#ifdef K9_SPEAKER_GPIO
  result.remove(result.length()-1);
  result += ",\"soundMuted\":"; result += soundMuted ? "true" : "false";
  result += ",\"soundAutomatic\":"; result += soundAutomatic ? "true" : "false";
  result += ",\"soundVolume\":"; result += String(soundVolume);
  result += ",\"activity\":"; result += String(webActivity());
  result += ",\"activityTime\":"; result += String(webActivityTime(),2);
  result += ",\"soundMusic\":\""; result += soundMusic; result += "\"";
  result += "}";
#endif
  return result;
}

static const char HTML_INDEX[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>🤖 Minirobo K9V2.1 — Campo</title>
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
  <div class="status" id="statusTxt">✅ Pronto — modo campo (só pernas, sem vídeo)</div>

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
  </div>

  <div class="section-title">Marchas & Poses</div>
  <div class="actions">
    <button class="btn" onclick="sendCmd('stand')">🧍 Em pé</button>
    <button class="btn" onclick="sendCmd('sit')">🪑 Sentar</button>
    <button class="btn" onclick="sendCmd('lie')">🛌 Deitar</button>
    <button class="btn" onclick="sendCmd('wave')">🐾 Pata D</button>
    <button class="btn" onclick="sendCmd('waveleft')">🐾 Pata E</button>
    <button class="btn" onclick="sendCmd('dance')">💃 Dançar</button>
    <button class="btn" onclick="sendCmd('stretch')">🐕 Alongar</button>
    <button class="btn" onclick="sendCmd('wag')">🐕 Abanar</button>
    <button class="btn" onclick="sendCmd('dig')">🐾 Cavar</button>
    <button class="btn" onclick="sendCmd('scratch')">🐕 Coçar</button>
    <button class="btn" onclick="sendCmd('beg')">🐕 Pedir</button>
    <button class="btn" onclick="sendCmd('gait1')">Marcha 1</button>
    <button class="btn" onclick="sendCmd('gait2')">Marcha 2</button>
    <button class="btn" onclick="sendCmd('gait3')">Marcha 3</button>
    <button class="btn" onclick="sendCmd('gait4')">Marcha 4</button>
    <button class="btn" onclick="sendCmd('gait5')">Marcha 5 (MK3 diagonal)</button>
    <button class="btn" onclick="sendCmd('gait6')">Marcha 6 (MK3 lado)</button>
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
    let driveTimer = null;

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
  server.send(200, "application/json", buildTelemetryJson());
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
  k9Prefs.begin("k9-net", false); k9Prefs.clear(); k9Prefs.end();   // different network: forget the fast-reconnect cache
  server.send(200, "text/plain", "Saved Wi-Fi: " + newSsid + ". Rebooting...");
  delay(500);
  ESP.restart();
}

inline void enterFieldApMode();

static String dispatchCommand(const String& c, float fArg = 0.0f, float tArg = 0.0f, int legArg = 0, int deltaArg = 0) {
#ifdef K9_SPEAKER_GPIO
  const char* personalityCmds[]={"wake","sleep","emotion_curious","emotion_angry","emotion_shy","emotion_celebrate","emotion_greet","emotion_glitch"};
  for(int i=0;i<8;i++) if(c==personalityCmds[i]) {
    soundCommand("sound_stop"); emotionSeen=0; webOnAnim(17+i); return "PERSONALITY OK";
  }
  if (c == "emotion_laugh") { laughSeen=false; soundStop(); webOnAnim(16); return "EMOTION OK"; }
  if (c == "emotion_happy") { webOnAnim(10); soundCommand("sound_laugh"); return "EMOTION OK"; }
  if (c == "emotion_sad") { webOnAnim(2); soundCommand("sound_sad"); return "EMOTION OK"; }
  if (c == "emotion_confused") { webOnAnim(12); soundCommand("sound_crazy"); return "EMOTION OK"; }


  if (soundCommand(c)) return "SOUND OK";
  if (c == "stop") soundStop();
  else soundForAction(c);
#endif
#ifndef K9_CAM_ONLY
  if (c.length() == 8 && c.startsWith("jog") && c[3] >= '0' && c[3] <= '3') {
    String direction = c.substring(4);
    if (direction != "plus" && direction != "less") return "ERR";
#ifdef K9_SPEAKER_GPIO
    soundStop();
#endif
    webOnManualServo(c[3]-'0', direction == "plus" ? 5 : -5);
    return "SERVO TEST OK";
  }
#endif
  if (c != "drive") k9Logf("cmd %s leg=%d d=%d", c.c_str(), legArg, deltaArg);   // drive is logged in the stat line
  if (c == "fieldap") {
    enterFieldApMode();
    return "FIELD_AP 192.168.4.1";
  } else if (c == "strobe") {               // UDP "S hz" (0 = stop), /cmd?c=strobe&v=hz
    setStrobe(deltaArg);
    return "STROBE " + String(strobeHz);
  } else if (c == "camq") {                        // image preset 0..2 (UDP "Q n", /cmd?c=camq&v=n)
    if (camInitialized) { applyCamPreset(deltaArg); camPrefsSave(); }
    return "CAM " + String(camPreset);
  } else if (c == "camopt") {               // UDP "O key val": legArg = key, deltaArg = value
    if (camInitialized) setCamOpt(legArg, deltaArg);
    return "OPT";
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
#ifdef K9_SPEAKER_GPIO
    webOnHalt();
#else
    webOnDrive(0.0f, 0.0f);
#endif
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
  } else if (c == "scratch") {
#ifdef K9_SPEAKER_GPIO
    emotionSeen=0;
#endif
    webOnAnim(13); // GC_ANIM_SCRATCH = 13: sit and scratch the belly
  } else if (c == "beg") {
    webOnAnim(14); // GC_ANIM_BEG = 14: half sitting with both front legs raised, held
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
  } else if (c == "gait" || c == "gait1" || c == "gait2" || c == "gait3" || c == "gait4" || c == "gait5" || c == "gait6") {
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
        reply = "";   // no ACK for D: the hub drops it anyway and it was ~20 Wi-Fi TX bursts/s while walking
      } else if (strncmp(buf, "G ", 2) == 0) {
        float f, a, d, p, q; char extra;
        const int count = sscanf(buf + 2, "%f %f %f %f %f %c", &f, &a, &d, &p, &q, &extra);
        reply = count == 5 && webOnTune(f, a, d, p, q) ? "ACK_G" : "ERR_G";
      } else if (strncmp(buf, "B ", 2) == 0) {
        float front, rear, rate = NAN, to = NAN; char extra;
        const int count = sscanf(buf + 2, "%f %f %f %f %c", &front, &rear, &rate, &to, &extra);
        reply = (count == 2 || count == 4) && webOnBegTune(front, rear, rate, to) ? "ACK_B" : "ERR_B";
      } else if (strncmp(buf, "H ", 2) == 0) {
        float a, b, c, d; char extra;
        const int count = sscanf(buf + 2, "%f %f %f %f %c", &a, &b, &c, &d, &extra);
        reply = count == 4 && webOnPhase(a, b, c, d) ? "ACK_H" : "ERR_H";
      } else if (strncmp(buf, "R ", 2) == 0) {   // rear-return variation: "R <add>" (after "G", which zeroes it)
        float add; char extra;
        const int count = sscanf(buf + 2, "%f %c", &add, &extra);
        reply = count == 1 && webOnRearDuty(add) ? "ACK_R" : "ERR_R";
      } else if (strncmp(buf, "C ", 2) == 0) {
        reply = dispatchCommand(String(buf + 2));
      } else if (strncmp(buf, "O ", 2) == 0) {
        int k = 0, v = 0;
        sscanf(buf + 2, "%d %d", &k, &v);
        reply = dispatchCommand("camopt", 0, 0, k, v);
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

      if (reply.length()) {
        udp.beginPacket(udp.remoteIP(), udp.remotePort());
        udp.write((const uint8_t*)reply.c_str(), reply.length());
        udp.endPacket();
      }
    }
    packetSize = udp.parsePacket();
  }
}

// Task dedicada no Core 0: stream MJPEG da porta 81 para ate 3 espectadores.
// Um unico grab da camera por ciclo e enviado a todos. Espectador novo com a fila
// cheia derruba o MAIS ANTIGO (uma aba esquecida/travada nunca bloqueia ninguem).
#define MAX_STREAM_CLIENTS 1   // measured on the robot: 1 viewer = 103 ms ping, 13.9 fps; 2 viewers = 500+ ms and 0.2-3.7 fps
static WiFiServer streamSrv(81);

// Sends n bytes within budgetMs. WiFiClient::write() in core 2.0.14 can keep retrying for seconds on a
// stalled socket (it resets its retry counter whenever any byte goes out) and ignores setTimeout for
// the send path, so a frozen browser tab would stall every other viewer. Bounded send => drop that one.
static volatile int lastSendErrno = 0;
static bool sendBounded(WiFiClient& c, const uint8_t* p, size_t n, uint32_t budgetMs) {
  int fd = c.fd();
  if (fd < 0) { lastSendErrno = -1; return false; }
  uint32_t t0 = millis();
  while (n) {
    fd_set w; FD_ZERO(&w); FD_SET(fd, &w);
    timeval tv = { 0, 20000 };
    if (select(fd + 1, nullptr, &w, nullptr, &tv) > 0) {
      int r = send(fd, p, n, MSG_DONTWAIT);
      if (r > 0) { p += r; n -= r; }
      else if (r < 0) {
        // Transient lwip conditions are NOT a dead client: ENOMEM (out of pbufs, seen in the log as
        // "could not send data: 12") and EAGAIN just mean "try again in a moment".
        if (errno == EAGAIN || errno == EWOULDBLOCK || errno == ENOMEM || errno == EINTR) vTaskDelay(pdMS_TO_TICKS(5));
        else { lastSendErrno = errno; return false; }
      }
    }
    if (millis() - t0 > budgetMs) { lastSendErrno = ETIMEDOUT; return false; }
  }
  return true;
}

static void streamTask(void* pvParameters) {
  (void)pvParameters;
  WiFiClient clients[MAX_STREAM_CLIENTS];
  unsigned long since[MAX_STREAM_CLIENTS] = {0};
  unsigned long lastFrameMs = 0;
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
        if (slot < 0) {
          // Busy. A viewer that got a frame in the last 1.5 s is healthy: it KEEPS the stream and the newcomer is
          // told "busy" (503). Otherwise evicting would make two tabs kick each other out every retry (3 s).
          // A stalled/half-open viewer is replaced.
          slot = 0;
          for (int i = 1; i < MAX_STREAM_CLIENTS; i++) if (since[i] < since[slot]) slot = i;
          if (millis() - since[slot] < 1500) {
            nc.print("HTTP/1.1 503 Service Unavailable\r\nRetry-After: 3\r\nConnection: close\r\n\r\nCamera em uso por outro espectador");
            nc.stop();
            slot = -2;
          } else {
            clients[slot].stop();
          }
        }
        if (slot == -2) { /* rejected above */ } else {
        nc.setNoDelay(true);
        nc.print("HTTP/1.1 200 OK\r\nCache-Control: no-store\r\n"
                 "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n");
        clients[slot] = nc;
        since[slot] = millis();
        }
      }
    }

    bool any = false;
    for (int i = 0; i < MAX_STREAM_CLIENTS; i++) if (clients[i].connected()) any = true;
    if (!any) { vTaskDelay(pdMS_TO_TICKS(20)); continue; }

    unsigned long minGap = 1000UL / camFpsCap;           // fps cap = fewer TX bursts
    unsigned long el = millis() - lastFrameMs;
    if (el < minGap) { vTaskDelay(pdMS_TO_TICKS(minGap - el)); }
    lastFrameMs = millis();

    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) { vTaskDelay(pdMS_TO_TICKS(10)); continue; }
    char hdr[100];
    // boundary first with a leading CRLF: one send fewer per frame (no trailing "\r\n")
    int hn = snprintf(hdr, sizeof(hdr),
                      "\r\n--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", (unsigned)fb->len);
    for (int i = 0; i < MAX_STREAM_CLIENTS; i++) {
      if (!clients[i].connected()) continue;
      bool ok = sendBounded(clients[i], (const uint8_t*)hdr, hn, 2000)
             && sendBounded(clients[i], fb->buf, fb->len, 2000);
      if (!ok) {                                         // really stalled or gone (2 s, or a hard socket error)
        k9Logf("stream drop: errno=%d after %lu frames", (int)lastSendErrno, (unsigned long)(streamFrames));
        clients[i].stop();
      }
      else since[i] = millis();                          // healthy: got a frame just now
    }
    streamFrames++; streamBytes += fb->len;
    esp_camera_fb_return(fb);
  }
}

inline bool initCameraModule() {
  camPrefsLoad();
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
  config.xclk_freq_hz = 10000000;   // 10 MHz: half the sensor rate and power; 20 MHz starved the Wi-Fi
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size   = FRAMESIZE_VGA;   // buffers sized for the biggest preset; applyCamPreset() picks the real one
  config.jpeg_quality = 20;              // 0-63, HIGHER = smaller/faster JPEG
  config.fb_count     = 2;
  config.grab_mode    = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&config);
  camInitialized = (err == ESP_OK);
  if (camInitialized) {
    applyCamPreset(camPreset);
    Serial.printf("[cam] Camera %s inicializada com sucesso!\n", isOv3660 ? "OV3660" : "OV2640");
  } else {
    Serial.printf("[cam] Falha ao iniciar camera: 0x%x\n", err);
  }
  return camInitialized;
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
#ifdef K9_SPEAKER_GPIO
  soundBegin();
#endif
  k9LogInit();
#ifndef K9_NO_CAM
  initCameraModule();           // -DK9_NO_CAM = bench test: is the supply the problem?
#endif
  initFlash();

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
  WiFi.setAutoReconnect(true);
  WiFi.setScanMethod(WIFI_ALL_CHANNEL_SCAN);       // MESH (router + 2 nodes, same SSID): the default joins the FIRST AP found,
  WiFi.setSortMethod(WIFI_CONNECT_AP_BY_SIGNAL);   // often a far one. Look at every node and join the STRONGEST.
  // Full TX power (default 19.5 dBm). It was lowered to 11 dBm when the board sat next to the router; mounted
  // inside the robot the link is weaker (-50..-58 dBm) and 11 dBm made the UPLINK the bottleneck (ping avg 529 ms).

  Serial.printf("[wifi] Conectando ao Wi-Fi residencial \"%s\"...\n", homeSsid.c_str());

  // Reconnect fast: reuse the last IP/gateway/channel/BSSID (no scan, no DHCP exchange). If that
  // fails within 6 s, forget it and do a normal full connect, so a changed router never locks us out.
  k9Prefs.begin("k9-net", true);
  uint32_t nIp = k9Prefs.getUInt("ip", 0), nGw = k9Prefs.getUInt("gw", 0), nMask = k9Prefs.getUInt("mask", 0);
  int nCh = k9Prefs.getInt("ch", 0);
  uint8_t nBssid[6] = {0};
  bool haveBssid = k9Prefs.getBytes("bssid", nBssid, 6) == 6;
  k9Prefs.end();
  bool fast = false;   // DISABLED: pinning the saved BSSID/channel keeps the board on one (maybe far) mesh node
  (void)nIp; (void)nGw; (void)nMask; (void)nCh; (void)haveBssid;

  unsigned long t0 = millis();
  if (fast) {
    WiFi.config(IPAddress(nIp), IPAddress(nGw), IPAddress(nMask), IPAddress(nGw));
    WiFi.begin(homeSsid.c_str(), homePass.c_str(), nCh, nBssid);
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 6000) { delay(200); Serial.print('f'); }
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println(F("\n[wifi] reconexao rapida falhou, conexao completa (DHCP)"));
      WiFi.disconnect();
      WiFi.config(INADDR_NONE, INADDR_NONE, INADDR_NONE);
      k9Prefs.begin("k9-net", false); k9Prefs.clear(); k9Prefs.end();
      fast = false;
    }
  }
  if (!fast) {
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
    WiFi.begin(homeSsid.c_str(), homePass.c_str());
    t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 6500) { delay(250); Serial.print('.'); }
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {                 // remember how we got in, for the next boot
    uint32_t ip = (uint32_t)WiFi.localIP(), gw = (uint32_t)WiFi.gatewayIP(), mask = (uint32_t)WiFi.subnetMask();
    k9Prefs.begin("k9-net", false);
    if (k9Prefs.getUInt("ip", 0) != ip) k9Prefs.putUInt("ip", ip);
    if (k9Prefs.getUInt("gw", 0) != gw) k9Prefs.putUInt("gw", gw);
    if (k9Prefs.getUInt("mask", 0) != mask) k9Prefs.putUInt("mask", mask);
    if (k9Prefs.getInt("ch", 0) != WiFi.channel()) k9Prefs.putInt("ch", WiFi.channel());
    k9Prefs.putBytes("bssid", WiFi.BSSID(), 6);
    k9Prefs.end();
  }

  if (WiFi.status() == WL_CONNECTED) {
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
#ifdef K9_SPEAKER_GPIO
    soundStop();
#endif
    webOnCalibrate(true); // Estaciona os servos em segurança durante gravação OTA
  });
  ArduinoOTA.begin();

  // Servidor HTTP na Porta 80
  server.on("/", handleRoot);
  server.on("/cmd", handleCmd);
  server.on("/status", handleStatus);
  server.on("/wifi", handleWifiConfig);
  server.on("/log", handleLog);
  server.on("/log/info", handleLogInfo);
  server.on("/log/clear", handleLogClear);
  server.begin();

  // Servidor UDP de Baixa Latência na Porta 4210
  udp.begin(K9_UDP_PORT);

  // Servidor de Vídeo na Porta 81 em Task separada (Core 0)
  xTaskCreatePinnedToCore(streamTask, "CamStream", 8192, nullptr, 1, nullptr, 0);

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
  uint32_t fr = streamFrames, by = streamBytes;
  streamFrames = 0; streamBytes = 0;
  static unsigned long lastStatMs = 0;
  float secs = lastStatMs ? (millis() - lastStatMs) / 1000.0f : 5.0f;
  lastStatMs = millis();
  k9Logf("stat heap=%u min=%u rssi=%d flash=%d cam=%d fps=%.1f kb=%.1f",
         (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMinFreeHeap(), up ? WiFi.RSSI() : 0,
         flashPercent, camPreset, fr / secs, fr ? by / 1024.0f / fr : 0.0f);
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
#ifdef K9_SPEAKER_GPIO
  soundEmotionSync(webActivity(),webActivityTime(),webScratchHz());
  soundDanceSync(webDanceActive());
  soundLaughSync(webLaughTime());
  soundTask();
#endif
  weakSignalRescan();
  server.handleClient();
  logStatus();
  handleUdpPackets();
  updateFlash();
  ArduinoOTA.handle();
}

#endif
