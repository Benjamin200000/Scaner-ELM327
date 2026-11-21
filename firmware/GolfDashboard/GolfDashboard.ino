/* Golf MK4/A4: tablero OBD de lectura. No modifica la ECU ni borra DTC.
 * Arduino-ESP32 3.3.4 / ESP32 Dev Module / particion Huge APP.
 * Bluetooth clasico SPP + OLED SSD1306 128x64 I2C.
 */
#include <Arduino.h>
#include <BluetoothSerial.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <atomic>
#include "Config.h"
#include "ObdCodec.h"
#include "DashboardState.h"
#include "PollPlanner.h"
#include "WebUi.h"

#if !defined(CONFIG_BT_SPP_ENABLED)
#error "Seleccione ESP32 original con Bluetooth SPP (ESP32 Dev Module), no S3/C3."
#endif

BluetoothSerial elm;
Adafruit_SSD1306 oled(128, 64, &Wire, -1, OLED_I2C_HZ, OLED_I2C_HZ);
constexpr uint8_t PIDS[] = {0x0C, 0x0D, 0x05, 0x5C, 0x10, 0x00, 0x0F, 0x0B, 0x04, 0x11, 0x42};
Dashboard shared;
AdapterSettings adapter;
Preferences preferences;
WebServer web{80};
String webToken;
std::atomic<bool> reconnectRequested{false};
portMUX_TYPE guard = portMUX_INITIALIZER_UNLOCKED;
bool displayReady = false;

