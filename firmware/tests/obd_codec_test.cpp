#include <cassert>
#include <cmath>
#include <iostream>
#include "../GolfDashboard/ObdCodec.h"
#include "../GolfDashboard/PollPlanner.h"

int main() {
  float v = 0;
  assert(Obd::value("SEARCHING...\r41 0C 1A F8\r>", 0x0C, v) && v == 1726);
  assert(Obd::value("010D\r410D44\r>", 0x0D, v) && v == 68);
  assert(Obd::value("410584\r", 0x05, v) && v == 92);
  assert(Obd::value("415C8C\r", 0x5C, v) && v == 100);
  assert(Obd::value("410500\r", 0x05, v) && v == -40);
  assert(!Obd::value("NO DATA\r>", 0x5C, v));
  assert(!Obd::value("CAN ERROR\r>", 0x0C, v));
  assert(!Obd::value("BUS INIT: ERROR\r>", 0x0C, v));
  assert(!Obd::value("410C1A\r", 0x0C, v));
  assert(!Obd::value("410C1AF8garbage\r", 0x0C, v));
  assert(!Obd::value("410D44\r", 0x0C, v));
  assert(Obd::value("410C1AF8\r410C0000\r", 0x0C, v) && v == 1726);
  uint32_t bits = 0;
  assert(Obd::bitmap("410008180001\r", 0x00, bits));
  assert(Obd::supported(bits, 0x00, 0x05));
  assert(Obd::supported(bits, 0x00, 0x0C));
  assert(Obd::supported(bits, 0x00, 0x0D));
  assert(Obd::supported(bits, 0x00, 0x20));
  assert(!Obd::supported(bits, 0x00, 0x00));
  assert(!Obd::supported(bits, 0x00, 0x21));
  assert(Obd::bitmap("414000000010\r", 0x40, bits));
  assert(Obd::supported(bits, 0x40, 0x5C));
  assert(!Obd::supported(bits, 0x40, 0x5B));
  assert(!Obd::bitmap("41200000\r", 0x20, bits));
  assert(Obd::value("41103E80\r", 0x10, v) && v == 160.0f);
  assert(Obd::value("41100000\r", 0x10, v) && v == 0.0f);
  assert(Obd::value("4124800003E8\r", 0x24, v) && v == 1.0f);
  assert(Obd::value("4124600003E8\r", 0x24, v) && v == 0.75f);
  assert(Obd::value("4134A0008000\r", 0x34, v) && v == 1.25f);
  assert(!Obd::value("41248000\r", 0x24, v));
  assert(!Obd::value("412400000000\r", 0x24, v));
  assert(!Obd::value("41448000\r", 0x44, v));
  assert(!Obd::value("41148080\r", 0x14, v));
  assert(Obd::value("410F50\r", 0x0F, v) && v == 40);
  assert(Obd::value("410B64\r", 0x0B, v) && v == 1.0f);
  assert(Obd::value("4104FF\r", 0x04, v) && v == 100.0f);
  assert(Obd::value("411100\r", 0x11, v) && v == 0.0f);
  assert(Obd::value("414236B0\r", 0x42, v) && v == 14.0f);
  assert(Obd::bitmap("412010001000\r", 0x20, bits));
  assert(Obd::supported(bits, 0x20, 0x24));
  assert(Obd::supported(bits, 0x20, 0x34));

  Dashboard d;
  for (auto& r : d.fields) r.support = Support::Yes;
  PollPlanner planner;
  assert(planner.next(d, 0) == RPM);
  assert(planner.next(d, 1) == COOLANT);
  assert(planner.next(d, 2) == SPEED);
  assert(planner.next(d, 3) == OIL);
  assert(planner.next(d, 4) == RPM);
  assert(planner.next(d, 5) == SPEED);
  d.page = 1;
  for (unsigned i = 0; i < 40; ++i)
    assert(planner.next(d, 10000+i) == (i % 2 ? LAMBDA : MAF));
  d.fields[LAMBDA].support = Support::No;
  for (unsigned i = 0; i < 10; ++i) assert(planner.next(d, 11000+i) == MAF);
  d.fields[MAF].support = Support::No;
  assert(planner.next(d, 12000) == FIELD_COUNT);
  d.page = 0;
  assert(planner.next(d, 13000) == RPM);
  assert(planner.next(d, 13001) == COOLANT);
  // La cadencia sigue funcionando al desbordar millis().
  PollPlanner wrap;
  assert(wrap.next(d, UINT32_MAX-1) == RPM);
  assert(wrap.next(d, UINT32_MAX) == COOLANT);
  assert(wrap.next(d, 0) == SPEED);
  assert(wrap.next(d, 1) == OIL);
  assert(wrap.next(d, 2) == RPM);
  d.fields[COOLANT].support=d.fields[OIL].support=Support::No;
  d.extraMask=uint32_t(1)<<IAT;
  PollPlanner extras;
  assert(extras.next(d,0)==RPM);
  assert(extras.next(d,1)==IAT);
  assert(extras.next(d,2)==SPEED);
  assert(extras.next(d,3)==RPM);
  assert(extras.next(d,1001)==IAT);
  assert(extras.next(d,1002)==SPEED);
  d.extraMask=0;
  for (unsigned i=0;i<10;++i) {
    FieldId id=extras.next(d,2000+i);
    assert(id==RPM || id==SPEED);
  }
  std::cout << "Pruebas correctas: OBD, mezcla, extras, prioridad y plan por pagina.\n";
}
