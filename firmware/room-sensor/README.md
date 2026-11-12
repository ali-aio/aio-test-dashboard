# Room sensor (ESP32-S3 + SHT30)

Sends the lab's room temperature and humidity to the dashboard on the lab laptop every minute;
Today shows it as the **Room temp** tile (range and average since the cycle started).

**How it's connected (12 Nov 2026): Wi-Fi, AIO-Office**, powered by any USB adapter; it POSTs each reading to the lab
laptop (mDNS name, else `LAPTOP_IP`) and keeps up to 4 h of readings it couldn't send. Flash with `WIFI_SSID` / `WIFI_PASS`
set in `secrets.h` (gitignored; `build/`, which holds the compiled password, is gitignored too).

**Before that (2 – 11 Nov 2026): a USB cable into the lab laptop**, either USB-C port — still works as a fallback. The board prints
`ROOM {"sensor":"room","t":23.19,"rh":50.4}` every minute on both ports; the dashboard's server reads them
(`server/roomSerial.mjs` → `server/room-serial.py`) and picks the board up again by itself after an unplug.
Check on the laptop: `curl -s localhost:8090/api/room | head -c 300` (`usb.open: true`). Wi-Fi is optional (below).

- Wiring: SHT30 VIN → 3V3, GND → GND, SDA → GPIO 8, SCL → GPIO 9 (address 0x44; change `SHT30_ADDR` to 0x45 if ADDR is high).
- `cp secrets.example.h secrets.h` (needed to build; leave `WIFI_PASS` empty for USB only). For Wi-Fi, fill in the Wi-Fi the **lab laptop** is on — "UniFi - HW Team" since 2 Nov 2026
  (`ssh test-team@100.120.184.6 nmcli -t -f NAME connection show --active`), 2.4 GHz, and its address there
  (192.168.201.27 then) as `LAPTOP_IP`; mDNS finds it if the address changes.
- The lab's board is an **ESP32-S3-N16R8** DevKit with two USB-C ports. **Plug into COM** (a CH343 USB-serial chip): it
  resets itself into flashing mode and carries the serial output. The other port (USB) runs whatever the board was sold
  with, which may not let itself be flashed without BOOT held at power-up.
- Flash (arduino-cli ships inside the Arduino IDE, `/opt/arduino-ide/resources/app/lib/backend/resources/arduino-cli`;
  the board package is `esp32:esp32` from `https://espressif.github.io/arduino-esp32/package_esp32_index.json`):
  `arduino-cli compile --upload -p /dev/ttyACM0 --fqbn "esp32:esp32:esp32s3:CDCOnBoot=cdc,FlashSize=16M,PSRAM=opi,PartitionScheme=app3M_fat9M_16MB" .`
  (`CDCOnBoot=cdc`: `Serial` = the USB port, `Serial0` = COM; the sketch writes to both. After the first flash on COM, either
  port flashes without buttons.)
- Check: the serial monitor (115200) prints each reading and `POST … → 200`; on the laptop
  `curl -s localhost:8090/api/room | head -c 300`.
- Test the endpoint without the board: `curl -s -XPOST localhost:8090/api/room/report -d '{"sensor":"room","t":23.4,"rh":41}'`.

More than one sensor: give each its own `SENSOR_NAME`; Today shows the first one and lists them all in the tile's drop-down.
The laptop keeps readings in `data/room.jsonl` (gitignored), 120 days.
