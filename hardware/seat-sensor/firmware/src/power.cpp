#include "power.h"

#include <Arduino.h>
#include <esp_sleep.h>

#include "config.h"

void powerBegin() {
  setCpuFrequencyMhz(CPU_FREQ_MHZ);
#if BATTERY_SENSE
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_VBAT, ADC_11db);
#endif
}

uint16_t powerBatteryMv() {
#if BATTERY_SENSE
  uint32_t sum = 0;
  for (int i = 0; i < 8; i++) sum += analogReadMilliVolts(PIN_VBAT);
  return (uint16_t)((sum / 8) * VBAT_DIVIDER_RATIO);
#else
  return 0;
#endif
}

uint8_t powerBatteryPct() {
#if BATTERY_SENSE
  // Rough Li-ion open-circuit curve under light load. Good enough for a
  // "charge it soon" flag; not a fuel gauge.
  static const uint16_t mv[] = {3300, 3500, 3600, 3700, 3750, 3800, 3850, 3950, 4050, 4150, 4200};
  uint16_t v = powerBatteryMv();
  if (v <= mv[0]) return 0;
  for (int i = 1; i < 11; i++) {
    if (v <= mv[i]) return (uint8_t)((i - 1) * 10 + (v - mv[i - 1]) * 10 / (mv[i] - mv[i - 1]));
  }
  return 100;
#else
  return 0xFF;
#endif
}

const char* powerWakeCause() {
  switch (esp_sleep_get_wakeup_cause()) {
    case ESP_SLEEP_WAKEUP_EXT0: return "encoder motion";
    case ESP_SLEEP_WAKEUP_EXT1: return "BOOT button";
    case ESP_SLEEP_WAKEUP_UNDEFINED: return "power-on or reset";
    default: return "other";
  }
}

void powerDeepSleep() {
  // Wake on the first edge of channel A: arm ext0 for the opposite of its
  // present level. The encoder stays powered from 5V through sleep, so any
  // seat movement of one count wakes the chip. The reference is lost on wake
  // (incremental encoder, and the seat may have moved), so it re-homes.
  int a = digitalRead(PIN_ENC_A);
  esp_sleep_enable_ext0_wakeup(PIN_ENC_A, a ? 0 : 1);
  esp_sleep_enable_ext1_wakeup(1ULL << PIN_BOOT_BTN, ESP_EXT1_WAKEUP_ANY_LOW);
  Serial.println("[power] deep sleep; move the seat or press BOOT to wake");
  Serial.flush();
  esp_deep_sleep_start();
}
