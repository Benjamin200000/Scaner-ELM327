// GOLF DASHBOARD Wi-Fi v3 - archivo unico para copiar en Arduino IDE.
// ESP32-WROOM-32, core Espressif 3.3.4, particion Huge APP.
#include <Arduino.h>
#include <BluetoothSerial.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <atomic>
#if !defined(CONFIG_BT_SPP_ENABLED)
#error "Usar ESP32 Dev Module (WROOM-32), no S3/C3"
#endif
static const char WEB_UI[] PROGMEM = R"GOLFHTML(<!doctype html>
<html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Golf Dashboard</title><style>
:root{color-scheme:dark}body{font:16px system-ui;background:#10151d;color:#eef3fb;max-width:760px;margin:auto;padding:16px}h1{font-size:24px}button,input{font:inherit;border-radius:8px;padding:10px;border:1px solid #506078}button{background:#234c81;color:white;cursor:pointer}input{background:#192330;color:white;max-width:95%}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.card,section{background:#1a2432;border-radius:12px;padding:14px;margin:10px 0}.value{font-size:32px;font-weight:bold;overflow-wrap:anywhere}.unit,.age,small{color:#b5c3d5;font-size:13px}.bad{color:#ffcc83}.row{display:flex;gap:8px;flex-wrap:wrap}label{display:block;margin:10px 0}input[type=checkbox]{width:20px;height:20px;vertical-align:middle}#msg{white-space:pre-wrap}a{color:#a8d0ff}
</style><h1>Golf Dashboard</h1><p id="status">Conectando al ESP32...</p>
<p class="row"><button onclick="setPage(0)">OLED: motor</button><button onclick="setPage(1)">OLED: mezcla</button></p>
<div class="grid" id="cards"></div><section><b>Consultas adicionales</b><p>Marca solo lo que necesitas. Cada dato extra comparte el tiempo del ELM; no aumenta su velocidad. Los datos de la página OLED activa tienen prioridad.</p><div id="extras"></div><button onclick="applyExtras()">Aplicar selección</button><button onclick="clearExtras()">Priorizar latencia</button></section>
<section><b>Adaptador Bluetooth</b><form id="config"><label>Nombre <input id="name" maxlength="63" required></label><label>MAC opcional <input id="mac" placeholder="AA:BB:CC:DD:EE:FF" maxlength="17"></label><label>PIN <input id="pin" type="password" maxlength="16" placeholder="Vacío: conservar el actual"></label><button>Guardar y reconectar</button></form><p>Una MAC válida tiene prioridad sobre el nombre. El PIN guardado no se muestra. Una búsqueda Bluetooth puede tardar varias decenas de segundos.</p></section>
<p id="msg" role="status"></p><small>Red local sin internet. MAP se muestra en bar absolutos. AFR es calculado con una referencia configurable; N/D no significa cero. No manipules el teléfono al conducir.</small>
<script>
const token='%TOKEN%',cards=document.querySelector('#cards'),extra=document.querySelector('#extras');let busy=false,initialized=false;
const names=['RPM','Velocidad','Refrigerante','Aceite','MAF','Lambda medida S1','Temperatura admisión','Presión admisión absoluta','Carga calculada','Posición acelerador','Tensión ECU'];
const units=['rpm','km/h','°C','°C','g/s','λ','°C','bar abs','%','%','V'];
function message(t){document.querySelector('#msg').textContent=t}
async function post(url,data){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Golf-Token':token},body:new URLSearchParams(data),signal:AbortSignal.timeout(5000)});const t=await r.text();if(!r.ok)throw Error(t);return t}
async function setPage(p){try{await post('/api/page',{page:p});message('Página OLED cambiada.')}catch(e){message(e.message)}}
async function applyExtras(){let mask=0;document.querySelectorAll('#extras input:checked').forEach(x=>mask|=1<<Number(x.value));try{await post('/api/extras',{mask});message('Selección aplicada.')}catch(e){message(e.message)}}
async function clearExtras(){document.querySelectorAll('#extras input').forEach(x=>x.checked=false);await applyExtras()}
function show(f){if(f.support===0)return 'N/D';if(f.value===null)return '—';if(f.stale)return 'Antiguo';return Number(f.value).toFixed(f.digits)}
async function poll(){if(busy)return;busy=true;try{const r=await fetch('/api/live',{cache:'no-store',signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error('Sin respuesta del ESP32');const d=await r.json();document.querySelector('#status').textContent=d.state+' · OLED '+(d.page+1)+'/2 · RPM '+d.rpmHz.toFixed(1)+' Hz · velocidad '+d.speedHz.toFixed(1)+' Hz';if(!initialized){names.forEach((n,i)=>{const c=document.createElement('div');c.className='card';c.innerHTML='<div></div><div class="value"></div><div class="unit"></div><div class="age"></div>';c.children[0].textContent=n;c.children[2].textContent=units[i];cards.append(c);const label=document.createElement('label');const box=document.createElement('input');box.type='checkbox';box.value=i;box.checked=Boolean(d.mask&(1<<i));box.disabled=d.fields[i].support!==1;label.append(box,document.createTextNode(' '+n));extra.append(label)});const afr=document.createElement('div');afr.className='card';afr.innerHTML='<div>AFR calculado</div><div class="value"></div><small></small>';cards.append(afr);initialized=true}d.fields.forEach((f,i)=>{const c=cards.children[i];c.children[1].textContent=show(f);c.children[1].classList.toggle('bad',f.stale);c.children[3].textContent=f.age===null?'Sin medición':'Hace '+(f.age/1000).toFixed(1)+' s';extra.children[i].querySelector('input').disabled=f.support!==1});const a=cards.lastElementChild;a.children[1].textContent=d.fields[5].stale?'Antiguo':d.afr===null?'N/D':d.afr.toFixed(2);a.children[2].textContent='Lambda × '+d.reference.toFixed(2)+' (referencia de combustible)'}catch(e){document.querySelector('#status').textContent='Sin conexión Wi-Fi/datos';document.querySelectorAll('.value').forEach(x=>x.textContent='—')}finally{busy=false}}
document.querySelector('#config').onsubmit=async e=>{e.preventDefault();try{message(await post('/api/config',{name:document.querySelector('#name').value,mac:document.querySelector('#mac').value,pin:document.querySelector('#pin').value}));document.querySelector('#pin').value=''}catch(err){message(err.message)}};
fetch('/api/config').then(r=>r.json()).then(c=>{document.querySelector('#name').value=c.name;document.querySelector('#mac').value=c.mac}).catch(()=>message('No se pudo cargar la configuración.'));
poll();setInterval(poll,500);
</script></html>)GOLFHTML";
class GolfDashboardFirmware {
public:

enum FieldId { RPM, SPEED, COOLANT, OIL, MAF, LAMBDA, IAT, MAP, LOAD, THROTTLE, VOLTAGE, FIELD_COUNT };
enum class Support : uint8_t { Unknown, Yes, No };
enum class Link : uint8_t { Connecting, Initializing, Ready, Recovering };
enum class Reply { Complete, Timeout, Disconnected, Overflow };
struct AdapterSettings {
  char name[64] = "ELM 327";
  char pin[17] = "1234";
  char mac[18] = "";
};
struct Reading {
  float value = 0;
  uint32_t at = 0;
  uint32_t count = 0;
  uint32_t latencyMs = 0;
  bool valid = false;
  Support support = Support::Unknown;
};
struct Dashboard {
  Reading fields[FIELD_COUNT];
  uint8_t page = 0;
  uint8_t lambdaPid = 0; // Solo sensor 1: 0x24 (voltaje) o 0x34 (corriente).
  uint32_t extraMask = 0; // Elegidos desde el movil; cero conserva prioridad original.
  Link link = Link::Connecting;
  uint32_t revision = 0;
  float rpmHz = 0;
  float speedHz = 0;
  float mafHz = 0;
  float lambdaHz = 0;
};

// ESP32-WROOM-32 (ESP32 original; requiere Bluetooth clasico SPP).
static constexpr char ELM_NAME[] = "ELM 327";
// Si el nombre no conecta, escribir la MAC del adaptador y activar esta opcion.
static constexpr bool USE_ELM_MAC = false;
static constexpr uint8_t ELM_MAC[6] = {0, 0, 0, 0, 0, 0};
// Se utiliza solo si el adaptador solicita PIN. Probar "0000" si 1234 falla.
static constexpr char ELM_PIN[] = "1234";

static constexpr uint8_t OLED_ADDRESS = 0x3C;
static constexpr int OLED_SDA = 21;
static constexpr int OLED_SCL = 22;
static constexpr uint32_t OLED_I2C_HZ = 400000;
static constexpr uint32_t OLED_FRAME_MS = 50; // Hasta 20 refrescos/s; no inventa mediciones.

// ATST20 = 0x20 * 4 ms = 128 ms: espera ELM, NO pausa entre consultas.
// ATAT2 usa temporizacion adaptativa agresiva; ATAT1 es la alternativa estable.
// Si aparecen fallos intermitentes, usar ATAT1 y ATST32 (200 ms).
static constexpr char ELM_ADAPTIVE_COMMAND[] = "ATAT2";
static constexpr char ELM_TIMEOUT_COMMAND[] = "ATST20";
static constexpr uint32_t PID_RESPONSE_MS = 1300;
static constexpr uint32_t AUTO_PROTOCOL_MS = 20000;
static constexpr uint32_t COOLANT_INTERVAL_MS = 1500;
static constexpr uint32_t OIL_INTERVAL_MS = 4000;
static constexpr uint32_t FAST_STALE_MS = 1800;
static constexpr uint32_t COOLANT_STALE_MS = 10000;
static constexpr uint32_t OIL_STALE_MS = 15000;

// Pulsacion corta BOOT mientras el programa YA esta ejecutandose.
// No mantener BOOT al encender: ese boton tambien selecciona el modo de carga.
static constexpr int PAGE_BUTTON_PIN = 0;
static constexpr uint32_t BUTTON_DEBOUNCE_MS = 40;
// AFR mostrado = lambda medida * esta referencia configurable.
// 14,7 es una referencia de gasolina sin etanol; no identifica tu combustible.
static constexpr float STOICHIOMETRIC_AFR = 14.7f;
static_assert(STOICHIOMETRIC_AFR > 0, "La referencia estequiometrica debe ser positiva");
static constexpr char WIFI_AP_NAME[] = "GolfDashboard";
static constexpr char WIFI_AP_PASSWORD[] = "GolfOBD2026"; // Cambiar antes de compartir el codigo.
static constexpr uint32_t EXTRA_INTERVAL_MS = 1000;
static constexpr uint32_t EXTRA_STALE_MS = 30000;

struct Obd {
static int hex(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  c = static_cast<char>(toupper(static_cast<unsigned char>(c)));
  return c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
}

// Solo acepta lineas hexadecimales completas, sin cabeceras (ATH0).
// Ignora eco, SEARCHING y texto de estado; nunca extrae cifras de ese texto.
static bool payload(const char* response, uint8_t pid, uint8_t* out, size_t count) {
  const char* p = response;
  while (*p) {
    char compact[160];
    size_t n = 0;
    bool valid = true;
    while (*p && *p != '\r' && *p != '\n' && *p != '>') {
      const unsigned char c = static_cast<unsigned char>(*p++);
      if (isspace(c)) continue;
      if (hex(static_cast<char>(c)) < 0 || n == sizeof(compact)) valid = false;
      else compact[n++] = static_cast<char>(c);
    }
    if (*p) ++p;
    if (!valid || n < 4 + count * 2 || n % 2) continue;
    auto byteAt = [&](size_t i) -> uint8_t {
      return static_cast<uint8_t>((hex(compact[2*i]) << 4) | hex(compact[2*i+1]));
    };
    if (byteAt(0) != 0x41 || byteAt(1) != pid) continue;
    for (size_t i = 0; i < count; ++i) out[i] = byteAt(i + 2);
    return true;
  }
  return false;
}

static bool bitmap(const char* response, uint8_t base, uint32_t& bits) {
  uint8_t b[4];
  if (!payload(response, base, b, 4)) return false;
  bits = (uint32_t(b[0]) << 24) | (uint32_t(b[1]) << 16) | (uint32_t(b[2]) << 8) | b[3];
  return true;
}
static bool supported(uint32_t bits, uint8_t base, uint8_t pid) {
  return pid > base && pid <= base + 32 && (bits & (uint32_t(1) << (32 - (pid - base))));
}
static bool value(const char* response, uint8_t pid, float& result) {
  uint8_t b[2];
  if (pid == 0x0C) {
    if (!payload(response, pid, b, 2)) return false;
    result = ((uint16_t(b[0]) << 8) | b[1]) / 4.0f;
  } else if (pid == 0x10) {
    if (!payload(response, pid, b, 2)) return false;
    result = ((uint16_t(b[0]) << 8) | b[1]) / 100.0f;
  } else if (pid == 0x24 || pid == 0x34) {
    // Sensor O2 de banda ancha, no PID 44 (consigna). Requiere los 4 bytes,
    // aunque aqui solo se usa la relacion normalizada de los primeros dos.
    uint8_t wide[4];
    if (!payload(response, pid, wide, 4)) return false;
    result = ((uint16_t(wide[0]) << 8) | wide[1]) / 32768.0f;
    // Cero no representa una lambda fisica valida (p. ej. sensor no listo).
    if (result <= 0) return false;
  } else if (pid == 0x42) {
    if (!payload(response, pid, b, 2)) return false;
    result = ((uint16_t(b[0]) << 8) | b[1]) / 1000.0f;
  } else if (pid == 0x04 || pid == 0x11) {
    if (!payload(response, pid, b, 1)) return false;
    result = b[0] * 100.0f / 255.0f;
  } else if (pid == 0x0D || pid == 0x05 || pid == 0x5C || pid == 0x0F || pid == 0x0B) {
    if (!payload(response, pid, b, 1)) return false;
    result = (pid == 0x0D || pid == 0x0B) ? b[0] : int(b[0]) - 40;
    if (pid == 0x0B) result /= 100.0f; // bar absolutos, no sobrepresion.
  } else return false; // PID44 es consigna; no es lambda medida.
  return true;
}
};

// Elegir solo parametros visibles: la segunda pagina no resta consultas a la
// primera cuando esta oculta. La pantalla OLED no participa en este plan.
class PollPlanner {
  uint8_t page = 255;
  bool started = false;
  bool primary = true, allowSlow = false;
  uint32_t lastCoolant = uint32_t(0) - COOLANT_INTERVAL_MS;
  uint32_t lastOil = uint32_t(0) - OIL_INTERVAL_MS;
  uint32_t lastExtra = 0;
  unsigned slowCursor = 0;
public:
  FieldId next(const Dashboard& d, uint32_t now) {
    if (!started) {
      lastCoolant = now - COOLANT_INTERVAL_MS;
      lastOil = now - OIL_INTERVAL_MS;
      lastExtra = now - EXTRA_INTERVAL_MS;
      started = true;
    }
    if (page != d.page) {
      page = d.page; primary = true; allowSlow = false;
    }
    const FieldId first = page == 0 ? RPM : MAF;
    const FieldId second = page == 0 ? SPEED : LAMBDA;
    if (allowSlow) {
      for (unsigned n = 0; n < FIELD_COUNT; ++n) {
        FieldId id = static_cast<FieldId>((slowCursor+n) % FIELD_COUNT);
        if (id == first || id == second || d.fields[id].support != Support::Yes) continue;
        bool due = false;
        if (page == 0 && id == COOLANT && uint32_t(now-lastCoolant) >= COOLANT_INTERVAL_MS) {
          lastCoolant = now; due = true;
        } else if (page == 0 && id == OIL && uint32_t(now-lastOil) >= OIL_INTERVAL_MS) {
          lastOil = now; due = true;
        } else if ((d.extraMask & (uint32_t(1) << id)) && uint32_t(now-lastExtra) >= EXTRA_INTERVAL_MS) {
          lastExtra = now; due = true;
        }
        if (due) { slowCursor = id+1; allowSlow = false; return id; }
      }
    }
    FieldId result = primary ? first : second;
    primary = !primary;
    allowSlow = true;
    if (d.fields[result].support != Support::Yes) result = result == first ? second : first;
    return d.fields[result].support == Support::Yes ? result : FIELD_COUNT;
  }
};
BluetoothSerial elm;
Adafruit_SSD1306 oled{128, 64, &Wire, -1, OLED_I2C_HZ, OLED_I2C_HZ};
static constexpr uint8_t PIDS[] = {0x0C, 0x0D, 0x05, 0x5C, 0x10, 0x00, 0x0F, 0x0B, 0x04, 0x11, 0x42};
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

void obdTask() {
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
  if (xTaskCreatePinnedToCore(runObdTask, "OBD", 8192, this, 2, nullptr, 0) != pdPASS) {
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

static void runObdTask(void* context) {static_cast<GolfDashboardFirmware*>(context)->obdTask();}
};
GolfDashboardFirmware dashboard;
void setup() {dashboard.setup();}
void loop() {dashboard.loop();}
