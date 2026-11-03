// Adapted from miniRobo K9V2.1: https://www.minirobo.io/projects/k9v2-1
// Upstream personal/non-commercial terms apply to derived portions.
// These portions are not relicensed under the repository's MIT grant.
// See ../../THIRD_PARTY.md (repository root) for provenance.
// ============================================================================
// net_console.h — drop-in WiFi OTA + telnet console for minirobo firmware.
// ----------------------------------------------------------------------------
// The DEFAULT minirobo dev loop: re-flash firmware over WiFi (OTA) and watch a
// live telnet console (port 23) that STREAMS telemetry and TAKES one-letter
// commands — so you can read sensor data and tune the robot without a cable.
//
// The ESP32-C3 has ONE 2.4 GHz radio; WiFi + BLE (Bluepad32/BTstack) coexistence
// is fragile, so this is gated behind -DTUNE_MODE and REPLACES the BLE gamepad
// path while tuning (you drive over telnet instead). Ship the dialed-in firmware
// as the normal (BLE) build.
//
// Integration (main.cpp):
//   #ifdef TUNE_MODE
//   #include "net_console.h"
//   #endif
//   // provide these two — your robot's command set + telemetry line:
//   void onConsoleCmd(char c, float v) { switch(c){ case 'w': drive=v; break; ... } }
//   void consoleTelemetry()            { logf("pitch=%.1f drive=%.2f\n", pitch, drive); }
//   // setup():  netBegin(BANNER, onOtaStart /*optional: park actuators*/);
//   // loop():   netTask();   // call every iteration
//   // logf(...) writes to USB Serial AND the telnet client.
//
// Requires a secrets.h (see secrets.h.example) with WIFI_SSID / WIFI_PASS, and
// these envs in platformio.ini: `tune` (USB) + `tune-ota` (espota). Needs a
// 4 MB-flash board (two OTA app partitions) — the SuperMini default.
// ============================================================================
#pragma once
#include <WiFi.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <stdarg.h>
#include "secrets.h"

#ifndef OTA_HOST
#define OTA_HOST "minirobo"        // override in secrets.h -> mDNS <host>.local
#endif
#ifndef NET_TELE_MS
#define NET_TELE_MS 200            // telemetry stream period (ms)
#endif
#ifndef NET_WIFI_RETRY_MS
#define NET_WIFI_RETRY_MS 10000    // re-attempt WiFi this often while disconnected
#endif

// You implement these (in main.cpp):
void onConsoleCmd(char c, float v);   // one command char + its number argument
void consoleTelemetry();              // emit one telemetry line via logf()

static WiFiServer _telnet(23);
static WiFiClient _tcli;
static char _lb[64];
static uint8_t _ll = 0;
static unsigned long _lastTele = 0;
static const char* _banner = nullptr;
static void (*_otaStart)() = nullptr;   // optional: park actuators on OTA begin
static bool _servicesUp = false;        // OTA + telnet started (once, on first link)
static unsigned long _lastWifiTry = 0;  // last WiFi.begin() attempt

inline bool netClientConnected() { return _tcli && _tcli.connected(); }

// (Re)issue a connect attempt. The disconnect(true) clears any half-open auth
// state first, which also helps shake loose the AUTH_EXPIRE that band-steering
// routers throw when they deauth mid-association.
static void _wifiConnect() {
  WiFi.disconnect(true);
  delay(100);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  _lastWifiTry = millis();
}

// Start OTA + telnet exactly once, the first time WiFi links up.
static void _startServices() {
  if (_servicesUp) return;
  Serial.print(F("[wifi] connected, IP ")); Serial.println(WiFi.localIP());
  ArduinoOTA.setHostname(OTA_HOST);
#ifdef OTA_PASS
  ArduinoOTA.setPassword(OTA_PASS);
#endif
  if (_otaStart) ArduinoOTA.onStart(_otaStart);
  ArduinoOTA.begin();
  _telnet.begin();
  _telnet.setNoDelay(true);
  _servicesUp = true;
  Serial.printf("[net] OTA + telnet ready at %s.local (telnet :23)\n", OTA_HOST);
}

// Log to USB Serial and (if connected) the telnet client.
inline void logf(const char* fmt, ...) {
  char b[180]; va_list ap; va_start(ap, fmt);
  vsnprintf(b, sizeof b, fmt, ap); va_end(ap);
  Serial.print(b);
  if (netClientConnected()) _tcli.print(b);
}

// Connect WiFi, start OTA + telnet. `banner` is printed to a new client;
// `onStart` (optional) runs when an OTA update begins — park your actuators.
inline void netBegin(const char* banner = nullptr, void (*onStart)() = nullptr) {
  _banner = banner;
  _otaStart = onStart;
#if defined(CONFIG_BT_ENABLED)
  // The Bluepad32 framework boots the BT controller automatically (it prints its
  // banner before setup() runs). On the single-radio C3 that aborts WiFi unless
  // modem sleep is on. We don't use BLE while tuning, so stop the controller and
  // hand the whole radio to WiFi — then setSleep(false) is safe.
  btStop();
#endif
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  Serial.printf("[wifi] MAC %s — connecting to \"%s\"", WiFi.macAddress().c_str(), WIFI_SSID);
  _wifiConnect();
  // One synchronous window so a fresh boot is usually online before loop() runs;
  // if it isn't, netTask() keeps retrying in the background (no more giving up).
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 8000) { delay(250); Serial.print('.'); }
  if (WiFi.status() == WL_CONNECTED) _startServices();
  else Serial.println(F("\n[wifi] not up yet — retrying in background"));
}

// Call every loop: services OTA, accepts one telnet client, dispatches commands,
// and streams telemetry while a client is connected.
inline void netTask() {
  // Keep WiFi up: while disconnected, re-attempt every NET_WIFI_RETRY_MS and
  // service nothing else until we have a link. On the first successful link,
  // bring OTA + telnet online.
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - _lastWifiTry > NET_WIFI_RETRY_MS) {
      Serial.println(F("[wifi] retrying..."));
      _wifiConnect();
    }
    return;
  }
  _startServices();
  ArduinoOTA.handle();
  // Accept a new telnet client. Core 3.x renamed WiFiServer::available() ->
  // accept(); on 3.x the old available() hands back a client that isn't retained
  // (you get the banner once, then it reads disconnected — no telemetry/commands).
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  WiFiClient incoming = _telnet.accept();
#else
  WiFiClient incoming = _telnet.hasClient() ? _telnet.available() : WiFiClient();
#endif
  if (incoming) {
    if (netClientConnected()) incoming.stop();                      // one client only
    else { _tcli = incoming; _tcli.setNoDelay(true);
           if (_banner) _tcli.print(_banner); }
  }
  while (netClientConnected() && _tcli.available()) {
    char c = _tcli.read();
    if (c == '\n' || c == '\r') {
      if (_ll) { _lb[_ll] = 0; char* s = _lb; while (*s == ' ') s++;
                 onConsoleCmd(*s, atof(s + 1)); _ll = 0; }
    } else if (_ll < sizeof(_lb) - 1) _lb[_ll++] = c;
  }
  if (netClientConnected() && millis() - _lastTele > NET_TELE_MS) {
    _lastTele = millis(); consoleTelemetry();
  }
}
