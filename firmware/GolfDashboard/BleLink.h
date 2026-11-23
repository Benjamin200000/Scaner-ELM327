#pragma once
#include <Arduino.h>
#include <BLEDevice.h>

// ELM327 por Bluetooth LE: los adaptadores "compatibles con iPhone" (Vgate,
// Veepeak, LELink, clones). El iPhone no puede usar Bluetooth clasico con
// estos adaptadores, asi que suelen ser BLE. Se comporta como el puerto serie
// del Bluetooth clasico (available/read/write) para que el resto no cambie.
class BleElm {
 public:
  void begin(const char* deviceName) {
    if (started_) return;
    BLEDevice::init(deviceName);
    BLEDevice::setMTU(185);
    started_ = true;
  }

  // Busca por MAC, por nombre (sin distinguir mayusculas) o, si ninguno
  // coincide, el adaptador mas cercano que anuncie un servicio ELM327 conocido.
  bool connect(const char* name, const char* mac, uint32_t scanSeconds = 5) {
    if (!started_) return false;
    disconnect();
    found_[0] = 0;
    BLEScan* scan = BLEDevice::getScan();
    scan->setActiveScan(true);
    scan->setInterval(100);
    scan->setWindow(80);
    BLEScanResults* results = scan->start(scanSeconds, false);
    const int count = results ? results->getCount() : 0;
    int chosen = -1, byService = -1, bestRssi = -1000;
    for (int i = 0; i < count; ++i) {
      BLEAdvertisedDevice d = results->getDevice(i);
      const String addr = d.getAddress().toString();
      const String devName = d.haveName() ? d.getName() : String();
      if (devName.length()) appendFound(devName.c_str());
      if (mac && mac[0] && addr.equalsIgnoreCase(mac)) { chosen = i; break; }
      if (name && name[0] && devName.length() && devName.equalsIgnoreCase(name)) chosen = i;
      if (advertisesElm(d) && d.getRSSI() > bestRssi) { byService = i; bestRssi = d.getRSSI(); }
    }
    if (chosen < 0) chosen = byService;
    if (chosen < 0) { scan->clearResults(); return false; }
    BLEAdvertisedDevice device = results->getDevice(chosen);
    scan->clearResults();
    if (!client_) client_ = BLEDevice::createClient();
    if (!client_->connect(&device)) return false;
    if (!findCharacteristics()) { client_->disconnect(); return false; }
    clear();
    rx_->registerForNotify([this](BLERemoteCharacteristic*, uint8_t* data, size_t length, bool) {
      push(data, length);
    });
    address_ = device.getAddress().toString();
    address_.toUpperCase();
    connectedName_ = device.haveName() ? device.getName() : String("(sin nombre)");
    return true;
  }

  bool connected() { return client_ && tx_ && client_->isConnected(); }

  void disconnect() {
    if (client_ && client_->isConnected()) client_->disconnect();
    tx_ = rx_ = nullptr;
    clear();
  }

  int available() {
    portENTER_CRITICAL(&mux_);
    const int n = int((head_ - tail_) & (SIZE - 1));
    portEXIT_CRITICAL(&mux_);
    return n;
  }

  int read() {
    int c = -1;
    portENTER_CRITICAL(&mux_);
    if (head_ != tail_) { c = buffer_[tail_]; tail_ = (tail_ + 1) & (SIZE - 1); }
    portEXIT_CRITICAL(&mux_);
    return c;
  }

  size_t write(const uint8_t* data, size_t length) {
    if (!connected()) return 0;
    const uint16_t mtu = client_->getMTU();
    const size_t chunk = mtu > 23 ? mtu - 3 : 20;
    for (size_t off = 0; off < length; off += chunk) {
      const size_t n = length - off < chunk ? length - off : chunk;
      if (!tx_->writeValue(const_cast<uint8_t*>(data + off), n, withResponse_)) return off;
    }
    return length;
  }

  const String& address() const { return address_; }
  const String& connectedName() const { return connectedName_; }
  const char* found() const { return found_; }

