#include "ble_link.h"

#include <Arduino.h>
#include <NimBLEDevice.h>

#include "config.h"
#include "power.h"
#include "sensor.h"

static NimBLEServer* s_server = nullptr;
static NimBLECharacteristic* s_samples = nullptr;
static NimBLECharacteristic* s_status = nullptr;
static NimBLECharacteristic* s_info = nullptr;
static NimBLECharacteristic* s_control = nullptr;

static volatile bool s_connected = false;
static volatile bool s_subscribed = false;
static volatile bool s_sleepReq = false;
static volatile bool s_advRestart = false;
static uint32_t s_advStartMs = 0;
static bool s_advFast = true;
static StatusPacket s_lastSent = {};
static uint32_t s_lastStatusMs = 0;
static uint32_t s_lastBattMs = 0;
static uint16_t s_battMv = 0;
static uint8_t s_battPct = 0xFF;
static bool s_overrun = false;

static void startAdvertising(bool fast) {
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->stop();
  uint16_t iv = fast ? ADV_FAST_INTERVAL : ADV_SLOW_INTERVAL;
  adv->setMinInterval(iv);
  adv->setMaxInterval(iv + iv / 4);
  adv->start();
  s_advFast = fast;
  s_advStartMs = millis();
}

class ServerCb : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* srv, NimBLEConnInfo& info) override {
    s_connected = true;
    s_overrun = false;
    srv->updateConnParams(info.getConnHandle(), CONN_INTERVAL_MIN, CONN_INTERVAL_MAX, 0,
                          CONN_SUPERVISION_TIMEOUT);
    Serial.printf("[ble] connected %s\n", info.getAddress().toString().c_str());
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int reason) override {
    s_connected = false;
    s_subscribed = false;
    sensorSetStreaming(false);
    s_advRestart = true;  // restart from loop(), not from the host task
    Serial.printf("[ble] disconnected, reason 0x%02x\n", reason);
  }
};

class SamplesCb : public NimBLECharacteristicCallbacks {
  void onSubscribe(NimBLECharacteristic*, NimBLEConnInfo&, uint16_t subValue) override {
    // Stream only while notifications are enabled (bit 0 of the CCCD).
    s_subscribed = (subValue & 0x0001) != 0;
    sensorSetStreaming(s_subscribed);
    Serial.printf("[ble] samples %s\n", s_subscribed ? "subscribed" : "unsubscribed");
  }
};

class ControlCb : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo&) override {
    NimBLEAttValue v = c->getValue();
    if (v.length() < 1) return;
    switch (v.data()[0]) {
      case CTRL_HOME_HERE: sensorHomeHere(); break;
      case CTRL_CLEAR_HOME: sensorClearHome(); break;
      case CTRL_SLEEP: s_sleepReq = true; break;
      default: break;  // unknown opcodes are ignored so older firmware tolerates newer apps
    }
  }
};

static ServerCb s_serverCb;
static SamplesCb s_samplesCb;
static ControlCb s_controlCb;

void bleUpdateInfo(const Settings& s) {
  InfoPacket info = {};
  info.protocol_version = PROTOCOL_VERSION;
  info.fw_major = FW_VERSION_MAJOR;
  info.fw_minor = FW_VERSION_MINOR;
  info.fw_patch = FW_VERSION_PATCH;
  info.sample_period_us = SAMPLE_PERIOD_US;
  info.samples_per_packet = SAMPLES_PER_PACKET;
  info.nm_per_count = s.nm_per_count;
  info.home_pos_01mm = s.home_pos_01mm;
  s_info->setValue((const uint8_t*)&info, sizeof(info));
}

