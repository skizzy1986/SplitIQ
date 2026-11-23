#include "sensor.h"

#include <Arduino.h>
#include <driver/gpio.h>
#include <driver/pulse_cnt.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

#include "config.h"
#include "scaling.h"

static pcnt_unit_handle_t s_unit = nullptr;
static esp_timer_handle_t s_timer = nullptr;
static QueueHandle_t s_queue = nullptr;
static portMUX_TYPE s_lock = portMUX_INITIALIZER_UNLOCKED;

// Scaling and reference, read by the sampler under s_lock.
static Settings s_cfg;
static int32_t s_homeCount = 0;  // count at the home index (boot count until homed)
static bool s_homed = false;
static int8_t s_homeApproach = 0;  // sign of count change when the reed made at homing
static int16_t s_lastErr01 = 0;
static bool s_slip = false;

// Sampler state (esp_timer task).
static volatile bool s_streaming = false;
static volatile bool s_resetReq = false;  // sampler restarts its packet on the next sample
static SamplePacket s_pkt;
static uint8_t s_pktFill = 0;
static volatile uint16_t s_dropped = 0;
static int32_t s_lastCount = 0;
static int32_t s_lag[8];  // counts of the last 8 samples (40 ms), for reed direction
static uint8_t s_lagIdx = 0;
static volatile int32_t s_maxDeltaWindow = 0;
static uint32_t s_reedOpenRun = 0;

// Reed capture (GPIO ISR -> loop).
static volatile bool s_reedArmed = false;
static volatile bool s_reedPending = false;
static volatile int32_t s_reedCount = 0;
static volatile int32_t s_reedLagCount = 0;

// 1 s window (loop).
static uint32_t s_windowStartMs = 0;
static int32_t s_windowStartCount = 0;
static uint32_t s_peakCps = 0;
static bool s_moving = false;
static uint32_t s_lastMotionMs = 0;

static inline int32_t readCount() {
  int c = 0;
  pcnt_unit_get_count(s_unit, &c);
  return c;
}

static inline int16_t toPos01(int32_t count, const Settings& cfg, int32_t homeCount) {
  return countsToPos01mm(count, homeCount, cfg.nm_per_count, cfg.direction, cfg.home_pos_01mm);
}

static void ARDUINO_ISR_ATTR onReed() {
  if (!s_reedArmed) return;
  s_reedArmed = false;
  s_reedCount = readCount();  // pcnt_unit_get_count is ISR-safe (pulse_cnt.h)
  s_reedLagCount = s_lag[s_lagIdx];  // oldest of the last 8 samples
  s_reedPending = true;
}

static void onSample(void*) {
  int64_t now = esp_timer_get_time();
  int32_t c = readCount();

  int32_t d = c - s_lastCount;
  if (d < 0) d = -d;
  if (d > s_maxDeltaWindow) s_maxDeltaWindow = d;
  s_lastCount = c;
  s_lag[s_lagIdx] = c;
  s_lagIdx = (s_lagIdx + 1) % 8;

  // Re-arm the reed only after it has read open for a while: kills contact bounce
  // and a seat parked on the switch.
  if (gpio_get_level(PIN_REED)) {
    if (++s_reedOpenRun >= REED_REARM_SAMPLES) s_reedArmed = true;
  } else {
    s_reedOpenRun = 0;
  }

  if (!s_streaming) return;
  if (s_resetReq) {
    s_resetReq = false;
    s_pktFill = 0;
  }

  Settings cfg;
  int32_t home;
  portENTER_CRITICAL(&s_lock);
  cfg = s_cfg;
  home = s_homeCount;
  portEXIT_CRITICAL(&s_lock);

  if (s_pktFill == 0) s_pkt.t0_us = (uint32_t)now;
  s_pkt.pos_01mm[s_pktFill++] = toPos01(c, cfg, home);
  if (s_pktFill == SAMPLES_PER_PACKET) {
    if (xQueueSend(s_queue, &s_pkt, 0) != pdTRUE) s_dropped = s_dropped + 1;
    s_pktFill = 0;
  }
}