Dashboard snapshot() {
  portENTER_CRITICAL(&guard);
  Dashboard copy = shared;
  portEXIT_CRITICAL(&guard);
  return copy;
}
void linkState(Link state, bool reset = false) {
  portENTER_CRITICAL(&guard);
  if (reset) {
    const uint8_t page = shared.page;
    const uint32_t mask = shared.extraMask;
    shared = Dashboard{};
    shared.page = page;
    shared.extraMask = mask;
  }
  shared.link = state;
  ++shared.revision;
  portEXIT_CRITICAL(&guard);
}
void setSupport(FieldId id, Support s) {
  portENTER_CRITICAL(&guard);
  shared.fields[id].support = s;
  ++shared.revision;
  portEXIT_CRITICAL(&guard);
}
void changePage() {
  portENTER_CRITICAL(&guard);
  shared.page = 1 - shared.page;
  ++shared.revision;
  portEXIT_CRITICAL(&guard);
}
AdapterSettings adapterSnapshot() {
  portENTER_CRITICAL(&guard);
  AdapterSettings copy = adapter;
  portEXIT_CRITICAL(&guard);
  return copy;
}
bool parseMac(const char* text, uint8_t* bytes) {
  if (strlen(text) != 17) return false;
  for (unsigned i = 0; i < 6; ++i) {
    int a = Obd::hex(text[i*3]), b = Obd::hex(text[i*3+1]);
    if (a < 0 || b < 0 || (i < 5 && text[i*3+2] != ':')) return false;
    bytes[i] = uint8_t((a<<4)|b);
  }
  return true;
}
String jsonText(const char* text) {
  String out = "\"";
  while (*text) {
    char c = *text++;
    if (c == '\\' || c == '"') out += '\\';
    if (uint8_t(c) < 32) out += '?'; else out += c;
  }
  return out + '"';
}
void sendLive() {
  Dashboard d = snapshot();
  uint32_t now = millis();
  const char* states[] = {"Conectando Bluetooth", "Detectando ECU", "OBD conectado", "Reconectando OBD"};
  String out; out.reserve(2400);
  out = "{\"state\":" + jsonText(states[static_cast<unsigned>(d.link)]);
  out += ",\"page\":"+String(d.page)+",\"mask\":"+String(d.extraMask);
  out += ",\"rpmHz\":"+String(d.rpmHz,2)+",\"speedHz\":"+String(d.speedHz,2);
  out += ",\"reference\":"+String(STOICHIOMETRIC_AFR,2)+",\"afr\":";
  const Reading& lambda = d.fields[LAMBDA];
  const bool lambdaFast = d.page == 1;
  const bool lambdaFresh = lambda.valid && d.link == Link::Ready &&
    uint32_t(now-lambda.at) <= (lambdaFast ? FAST_STALE_MS : EXTRA_STALE_MS);
  out += lambdaFresh ? String(lambda.value*STOICHIOMETRIC_AFR,2) : "null";
  out += ",\"fields\":[";
  for (unsigned id = 0; id < FIELD_COUNT; ++id) {
    const Reading& r = d.fields[id];
    bool fast = d.page == 0 ? (id == RPM || id == SPEED) : (id == MAF || id == LAMBDA);
    uint32_t limit = fast ? FAST_STALE_MS : id == COOLANT ? COOLANT_STALE_MS : id == OIL ? OIL_STALE_MS : EXTRA_STALE_MS;
    bool stale = r.valid && (d.link != Link::Ready || uint32_t(now-r.at) > limit);
    if (id) out += ',';
    out += "{\"support\":"+String(r.support == Support::Yes ? 1 : r.support == Support::No ? 0 : -1);
    out += ",\"value\":";
    out += r.valid && d.link == Link::Ready ? String(r.value,3) : "null";
    out += ",\"age\":";
    out += r.valid ? String(uint32_t(now-r.at)) : "null";
    out += ",\"stale\":"; out += stale ? "true" : "false";
    out += ",\"digits\":"+String(id == LAMBDA ? 3 : id == MAF || id == MAP || id == VOLTAGE ? 2 : 0)+"}";
  }
  out += "]}";
  web.sendHeader("Cache-Control", "no-store");
  web.send(200, "application/json", out);
}
bool allowWebWrite() {
  if (web.header("X-Golf-Token") == webToken) return true;
  web.send(403,"text/plain; charset=utf-8","Recarga la página para obtener una sesión válida.");
  return false;
}
void configureNetwork() {
  strlcpy(adapter.name, preferences.getString("name", ELM_NAME).c_str(), sizeof(adapter.name));
  strlcpy(adapter.pin, preferences.getString("pin", ELM_PIN).c_str(), sizeof(adapter.pin));
  if (USE_ELM_MAC) {
    snprintf(adapter.mac,sizeof(adapter.mac),"%02X:%02X:%02X:%02X:%02X:%02X",ELM_MAC[0],ELM_MAC[1],ELM_MAC[2],ELM_MAC[3],ELM_MAC[4],ELM_MAC[5]);
  }
  strlcpy(adapter.mac, preferences.getString("mac",adapter.mac).c_str(), sizeof(adapter.mac));
  if (preferences.getBytesLength("adapter") == sizeof(AdapterSettings)) {
    AdapterSettings stored;
    if (preferences.getBytes("adapter",&stored,sizeof(stored)) == sizeof(stored)) {
      stored.name[sizeof(stored.name)-1]=0; stored.pin[sizeof(stored.pin)-1]=0; stored.mac[sizeof(stored.mac)-1]=0;
      uint8_t parsed[6];
      if (stored.name[0] && stored.pin[0] && (!stored.mac[0] || parseMac(stored.mac,parsed))) adapter=stored;
    }
  }
  WiFi.mode(WIFI_AP);
  WiFi.setSleep(false);
  if (!WiFi.softAP(WIFI_AP_NAME,WIFI_AP_PASSWORD,1,false,2)) Serial.println("No se pudo iniciar Wi-Fi AP.");
  char token[17]; snprintf(token,sizeof(token),"%08lx%08lx",(unsigned long)esp_random(),(unsigned long)esp_random());
  webToken = token;
  const char* headers[] = {"X-Golf-Token"}; web.collectHeaders(headers,1);
  web.on("/",HTTP_GET,[&]() {
    String page = FPSTR(WEB_UI); page.replace("%TOKEN%",webToken);
    web.sendHeader("Cache-Control","no-store"); web.send(200,"text/html; charset=utf-8",page);
  });
  web.on("/api/live",HTTP_GET,[&]() {sendLive();});
  web.on("/api/config",HTTP_GET,[&]() {
    AdapterSettings a = adapterSnapshot();
    web.sendHeader("Cache-Control","no-store");
    web.send(200,"application/json","{\"name\":"+jsonText(a.name)+",\"mac\":"+jsonText(a.mac)+"}");
  });
  web.on("/api/page",HTTP_POST,[&]() {
    if (!allowWebWrite()) return;
    String page = web.arg("page");
    if (page != "0" && page != "1") {web.send(400,"text/plain","Pagina invalida"); return;}
    portENTER_CRITICAL(&guard); shared.page = page == "1" ? 1 : 0; ++shared.revision; portEXIT_CRITICAL(&guard);
    web.send(200,"text/plain","OK");
  });
  web.on("/api/extras",HTTP_POST,[&]() {
    if (!allowWebWrite()) return;
    String mask = web.arg("mask"); bool valid = mask.length() > 0 && mask.length() <= 4;
    for (unsigned i=0; i<mask.length(); ++i) if (mask[i]<'0'||mask[i]>'9') valid=false;
    uint32_t number = mask.toInt();
    if (!valid || number >= (uint32_t(1)<<FIELD_COUNT)) {web.send(400,"text/plain","Seleccion invalida");return;}
    portENTER_CRITICAL(&guard); shared.extraMask=number; ++shared.revision; portEXIT_CRITICAL(&guard);
    web.send(200,"text/plain","OK");
  });
  web.on("/api/config",HTTP_POST,[&]() {
    if (!allowWebWrite()) return;
    AdapterSettings next = adapterSnapshot();
    String name=web.arg("name"), pin=web.arg("pin"), mac=web.arg("mac"); name.trim(); mac.trim();
    bool valid=name.length()>0 && name.length()<sizeof(next.name) && pin.length()<sizeof(next.pin);
    for (unsigned i=0; i<name.length(); ++i) if (name[i]<32 || uint8_t(name[i])>126) valid=false;
    for (unsigned i=0; i<pin.length(); ++i) if (pin[i]<32 || uint8_t(pin[i])>126) valid=false;
    uint8_t parsed[6];
    if (mac.length() && !parseMac(mac.c_str(),parsed)) valid=false;
    if (!valid) {web.send(400,"text/plain; charset=utf-8","Revisa nombre, PIN (máximo 16 caracteres) y MAC.");return;}
    strlcpy(next.name,name.c_str(),sizeof(next.name)); strlcpy(next.mac,mac.c_str(),sizeof(next.mac));
    if (pin.length()) strlcpy(next.pin,pin.c_str(),sizeof(next.pin));
    if (preferences.putBytes("adapter",&next,sizeof(next)) != sizeof(next)) {
      web.send(500,"text/plain","No se pudo guardar en memoria. Revisa por USB."); return;
    }
    portENTER_CRITICAL(&guard); adapter=next; portEXIT_CRITICAL(&guard);
    reconnectRequested.store(true);
    web.send(200,"text/plain; charset=utf-8","Guardado. Reconectando Bluetooth; puede tardar varias decenas de segundos.");
  });
  web.onNotFound([&]() {web.send(404,"text/plain","Abre http://192.168.4.1/");});
  web.begin();
  Serial.printf("Wi-Fi %s, abrir http://192.168.4.1/\n",WIFI_AP_NAME);
}