 private:
  static constexpr size_t SIZE = 1024;  // potencia de 2
  // Servicio, escritura y notificacion de los ELM327 BLE conocidos.
  static constexpr const char* PROFILES[][3] = {
    {"0000fff0-0000-1000-8000-00805f9b34fb", "0000fff2-0000-1000-8000-00805f9b34fb", "0000fff1-0000-1000-8000-00805f9b34fb"},
    {"0000ffe0-0000-1000-8000-00805f9b34fb", "0000ffe1-0000-1000-8000-00805f9b34fb", "0000ffe1-0000-1000-8000-00805f9b34fb"},
    {"e7810a71-73ae-499d-8c15-faa9aef0c3f2", "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f", "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f"},
    {"6e400001-b5a3-f393-e0a9-e50e24dcca9e", "6e400002-b5a3-f393-e0a9-e50e24dcca9e", "6e400003-b5a3-f393-e0a9-e50e24dcca9e"},
    {"000018f0-0000-1000-8000-00805f9b34fb", "00002af1-0000-1000-8000-00805f9b34fb", "00002af0-0000-1000-8000-00805f9b34fb"},
  };

  static bool advertisesElm(BLEAdvertisedDevice& d) {
    for (const auto& p : PROFILES) if (d.isAdvertisingService(BLEUUID(p[0]))) return true;
    return false;
  }

  bool findCharacteristics() {
    tx_ = rx_ = nullptr;
    for (const auto& p : PROFILES) {
      BLERemoteService* s = client_->getService(BLEUUID(p[0]));
      if (!s) continue;
      BLERemoteCharacteristic* w = s->getCharacteristic(BLEUUID(p[1]));
      BLERemoteCharacteristic* n = s->getCharacteristic(BLEUUID(p[2]));
      if (w && n && n->canNotify() && (w->canWrite() || w->canWriteNoResponse())) { tx_ = w; rx_ = n; break; }
    }
    if (!tx_) {
      // Adaptador desconocido: el primer servicio con una caracteristica de
      // notificacion y otra de escritura.
      auto* services = client_->getServices();
      if (services) for (auto& entry : *services) {
        auto* chars = entry.second->getCharacteristics();
        if (!chars) continue;
        BLERemoteCharacteristic *w = nullptr, *n = nullptr;
        for (auto& c : *chars) {
          if (!n && c.second->canNotify()) n = c.second;
          if (!w && (c.second->canWrite() || c.second->canWriteNoResponse())) w = c.second;
        }
        if (w && n) { tx_ = w; rx_ = n; break; }
      }
    }
    if (!tx_) return false;
    withResponse_ = !tx_->canWriteNoResponse();
    return true;
  }

  void push(const uint8_t* data, size_t length) {
    portENTER_CRITICAL(&mux_);
    for (size_t i = 0; i < length; ++i) {
      const size_t next = (head_ + 1) & (SIZE - 1);
      if (next == tail_) break;  // lleno: se descarta, la respuesta quedara incompleta
      buffer_[head_] = data[i];
      head_ = next;
    }
    portEXIT_CRITICAL(&mux_);
  }

  void clear() { portENTER_CRITICAL(&mux_); head_ = tail_ = 0; portEXIT_CRITICAL(&mux_); }

  void appendFound(const char* n) {
    if (strstr(found_, n)) return;
    const size_t used = strlen(found_), add = strlen(n);
    if (used + add + 3 >= sizeof(found_)) return;
    if (used) strcat(found_, ", ");
    strcat(found_, n);
  }

  bool started_ = false;
  bool withResponse_ = false;
  BLEClient* client_ = nullptr;
  BLERemoteCharacteristic* tx_ = nullptr;
  BLERemoteCharacteristic* rx_ = nullptr;
  portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED;
  uint8_t buffer_[SIZE];
  volatile size_t head_ = 0, tail_ = 0;
  char found_[160] = "";
  String address_;
  String connectedName_;
};
