#pragma once
// Override with PlatformIO -D flags for controlled A/B tests.
#ifndef K9_CAM_XCLK_HZ
#define K9_CAM_XCLK_HZ 18000000
#endif
#ifndef K9_CAM_JPEG_QUALITY
#define K9_CAM_JPEG_QUALITY 10
#endif
#ifndef K9_CAM_FRAME_SIZE
#define K9_CAM_FRAME_SIZE FRAMESIZE_CIF
#endif
#ifndef K9_CAM_TX_POWER
#define K9_CAM_TX_POWER WIFI_POWER_15dBm
#endif
#ifndef K9_CAM_BOOT_FLASH
#define K9_CAM_BOOT_FLASH 0  // isolate camera/radio power from the LED during diagnosis
#endif
static_assert(K9_CAM_XCLK_HZ == 10000000 || K9_CAM_XCLK_HZ == 16000000 || K9_CAM_XCLK_HZ == 18000000 || K9_CAM_XCLK_HZ == 20000000,
              "Use 10, 16, 18 or 20 MHz for the clock comparison");