char response[768];

// Una sola consulta en vuelo. Si falta '>', se reinicia la conexion para no
// atribuir una respuesta tardia al comando siguiente. Solo bloquea la tarea OBD.
Reply command(const char* text, uint32_t timeout) {
  if (reconnectRequested.load()) return Reply::Disconnected;
  while (elm.available()) elm.read();
  response[0] = 0;
  char outbound[32];
  const int length = snprintf(outbound, sizeof(outbound), "%s\r", text);
  if (length < 0 || size_t(length) >= sizeof(outbound)) return Reply::Overflow;
  // Comando y terminador en una escritura para evitar dos envios SPP separados.
  if (elm.write(reinterpret_cast<const uint8_t*>(outbound), length) != size_t(length))
    return Reply::Disconnected;
  const uint32_t start = millis();
  size_t used = 0;
  bool overflow = false;
  while (uint32_t(millis() - start) < timeout) {
    while (elm.available()) {
      int ch = elm.read();
      if (ch < 0) break;
      if (ch == '>') {
        response[used] = 0;
        return overflow ? Reply::Overflow : Reply::Complete;
      }
      if (used + 1 < sizeof(response)) response[used++] = static_cast<char>(ch);
      else overflow = true;
    }
    if (!elm.connected(0) || reconnectRequested.load()) return Reply::Disconnected;
    vTaskDelay(1); // Cede CPU al stack BT; no hay espera fija tras una respuesta.
  }
  response[used] = 0;
  return Reply::Timeout;
}
bool at(const char* text, bool requireOK = true, uint32_t timeout = 2200) {
  if (command(text, timeout) != Reply::Complete) return false;
  return !requireOK || strstr(response, "OK") != nullptr;
}
bool query(uint8_t pid, uint32_t timeout = PID_RESPONSE_MS) {
  char cmd[5];
  snprintf(cmd, sizeof(cmd), "01%02X", pid);
  return command(cmd, timeout) == Reply::Complete;
}
bool initializeElm() {
  // ATZ se usa solo al conectar, nunca en el ciclo de adquisicion.
  if (!at("ATZ", false, 4000)) return false;
  if (!at("ATE0") || !at("ATL0") || !at("ATS0") || !at("ATH0")) return false;
  // Algunos clones no implementan ATAT2; conservar un modo adaptativo basico.
  if (command(ELM_ADAPTIVE_COMMAND, 2200) != Reply::Complete) return false;
  if (!strstr(response, "OK")) {
    if (!at("ATAT1", false)) return false;
    Serial.println("ELM no confirmo el modo adaptativo solicitado; alternativa ATAT1.");
  }
  if (!at(ELM_TIMEOUT_COMMAND) || !at("ATSP0")) return false;

  uint32_t bits0 = 0, bits20 = 0, bits40 = 0;
  if (!query(0x00, AUTO_PROTOCOL_MS)) return false;
  if (!Obd::bitmap(response, 0x00, bits0)) {
    // Segundo intento tras el descubrimiento automatico del protocolo.
    if (!query(0x00, AUTO_PROTOCOL_MS) || !Obd::bitmap(response, 0x00, bits0)) return false;
  }
  for (FieldId id : {RPM, SPEED, COOLANT, MAF, IAT, MAP, LOAD, THROTTLE})
    setSupport(id, Obd::supported(bits0, 0x00, PIDS[id]) ? Support::Yes : Support::No);

  // No consultar 015C a ciegas de forma continua: comprobar primero el soporte.
  Support oil = Support::Unknown;
  Support voltage = Support::Unknown;
  Support lambda = Support::Unknown;
  uint8_t lambdaPid = 0;
  if (!Obd::supported(bits0, 0x00, 0x20)) oil = lambda = voltage = Support::No;
  else {
    if (!query(0x20)) return false;
    if (Obd::bitmap(response, 0x20, bits20)) {
      // No buscar el sensor posterior al catalizador como sustituto del S1.
      if (Obd::supported(bits20, 0x20, 0x24)) lambdaPid = 0x24;
      else if (Obd::supported(bits20, 0x20, 0x34)) lambdaPid = 0x34;
      lambda = lambdaPid ? Support::Yes : Support::No;
      if (!Obd::supported(bits20, 0x20, 0x40)) oil = voltage = Support::No;
      else {
        if (!query(0x40)) return false;
        if (Obd::bitmap(response, 0x40, bits40)) {
          oil = Obd::supported(bits40, 0x40, 0x5C) ? Support::Yes : Support::No;
          voltage = Obd::supported(bits40, 0x40, 0x42) ? Support::Yes : Support::No;
        }
      }
    }
  }
  setSupport(OIL, oil);
  setSupport(VOLTAGE, voltage);
  setSupport(LAMBDA, lambda);
  portENTER_CRITICAL(&guard);
  shared.lambdaPid = lambdaPid;
  ++shared.revision;
  portEXIT_CRITICAL(&guard);
  Serial.printf("MAF PID10, lambda medida S1 PID%02X (00=no disponible).\n", lambdaPid);
  if (!at("ATDPN", false)) return false;
  Serial.printf("Protocolo ELM (A=automatico): %s\n", response);
  return true;
}

