// Build-time configuration: pin map, scaling defaults and timing.
// Runtime-tunable values (calibration, direction, home position) live in NVS
// via settings.h and are only defaulted here.
#pragma once
#include <Arduino.h>

#define FW_VERSION_MAJOR 0
#define FW_VERSION_MINOR 1
#define FW_VERSION_PATCH 0

// ---------------------------------------------------------------------------
// Pin map: ESP32-S3-DevKitC-1 N16R8 on the KIT B screw-terminal carrier.
//
// Ruled out on this module (ESP32-S3-DevKitC-1 user guide, ESP32-S3 datasheet):
//   GPIO 0, 3, 45, 46  strapping pins (GPIO 0 is still used below as the BOOT
//                      button wake input; it only matters at reset)
//   GPIO 26-32         SPI flash / PSRAM bus
//   GPIO 33-37         octal PSRAM on R8 modules
//   GPIO 19, 20        native USB D-/D+
//   GPIO 43, 44        UART0 TX/RX (serial console via the UART port)
//   GPIO 38 / 48       on-board RGB LED (board revision dependent)
// The S3 has no input-only pins (that was the classic ESP32); PCNT inputs route
// through the GPIO matrix, so any free pin works. These are RTC-capable
// (GPIO 0-21) so they can also be deep-sleep wake sources.
// ---------------------------------------------------------------------------
static constexpr gpio_num_t PIN_ENC_A = GPIO_NUM_4;   // encoder A (green on most LPD3806 listings), 2.2k pull-up to 3V3
static constexpr gpio_num_t PIN_ENC_B = GPIO_NUM_5;   // encoder B (white on most LPD3806 listings), 2.2k pull-up to 3V3
static constexpr gpio_num_t PIN_REED = GPIO_NUM_6;    // MC-38 reed to 0V, 4.7k pull-up to 3V3; low = closed
static constexpr gpio_num_t PIN_BOOT_BTN = GPIO_NUM_0;  // on-board BOOT button, wake from sleep only
static constexpr gpio_num_t PIN_VBAT = GPIO_NUM_1;    // ADC1_CH0, battery divider (only if BATTERY_SENSE)

// Battery sense. Off by default: a USB power bank reports nothing to the board.
// For an 18650 build, fit a 100k/100k divider from cell + to PIN_VBAT and set 1.
#ifndef BATTERY_SENSE
#define BATTERY_SENSE 0
#endif
static constexpr float VBAT_DIVIDER_RATIO = 2.0f;  // (Rtop + Rbottom) / Rbottom

// ---------------------------------------------------------------------------
// Scaling. GT2 belt: 2 mm pitch x 20 teeth = 40 mm of belt per encoder rev,
// independent of pulley pitch diameter. LPD3806-500BM = 500 PPR; 2x decoding
// (both edges of A) = 1000 counts/rev -> 40 um/count = 40,000 nm/count.
// ---------------------------------------------------------------------------
static constexpr uint32_t DEFAULT_NM_PER_COUNT = 40000;
static constexpr int8_t DEFAULT_DIRECTION = 1;          // flip with the `dir` console command
static constexpr int16_t DEFAULT_HOME_POS_01MM = 0;    // position reported at the reed make point

// PCNT. Limits sit inside the 16-bit hardware range; accum_count extends the
// count in software at each limit crossing, so total travel is unbounded.
static constexpr int PCNT_HIGH_LIMIT = 30000;
static constexpr int PCNT_LOW_LIMIT = -30000;
// Pulses narrower than this are rejected as noise. At 25 kHz on channel A the
// half-period is 20 us, so 1 us leaves a wide margin.
static constexpr uint32_t PCNT_GLITCH_NS = 1000;

// ---------------------------------------------------------------------------
// Sampling and packets (see hardware/seat-sensor/docs/ble-protocol.md).
// ---------------------------------------------------------------------------
static constexpr uint32_t SAMPLE_PERIOD_US = 5000;   // 200 Hz
static constexpr uint8_t SAMPLES_PER_PACKET = 8;     // one notification per 40 ms
static constexpr uint8_t PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Homing.
// ---------------------------------------------------------------------------
static constexpr uint32_t REED_REARM_SAMPLES = 10;   // reed must read open for 50 ms before the next make counts
static constexpr int32_t REINDEX_SLIP_LIMIT_01MM = 20;  // > 2 mm error at a re-index pass sets the slip flag

// ---------------------------------------------------------------------------
// Power.
// ---------------------------------------------------------------------------
static constexpr uint32_t CPU_FREQ_MHZ = 80;            // lowest clock that keeps the radio up
static constexpr uint32_t ADV_FAST_MS = 30000;          // fast advertising after boot or disconnect
static constexpr uint16_t ADV_FAST_INTERVAL = 160;      // x0.625 ms = 100 ms
static constexpr uint16_t ADV_SLOW_INTERVAL = 1600;     // x0.625 ms = 1 s
static constexpr uint32_t IDLE_SLEEP_MS = 5UL * 60UL * 1000UL;  // no client and no motion -> deep sleep
static constexpr int32_t MOTION_THRESHOLD_COUNTS = 25;  // 1 mm in a 1 s window counts as motion
// Preferred connection interval, x1.25 ms. 12 = 15 ms, 24 = 30 ms.
static constexpr uint16_t CONN_INTERVAL_MIN = 12;
static constexpr uint16_t CONN_INTERVAL_MAX = 24;
static constexpr uint16_t CONN_SUPERVISION_TIMEOUT = 400;  // x10 ms = 4 s

static constexpr const char* DEVICE_NAME = "SplitIQ Seat";
