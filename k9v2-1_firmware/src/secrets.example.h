#pragma once
// Copy this file to `secrets.h` (it is in .gitignore and must NEVER be committed) and fill in your own values.
// The Wi-Fi network can also be changed later from the control panel (Settings > Boards' Wi-Fi network).

#define DEFAULT_HOME_SSID "YOUR_2.4GHZ_WIFI_NAME"
#define DEFAULT_HOME_PASS "YOUR_WIFI_PASSWORD"

// Emergency access point "Minirobo-K9" (at least 8 characters) and password for flashing over the network.
// Use different, unique values for each robot.
#define K9_AP_PASS  "choose-a-unique-ap-password"
#define K9_OTA_PASS "choose-a-unique-ota-password"

// DHCP is the default. Optional static addressing: uncomment and adapt ALL
// values to your network. These are examples, not the maintainer's addresses.
// #define K9_LEGS_STATIC_IP "192.168.1.100"
// #define K9_CAM_STATIC_IP  "192.168.1.101"
// #define K9_GATEWAY_IP     "192.168.1.1"
// #define K9_SUBNET_MASK    "255.255.255.0"
// #define K9_DNS_IP         "192.168.1.1"
