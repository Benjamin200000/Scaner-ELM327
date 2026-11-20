#pragma once
#include "DashboardState.h"
#include "Config.h"

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