void sensorBegin(const Settings& s) {
  s_cfg = s;

  pcnt_unit_config_t unitCfg = {};
  unitCfg.low_limit = PCNT_LOW_LIMIT;
  unitCfg.high_limit = PCNT_HIGH_LIMIT;
  unitCfg.flags.accum_count = 1;
  ESP_ERROR_CHECK(pcnt_new_unit(&unitCfg, &s_unit));

  pcnt_glitch_filter_config_t filt = {.max_glitch_ns = PCNT_GLITCH_NS};
  ESP_ERROR_CHECK(pcnt_unit_set_glitch_filter(s_unit, &filt));

  // One channel = 2x decoding: count both edges of A, B's level gives direction.
  // (4x would add a second channel with A and B swapped; it would double the
  // count rate and the glitch-filter load for resolution nobody needs.)
  pcnt_chan_config_t chCfg = {};
  chCfg.edge_gpio_num = PIN_ENC_A;
  chCfg.level_gpio_num = PIN_ENC_B;
  pcnt_channel_handle_t ch = nullptr;
  ESP_ERROR_CHECK(pcnt_new_channel(s_unit, &chCfg, &ch));
  ESP_ERROR_CHECK(pcnt_channel_set_edge_action(ch, PCNT_CHANNEL_EDGE_ACTION_DECREASE,
                                               PCNT_CHANNEL_EDGE_ACTION_INCREASE));
  ESP_ERROR_CHECK(pcnt_channel_set_level_action(ch, PCNT_CHANNEL_LEVEL_ACTION_KEEP,
                                                PCNT_CHANNEL_LEVEL_ACTION_INVERSE));
  // accum_count needs the limits as watch points: the driver adds the limit to
  // its software accumulator each time the hardware counter hits one.
  ESP_ERROR_CHECK(pcnt_unit_add_watch_point(s_unit, PCNT_HIGH_LIMIT));
  ESP_ERROR_CHECK(pcnt_unit_add_watch_point(s_unit, PCNT_LOW_LIMIT));
  ESP_ERROR_CHECK(pcnt_unit_enable(s_unit));
  ESP_ERROR_CHECK(pcnt_unit_clear_count(s_unit));
  ESP_ERROR_CHECK(pcnt_unit_start(s_unit));

  // The PCNT driver enables the pins' internal pull-ups; the external 2.2k
  // pull-ups dominate, so they are left as the driver set them.

  pinMode(PIN_REED, INPUT);  // external 4.7k pull-up
  attachInterrupt(PIN_REED, onReed, FALLING);

  s_queue = xQueueCreate(16, sizeof(SamplePacket));

  esp_timer_create_args_t targs = {};
  targs.callback = onSample;
  targs.dispatch_method = ESP_TIMER_TASK;
  targs.name = "seat_sample";
  targs.skip_unhandled_events = false;
  ESP_ERROR_CHECK(esp_timer_create(&targs, &s_timer));
  ESP_ERROR_CHECK(esp_timer_start_periodic(s_timer, SAMPLE_PERIOD_US));

  s_windowStartMs = millis();
  s_lastMotionMs = millis();
}

void sensorApplySettings(const Settings& s) {
  portENTER_CRITICAL(&s_lock);
  s_cfg = s;
  portEXIT_CRITICAL(&s_lock);
}

void sensorService() {
  if (s_reedPending) {
    s_reedPending = false;
    int32_t c = s_reedCount;
    int32_t lag = s_reedLagCount;
    int8_t dir = (c > lag) ? 1 : (c < lag) ? -1 : 0;
    // A make with the seat stationary has no direction, so it can't be
    // qualified against the reed's differential (make point differs by
    // approach direction). Ignore it; the next moving pass homes.
    if (dir != 0) {
      portENTER_CRITICAL(&s_lock);
      if (!s_homed) {
        s_homed = true;
        s_homeApproach = dir;
        s_homeCount = c;
        s_lastErr01 = 0;
        s_slip = false;
      } else if (dir == s_homeApproach) {
        Settings cfg = s_cfg;
        int16_t err = toPos01(c, cfg, s_homeCount) - cfg.home_pos_01mm;
        s_lastErr01 = err;
        if (abs(err) > REINDEX_SLIP_LIMIT_01MM) s_slip = true;
        s_homeCount = c;  // re-index, like a Z-pulse re-reference
      }
      portEXIT_CRITICAL(&s_lock);
    }
  }

  uint32_t now = millis();
  if (now - s_windowStartMs >= 1000) {
    int32_t c = readCount();
    int32_t moved = c - s_windowStartCount;
    s_moving = abs(moved) > MOTION_THRESHOLD_COUNTS;
    if (s_moving) s_lastMotionMs = now;
    s_peakCps = (uint32_t)s_maxDeltaWindow * (1000000UL / SAMPLE_PERIOD_US);
    s_maxDeltaWindow = 0;
    s_windowStartCount = c;
    s_windowStartMs = now;
  }
}

int32_t sensorCount() { return readCount(); }

int16_t sensorCountToPosition01mm(int32_t count) {
  portENTER_CRITICAL(&s_lock);
  Settings cfg = s_cfg;
  int32_t home = s_homeCount;
  portEXIT_CRITICAL(&s_lock);
  return toPos01(count, cfg, home);
}

int16_t sensorPositionNow01mm() { return sensorCountToPosition01mm(readCount()); }

bool sensorHomed() { return s_homed; }

void sensorHomeHere() {
  int32_t c = readCount();
  portENTER_CRITICAL(&s_lock);
  s_homed = true;
  s_homeApproach = 0;  // manual reference: no reed direction known yet
  s_homeCount = c;
  s_lastErr01 = 0;
  s_slip = false;
  portEXIT_CRITICAL(&s_lock);
}

void sensorClearHome() {
  portENTER_CRITICAL(&s_lock);
  s_homed = false;
  s_homeApproach = 0;
  s_slip = false;
  s_lastErr01 = 0;
  portEXIT_CRITICAL(&s_lock);
}

int16_t sensorLastReindexErr01mm() { return s_lastErr01; }
bool sensorSlip() { return s_slip; }
bool sensorMoving() { return s_moving; }
uint32_t sensorMsSinceMotion() { return millis() - s_lastMotionMs; }
uint32_t sensorPeakCountsPerSec() { return s_peakCps; }

void sensorSetStreaming(bool on) {
  if (on == s_streaming) return;
  s_streaming = false;
  s_resetReq = true;
  xQueueReset(s_queue);
  s_dropped = 0;
  s_streaming = on;
}

bool sensorPopPacket(SamplePacket& out) { return xQueueReceive(s_queue, &out, 0) == pdTRUE; }

uint16_t sensorDroppedPackets() { return s_dropped; }
