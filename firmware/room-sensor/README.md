# Room sensor (ESP32-S3 + SHT30)

Sends the lab's room temperature and humidity to the dashboard on the lab laptop every minute;
Today shows it as the **Room temp** tile (range and average since the cycle started).

- Wiring: SHT30 VIN → 3V3, GND → GND, SDA → GPIO 8, SCL → GPIO 9 (address 0x44; change `SHT30_ADDR` to 0x45 if ADDR is high).
- `cp secrets.example.h secrets.h`, fill in the AIO-Office Wi-Fi password.
- Flash with Arduino IDE (board "ESP32S3 Dev Module", USB CDC On Boot: Enabled for serial output) or
  `arduino-cli compile --fqbn esp32:esp32:esp32s3 . && arduino-cli upload -p /dev/ttyACM0 --fqbn esp32:esp32:esp32s3 .`
- Check: the serial monitor (115200) prints each reading and `POST … → 200`; on the laptop
  `curl -s localhost:8090/api/room | head -c 300`.
- Test the endpoint without the board: `curl -s -XPOST localhost:8090/api/room/report -d '{"sensor":"room","t":23.4,"rh":41}'`.

More than one sensor: give each its own `SENSOR_NAME`; Today shows the first one and lists them all in the tile's drop-down.
The laptop keeps readings in `data/room.jsonl` (gitignored), 120 days.
