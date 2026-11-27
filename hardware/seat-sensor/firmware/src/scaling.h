// Counts -> position. Pure, so it is unit-tested on the host (test/host_test.cpp).
#pragma once
#include <stdint.h>

// position (0.1 mm) = home_pos + direction * (count - home_count) * nm_per_count / 1e5,
// saturated to int16 (+/-3.27 m, far beyond any erg rail).
static inline int16_t countsToPos01mm(int32_t count, int32_t homeCount, uint32_t nmPerCount, int8_t direction,
                                      int16_t homePos01mm) {
  int64_t d01 = (int64_t)(count - homeCount) * (int64_t)nmPerCount / 100000;
  int64_t pos = (int64_t)homePos01mm + direction * d01;
  if (pos > INT16_MAX) pos = INT16_MAX;
  if (pos < INT16_MIN) pos = INT16_MIN;
  return (int16_t)pos;
}
