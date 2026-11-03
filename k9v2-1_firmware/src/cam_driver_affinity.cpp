#ifdef K9_CAM_ONLY
#include <cstring>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

// Arduino-ESP32 2.0.x ships esp32-camera precompiled with CONFIG_CAMERA_CORE0.
// A build flag cannot change that archive. Wrap its task creation at link time,
// changing only cam_task; retain the installed driver and every other affinity.
// platformio.ini enables --wrap only for the camera environments.
int k9CameraDriverCore = -1;
extern "C" BaseType_t __real_xTaskCreatePinnedToCore(
    TaskFunction_t, const char* const, const uint32_t, void* const,
    UBaseType_t, TaskHandle_t* const, const BaseType_t);

extern "C" BaseType_t __wrap_xTaskCreatePinnedToCore(
    TaskFunction_t fn, const char* const name, const uint32_t stack,
    void* const arg, UBaseType_t priority, TaskHandle_t* const output,
    const BaseType_t core) {
  const bool camera = name && std::strcmp(name, "cam_task") == 0;
  TaskHandle_t created = nullptr;
  BaseType_t result = __real_xTaskCreatePinnedToCore(
      fn, name, stack, arg, priority, &created, camera ? 1 : core);
  if (output) *output = created;
  if (camera && result == pdPASS) k9CameraDriverCore = xTaskGetAffinity(created);
  return result;
}
#endif