// La busqueda Bluetooth clasica ocupa la misma radio que el Wi-Fi. Repetida
// sin pausa, el telefono no logra unirse a GolfDashboard y no se puede corregir
// el nombre o PIN del ELM desde el panel. Tras dos intentos fallidos se espacia:
// 15 s sin telefonos conectados, 30 s con alguno conectado al punto de acceso.
uint32_t bluetoothRetryDelay(unsigned failures) {
  if (failures < 2) return 3000;
  return WiFi.softAPgetStationNum() > 0 ? 30000 : 15000;
}

// Espera, pero corta en cuanto se guarda una configuracion nueva desde el panel.
void waitOrReconfigure(uint32_t ms) {
  const uint32_t start = millis();
  while (uint32_t(millis() - start) < ms && !reconnectRequested.load()) vTaskDelay(pdMS_TO_TICKS(100));
}

void obdTask(void*) {
  unsigned btFailures = 0;
  for (;;) {
    reconnectRequested.exchange(false);
    linkState(Link::Connecting, true);
    AdapterSettings wanted = adapterSnapshot();
    elm.setPin(wanted.pin, strlen(wanted.pin));
    Serial.printf("Conectando a %s; contacto del Golf encendido.\n", wanted.name);
    bool connected;
    uint8_t address[6];
    if (wanted.mac[0] && parseMac(wanted.mac,address)) {
      connected = elm.connect(address);
    } else connected = elm.connect(String(wanted.name));
    if (!connected) {
      ++btFailures;
      const uint32_t wait = bluetoothRetryDelay(btFailures);
      Serial.printf("ELM no encontrado; nueva busqueda en %lu s.\n", (unsigned long)(wait / 1000));
      waitOrReconfigure(wait);
      if (reconnectRequested.load()) btFailures = 0;
      continue;
    }
    btFailures = 0;
    linkState(Link::Initializing);
    if (!initializeElm()) {
      Serial.printf("No se pudo iniciar OBD. Ultima respuesta: %s\n", response);
      linkState(Link::Recovering);
      elm.disconnect();
      vTaskDelay(pdMS_TO_TICKS(2000));
      continue;
    }
    linkState(Link::Ready);
    // Alternancia de parametros rapidos. Como maximo una consulta lenta entre
    // dos rapidas. La cadencia real depende de ECU/protocolo/ELM.
    PollPlanner planner;
    uint32_t statsAt = millis();
    uint32_t counts[FIELD_COUNT] = {};
    unsigned failures = 0;
    while (elm.connected(0) && !reconnectRequested.load()) {
      const uint32_t now = millis();
      Dashboard d = snapshot();
      const FieldId id = planner.next(d, now);
      if (id == FIELD_COUNT) {
        vTaskDelay(pdMS_TO_TICKS(20)); // Ningun PID disponible; no ciclo ocupado.
        continue;
      }
      const uint8_t pid = id == LAMBDA ? d.lambdaPid : PIDS[id];
      const uint32_t sentAt = millis();
      if (!query(pid)) break;
      const uint32_t receivedAt = millis();
      float value;
      if (Obd::value(response, pid, value)) {
        portENTER_CRITICAL(&guard);
        Reading& r = shared.fields[id];
        r.value = value; r.at = receivedAt; r.valid = true;
        r.latencyMs = receivedAt - sentAt; ++r.count; ++shared.revision;
        portEXIT_CRITICAL(&guard);
        failures = 0;
        ++counts[id];
      } else {
        ++failures;
        Serial.printf("Sin lectura PID %02X: %s\n", pid, response);
        if (failures >= 8) break;
      }
      if (uint32_t(receivedAt - statsAt) >= 3000) {
        const float seconds = (receivedAt - statsAt) / 1000.0f;
        portENTER_CRITICAL(&guard);
        shared.rpmHz = counts[RPM] / seconds;
        shared.speedHz = counts[SPEED] / seconds;
        shared.mafHz = counts[MAF] / seconds;
        shared.lambdaHz = counts[LAMBDA] / seconds;
        ++shared.revision;
        portEXIT_CRITICAL(&guard);
        d = snapshot();
        Serial.printf("RPM %.1f Hz (%lu ms), velocidad %.1f Hz (%lu ms)\n",
                      d.rpmHz, (unsigned long)d.fields[RPM].latencyMs,
                      d.speedHz, (unsigned long)d.fields[SPEED].latencyMs);
        Serial.printf("MAF %.1f Hz (%lu ms), lambda %.1f Hz (%lu ms)\n",
                      d.mafHz, (unsigned long)d.fields[MAF].latencyMs,
                      d.lambdaHz, (unsigned long)d.fields[LAMBDA].latencyMs);
        statsAt = receivedAt;
        memset(counts, 0, sizeof(counts));
      }
    }
    linkState(Link::Recovering);
    elm.disconnect();
    vTaskDelay(pdMS_TO_TICKS(1500));
  }
}

