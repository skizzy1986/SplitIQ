# Seat position sensor

A portable seat-position sensor for a Concept2 RowErg. A quadrature encoder drives a
GT2 belt loop clamped to the seat, and an ESP32-S3 counts it in hardware, samples at
200 Hz and streams over BLE to the SplitIQ app. The app connects to it after the PM5
and maps both onto the phone's clock (#734).

**Status:** the firmware has been drafted and compiles. It has not been run on
hardware yet, because the parts are due early December. Run `docs/bench-test.md`
when they land.

| Path | What |
|---|---|
| `firmware/` | PlatformIO project (Arduino framework) |
| `docs/ble-protocol.md` | GATT service and packet spec, the contract with the app |
| `docs/flashing.md` | Flashing from Windows VS Code: each PlatformIO button, its command and its output |
| `docs/bench-test.md` | Bench test: board, encoder, tape measure |
| `tools/bench.html` | Bench-test page (Chrome/Edge, Web Serial + Web Bluetooth): buttons and live readout beside the console |

The mechanical build (brackets, belt, mounting on a shared gym erg, power) is in
the build plan, not here.

## Hardware

| Part | Detail |
|---|---|
| MCU | ESP32-S3-DevKitC-1 N16R8 on a screw-terminal carrier ("KIT B") |
| Encoder | LPD3806-500BM: 500 PPR, NPN open collector, 5–24 V supply |
| Drive | 20T GT2 pulley on the encoder; closed belt loop to an idler; seat clamped to one run |
| Home index | MC-38 reed switch with magnet, at one end of the rail |

### Pin map

| Signal | GPIO | Terminal fittings |
|---|---|---|
| Encoder A | 4 | 2.2 kΩ to 3V3 |
| Encoder B | 5 | 2.2 kΩ to 3V3 |
| Reed (to 0 V when closed) | 6 | 4.7 kΩ to 3V3 |
| Battery sense (18650 builds only) | 1 (ADC1_CH0) | 100k/100k divider from cell + |
| Encoder supply | 5V pin | |
| Wake button | 0 (on-board BOOT) | |

**Why these pins:** the scoping doc's GPIO 34–39 choice was for the classic ESP32. The S3 has no input-only pins, and on an R8 (octal PSRAM) module GPIO 33–37
belong to the PSRAM bus. GPIO 26–32 are flash, 19/20 are native USB, 43/44 are the
UART console, and 0/3/45/46 are strapping pins. The S3's PCNT takes any pin through
the GPIO matrix, so 4/5/6 are chosen because they are free, sit together on the
header, and are RTC-capable, which lets encoder A act as a deep-sleep wake source.
Checked against ESP-IDF 5.5's own S3 pin definitions (`soc/io_mux_reg.h`: flash and
octal bus up to GPIO 37 and native USB on 19/20; `uart_pins.h`: UART0 on 43/44;
`soc_caps.h`: RTC IO on GPIO 0–21). The strapping list is
from the ESP32-S3 datasheet (not re-read for this draft).

## Design decisions

- **PCNT at 2× decoding, with software accumulation.** One PCNT channel counts both
  edges of A, and B's level sets the direction. That gives 1000 counts/rev, or
  0.04 mm per count. The 16-bit hardware counter alone tops out at about 1.3 m of
  travel, so the IDF 5 driver's `accum_count` extends it at each ±30 000 limit,
  and total travel is unlimited. 4× decoding would only double the edge rate for
  resolution nobody needs.
- **Glitch filter 1 µs.** At 25 kHz the channel-A half-period is 20 µs.
- **200 Hz from a hardware timer.** `esp_timer` fires every 5 ms. The callback
  reads the counter, scales it to 0.1 mm and packs 8 samples per 20-byte packet.
  The packet carries the device time of the first sample. The phone stamps the
  packet on receipt, and the device has no wall clock and does no NTP.
- **Homing like a Z-pulse.** A GPIO interrupt on the reed's make edge reads the
  counter directly. The first make with the seat moving sets the reference.
  Later makes in the same direction re-index it and report the error, which is a
  lost-count check. A slip over 2 mm latches a flag. Makes in the other direction
  are ignored because of the reed's contact differential.
- **Positive away from the flywheel.** The drive increases position. The console's
  `dir` command sets the sign whichever way the encoder ends up mounted.
- **BLE only, NimBLE, WiFi off.** NimBLE-Arduino 2.3.9 on the S3's own controller.
  The CPU runs at 80 MHz. Advertising is fast for 30 s, then slows to 1 s.
  Samples stream only while a client is subscribed.
- **Deep sleep after 5 min with no client and no motion.** It wakes on the first
  encoder edge (ext0 on GPIO 4) or the BOOT button. The reference is lost through
  sleep, so the seat must pass the reed again.

## Build, flash, test

Flash from plain Windows VS Code with the PlatformIO extension, on the PC the board
is plugged into (`docs/flashing.md`). Then run the bench test from
`tools/bench.html` (`docs/bench-test.md`). The command-line equivalents are in
the appendix of `docs/flashing.md`. Host checks, from `firmware/`:

```
g++ -std=c++17 -Isrc test/host_test.cpp -o seat_test && ./seat_test
```

The platform is `pioarduino` 55.03.39 (Arduino-ESP32 3.3.9 on ESP-IDF 5.5). The
`accum_count` PCNT driver needs IDF 5, and PlatformIO's own `espressif32`
platform stops at Arduino-ESP32 2.0.x. All versions are pinned in
`platformio.ini`.

Nothing in CI builds this folder. Every workflow is path-filtered to `web/`,
`supabase/` and similar paths. A firmware build job is a possible follow-up.

## Verified versus assumed

- **Verified here:** the firmware builds clean (RAM 10 %, flash 18 %). The host
  checks pass for scaling, saturation, and every packet byte offset in the spec.
  The bench page ran against a simulated board in headless Chromium: serial
  connect, command echo, telemetry parsing, span runs and pass badges, with no
  page errors. Its Bluetooth half is untested, because headless Linux Chromium
  has no Web Bluetooth.
  The PCNT, sleep and NimBLE APIs were checked against the headers of the pinned
  versions.
- **Not verified until the bench test:** everything at runtime. That covers count
  integrity at speed, wake on encoder motion, whether the reed ISR's direction
  check behaves, BLE throughput on a real phone, and current draw.
- **Assumed:** the LPD3806 colour code and its open-collector output (meter it
  first), the roughly 20 kHz encoder limit quoted by listings, and a seat speed of
  2 m/s or less.
