#include "console.h"

#include <Arduino.h>
#include <esp_timer.h>

#include "ble_link.h"
#include "config.h"
#include "power.h"
#include "sensor.h"

static Settings* s_cfg = nullptr;
static char s_line[64];
static uint8_t s_len = 0;
static uint32_t s_streamPeriodUs = 0;  // 0 = off
static int64_t s_nextStreamUs = 0;
static bool s_rateLog = false;
static bool s_tele = false;  // machine-readable lines for the bench-test page
static uint32_t s_lastTeleMs = 0;
static uint32_t s_lastRateMs = 0;
static bool s_markSet = false;
static int32_t s_markCount = 0;
static bool s_sleepReq = false;

static void printMm(int16_t pos01) {
  Serial.printf("%s%d.%d", pos01 < 0 ? "-" : "", abs(pos01) / 10, abs(pos01) % 10);
}

static void help() {
  Serial.println(
      "commands:\n"
      "  info              firmware, calibration, home state, BLE, battery\n"
      "  pos               one reading: counts and mm\n"
      "  stream [hz]       CSV t_us,counts,pos_mm at hz (default 50, max 200); `stop` ends\n"
      "  rate              toggle a 1 s log of peak count rate and channel-A frequency\n"
      "  zero              take the current position as home (manual reference)\n"
      "  unhome            clear the reference; the next reed pass homes\n"
      "  mark              remember the current count for a span calibration\n"
      "  span <mm>         after `mark` and a measured move of <mm>: compute and save the scale\n"
      "  cal <nm>          set the scale directly in nm per count (default 40000)\n"
      "  dir               reverse the sign (away from the flywheel must read positive)\n"
      "  homepos <mm>      position to report at the home index (default 0)\n"
      "  reset             restore calibration defaults\n"
      "  sleep             enter deep sleep now\n"
      "  tele [on|off]     machine-readable lines at 20 Hz (used by the bench-test page)\n"
      "  cfg               print the machine-readable config line");
}

static void info() {
  Serial.printf("SplitIQ seat sensor fw %d.%d.%d, protocol %d\n", FW_VERSION_MAJOR, FW_VERSION_MINOR,
                FW_VERSION_PATCH, PROTOCOL_VERSION);
  Serial.printf("  scale %lu nm/count (%.3f counts/mm), direction %+d, home position ",
                (unsigned long)s_cfg->nm_per_count, 1e6 / s_cfg->nm_per_count, s_cfg->direction);
  printMm(s_cfg->home_pos_01mm);
  Serial.println(" mm");
  Serial.printf("  homed %s, last re-index error ", sensorHomed() ? "yes" : "NO");
  printMm(sensorLastReindexErr01mm());
  Serial.printf(" mm, slip %s\n", sensorSlip() ? "YES" : "no");
  StatusPacket st = bleCurrentStatus();
  Serial.printf("  BLE %s, streaming %s, dropped packets %u\n", bleConnected() ? "connected" : "advertising",
                (st.flags & STATUS_STREAMING) ? "yes" : "no", st.dropped_packets);
  if (st.battery_pct == 0xFF) {
    Serial.println("  battery not measured (BATTERY_SENSE=0)");
  } else {
    Serial.printf("  battery %u mV, %u %%\n", st.battery_mv, st.battery_pct);
  }
  Serial.printf("  reed %s, wake cause: %s\n", digitalRead(PIN_REED) ? "open" : "CLOSED", powerWakeCause());
}

// Machine-readable lines (prefix letter, comma-separated) for tools/bench.html.
// C = config, T = telemetry, S = span result. Humans can ignore them.
static void printConfigLine() {
  Serial.printf("C,%d.%d.%d,%d,%lu,%d,%d,%s\n", FW_VERSION_MAJOR, FW_VERSION_MINOR, FW_VERSION_PATCH,
                PROTOCOL_VERSION, (unsigned long)s_cfg->nm_per_count, s_cfg->direction, s_cfg->home_pos_01mm,
                powerWakeCause());
}

static void saveAndApply() {
  settingsSave(*s_cfg);
  sensorApplySettings(*s_cfg);
  bleUpdateInfo(*s_cfg);
  printConfigLine();
}

