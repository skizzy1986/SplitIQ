// Encoder counting (PCNT), the 200 Hz sampler, homing and counts -> position.
#pragma once
#include <stdint.h>

#include "protocol.h"
#include "settings.h"

void sensorBegin(const Settings& s);
void sensorApplySettings(const Settings& s);

// Call often from loop(): handles reed captures and the 1 s motion/rate window.
void sensorService();

int32_t sensorCount();              // accumulated encoder count (not homed, not scaled)
int16_t sensorPositionNow01mm();    // current position, 0.1 mm
int16_t sensorCountToPosition01mm(int32_t count);

bool sensorHomed();
void sensorHomeHere();
void sensorClearHome();
int16_t sensorLastReindexErr01mm();
bool sensorSlip();

bool sensorMoving();
uint32_t sensorMsSinceMotion();
uint32_t sensorPeakCountsPerSec();  // over the last full second

// Packet production for BLE. Enabling clears the queue and starts a fresh packet.
void sensorSetStreaming(bool on);
bool sensorPopPacket(SamplePacket& out);
uint16_t sensorDroppedPackets();
