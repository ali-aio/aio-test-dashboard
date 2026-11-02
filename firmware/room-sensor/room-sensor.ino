// Lab room temperature / humidity → the test dashboard on the lab laptop.
// ESP32-S3 + SHT30 (I2C, address 0x44; 0x45 with ADDR pulled high). Every READ_S seconds it reads the SHT30 and
// prints one line on both USB-C ports (COM at 115200, and the chip's own USB):  ROOM {"sensor":"room","t":23.63,"rh":52.2}
// The lab's way (2 Nov 2026): the board is plugged into the lab laptop's USB, whose server reads those lines
// (server/roomSerial.mjs + room-serial.py) — no Wi-Fi. With WIFI_PASS set in secrets.h it also
// POSTs {"sensor","readings":[{"t","rh","ago"}]} to http://<laptop>:8090/api/room/report
// (server/room.mjs). Readings that couldn't be sent (laptop restarting, Wi-Fi down) are kept, up to
// QUEUE_MAX, and go with the next post, each with how many seconds ago it was taken.
//
// Wiring (SHT30 breakout → ESP32-S3 DevKit): VIN → 3V3, GND → GND, SDA → GPIO 8, SCL → GPIO 9.
// Build: arduino-cli / Arduino IDE, esp32 core 3.x, no extra libraries; the lab's ESP32-S3-N16R8 is flashed on its COM
// port with the FQBN in README.md (serial output on COM, 115200).
// Copy secrets.example.h to secrets.h first.
#include <WiFi.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <Wire.h>
#include "secrets.h"

#define SDA_PIN 8
#define SCL_PIN 9
#define SHT30_ADDR 0x44
static const uint32_t READ_S = 60;
static const int QUEUE_MAX = 240; // 4 h at one a minute
static const bool USE_WIFI = sizeof(WIFI_PASS) > 1; // no password = USB only

struct Reading { uint32_t ms; float t; float rh; };
static Reading queue_[QUEUE_MAX];
static int qn = 0;
static IPAddress laptop;
static uint32_t lastResolve = 0;

static uint8_t crc8(const uint8_t *d, int n) {
  uint8_t c = 0xFF;
  for (int i = 0; i < n; i++) { c ^= d[i]; for (int b = 0; b < 8; b++) c = c & 0x80 ? (c << 1) ^ 0x31 : c << 1; }
  return c;
}

// single shot, high repeatability, no clock stretching (0x24 0x00)
static bool readSht30(float &t, float &rh) {
  Wire.beginTransmission(SHT30_ADDR);
  Wire.write(0x24); Wire.write(0x00);
  if (Wire.endTransmission() != 0) return false;
  delay(20);
  uint8_t b[6];
  if (Wire.requestFrom(SHT30_ADDR, 6) != 6) return false;
  for (int i = 0; i < 6; i++) b[i] = Wire.read();
  if (crc8(b, 2) != b[2] || crc8(b + 3, 2) != b[5]) return false;
  t = -45.0f + 175.0f * ((b[0] << 8) | b[1]) / 65535.0f;
  rh = 100.0f * ((b[3] << 8) | b[4]) / 65535.0f;
  return true;
}

static void wifiUp() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  if (WiFi.status() == WL_CONNECTED) { Serial0.printf("wifi %s\n", WiFi.localIP().toString().c_str()); MDNS.begin(SENSOR_NAME); }
}

// the laptop's address: mDNS (its IP is DHCP), re-asked every 10 min, else LAPTOP_IP
static IPAddress laptopIp() {
  if (laptop == IPAddress() || millis() - lastResolve > 600000UL) {
    lastResolve = millis();
    IPAddress ip = MDNS.queryHost(LAPTOP_MDNS, 2000);
    if (ip != IPAddress()) laptop = ip;
    else if (laptop == IPAddress()) laptop.fromString(LAPTOP_IP);
  }
  return laptop;
}

static bool sendQueue() {
  if (!qn || WiFi.status() != WL_CONNECTED) return false;
  String body = "{\"sensor\":\"" SENSOR_NAME "\",\"readings\":[";
  uint32_t now = millis();
  for (int i = 0; i < qn; i++) {
    char buf[64];
    snprintf(buf, sizeof buf, "%s{\"t\":%.2f,\"rh\":%.1f,\"ago\":%lu}", i ? "," : "", queue_[i].t, queue_[i].rh, (unsigned long)((now - queue_[i].ms) / 1000));
    body += buf;
  }
  body += "]}";
  HTTPClient http;
  String url = "http://" + laptopIp().toString() + ":" + String(LAPTOP_PORT) + "/api/room/report";
  http.begin(url);
  http.setTimeout(5000);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  http.end();
  Serial0.printf("POST %s → %d (%d readings)\n", url.c_str(), code, qn);
  if (code == 200) { qn = 0; return true; }
  if (code < 0) lastResolve = 0; // couldn't connect: ask mDNS again next time
  return false;
}

// one line on both USB-C ports: COM (UART0 via the CH343) and USB (the chip's own USB serial), so the
// board works whichever port goes into the laptop
// (built with USB CDC On Boot: Serial = the chip's own USB, Serial0 = UART0 on the COM port)
static void say(const char *s) {
  Serial0.println(s);
  if (Serial) Serial.println(s);
}

void setup() {
  Serial0.begin(115200);
  Serial.begin(115200);
  Serial.setTxTimeoutMs(0); // nobody listening on USB: drop the line, don't block
  Wire.begin(SDA_PIN, SCL_PIN);
  if (USE_WIFI) wifiUp(); else WiFi.mode(WIFI_OFF);
}

void loop() {
  static uint32_t next = 0;
  if ((int32_t)(millis() - next) >= 0) {
    next = millis() + READ_S * 1000;
    float t, rh;
    if (readSht30(t, rh)) {
      char line[96];
      snprintf(line, sizeof line, "ROOM {\"sensor\":\"%s\",\"t\":%.2f,\"rh\":%.1f}", SENSOR_NAME, t, rh);
      say(line);
      if (!USE_WIFI) return;
      if (qn == QUEUE_MAX) { memmove(queue_, queue_ + 1, sizeof(Reading) * (QUEUE_MAX - 1)); qn--; }
      queue_[qn++] = { millis(), t, rh };
    } else { say("SHT30: no answer / bad CRC - check wiring and address"); if (!USE_WIFI) return; }
    wifiUp();
    sendQueue();
  }
  delay(200);
}
