// Persistent calibration in NVS (survives power-off and deep sleep).
#pragma once
#include <stdint.h>

struct Settings {
  uint32_t nm_per_count;
  int8_t direction;        // +1 or -1: makes "away from the flywheel" positive
  int16_t home_pos_01mm;
};

void settingsLoad(Settings& s);
void settingsSave(const Settings& s);
void settingsReset(Settings& s);
