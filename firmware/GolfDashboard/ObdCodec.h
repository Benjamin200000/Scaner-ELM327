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

inline bool bitmap(const char* response, uint8_t base, uint32_t& bits) {
  uint8_t b[4];
  if (!payload(response, base, b, 4)) return false;
  bits = (uint32_t(b[0]) << 24) | (uint32_t(b[1]) << 16) | (uint32_t(b[2]) << 8) | b[3];
  return true;
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
