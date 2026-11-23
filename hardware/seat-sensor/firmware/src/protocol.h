// BLE GATT layout and wire formats. hardware/seat-sensor/docs/ble-protocol.md is the spec the app
// implements; change both together and bump PROTOCOL_VERSION on any layout change.
// All multi-byte fields are little-endian (the ESP32-S3 is little-endian, so the
// packed structs below are the wire format as-is).
#pragma once
#include <stdint.h>

#define SEAT_UUID(x) "36f9" x "-f6b6-4908-857c-004314d7acba"
#define SEAT_SERVICE_UUID SEAT_UUID("0001")
#define SEAT_SAMPLES_UUID SEAT_UUID("0002")  // notify
#define SEAT_STATUS_UUID SEAT_UUID("0003")   // read, notify
#define SEAT_INFO_UUID SEAT_UUID("0004")     // read
#define SEAT_CONTROL_UUID SEAT_UUID("0005")  // write

// Samples: 20 bytes, fits the default 23-byte ATT MTU with no negotiation.
struct __attribute__((packed)) SamplePacket {
  uint32_t t0_us;        // esp_timer time of sample[0], truncated to 32 bits (wraps every 71.6 min)
  int16_t pos_01mm[8];   // position in 0.1 mm, sample k taken at t0_us + k * sample_period_us
};
static_assert(sizeof(SamplePacket) == 20, "sample packet must be 20 bytes");

enum StatusFlag : uint8_t {
  STATUS_HOMED = 1 << 0,       // position is referenced to the home index; meaningless when clear
  STATUS_STREAMING = 1 << 1,   // a client is subscribed to samples
  STATUS_MOVING = 1 << 2,      // seat moved more than 1 mm in the last second
  STATUS_SLIP = 1 << 3,        // last re-index pass disagreed by more than 2 mm (latched until re-homed)
  STATUS_BATT_LOW = 1 << 4,    // battery under 15 %
  STATUS_OVERRUN = 1 << 5,     // a sample packet was dropped on the device (latched until reconnect)
};

struct __attribute__((packed)) StatusPacket {
  uint8_t flags;               // StatusFlag bits
  uint8_t battery_pct;         // 0-100, 0xFF = not measured
  uint16_t battery_mv;         // 0 = not measured
  int16_t last_reindex_err_01mm;  // position error found at the last re-index pass
  uint16_t dropped_packets;    // packets dropped on the device since the client subscribed
  uint16_t peak_rate_hz_div10; // peak channel-A frequency over the last second, /10 (encoder headroom)
};
static_assert(sizeof(StatusPacket) == 10, "status packet size");

struct __attribute__((packed)) InfoPacket {
  uint8_t protocol_version;
  uint8_t fw_major, fw_minor, fw_patch;
  uint16_t sample_period_us;
  uint8_t samples_per_packet;
  uint8_t reserved;            // 0
  uint32_t nm_per_count;       // calibration in use; counts per mm = 1e6 / nm_per_count
  int16_t home_pos_01mm;       // position assigned at the home index
};
static_assert(sizeof(InfoPacket) == 14, "info packet size");

enum ControlOp : uint8_t {
  CTRL_HOME_HERE = 0x01,   // take the current position as home (manual reference, no reed)
  CTRL_CLEAR_HOME = 0x02,  // drop the reference; the next reed pass homes again
  CTRL_SLEEP = 0x03,       // disconnect and enter deep sleep
};
