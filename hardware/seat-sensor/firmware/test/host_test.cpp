// Host-side checks for the pure parts: scaling and wire layouts.
// Run: g++ -std=c++17 -Isrc test/host_test.cpp -o /tmp/seat_test && /tmp/seat_test
#include <cstddef>
#include <cstdio>
#include <cstring>

#include "../src/protocol.h"
#include "../src/scaling.h"

static int fails = 0;
#define CHECK_EQ(a, b)                                                                     \
  do {                                                                                     \
    long long _a = (a), _b = (b);                                                          \
    if (_a != _b) {                                                                        \
      std::printf("FAIL %s:%d  %s = %lld, want %lld\n", __FILE__, __LINE__, #a, _a, _b); \
      fails++;                                                                             \
    }                                                                                      \
  } while (0)

int main() {
  const uint32_t nm = 40000;  // 20T GT2, 500 PPR, 2x
  // 25 counts = 1 mm = 10 x 0.1 mm
  CHECK_EQ(countsToPos01mm(25, 0, nm, 1, 0), 10);
  // 1 m of travel = 25,000 counts: past the 16-bit PCNT limit the accumulated count still scales
  CHECK_EQ(countsToPos01mm(25000, 0, nm, 1, 0), 10000);
  CHECK_EQ(countsToPos01mm(40000, 0, nm, 1, 0), 16000);
  // home offset and direction
  CHECK_EQ(countsToPos01mm(1000, 1250, nm, 1, 0), -100);
  CHECK_EQ(countsToPos01mm(1000, 1250, nm, -1, 0), 100);
  CHECK_EQ(countsToPos01mm(1250, 1250, nm, 1, 123), 123);
  // sub-0.1 mm truncates toward zero (2 counts = 0.08 mm)
  CHECK_EQ(countsToPos01mm(2, 0, nm, 1, 0), 0);
  CHECK_EQ(countsToPos01mm(3, 0, nm, 1, 0), 1);
  // saturation
  CHECK_EQ(countsToPos01mm(10000000, 0, nm, 1, 0), 32767);
  CHECK_EQ(countsToPos01mm(-10000000, 0, nm, 1, 0), -32768);

  // Wire layout: the spec's byte offsets.
  CHECK_EQ(sizeof(SamplePacket), 20);
  SamplePacket p = {};
  p.t0_us = 0x04030201;
  p.pos_01mm[0] = -2;   // 0xFFFE
  p.pos_01mm[7] = 1234; // 0x04D2
  uint8_t b[20];
  std::memcpy(b, &p, 20);
  CHECK_EQ(b[0], 0x01);
  CHECK_EQ(b[3], 0x04);
  CHECK_EQ(b[4], 0xFE);
  CHECK_EQ(b[5], 0xFF);
  CHECK_EQ(b[18], 0xD2);
  CHECK_EQ(b[19], 0x04);
  CHECK_EQ(sizeof(StatusPacket), 10);
  CHECK_EQ(offsetof(StatusPacket, battery_mv), 2);
  CHECK_EQ(offsetof(StatusPacket, last_reindex_err_01mm), 4);
  CHECK_EQ(offsetof(StatusPacket, dropped_packets), 6);
  CHECK_EQ(offsetof(StatusPacket, peak_rate_hz_div10), 8);
  CHECK_EQ(sizeof(InfoPacket), 14);
  CHECK_EQ(offsetof(InfoPacket, sample_period_us), 4);
  CHECK_EQ(offsetof(InfoPacket, samples_per_packet), 6);
  CHECK_EQ(offsetof(InfoPacket, nm_per_count), 8);
  CHECK_EQ(offsetof(InfoPacket, home_pos_01mm), 12);

  std::printf(fails ? "%d FAILED\n" : "all host checks passed\n", fails);
  return fails ? 1 : 0;
}
