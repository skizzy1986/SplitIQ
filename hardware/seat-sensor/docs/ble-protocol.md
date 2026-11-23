# Seat sensor BLE protocol, version 1

The contract between the seat-sensor firmware (`../firmware/`) and the SplitIQ app.
The app side is #734. The firmware source of truth is `../firmware/src/protocol.h`.
A layout change edits both files and bumps `protocol_version`, and the app refuses
a version it does not know.

All multi-byte fields are **little-endian**. Positions are **signed 0.1 mm**.

## Discovery and connection

- **Role:** the sensor is a GATT server and peripheral. The app connects to it as
  central, after the PM5 connects (the Capacitor plugin serialises GATT operations,
  #734). Only one client at a time is expected.
- **Advertising:** the primary service UUID is in the advertising packet, so filter
  on it (`requestDevice({filters: [{services: [SERVICE]}]})` on Web Bluetooth, a
  service-UUID scan filter on Android). The name `SplitIQ Seat` is in the **scan
  response**, because a 128-bit UUID plus flags leaves too little of the 31-byte
  advertising packet for it. A name filter therefore needs an active scan; filter
  on the service UUID.
- **Advertising interval:** 100 ms for 30 s after boot or a disconnect, then 1 s.
  Expect discovery to take a few seconds once the sensor has been idle.
- **Security:** no pairing and no bonding. Anyone in range can read the stream and
  write the control point. The worst a stranger can do is clear the reference or
  put the sensor to sleep.
- **Connection parameters:** the sensor asks for a 15–30 ms connection interval,
  no slave latency and a 4 s supervision timeout, both in its advertised preferred
  parameters and in an update request on connect. The phone decides.
- **MTU:** every value fits the default 23-byte ATT MTU (20-byte payload), so the
  app never needs an MTU exchange. Web Bluetooth cannot request one anyway.

## Service and characteristics

Service UUID: `36f90001-f6b6-4908-857c-004314d7acba`

| Characteristic | UUID | Properties | Size |
|---|---|---|---|
| Samples | `36f90002-f6b6-4908-857c-004314d7acba` | notify | 20 bytes |
| Status | `36f90003-f6b6-4908-857c-004314d7acba` | read, notify | 10 bytes |
| Info | `36f90004-f6b6-4908-857c-004314d7acba` | read | 14 bytes |
| Control | `36f90005-f6b6-4908-857c-004314d7acba` | write (with response) | 1 byte |

Connect sequence for the app: read Info and check `protocol_version`, read
Status, subscribe to Status, then subscribe to Samples. The sensor streams only
while Samples notifications are enabled. Subscribing starts a fresh packet
boundary, and unsubscribing or disconnecting stops the stream.

## Samples: 20 bytes, every 40 ms

| Offset | Type | Field | Meaning |
|---|---|---|---|
| 0 | uint32 | `t0_us` | Device time of sample 0, in µs. The low 32 bits of `esp_timer`, which is monotonic from boot. Wraps every 2³² µs (71.6 min). |
| 4 | int16 × 8 | `pos[0..7]` | Seat position in 0.1 mm. Sample *k* was taken at `t0_us + k × sample_period_us`. |

- **Rate:** 200 samples/s (`sample_period_us` = 5000) in packets of 8, so 25
  notifications/s and about 500 B/s.
- **Sign convention:** position is **positive in the direction away from the
  flywheel**, which is the seat's direction on the drive. It increases through
  the drive and decreases through the recovery. The bench test sets the sign
  (`dir` on the console) so this holds whichever way the encoder is mounted.
- **Zero:** position equals `home_pos_01mm` (from Info) at the home index, which
  is the point where the reed switch makes. With the default `home_pos_01mm` = 0,
  position is the distance from the reed, signed as above. If the reed sits at
  the flywheel end, working positions are positive. If it sits at the far end,
  they are negative unless `home_pos_01mm` is set to the rail length.
- **Before homing** (Status bit `HOMED` clear), positions are relative to wherever
  the seat was at power-on or wake. They are still a valid *relative* trace
  (stroke length and velocity are right), but not an absolute position. The app
  should show "slide the seat past the home end to home" and keep or discard the
  relative data as it sees fit.
- **Loss detection:** there is no sequence number. The next packet's `t0_us`
  should be the previous `t0_us + 8 × 5000` (mod 2³²). A gap of *n* × 40 000 µs
  means *n* − 1 packets were lost in the air. Packets dropped *on the device*,
  because the radio fell behind, are counted in Status `dropped_packets`.
- **Unwrapping:** treat `t0_us` as a uint32 and unwrap by adding 2³² whenever it
  goes backwards. One session never needs more than one wrap guard: the stamp is
  continuous across connections and only resets on reboot or deep sleep.
- **Clock mapping:** the device clock runs from the ESP32-S3's 40 MHz crystal. The
  device has no wall-clock time and does no NTP. The app maps device time onto
  the phone clock with the minimum of (arrival − `t0_us`) over a sliding window,
  plus a linear drift fit. Two consequences for the app:
  - Each sample time is exact relative to `t0_us`: the sampler runs off a 5 ms
    hardware timer, so dispatch jitter is in the tens of µs (estimate, measured in
    bench test step 8).
  - Notifications arrive bunched by the connection interval. Never use arrival
    time per sample. Use `t0_us + k × period`, mapped through the offset.
- **Saturation:** positions clamp at ±3276.7 mm. A real erg rail never reaches it.

### Decoding example (JavaScript)

```js
function parseSamples(dataView, periodUs = 5000) {
  const t0 = dataView.getUint32(0, true);
  const samples = [];
  for (let k = 0; k < 8; k++) {
    samples.push({ tUs: t0 + k * periodUs, posMm: dataView.getInt16(4 + 2 * k, true) / 10 });
  }
  return samples; // tUs not yet unwrapped past 2^32
}
```

Test vector: bytes `01 02 03 04 FE FF 00 00 00 00 00 00 00 00 00 00 00 00 D2 04` give
`t0_us` = 67305985, pos[0] = −0.2 mm, pos[1..6] = 0, pos[7] = 123.4 mm. The firmware's
host test (`../firmware/test/host_test.cpp`) pins the same bytes.

## Status: 10 bytes

Read it on connect. It notifies when any field except `peak_rate_hz_div10` changes,
and the read value refreshes every second.

| Offset | Type | Field | Meaning |
|---|---|---|---|
| 0 | uint8 | `flags` | Bits below |
| 1 | uint8 | `battery_pct` | 0–100. `0xFF` = not measured (power-bank builds) |
| 2 | uint16 | `battery_mv` | Cell voltage. 0 = not measured |
| 4 | int16 | `last_reindex_err_01mm` | Position error found the last time the seat passed the reed in the homing direction, in 0.1 mm. Near 0 is healthy. |
| 6 | uint16 | `dropped_packets` | Packets dropped on the device since this subscription began |
| 8 | uint16 | `peak_rate_hz_div10` | Peak encoder channel-A frequency over the last full second, ÷10. Diagnostic for encoder headroom (LPD3806 listings commonly quote about 20 kHz max, unverified) |

`flags` bits:

| Bit | Name | Meaning |
|---|---|---|
| 0 | `HOMED` | Position is referenced to the home index. **When clear, absolute position is meaningless.** |
| 1 | `STREAMING` | Samples notifications are enabled |
| 2 | `MOVING` | The seat moved more than 1 mm in the last second |
| 3 | `SLIP` | A re-index pass disagreed by more than 2 mm. Counts were lost, so treat the data before it as suspect. Latched until homed again. |
| 4 | `BATT_LOW` | Battery under 15 % (never set when not measured) |
| 5 | `OVERRUN` | At least one packet was dropped on the device since connect |
| 6–7 | — | Reserved, 0 |

## Info: 14 bytes, read once

| Offset | Type | Field | Meaning |
|---|---|---|---|
| 0 | uint8 | `protocol_version` | 1. **Refuse anything else.** |
| 1 | uint8 × 3 | `fw_major`, `fw_minor`, `fw_patch` | Firmware version, for logs |
| 4 | uint16 | `sample_period_us` | 5000 |
| 6 | uint8 | `samples_per_packet` | 8 |
| 7 | uint8 | reserved | 0 |
| 8 | uint32 | `nm_per_count` | Calibration in use, in nm per encoder count (nominal 40 000). Counts per mm = 10⁶ ÷ `nm_per_count` = 25. |
| 12 | int16 | `home_pos_01mm` | Position reported at the home index |

Positions arrive already scaled, so the app needs `nm_per_count` only to show
resolution or to sanity-check. It is given as nm per count rather than counts per
mm because an integer stays exact for any belt and encoder combination.

## Control: 1-byte opcodes

| Opcode | Action |
|---|---|
| `0x01` | **Home here.** Take the current position as `home_pos_01mm`. This is a manual reference without the reed. Sets `HOMED`. |
| `0x02` | **Clear home.** Drop the reference. The next reed pass homes again. |
| `0x03` | **Sleep.** Disconnect and enter deep sleep. Seat movement or the BOOT button wakes it. |

Unknown opcodes are ignored. Calibration is set on the serial console only, not
over the air.

## Homing behaviour

- The reed is read by a GPIO interrupt. On the make edge, the interrupt reads the
  hardware counter directly, so the capture is good to a few counts at any seat
  speed.
- A make edge counts only if the seat is moving (the direction comes from the
  count change over the previous 40 ms) and the reed has read open for at least
  50 ms before it. That rules out contact bounce and a seat parked on the switch.
- **First qualified pass:** homes, and records the approach direction.
- **Later passes in the same direction:** re-index. The error goes into
  `last_reindex_err_01mm`, `SLIP` latches if it is over 2 mm, and the reference
  moves to the new pass. This is the same as an encoder Z-pulse re-reference.
- **Passes in the other direction** are ignored, because the reed's make point
  differs with approach direction (contact differential).
- **Deep sleep or reboot loses the reference.** The encoder is incremental and the
  seat may have moved while the sensor slept.

## Power states (for app UX)

| State | Entered when | Radio |
|---|---|---|
| Fast advertising | Boot, wake, disconnect | 100 ms interval, 30 s |
| Slow advertising | 30 s with no connection | 1 s interval |
| Connected, idle | Connected, Samples not subscribed | Connection events only |
| Streaming | Samples subscribed | 25 notifications/s |
| Deep sleep | 5 min with no connection and no seat movement, or Control `0x03` | Off. Moving the seat by one count wakes it, then it fast-advertises. |

While connected, the sensor never sleeps on its own, even if the seat is still
(rest intervals). Disconnect when the session ends so it can sleep.