static void handle(char* line) {
  char* cmd = strtok(line, " \t");
  char* arg = strtok(nullptr, " \t");
  if (!cmd) return;

  if (!strcmp(cmd, "help") || !strcmp(cmd, "?")) {
    help();
  } else if (!strcmp(cmd, "info")) {
    info();
  } else if (!strcmp(cmd, "pos")) {
    int32_t c = sensorCount();
    Serial.printf("counts %ld  pos ", (long)c);
    printMm(sensorCountToPosition01mm(c));
    Serial.printf(" mm  %s\n", sensorHomed() ? "" : "(NOT HOMED: relative to power-on)");
  } else if (!strcmp(cmd, "stream")) {
    long hz = arg ? atol(arg) : 50;
    if (hz < 1) hz = 1;
    if (hz > 200) hz = 200;
    s_streamPeriodUs = 1000000UL / hz;
    s_nextStreamUs = esp_timer_get_time();
    Serial.println("t_us,counts,pos_mm");
  } else if (!strcmp(cmd, "stop")) {
    s_streamPeriodUs = 0;
    s_rateLog = false;
    s_tele = false;
  } else if (!strcmp(cmd, "rate")) {
    s_rateLog = !s_rateLog;
    Serial.printf("rate log %s\n", s_rateLog ? "on" : "off");
  } else if (!strcmp(cmd, "zero")) {
    sensorHomeHere();
    Serial.println("homed here");
  } else if (!strcmp(cmd, "unhome")) {
    sensorClearHome();
    Serial.println("reference cleared; pass the reed to home");
  } else if (!strcmp(cmd, "mark")) {
    s_markCount = sensorCount();
    s_markSet = true;
    Serial.printf("mark at %ld counts; move a measured distance, then `span <mm>`\n", (long)s_markCount);
  } else if (!strcmp(cmd, "span")) {
    float mm = arg ? atof(arg) : 0;
    int32_t d = sensorCount() - s_markCount;
    if (!s_markSet || mm <= 0 || d == 0) {
      Serial.println("need `mark`, a move, then `span <mm>` with mm > 0");
      return;
    }
    uint32_t nm = (uint32_t)lroundf(mm * 1e6f / fabsf((float)d));
    Serial.printf("%ld counts over %.1f mm = %lu nm/count (nominal %lu, %+.2f %%)\n", (long)d, mm,
                  (unsigned long)nm, (unsigned long)DEFAULT_NM_PER_COUNT,
                  100.0 * ((double)nm - DEFAULT_NM_PER_COUNT) / DEFAULT_NM_PER_COUNT);
    bool ok = nm >= 1000 && nm <= 1000000;
    Serial.printf("S,%ld,%.1f,%lu,%d\n", (long)d, mm, (unsigned long)nm, ok ? 1 : 0);
    if (!ok) {
      Serial.println("out of range, not saved");
      return;
    }
    s_cfg->nm_per_count = nm;
    saveAndApply();
    Serial.println("saved");
  } else if (!strcmp(cmd, "cal")) {
    long nm = arg ? atol(arg) : 0;
    if (nm < 1000 || nm > 1000000) {
      Serial.println("cal <nm per count>, 1000-1000000");
      return;
    }
    s_cfg->nm_per_count = (uint32_t)nm;
    saveAndApply();
    Serial.printf("scale %ld nm/count saved\n", nm);
  } else if (!strcmp(cmd, "dir")) {
    s_cfg->direction = -s_cfg->direction;
    saveAndApply();
    Serial.printf("direction %+d saved\n", s_cfg->direction);
  } else if (!strcmp(cmd, "homepos")) {
    float mm = arg ? atof(arg) : 0;
    s_cfg->home_pos_01mm = (int16_t)lroundf(mm * 10);
    saveAndApply();
    Serial.printf("home position %.1f mm saved\n", mm);
  } else if (!strcmp(cmd, "reset")) {
    settingsReset(*s_cfg);
    sensorApplySettings(*s_cfg);
    bleUpdateInfo(*s_cfg);
    Serial.println("calibration reset to defaults");
    printConfigLine();
  } else if (!strcmp(cmd, "tele")) {
    s_tele = !(arg && !strcmp(arg, "off"));
    if (s_tele) printConfigLine();
  } else if (!strcmp(cmd, "cfg")) {
    printConfigLine();
  } else if (!strcmp(cmd, "sleep")) {
    s_sleepReq = true;
  } else {
    Serial.printf("unknown: %s (try help)\n", cmd);
  }
}

void consoleBegin(Settings* s) {
  s_cfg = s;
  Serial.println();
  Serial.printf("SplitIQ seat sensor %d.%d.%d, woke on: %s. Type `help`.\n", FW_VERSION_MAJOR,
                FW_VERSION_MINOR, FW_VERSION_PATCH, powerWakeCause());
}

void consoleService() {
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\r' || ch == '\n') {
      if (s_len) {
        s_line[s_len] = 0;
        s_len = 0;
        handle(s_line);
      }
    } else if (s_len < sizeof(s_line) - 1) {
      s_line[s_len++] = ch;
    }
  }

  if (s_streamPeriodUs) {
    int64_t now = esp_timer_get_time();
    if (now >= s_nextStreamUs) {
      s_nextStreamUs += s_streamPeriodUs;
      if (now - s_nextStreamUs > 100000) s_nextStreamUs = now;  // fell behind (serial backpressure): resync
      int32_t c = sensorCount();
      int16_t p = sensorCountToPosition01mm(c);
      Serial.printf("%lld,%ld,", now, (long)c);
      printMm(p);
      Serial.println();
    }
  }

  if (s_tele && millis() - s_lastTeleMs >= 50) {
    s_lastTeleMs = millis();
    int32_t c = sensorCount();
    StatusPacket st = bleCurrentStatus();
    // T,ms,counts,pos_01mm,status_flags,peak_counts_per_s,reindex_err_01mm,dropped,reed_closed
    Serial.printf("T,%lu,%ld,%d,%u,%lu,%d,%u,%d\n", (unsigned long)s_lastTeleMs, (long)c,
                  sensorCountToPosition01mm(c), st.flags, (unsigned long)sensorPeakCountsPerSec(),
                  st.last_reindex_err_01mm, st.dropped_packets, digitalRead(PIN_REED) ? 0 : 1);
  }

  if (s_rateLog && millis() - s_lastRateMs >= 1000) {
    s_lastRateMs = millis();
    uint32_t cps = sensorPeakCountsPerSec();
    // fA = cps / 2 (2x decoding). Seat speed = cps x scale.
    double mps = (double)cps * s_cfg->nm_per_count / 1e9;
    Serial.printf("peak %lu counts/s, channel A %lu Hz, %.2f m/s\n", (unsigned long)cps,
                  (unsigned long)(cps / 2), mps);
  }
}

bool consoleBusy() { return s_streamPeriodUs != 0 || s_rateLog || s_tele; }
bool consoleSleepRequested() { return s_sleepReq; }
