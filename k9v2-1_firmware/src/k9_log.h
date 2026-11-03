#pragma once
// Persistent event log for the ESP32-CAM build.
//
// Lines are queued from any task (never blocks the gait: the queue drops when full),
// and a low-priority task on core 0 appends them to LittleFS in batches. The log
// survives reboots, so the cause of a reset (brownout, panic, watchdog) is the first
// line of every boot. Nothing goes over Wi-Fi until you ask: GET /log (tail), /log?full=1,
// /log/info, /log/clear — or the hub's /api/log*.
//
// Storage is the internal flash (partitions_k9.csv, ~900 KB LittleFS), rotated
// log.txt -> log.old at K9_LOG_MAX, so roughly the last few hours are always kept.
// The SD card is NOT used: on the AI-Thinker board its pins (2/14/15, 4-bit also 4/12/13)
// are the servo and flashlight pins.
#ifdef BOARD_ESP32CAM
#include <Arduino.h>
#include <LittleFS.h>
#include <time.h>
#include <stdarg.h>
#include <esp_system.h>

#define K9_LOG_PATH   "/log.txt"
#define K9_LOG_OLD    "/log.old"
#define K9_LOG_MAX    (300 * 1024)     // rotate here; total on flash <= 2x this
#define K9_LOG_QUEUE  48
#define K9_TZ_OFFSET_S (-3 * 3600)     // America/Sao_Paulo

struct K9LogLine { char s[120]; };
static QueueHandle_t     k9LogQ   = nullptr;
static SemaphoreHandle_t k9LogMux = nullptr;
static bool              k9LogFsOk = false;

static void k9Stamp(char* out, size_t n) {
  time_t now = time(nullptr);
  if (now > 1700000000) {                       // NTP has set the clock
    struct tm t; localtime_r(&now, &t);
    strftime(out, n, "%d/%m %H:%M:%S", &t);
  } else {
    snprintf(out, n, "+%lus", millis() / 1000UL);
  }
}

// Safe from any task and from the Arduino loop: copies, never blocks.
inline void k9LogAppend(const char* msg) {
  if (!k9LogQ) return;
  K9LogLine l; char ts[24];
  k9Stamp(ts, sizeof ts);
  snprintf(l.s, sizeof l.s, "%s %s", ts, msg);
  size_t len = strlen(l.s);
  while (len && (l.s[len - 1] == '\n' || l.s[len - 1] == '\r')) l.s[--len] = 0;
  xQueueSend(k9LogQ, &l, 0);
}

inline void k9Logf(const char* fmt, ...) {
  char buf[110]; va_list ap; va_start(ap, fmt);
  vsnprintf(buf, sizeof buf, fmt, ap); va_end(ap);
  k9LogAppend(buf);
}

static void k9LogTask(void*) {
  for (;;) {
    K9LogLine l;
    if (xQueueReceive(k9LogQ, &l, pdMS_TO_TICKS(2000)) == pdTRUE) {
      xSemaphoreTake(k9LogMux, portMAX_DELAY);
      File f = LittleFS.open(K9_LOG_PATH, FILE_APPEND);
      if (f) {
        do { f.println(l.s); } while (xQueueReceive(k9LogQ, &l, 0) == pdTRUE);
        size_t sz = f.size();
        f.close();
        if (sz > K9_LOG_MAX) {                  // rotate: keep one previous file
          LittleFS.remove(K9_LOG_OLD);
          LittleFS.rename(K9_LOG_PATH, K9_LOG_OLD);
        }
      }
      xSemaphoreGive(k9LogMux);
    }
    vTaskDelay(pdMS_TO_TICKS(500));             // batch bursts into one write
  }
}

static const char* k9ResetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:   return "power-on";
    case ESP_RST_SW:        return "software restart";
    case ESP_RST_PANIC:     return "PANIC (crash)";
    case ESP_RST_INT_WDT:   return "interrupt watchdog";
    case ESP_RST_TASK_WDT:  return "task watchdog";
    case ESP_RST_WDT:       return "watchdog";
    case ESP_RST_BROWNOUT:  return "BROWNOUT (supply sagged)";
    case ESP_RST_DEEPSLEEP: return "deep sleep";
    case ESP_RST_EXT:       return "external reset";
    default:                return "unknown";
  }
}

inline void k9LogInit() {
  setenv("TZ", "<-03>3", 1); tzset();            // local time even before NTP finishes the setup
  k9LogFsOk = LittleFS.begin(true);            // true = format on first boot
  k9LogQ    = xQueueCreate(K9_LOG_QUEUE, sizeof(K9LogLine));
  k9LogMux  = xSemaphoreCreateMutex();
  if (!k9LogFsOk) { Serial.println(F("[log] LittleFS mount failed")); return; }
  xTaskCreatePinnedToCore(k9LogTask, "K9Log", 6144, nullptr, 1, nullptr, 0);
  k9Logf("=== BOOT === reset: %s | heap %u", k9ResetReason(), (unsigned)ESP.getFreeHeap());
}

// Streams the last `tailBytes` of old+current log to `out` (0 = everything).
// Holds the FS mutex, so keep it short; the logger task simply waits.
inline size_t k9LogSize() {
  size_t n = 0;
  if (!k9LogFsOk) return 0;
  xSemaphoreTake(k9LogMux, portMAX_DELAY);
  if (File f = LittleFS.open(K9_LOG_OLD)) { n += f.size(); f.close(); }
  if (File f = LittleFS.open(K9_LOG_PATH)) { n += f.size(); f.close(); }
  xSemaphoreGive(k9LogMux);
  return n;
}

inline void k9LogClear() {
  if (!k9LogFsOk) return;
  xSemaphoreTake(k9LogMux, portMAX_DELAY);
  LittleFS.remove(K9_LOG_OLD);
  LittleFS.remove(K9_LOG_PATH);
  xSemaphoreGive(k9LogMux);
  k9Logf("log cleared by request");
}
#endif
