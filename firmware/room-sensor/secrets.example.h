// Copy to secrets.h (gitignored) and fill in.
#pragma once
#define WIFI_SSID     "AIO-Office"
#define WIFI_PASS     "change-me"
// the lab laptop: its mDNS name (without .local) is tried first, then this address (its IP is DHCP)
#define LAPTOP_MDNS   "test-team-IdeaPad-3-15ITL6"
#define LAPTOP_IP     "10.32.2.135"
#define LAPTOP_PORT   8090
// one name per sensor: shown on Today when there is more than one (letters, digits, - or _)
#define SENSOR_NAME   "room"