void bleBegin(const Settings& s) {
  NimBLEDevice::init(DEVICE_NAME);
  NimBLEDevice::setPower(3);  // dBm; a phone within 2 m of the erg needs no more

  s_server = NimBLEDevice::createServer();
  s_server->setCallbacks(&s_serverCb);
  // No pairing or bonding: the data is seat position, and Web Bluetooth's
  // pairing support is patchy.

  NimBLEService* svc = s_server->createService(SEAT_SERVICE_UUID);
  s_samples = svc->createCharacteristic(SEAT_SAMPLES_UUID, NIMBLE_PROPERTY::NOTIFY);
  s_samples->setCallbacks(&s_samplesCb);
  s_status = svc->createCharacteristic(SEAT_STATUS_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  s_info = svc->createCharacteristic(SEAT_INFO_UUID, NIMBLE_PROPERTY::READ);
  s_control = svc->createCharacteristic(SEAT_CONTROL_UUID, NIMBLE_PROPERTY::WRITE);
  s_control->setCallbacks(&s_controlCb);
  bleUpdateInfo(s);
  StatusPacket st = bleCurrentStatus();
  s_status->setValue((const uint8_t*)&st, sizeof(st));
  svc->start();

  // Service UUID in the advertising packet (Chrome and Android scan filters
  // match on it); the name goes in the scan response because a 128-bit UUID
  // plus flags leaves too little of the 31-byte packet for it.
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->enableScanResponse(true);
  adv->addServiceUUID(SEAT_SERVICE_UUID);
  adv->setName(DEVICE_NAME);
  adv->setPreferredParams(CONN_INTERVAL_MIN, CONN_INTERVAL_MAX);
  startAdvertising(true);
}

StatusPacket bleCurrentStatus() {
  StatusPacket st = {};
  uint16_t dropped = sensorDroppedPackets();
  if (dropped) s_overrun = true;
  st.flags = (sensorHomed() ? STATUS_HOMED : 0) | (s_subscribed ? STATUS_STREAMING : 0) |
             (sensorMoving() ? STATUS_MOVING : 0) | (sensorSlip() ? STATUS_SLIP : 0) |
             (s_battPct != 0xFF && s_battPct < 15 ? STATUS_BATT_LOW : 0) | (s_overrun ? STATUS_OVERRUN : 0);
  st.battery_pct = s_battPct;
  st.battery_mv = s_battMv;
  st.last_reindex_err_01mm = sensorLastReindexErr01mm();
  st.dropped_packets = dropped;
  uint32_t fa = sensorPeakCountsPerSec() / 2;  // 2x decoding: two counts per A cycle
  st.peak_rate_hz_div10 = (uint16_t)min<uint32_t>(fa / 10, 0xFFFF);
  return st;
}

void bleService() {
  uint32_t now = millis();

  if (s_advRestart) {
    s_advRestart = false;
    startAdvertising(true);
  }
  if (!s_connected && s_advFast && now - s_advStartMs > ADV_FAST_MS) startAdvertising(false);

  if (now - s_lastBattMs > 10000 || s_lastBattMs == 0) {
    s_lastBattMs = now;
    s_battMv = powerBatteryMv();
    s_battPct = powerBatteryPct();
  }

  SamplePacket pkt;
  while (sensorPopPacket(pkt)) {
    if (s_subscribed) s_samples->notify((const uint8_t*)&pkt, sizeof(pkt));
  }

  // Status: notify on any change except the peak-rate field, which changes
  // every second while rowing; that one is refreshed for reads every 1 s.
  StatusPacket st = bleCurrentStatus();
  StatusPacket a = st, b = s_lastSent;
  a.peak_rate_hz_div10 = b.peak_rate_hz_div10 = 0;
  bool changed = memcmp(&a, &b, sizeof(a)) != 0;
  if (changed || now - s_lastStatusMs > 1000) {
    s_status->setValue((const uint8_t*)&st, sizeof(st));
    if (changed && s_connected) s_status->notify();
    s_lastSent = st;
    s_lastStatusMs = now;
  }
}

bool bleConnected() { return s_connected; }
bool bleSleepRequested() { return s_sleepReq; }

void bleStop() {
  NimBLEDevice::getAdvertising()->stop();
  if (s_server) {
    for (uint16_t h : s_server->getPeerDevices()) s_server->disconnect(h);
  }
  delay(100);
}
