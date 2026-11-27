// SplitIQ seat-position sensor.
// Quadrature encoder on a GT2 belt loop -> PCNT (2x) -> 200 Hz sampler ->
// BLE notifications, 8 samples per 20-byte packet. Spec: hardware/seat-sensor/docs/ble-protocol.md.
#include <Arduino.h>

#include "ble_link.h"
#include "config.h"
#include "console.h"
#include "power.h"
#include "sensor.h"
#include "settings.h"

static Settings g_settings;

void setup() {
  Serial.begin(115200);
  powerBegin();
  settingsLoad(g_settings);
  sensorBegin(g_settings);
  bleBegin(g_settings);
  consoleBegin(&g_settings);
}

void loop() {
  sensorService();
  bleService();
  consoleService();

  bool idle = !bleConnected() && !consoleBusy() && sensorMsSinceMotion() > IDLE_SLEEP_MS;
  if (idle || bleSleepRequested() || consoleSleepRequested()) {
    bleStop();
    powerDeepSleep();
  }

  // 1 ms is well inside one 40 ms packet; the sampler runs on its own timer.
  delay(1);
}
