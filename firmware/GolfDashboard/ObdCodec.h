#pragma once
#include <stdint.h>
#include <stddef.h>
#include <ctype.h>

namespace Obd {
inline int hex(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  c = static_cast<char>(toupper(static_cast<unsigned char>(c)));
  return c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
}

// Solo acepta lineas hexadecimales completas, sin cabeceras (ATH0).
// Ignora eco, SEARCHING y texto de estado; nunca extrae cifras de ese texto.
inline bool payload(const char* response, uint8_t pid, uint8_t* out, size_t count) {
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

// Mapa de PIDs disponibles. Si responden varias computadoras (motor, caja,
// hibrido...) se suman sus mapas: quedarse con la primera linea podia marcar
// como no disponibles datos del motor cuando la primera en responder era otra.
inline bool bitmap(const char* response, uint8_t base, uint32_t& bits) {
  bool any = false;
  uint32_t all = 0;
  const char* line = response;
  while (*line) {
    const char* end = line;
    while (*end && *end != '\r' && *end != '\n') ++end;
    char one[160];
    const size_t n = size_t(end - line) < sizeof(one) - 1 ? size_t(end - line) : sizeof(one) - 1;
    for (size_t i = 0; i < n; ++i) one[i] = line[i];
    one[n] = 0;
    uint8_t b[4];
    if (payload(one, base, b, 4)) {
      all |= (uint32_t(b[0]) << 24) | (uint32_t(b[1]) << 16) | (uint32_t(b[2]) << 8) | b[3];
      any = true;
    }
    line = *end ? end + 1 : end;
  }
  if (any) bits = all;
  return any;
}

// Protocolo informado por ATDPN ("A6" = automatico, ISO 15765 CAN 11 bit 500k).
// Devuelve 1..9 (A = J1939 se devuelve 10) o 0 si no se entiende.
inline uint8_t protocolNumber(const char* response) {
  const char* p = response;
  while (*p && (isspace(static_cast<unsigned char>(*p)) || *p == '>')) ++p;
  if (*p == 'A' || *p == 'a') {
    const int next = hex(p[1]);
    if (next >= 1 && next <= 10) ++p;  // "A6": automatico + protocolo 6
  }
  const int v = hex(*p);
  return v >= 1 && v <= 10 ? uint8_t(v) : 0;
}
inline bool isCan11(uint8_t protocol) { return protocol == 6 || protocol == 8; }
inline bool isCan29(uint8_t protocol) { return protocol == 7 || protocol == 9; }

// Tipo de combustible (PID 51, SAE J1979) y su relacion aire/combustible
// estequiometrica de referencia. 0 = desconocido o mezcla: usar la configurada.
inline float stoichForFuel(uint8_t fuel) {
  switch (fuel) {
    case 1: return 14.7f;  // gasolina
    case 2: return 6.4f;   // metanol
    case 3: return 9.0f;   // etanol
    case 4: return 14.5f;  // diesel
    case 5: return 15.5f;  // GLP
    case 6: return 17.2f;  // GNC
    case 7: return 15.6f;  // propano
    default: return 0.0f;
  }
}
inline const char* fuelName(uint8_t fuel) {
  switch (fuel) {
    case 1: return "gasolina"; case 2: return "metanol"; case 3: return "etanol";
    case 4: return "diesel"; case 5: return "GLP"; case 6: return "GNC";
    case 7: return "propano"; case 8: return "electrico";
    default: return "";
  }
}
inline bool supported(uint32_t bits, uint8_t base, uint8_t pid) {
  return pid > base && pid <= base + 32 && (bits & (uint32_t(1) << (32 - (pid - base))));
}
inline bool value(const char* response, uint8_t pid, float& result) {
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
}
