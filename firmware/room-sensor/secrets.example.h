// Copy to secrets.h (gitignored) and fill in.
#pragma once
#define WIFI_SSID     "UniFi - HW Team"   // the network the lab laptop is on (2.4 GHz)
#define WIFI_PASS     ""   // empty = USB only (how the lab runs it); set it to also send over Wi-Fi
// the lab laptop: its mDNS name (without .local) is tried first, then this address (its IP is DHCP)
#define LAPTOP_MDNS   "test-team-IdeaPad-3-15ITL6"
#define LAPTOP_IP     "192.168.201.27"
#define LAPTOP_PORT   8090
// one name per sensor: shown on Today when there is more than one (letters, digits, - or _)
#define SENSOR_NAME   "room"
