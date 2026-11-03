#pragma once
// Independent firmware versions; bump when changing the corresponding board.
#define K9_LEGS_FIRMWARE_VERSION "1.7.0-public.1"   // GPIO25 speaker: non-blocking sound commands
#define K9_CAM_FIRMWARE_VERSION "1.0.14"
#ifdef K9_CAM_ONLY
#define K9_FIRMWARE_VERSION K9_CAM_FIRMWARE_VERSION
#else
#define K9_FIRMWARE_VERSION K9_LEGS_FIRMWARE_VERSION
#endif
