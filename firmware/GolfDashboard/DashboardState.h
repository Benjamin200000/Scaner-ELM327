#pragma once
#include <stdint.h>

enum FieldId { RPM, SPEED, COOLANT, OIL, MAF, LAMBDA, IAT, MAP, LOAD, THROTTLE, VOLTAGE, FIELD_COUNT };
enum class Support : uint8_t { Unknown, Yes, No };
enum class Link : uint8_t { Connecting, Initializing, Ready, Recovering };
enum class Reply { Complete, Timeout, Disconnected, Overflow };
struct AdapterSettings {
  char name[64] = "OBDII";
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
  uint8_t fuelType = 0;  // PID 51 informado por la ECU; 0 = desconocido.
  uint32_t extraMask = 0; // Elegidos desde el movil; cero conserva prioridad original.
  Link link = Link::Connecting;
  uint32_t revision = 0;
  float rpmHz = 0;
  float speedHz = 0;
  float mafHz = 0;
  float lambdaHz = 0;
};
