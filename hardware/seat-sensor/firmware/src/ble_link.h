// BLE peripheral: custom GATT service, advertising and the sample stream.
#pragma once
#include <stdint.h>

#include "protocol.h"
#include "settings.h"

void bleBegin(const Settings& s);
void bleService();                  // call from loop(): sends queued packets, status, advertising mode
void bleUpdateInfo(const Settings& s);
bool bleConnected();
bool bleSleepRequested();           // a client wrote CTRL_SLEEP
void bleStop();                     // disconnect and stop advertising before sleep
StatusPacket bleCurrentStatus();