void printValue(const Reading& r, uint32_t now, uint32_t staleMs, uint8_t decimals = 0) {
  if (r.support == Support::No) oled.print("N/D");
  else if (!r.valid) oled.print("--");
  else if (uint32_t(now - r.at) > staleMs) oled.print("OLD");
  else if (decimals) oled.print(r.value, decimals);
  else oled.print(static_cast<int>(lroundf(r.value)));
}
void render(const Dashboard& d) {
  const uint32_t now = millis();
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1); oled.setCursor(0, 0);
  if (d.link != Link::Ready) {
    oled.println("GOLF MK4 / OBD");
    oled.setCursor(0, 20);
    if (d.link == Link::Connecting) oled.println("Conectando Bluetooth");
    else if (d.link == Link::Initializing) oled.println("Detectando ECU...");
    else oled.println("Sin conexion OBD");
    oled.setCursor(0, 40); oled.println("ELM 327 + contacto ON");
    oled.setCursor(0, 56); oled.print("WiFi: 192.168.4.1");
  } else if (d.page == 0) {
    oled.print("RPM"); oled.setCursor(54, 0); oled.print("1/2");
    oled.setCursor(90, 0); oled.print("km/h");
    oled.setTextSize(3); oled.setCursor(0, 12);
    // Evita cortar mensajes de estado en la columna de velocidad.
    if (!d.fields[RPM].valid || uint32_t(now - d.fields[RPM].at) > FAST_STALE_MS) oled.setTextSize(2);
    printValue(d.fields[RPM], now, FAST_STALE_MS);
    oled.setTextSize(2); oled.setCursor(88, 16);
    printValue(d.fields[SPEED], now, FAST_STALE_MS);
    oled.drawFastHLine(0, 37, 128, SSD1306_WHITE);
    oled.setTextSize(1); oled.setCursor(0, 39); oled.print("AGUA");
    oled.setCursor(68, 39); oled.print("ACEITE");
    oled.setCursor(0, 47); printValue(d.fields[COOLANT], now, COOLANT_STALE_MS); oled.print(" C");
    oled.setCursor(68, 47); printValue(d.fields[OIL], now, OIL_STALE_MS); oled.print(" C");
    oled.setCursor(0, 56); oled.printf("R:%.1f V:%.1f Hz", d.rpmHz, d.speedHz);
  } else {
    oled.print("2/2 MEZCLA");
    if (d.lambdaPid) { oled.setCursor(90, 0); oled.printf("WB%02X", d.lambdaPid); }
    oled.setCursor(0, 14); oled.print("MAF g/s");
    oled.setTextSize(2); oled.setCursor(52, 10);
    printValue(d.fields[MAF], now, FAST_STALE_MS, 2);
    oled.setTextSize(1); oled.setCursor(0, 32); oled.print("LAMBDA");
    oled.setTextSize(2); oled.setCursor(64, 28);
    printValue(d.fields[LAMBDA], now, FAST_STALE_MS, 3);
    oled.setTextSize(1); oled.setCursor(0, 50); oled.print("AFR calc");
    oled.setTextSize(2); oled.setCursor(64, 46);
    Reading afr = d.fields[LAMBDA];
    afr.value *= STOICHIOMETRIC_AFR;
    printValue(afr, now, FAST_STALE_MS, 2);
  }
  oled.display();
}

