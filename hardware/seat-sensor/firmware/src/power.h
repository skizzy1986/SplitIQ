// Battery measurement and deep sleep.
#pragma once
#include <stdint.h>

void powerBegin();
uint16_t powerBatteryMv();   // 0 when not measured
uint8_t powerBatteryPct();   // 0xFF when not measured
const char* powerWakeCause();
// Arms wake on encoder motion (channel A level change) and the BOOT button,
// then enters deep sleep. Does not return: the chip resets on wake.
[[noreturn]] void powerDeepSleep();