void setup() {
  Serial.begin(115200);
  preferences.begin("golfdash",false);
  pinMode(PAGE_BUTTON_PIN, INPUT_PULLUP);
  Wire.begin(OLED_SDA, OLED_SCL, OLED_I2C_HZ);
  displayReady = oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS);
  if (!displayReady) Serial.println("OLED no iniciada: revisar 3V3, GND, SDA21, SCL22 y 0x3C/0x3D.");
  else render(snapshot());
  configureNetwork();
  if (!elm.begin("GolfDashboard", true)) {
    Serial.println("No se pudo iniciar Bluetooth SPP.");
    while (true) delay(1000);
  }
  elm.setPin(ELM_PIN, strlen(ELM_PIN));
  if (xTaskCreatePinnedToCore(obdTask, "OBD", 8192, nullptr, 2, nullptr, 0) != pdPASS) {
    Serial.println("No se pudo crear tarea OBD.");
  }
}
void loop() {
  static uint32_t revision = UINT32_MAX, lastPaint = 0;
  static TickType_t lastWake = xTaskGetTickCount();
  static bool lastRaw = HIGH, stable = HIGH;
  static uint32_t buttonChangedAt = 0;
  web.handleClient();
  uint32_t now = millis();
  bool raw = digitalRead(PAGE_BUTTON_PIN);
  if (raw != lastRaw) { lastRaw = raw; buttonChangedAt = now; }
  if (raw != stable && uint32_t(now - buttonChangedAt) >= BUTTON_DEBOUNCE_MS) {
    stable = raw;
    if (stable == LOW) changePage();
  }
  // Alternativa sin boton, desde Monitor serie: enviar p.
  while (Serial.available()) {
    const int c = Serial.read();
    if (c == 'p' || c == 'P') changePage();
  }
  Dashboard d = snapshot();
  // Repinta solo por datos nuevos o para comprobar caducidad/estado.
  if (displayReady && (d.revision != revision || uint32_t(now - lastPaint) >= 250)) {
    render(d); revision = d.revision; lastPaint = now;
  }
  vTaskDelayUntil(&lastWake, pdMS_TO_TICKS(OLED_FRAME_MS));
}
