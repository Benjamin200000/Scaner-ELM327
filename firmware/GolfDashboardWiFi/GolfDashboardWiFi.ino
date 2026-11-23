// GOLF DASHBOARD Wi-Fi v3 - archivo unico para copiar en Arduino IDE.
// ESP32-WROOM-32, core Espressif 3.3.4, particion Huge APP.
#include <Arduino.h>
#include <BluetoothSerial.h>
#include <BLEDevice.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ESPmDNS.h>
#include <esp_gap_bt_api.h>
#include <Preferences.h>
#include <atomic>
#include <string>
#if !defined(CONFIG_BT_SPP_ENABLED)
#error "Usar ESP32 Dev Module (WROOM-32), no S3/C3"
#endif
// --- panel web: generado por tools/generar-panel.py desde web/panel.html; no editar a mano ---
static const uint8_t WEB_UI_GZ[] PROGMEM = {
  0x1f,0x8b,0x08,0x00,0x00,0x00,0x00,0x00,0x02,0xff,0xb5,0x59,0xdb,0x6e,0xdb,0x46,0x1a,0xbe,0xf7,0x53,
  0x4c,0x15,0x74,0x29,0x22,0x12,0x2d,0xd9,0x71,0x92,0x92,0x92,0x03,0xc7,0x71,0x9a,0x02,0x8e,0x63,0xc4,
  0x69,0x77,0x81,0x20,0x17,0x23,0x72,0x24,0x4d,0x4d,0x71,0xd8,0xe1,0xd0,0x87,0xa8,0x02,0xfa,0x10,0x0b,
  0xec,0x75,0x6e,0x16,0xe8,0x45,0x81,0x05,0xf6,0x62,0x81,0xdd,0xbb,0xfa,0x7e,0x1f,0xa2,0x4f,0xb2,0xdf,
  0x3f,0x3c,0x88,0x92,0xad,0x24,0x2d,0xb0,0x40,0x23,0x93,0x73,0xf8,0xe7,0x3f,0x7e,0xff,0x37,0xec,0xe0,
  0x8b,0x48,0x85,0xe6,0x3a,0x15,0x6c,0x6a,0x66,0xf1,0xfe,0xd6,0x80,0xfe,0xb0,0x98,0x27,0x93,0x61,0x4b,
  0x64,0xad,0xfd,0xc1,0x4c,0x18,0xce,0xc2,0x29,0xd7,0x99,0x30,0xc3,0x56,0x6e,0xc6,0xdd,0xc7,0xd5,0x68,
  0xc2,0x67,0x62,0xd8,0xba,0x90,0xe2,0x32,0x55,0xda,0xb4,0x58,0xa8,0x12,0x23,0x12,0xac,0xba,0x94,0x91,
  0x99,0x0e,0x23,0x71,0x21,0x43,0xd1,0xb5,0x2f,0x1d,0x99,0x48,0x23,0x79,0xdc,0xcd,0x42,0x1e,0x8b,0x61,
  0xbf,0x85,0x93,0x8c,0x34,0xb1,0xd8,0xff,0x5a,0xc5,0x63,0xf6,0x8c,0x67,0xd3,0x91,0xe2,0x3a,0x1a,0x6c,
  0x17,0xa3,0x83,0xcc,0x5c,0xe3,0xcf,0x96,0xaf,0x95,0x32,0xf3,0x50,0xc5,0x4a,0x63,0xeb,0x54,0xcc,0x84,
  0x1f,0x71,0x7d,0xbe,0x18,0xa9,0xe8,0x7a,0x3e,0xc6,0x79,0x7e,0xff,0x61,0x7a,0xc5,0xb2,0xeb,0xcc,0x88,
  0x59,0x37,0x97,0xc1,0x88,0x87,0xe7,0x13,0xad,0xf2,0x24,0xf2,0xef,0xf5,0x7b,0xfd,0xbd,0x7e,0x14,0xd8,
  0xdd,0xfe,0x3d,0x21,0xc6,0xbb,0xe3,0x51,0x30,0xe3,0x57,0x85,0x4a,0xfe,0xa3,0x87,0xbd,0xf4,0x0a,0xef,
  0x7a,0x22,0x13,0x9f,0xe7,0x46,0x05,0x29,0x8f,0x22,0x99,0x4c,0xac,0xcc,0xc5,0xb4,0x6f,0x0f,0xe8,0x66,
  0xf2,0xbd,0xf0,0x77,0x1e,0x60,0x64,0x94,0x1b,0xa3,0x12,0x98,0x92,0xe6,0xa6,0x38,0x5c,0x26,0x53,0xa1,
  0xa5,0x09,0x46,0x4a,0x47,0x42,0x77,0x35,0x8f,0x64,0x9e,0xf9,0x8f,0x21,0xb6,0x16,0x45,0x67,0x14,0xd3,
  0x7e,0x9f,0x34,0x55,0xb1,0x8c,0xd8,0xbd,0xbd,0xde,0xc3,0xde,0xa3,0xc7,0xa5,0xc4,0x79,0x53,0xe9,0x9d,
  0xdd,0x07,0xe1,0xe3,0x7e,0xa9,0xf4,0xe5,0x54,0x1a,0x11,0x84,0xb9,0xce,0xf0,0x92,0x2a,0x09,0xff,0xea,
  0x45,0x71,0xfe,0x8a,0xa1,0x5f,0xed,0xec,0xee,0xf6,0x56,0xf6,0x2c,0xcd,0xfc,0x6a,0xef,0xcb,0x85,0x37,
  0xd1,0x32,0x9a,0x47,0x32,0x4b,0x63,0x7e,0xed,0xd3,0x4b,0x40,0x3f,0x5d,0x38,0x0d,0x23,0x46,0x74,0xb1,
  0x35,0x9f,0x25,0x99,0xaf,0x45,0x2a,0xb8,0x69,0xef,0x74,0x66,0x32,0x81,0x88,0x76,0xaf,0xd3,0x1f,0x6b,
  0xd7,0x0d,0x26,0x3c,0xb5,0xa6,0x2c,0xbc,0x10,0x51,0xea,0x64,0x22,0x34,0x72,0x4d,0xf1,0x3e,0xdf,0x79,
  0xb0,0xbb,0xb3,0xe6,0x8a,0xfe,0x4e,0xd3,0x17,0x0f,0x96,0xfe,0x26,0x61,0xac,0xb7,0xf0,0x2e,0x78,0x9c,
  0x8b,0x86,0xa3,0x77,0x69,0x83,0x7d,0xbd,0x14,0x72,0x32,0x35,0xfe,0x48,0xc5,0x51,0xa0,0x2e,0x84,0x1e,
  0xc7,0xea,0xb2,0x7b,0xa9,0xa1,0x08,0x4f,0xae,0x2f,0xe1,0x77,0xb1,0xf0,0x72,0x64,0x55,0xc7,0xe3,0x13,
  0xd1,0xc9,0x66,0x3c,0x8e,0xe7,0x65,0xa8,0x47,0x7b,0xe1,0x6e,0xb4,0x17,0x2c,0xa5,0xf6,0x77,0x49,0xf5,
  0x11,0x8f,0xaa,0x15,0xe3,0x71,0x18,0x3e,0xde,0x5d,0x78,0x5a,0x5d,0xd6,0x6e,0x19,0xc7,0xe2,0xca,0x1a,
  0x4a,0xf1,0xa3,0x97,0xe2,0x34,0xfa,0x59,0xc4,0x7c,0x24,0xe2,0x7a,0xe5,0x28,0x56,0xe1,0xf9,0x9a,0x25,
  0x36,0x2a,0x6f,0xa9,0x92,0x86,0xc8,0xd3,0xf0,0x7c,0xa4,0xae,0xde,0xcd,0x8b,0x08,0xec,0x50,0x0e,0x4c,
  0x0b,0x73,0xec,0x33,0xac,0x31,0x12,0x85,0xd0,0xe5,0xb1,0x9c,0x24,0xfe,0x4c,0x46,0x51,0x2c,0x16,0xf7,
  0x66,0xd9,0x64,0x6e,0xa3,0xd7,0xcd,0x52,0x1e,0x0a,0x3f,0xd5,0xc2,0xaa,0xb0,0xe0,0x95,0xda,0xfc,0x71,
  0xd4,0x1b,0x8f,0x17,0x5b,0x83,0xed,0xa2,0x3e,0x06,0xd3,0xfe,0xad,0x02,0xc2,0xd0,0x20,0x65,0x32,0x1a,
  0xb6,0x32,0xc3,0x4d,0x8e,0x1a,0x3e,0x54,0x09,0xe2,0xc5,0x93,0x48,0x31,0x1e,0xb3,0xa3,0xb3,0xd3,0xdd,
  0x1d,0xcf,0xf3,0x06,0xdb,0x29,0x8a,0x30,0x65,0x61,0xcc,0xb3,0x6c,0xd8,0x82,0x27,0x50,0xd7,0x45,0x42,
  0x32,0x95,0x84,0xb1,0x0c,0xcf,0x21,0x42,0x98,0x53,0xb8,0xb7,0xdd,0x73,0x5b,0xfb,0xaf,0x8e,0x8f,0x9e,
  0xf9,0x6c,0xa6,0x8c,0xd2,0x83,0xed,0x62,0xe1,0xe6,0x0d,0xfd,0xe5,0x06,0xf1,0x1e,0x47,0x2c,0x77,0xd8,
  0x63,0x23,0x79,0x51,0x1d,0x4c,0x89,0xd8,0xb2,0xfa,0x52,0x6a,0x11,0xe4,0x6c,0x63,0x16,0x08,0x50,0xe4,
  0x18,0x8e,0x20,0x03,0xb2,0x3c,0x36,0x3c,0x63,0xc8,0xaa,0x10,0x83,0xc0,0x90,0x0c,0x12,0x61,0xe8,0xfe,
  0x4b,0xae,0x43,0x4e,0x65,0xa5,0x18,0xfe,0xfb,0x21,0x17,0x0c,0xc6,0x8a,0x4c,0x62,0xb5,0xc7,0x0e,0x79,
  0xc4,0x59,0xc4,0x8d,0x62,0xe2,0xca,0x68,0xe0,0x98,0x9a,0xa5,0x5c,0x1b,0xc1,0x44,0xcc,0x8c,0x44,0xf2,
  0x2b,0x16,0xe1,0xf1,0xe8,0xf8,0x65,0xc0,0x12,0x78,0x27,0x9f,0x01,0xbf,0x20,0x2d,0x67,0x17,0x02,0x31,
  0x96,0x11,0x8f,0x3c,0x76,0xac,0x32,0x2b,0x03,0xbf,0x02,0xc8,0xc8,0xd2,0x9b,0x0f,0x88,0x3b,0x67,0x64,
  0x1e,0xe3,0x50,0xf2,0x82,0x93,0xb0,0x44,0x24,0x2c,0xd5,0x52,0x69,0xbb,0x8b,0xcc,0xb4,0x56,0x92,0x61,
  0xf6,0xf0,0xa5,0x65,0xeb,0x3e,0xe3,0x69,0x1a,0x5f,0x1f,0xd9,0x35,0x6d,0xb8,0xed,0x20,0xc5,0x30,0xd7,
  0x2c,0x13,0xb1,0x08,0x43,0x79,0xf3,0xcf,0x64,0xb3,0xbb,0xc3,0x58,0x70,0xbd,0xdc,0x7a,0x6a,0xcf,0x7f,
  0x8f,0xcd,0x54,0xd5,0x49,0x28,0x9b,0x7e,0xaf,0x1c,0xba,0xd5,0x74,0xed,0x41,0xc4,0x53,0xc3,0x23,0xa5,
  0xd9,0x53,0x14,0xa2,0x01,0xda,0x4e,0x0b,0xc7,0xae,0xe6,0x85,0xcd,0xff,0xfd,0x81,0x4d,0x72,0x66,0x93,
  0xbc,0x45,0x15,0xae,0x5a,0x65,0x13,0x18,0x01,0xfe,0x6d,0x29,0x0f,0x5b,0x7d,0x34,0x02,0x2a,0x00,0x11,
  0xed,0x2f,0x65,0xb2,0xe3,0x23,0xd6,0x1e,0xe7,0x89,0x0d,0x1e,0x35,0x0a,0x26,0x4f,0xa7,0x48,0x4b,0x77,
  0xb0,0x5d,0x8a,0xfe,0x1d,0x27,0xf4,0x5a,0x4d,0xc9,0x61,0x7c,0xf3,0x21,0x93,0xa1,0x62,0x6d,0x9b,0x04,
  0x07,0x49,0xa4,0x95,0x8c,0x96,0x82,0x29,0x10,0x45,0x3d,0x8c,0x09,0xa8,0x5a,0xc5,0xc8,0x58,0xe9,0x59,
  0x91,0x74,0x2a,0x19,0xcb,0x49,0x6d,0xe2,0x89,0x9a,0x8d,0xb4,0x60,0xa5,0x1e,0xb4,0x80,0x8e,0x6f,0x31,
  0x80,0x61,0x2c,0x92,0x09,0xda,0x5a,0xeb,0xe1,0x6e,0x8b,0x69,0xf1,0x43,0x2e,0x35,0x4c,0x5c,0xd3,0xff,
  0xe5,0xc1,0x21,0x53,0x69,0x91,0xa2,0x4d,0x21,0x33,0x1e,0xb6,0x18,0xb0,0x23,0x14,0x53,0xe0,0x99,0xd0,
  0xc3,0xd6,0xc1,0x81,0xff,0xf4,0xa9,0x7f,0x78,0xe8,0x3f,0x7b,0xe6,0x1f,0x1d,0xf9,0xcf,0x9f,0xaf,0x9c,
  0xd1,0x7f,0xd4,0x5a,0x17,0x7d,0xfa,0xcd,0x49,0x53,0x62,0x2a,0x93,0x56,0xe9,0xa7,0x14,0x81,0xba,0x04,
  0xec,0xae,0x4a,0x78,0xb8,0x76,0xe0,0x77,0x3c,0xbc,0xf9,0x45,0xf9,0xe4,0xfc,0x4c,0xe8,0x0b,0xe4,0x08,
  0x32,0x1f,0xe9,0x9b,0xf3,0xb8,0x71,0x56,0x99,0x2d,0x5f,0xe7,0xa8,0x45,0xde,0xa8,0xf3,0x6d,0x72,0xd8,
  0x9d,0x51,0xaa,0xd0,0xae,0xa8,0x61,0x8a,0x01,0xc2,0x73,0x90,0xf2,0x49,0x71,0xc2,0x9f,0x65,0xf7,0xb9,
  0x24,0xdc,0x09,0x0b,0x14,0xd2,0xec,0x9a,0xe5,0x19,0xa5,0xb7,0x2d,0x59,0x94,0x13,0x47,0xc9,0xc5,0x78,
  0x68,0xa3,0x34,0x39,0xbb,0x50,0x31,0xe0,0x91,0x71,0x26,0x00,0x5f,0x55,0xad,0x01,0x45,0x38,0x71,0x0b,
  0x4c,0x3c,0x7d,0xf5,0xea,0x0d,0xdb,0x65,0x99,0xbb,0xa6,0x72,0xa9,0x4d,0xf1,0xd2,0x6a,0x54,0x88,0x4a,
  0xe8,0xdc,0xa3,0x78,0x46,0x05,0x72,0x58,0x29,0xc1,0x6d,0xd5,0xef,0xee,0x3c,0x5a,0x9a,0x98,0xee,0x7f,
  0x8b,0xdc,0xa4,0x08,0x5e,0xdc,0x7c,0x40,0x97,0x2e,0xab,0x7a,0x59,0xd4,0x50,0x99,0x72,0x03,0x46,0x25,
  0x36,0x4b,0x3c,0x76,0x14,0x33,0x0a,0xcb,0xc4,0x7a,0x0b,0xf0,0x0a,0x0c,0xc9,0x04,0x9b,0xe5,0xd0,0x5d,
  0x73,0x8f,0x91,0xbc,0xd1,0xcd,0xbf,0x33,0xa0,0x12,0xa4,0x2d,0x53,0x36,0xc5,0xbb,0x60,0xc6,0xba,0x18,
  0x49,0xad,0x25,0x27,0x6c,0x09,0x45,0x62,0xff,0x42,0xc4,0x04,0x89,0xaa,0xb2,0x02,0x44,0x1a,0x75,0x5b,
  0xa4,0x31,0xda,0x04,0x12,0x50,0x81,0x46,0xd5,0x08,0x6f,0x17,0xda,0x16,0xb8,0xff,0x5a,0x44,0x00,0x42,
  0x34,0x17,0x96,0x49,0x54,0x19,0x31,0x86,0x44,0x18,0x0f,0x76,0x9d,0x36,0x74,0x63,0x00,0xab,0x11,0xb9,
  0x61,0x84,0x30,0x80,0xfa,0x00,0x2b,0x0f,0x9e,0xbf,0x86,0xcf,0x19,0x76,0x86,0x79,0x4c,0xc6,0x50,0x95,
  0xe6,0xb0,0x40,0x8b,0x31,0x9a,0x2d,0x81,0x09,0x2b,0x8a,0x25,0xd7,0x7c,0x14,0x8b,0x80,0x9d,0x6c,0x3f,
  0xb3,0x16,0xa3,0x87,0xc9,0x31,0x20,0x8b,0x85,0x42,0x2b,0x8f,0x9d,0x28,0x8a,0x96,0x4c,0x73,0x80,0xb4,
  0x05,0x5a,0x11,0xdf,0xfc,0x8c,0x5e,0xac,0xca,0x2c,0x88,0xf2,0x50,0x6a,0xd8,0x56,0xe8,0x0b,0x34,0x0a,
  0xb5,0x4c,0xcd,0xfe,0x56,0x2c,0x90,0x52,0xea,0x5c,0x24,0x43,0xc7,0x09,0x28,0x4b,0x0d,0xb3,0x1d,0x61,
  0x08,0x86,0x6a,0x81,0xd9,0x83,0x1f,0xf5,0xf5,0x19,0xc1,0x22,0x7a,0x50,0xdb,0xb9,0x67,0xa7,0x1d,0xb7,
  0x63,0xf1,0x75,0xf3,0xb2,0x02,0x7e,0x1d,0x37,0xa0,0x13,0x46,0x79,0x76,0x3d,0x1c,0xf3,0x38,0x13,0x15,
  0x27,0x05,0x41,0x88,0xca,0x11,0x2d,0x8c,0xbe,0x3e,0x30,0xc3,0x5e,0xb0,0x55,0x28,0x40,0xc5,0x9f,0x0d,
  0xdf,0x3a,0xaf,0x4f,0x5f,0x3a,0x1d,0xe7,0xbb,0xaa,0x29,0xe0,0xf9,0xb5,0x18,0x6b,0x39,0x11,0x9a,0xf2,
  0x12,0xaf,0x07,0xa1,0x90,0xf6,0xe1,0xe5,0xc1,0x73,0xfc,0x1e,0xf3,0xd9,0x08,0x21,0x9f,0x89,0x88,0xf2,
  0xe8,0xac,0x8f,0xa1,0x37,0x68,0x37,0x58,0x6e,0xe0,0x3d,0xb4,0xb1,0x99,0xcc,0x08,0xd9,0x31,0x7e,0xaa,
  0x85,0x7d,0x5c,0x0e,0x56,0x51,0xe1,0x98,0x3d,0x04,0xc9,0xe0,0x75,0x50,0x68,0xe4,0x54,0x01,0xed,0x8a,
  0x65,0x21,0x6c,0xd4,0x04,0xde,0x56,0x7c,0x52,0x6c,0x3e,0x3a,0xfc,0xd6,0x79,0x57,0xe9,0x4f,0x04,0x89,
  0xf4,0xd7,0xe9,0x0c,0x6b,0xce,0x67,0xdb,0x53,0xfc,0xf9,0xf5,0x1f,0x87,0xf5,0xef,0x64,0x3b,0xc3,0xef,
  0x7f,0xff,0x53,0x0f,0x94,0x59,0x81,0xa7,0x2f,0xcb,0x7f,0xdf,0x91,0x38,0xc2,0x6e,0xca,0x42,0x98,0x94,
  0x65,0xd4,0xe0,0x8d,0x3b,0xdf,0xe8,0x70,0x64,0xa8,0xe3,0x7a,0x06,0x7e,0x3f,0x2c,0xaf,0x04,0x66,0xb1,
  0xc5,0xb3,0xeb,0x24,0x64,0xb5,0x9c,0x89,0x30,0x6f,0x28,0xd8,0x6d,0x77,0x2e,0xc7,0xed,0x2f,0x6c,0xe0,
  0xdd,0x79,0xa1,0xb5,0x1e,0xf2,0x4b,0x2e,0x0d,0x1b,0x0b,0x13,0x4e,0xdb,0xce,0x36,0x4f,0xe5,0xb6,0x5d,
  0xe0,0x74,0xe6,0x21,0x07,0xe0,0xf8,0x4e,0xa2,0xba,0x19,0x0e,0x83,0xc7,0x29,0xfd,0x78,0xec,0x1f,0x80,
  0x78,0x9a,0x33,0xfb,0xec,0x19,0x39,0x13,0x2a,0x37,0xed,0x07,0xbd,0x5e,0xcf,0x5d,0xb8,0x01,0x1d,0xa0,
  0x3d,0x75,0xee,0x9a,0x29,0xda,0x19,0x3b,0xd2,0x9a,0xd4,0x3c,0x43,0x7d,0x64,0x85,0xef,0x03,0x24,0x79,
  0x68,0x3d,0xbd,0xec,0xef,0xc8,0x97,0x22,0x1b,0x0b,0x5d,0xb4,0xb5,0xa7,0xed,0x2e,0x90,0x23,0xb9,0x4e,
  0x8a,0x4c,0xbd,0x65,0x55,0xaa,0x32,0xd3,0xce,0x75,0xdc,0x01,0x61,0xe0,0x77,0x9b,0x43,0xb3,0x73,0xdc,
  0x9f,0xa6,0x2a,0xf2,0x9d,0xd3,0x57,0x67,0x6f,0x9c,0xce,0x54,0x70,0x40,0x74,0xe6,0xcf,0x9d,0xd2,0x5f,
  0xdd,0x37,0x00,0x33,0xc7,0x77,0x88,0x19,0xa0,0xb0,0x48,0xf4,0x36,0xe8,0xe8,0xe5,0x65,0x97,0x60,0xb8,
  0x0b,0x11,0xa8,0x47,0x15,0x09,0x4a,0xc4,0xbf,0x74,0x89,0x01,0x76,0xad,0x33,0x1d,0xbf,0x38,0x69,0xe9,
  0xdc,0x45,0x87,0xae,0x4a,0x7e,0x22,0x2e,0xd9,0xb7,0xaf,0x8f,0xcf,0xc0,0x16,0xc2,0xe9,0x29,0x70,0x76,
  0x96,0xb5,0xad,0x8a,0x1f,0x73,0xdf,0x5e,0xe9,0xbe,0xc2,0x0a,0xb3,0xe6,0x88,0xbb,0xbd,0x6a,0xdc,0xa0,
  0x72,0xd0,0x2d,0xe7,0x54,0xdc,0x30,0x75,0xe7,0x28,0xb3,0x79,0x21,0xce,0x7a,0xac,0x08,0x31,0x7a,0x06,
  0xe2,0x39,0xa7,0x3f,0x7e,0x8a,0x73,0xab,0x54,0x73,0x4e,0x9b,0x8c,0x2b,0x44,0x69,0x49,0x94,0x82,0xe7,
  0xb8,0x0b,0xb8,0x06,0x1e,0x15,0xee,0xbc,0x5a,0x2a,0xbc,0xf2,0xc9,0x5d,0xdc,0x3a,0x7e,0x85,0x66,0xcd,
  0x09,0x0b,0x66,0x3c,0x3b,0x47,0xad,0xdf,0x9d,0xc7,0x07,0x71,0x5c,0x63,0x07,0xb3,0x0d,0xcf,0x2f,0x79,
  0x0d,0x72,0x1b,0x61,0x38,0x42,0x22,0xb6,0xaf,0x86,0xfb,0x24,0xe4,0xc7,0x61,0x7f,0x30,0x38,0xc9,0x67,
  0x23,0xa1,0xdb,0x57,0xc5,0x9d,0x06,0x97,0xa6,0x3b,0x8d,0x2c,0xc1,0x08,0x29,0x80,0x7d,0x4d,0x23,0xcf,
  0x6a,0xba,0x07,0x4d,0x29,0xea,0x7f,0xc0,0xc4,0x15,0x3a,0x38,0xff,0x5c,0xbb,0x56,0xed,0xb9,0xf2,0x4a,
  0x33,0x0b,0x4c,0x74,0x83,0xc2,0x84,0x15,0xef,0x2d,0x96,0x78,0x90,0x4d,0xd5,0x65,0x7b,0x6c,0x8b,0x78,
  0xec,0x65,0x79,0x4a,0x9f,0x02,0x86,0xc3,0x61,0xcf,0x2d,0xd3,0xc0,0x41,0x97,0x70,0x02,0x3b,0x5b,0xd0,
  0xb7,0xe1,0x30,0xc9,0xe3,0xb8,0x9e,0xfe,0xed,0xa7,0xbf,0x96,0xd3,0x68,0x66,0xb1,0xa8,0xc7,0x0f,0x12,
  0x83,0x4e,0xa3,0x9c,0x2a,0x9d,0x4a,0xef,0x96,0x52,0x80,0x2e,0xea,0xb9,0xbc,0x12,0x11,0x06,0x22,0x39,
  0x01,0xc8,0xb9,0x77,0xd4,0x22,0x2c,0xb5,0x8a,0x11,0xe6,0xff,0xf8,0xe3,0x33,0x50,0x62,0x2f,0x81,0xb6,
  0xee,0xa0,0xc4,0xf9,0xf2,0xb0,0xc0,0xf6,0x04,0xa3,0x73,0x61,0x43,0xb6,0x19,0x83,0x62,0x79,0x21,0x7e,
  0x27,0x04,0xed,0x7e,0x12,0x82,0x00,0xff,0x69,0x6e,0xc9,0x8e,0xbd,0x8a,0xd0,0xed,0xcc,0xa9,0x6a,0x2e,
  0xaa,0x6b,0xee,0xfb,0x4c,0xa1,0x9a,0x83,0x8d,0x90,0x6b,0xb9,0xed,0x1a,0xe8,0x46,0x9e,0x1d,0x7d,0xe2,
  0xd4,0x24,0x1f,0x0d,0xf9,0x29,0x98,0x38,0x81,0x47,0x62,0xa8,0x73,0x64,0xd4,0xb3,0x43,0xf0,0x2b,0xe7,
  0x7e,0xb9,0xda,0x47,0xf3,0xdd,0x78,0x4a,0xc1,0x37,0x6e,0x1d,0x33,0xa2,0x88,0xdb,0x6c,0x79,0xe2,0x2c,
  0x59,0x0e,0x27,0x0e,0x08,0x1e,0xd1,0x9e,0xa9,0x82,0x4d,0x14,0xd4,0xc1,0xa6,0xb8,0x0b,0xee,0x44,0x7d,
  0x7f,0x74,0xf3,0xcb,0x92,0x4f,0x11,0xf7,0x31,0x79,0xc9,0xcb,0x3a,0x05,0xab,0xba,0xf9,0x00,0xbe,0x08,
  0x2a,0x91,0xe1,0xa1,0x75,0x9b,0xbd,0xb5,0x3c,0xc7,0x8f,0x28,0x73,0x8c,0xb8,0xef,0xb0,0x5f,0xff,0x55,
  0x40,0x84,0x73,0xbf,0x1d,0x79,0x04,0x23,0xf7,0xfb,0xee,0x7d,0x67,0x7b,0x87,0x26,0xd0,0xc1,0xad,0x91,
  0xe8,0x84,0x2f,0xde,0xd7,0xd9,0x43,0xf3,0xec,0xc5,0x7b,0x5a,0x50,0xdf,0xf8,0xec,0xb2,0x2c,0x15,0x22,
  0xba,0xbd,0xd0,0x4a,0xb6,0xc7,0xc1,0x62,0xa7,0x71,0xb1,0xae,0xcd,0x76,0x9e,0x38,0x1e,0x3b,0x93,0x44,
  0x8c,0xe0,0xe6,0x5c,0x24,0x96,0x6d,0xc5,0xb5,0x55,0xa2,0x32,0x9b,0x8f,0xf8,0xf7,0x8a,0xae,0x9a,0xa5,
  0xf1,0x4b,0xc7,0x89,0x2b,0xd0,0x72,0x05,0xbb,0x4b,0x0f,0xc0,0x46,0xc7,0x29,0x52,0xa8,0x41,0x59,0xdc,
  0xb9,0x25,0x27,0x75,0xe9,0xb6,0x93,0x8e,0x74,0x87,0xfb,0x65,0xfa,0x86,0x4b,0x3a,0x14,0x6a,0x01,0x7d,
  0x8f,0x62,0x41,0x6f,0x6d,0x07,0x57,0x50,0xca,0x2f,0xcf,0xde,0xef,0x4e,0xe8,0x6e,0xe5,0x10,0x8f,0x02,
  0xe5,0xf2,0x24,0xa8,0xb2,0x7e,0xf1,0xe6,0xe5,0xf1,0xd0,0x19,0xd8,0x9b,0x6a,0x71,0x5f,0x6d,0x5c,0xd6,
  0x6d,0xf1,0xb5,0xee,0x98,0x20,0xa2,0x71,0xd7,0x38,0x82,0x50,0x0d,0xd3,0x09,0xe1,0x54,0xc6,0x11,0xc8,
  0xe4,0xdb,0xde,0xbb,0x95,0x1c,0x4a,0x9a,0x73,0x3b,0xab,0x73,0x96,0xc3,0xbc,0x95,0xef,0x02,0x4b,0xf7,
  0x3c,0x00,0x91,0x48,0xa2,0x76,0x58,0xd5,0x88,0xbd,0x05,0x6c,0xb4,0xd6,0xce,0xd6,0xf5,0x84,0x6b,0xca,
  0xc6,0x95,0x25,0x14,0x06,0x58,0xe3,0xd9,0xbb,0x84,0x53,0xdd,0x6c,0x1c,0x3b,0x56,0xa0,0x97,0xb4,0xcf,
  0x15,0x42,0x3e,0x55,0xa0,0xe1,0x3c,0x41,0x4e,0x10,0x9a,0xff,0xa9,0x8d,0x2e,0x20,0xdd,0x42,0x44,0x24,
  0x33,0x62,0xc9,0x11,0x55,0xa1,0x14,0x71,0x44,0x16,0x54,0xf8,0xf8,0xc5,0x70,0xd8,0x0f,0xac,0x66,0x95,
  0x35,0xd8,0xd1,0x59,0x53,0xec,0x0d,0x5c,0x70,0x82,0x1e,0xdf,0x76,0x90,0x90,0x09,0xa4,0x5a,0xc8,0xae,
  0x36,0xd8,0xdd,0xcb,0xe6,0xcc,0xc7,0xfa,0x13,0x01,0xc7,0x8a,0xdb,0x21,0xa7,0xc1,0xf5,0xa0,0xd3,0x3d,
  0xa0,0xbe,0x04,0x7c,0x2a,0x03,0x0a,0x0e,0x5f,0x71,0x79,0x67,0x35,0x44,0x90,0x8e,0xac,0x6d,0x90,0x6c,
  0x82,0xd8,0x45,0xe5,0x8f,0x65,0xe2,0x8e,0x57,0x13,0xb7,0x90,0x51,0x67,0x03,0x05,0x7e,0xf9,0xd6,0x5f,
  0xcd,0x8d,0xb2,0xfb,0xac,0xad,0xb0,0xaa,0x1e,0xcb,0xcc,0xa0,0x7c,0x27,0x93,0x18,0x2e,0x1c,0x11,0x67,
  0xaf,0x5a,0x4c,0x73,0xf5,0xee,0xaa,0xbc,0x31,0x7d,0x4c,0x2c,0x5b,0xd4,0x13,0x0b,0xcf,0x44,0xe1,0x2d,
  0x64,0xa1,0x08,0x5f,0x80,0x71,0x13,0xb8,0xd8,0x55,0xdb,0x7d,0x82,0xf6,0x55,0x80,0xc8,0x9c,0x32,0x4a,
  0x0d,0xed,0xd7,0x41,0xb4,0x6a,0xb9,0x75,0x82,0x8c,0x9b,0x69,0xb1,0x8c,0x68,0xe9,0x07,0x98,0x62,0xca,
  0x50,0x1e,0x92,0xd0,0x80,0x6f,0x74,0x46,0x9d,0x69,0x7b,0xef,0x0a,0x4b,0x9f,0xd4,0x5d,0x14,0x20,0x49,
  0x29,0x52,0x19,0x46,0x3d,0xb9,0x18,0xaa,0xf5,0xdf,0x71,0x9b,0x92,0xd7,0x4a,0xb0,0xba,0xcf,0xdc,0xfc,
  0xad,0xc0,0xd0,0xf2,0x46,0x28,0x1a,0xbb,0x09,0x18,0xc7,0xb9,0x80,0x70,0xd6,0xb6,0xcd,0x04,0xcf,0xf7,
  0x9d,0x0e,0x18,0x06,0x51,0x56,0xea,0x03,0x30,0x91,0xe8,0x35,0xee,0x27,0x2e,0x7c,0xc9,0xda,0x77,0xdd,
  0x2b,0x23,0xee,0x36,0x39,0x4f,0x75,0x1f,0x5b,0xb6,0xee,0xfb,0x3b,0xf0,0xfa,0xef,0x6c,0x50,0x9b,0xda,
  0x2c,0xb1,0x7e,0x69,0x97,0x10,0x84,0xff,0xf6,0xd3,0xdf,0x9d,0x8f,0x51,0xc1,0x02,0x00,0xd6,0xb9,0xd2,
  0xca,0x39,0xc4,0x65,0xdc,0xc5,0x18,0x54,0x35,0x8e,0xaf,0xe7,0xcb,0x9b,0x26,0x88,0x5a,0x89,0x3f,0x86,
  0x88,0xfd,0xb0,0x8d,0x74,0xdf,0x64,0x42,0xf1,0x1d,0xd9,0x7e,0xf3,0x1a,0x99,0x77,0x0d,0xca,0x69,0x8f,
  0x0f,0xb6,0x36,0x5f,0x86,0xad,0x0f,0xb1,0x90,0x3e,0x96,0x8e,0x66,0x12,0x7c,0xdd,0xf2,0x21,0x81,0xd2,
  0x12,0x5e,0xaa,0xc5,0x05,0x76,0x3d,0x13,0x63,0x9e,0xc7,0xc4,0xde,0x89,0xe9,0x54,0x94,0xf2,0x16,0x49,
  0x2d,0x65,0x75,0x6c,0x8b,0xf1,0x37,0x1e,0x49,0xb3,0x95,0x66,0x9d,0x19,0x0f,0x37,0xaf,0xc4,0x64,0xbd,
  0x30,0x95,0xc9,0xe6,0x85,0x98,0xac,0x17,0xa2,0x3a,0xfc,0xc2,0x63,0x60,0x9c,0xee,0x47,0xc8,0x4f,0x63,
  0xd3,0xd0,0x71,0xaa,0xf4,0xd1,0xba,0x41,0x9a,0xb5,0x6e,0xd0,0xe6,0xe0,0x16,0x6f,0x6e,0x7c,0x24,0x9a,
  0x2f,0x39,0xa0,0x8d,0xc2,0x67,0x59,0xef,0x19,0x2d,0xb1,0x37,0xf8,0xb8,0x27,0xff,0xef,0x3e,0xfa,0x5c,
  0x17,0x05,0x1f,0x8b,0x3c,0x79,0x02,0x0a,0xd3,0xf7,0xb9,0xd3,0xf2,0xdb,0xdc,0x66,0x5d,0x68,0x15,0x04,
  0x97,0x69,0xfa,0xc4,0xe9,0xa3,0xb4,0x7b,0x0e,0xa2,0xf5,0x89,0x8b,0x4b,0xed,0xfa,0x58,0xf1,0xe8,0xd0,
  0x3a,0xa9,0x8d,0xfb,0x7f,0x93,0x6d,0xd7,0xae,0xfb,0x03,0x57,0x7e,0xcf,0x4c,0x71,0xfb,0xd5,0xc3,0xfd,
  0x8a,0x39,0x97,0x23,0x61,0xdd,0x67,0x3e,0x27,0xb6,0x14,0xaf,0xe1,0xc7,0xe3,0x65,0x59,0x19,0xad,0x2e,
  0xef,0x25,0xcb,0xc7,0x61,0xe8,0xd1,0x8b,0x5d,0x80,0xa5,0xe5,0x7c,0xfd,0x84,0x69,0x3c,0xd3,0x6c,0xe8,
  0x21,0x88,0x15,0x81,0x76,0x3f,0x0f,0x17,0xde,0xd6,0x9f,0xc2,0xdf,0x2d,0xbd,0x5f,0x5c,0x61,0xea,0x0b,
  0xa5,0x43,0x7e,0x28,0xa2,0x40,0x80,0x43,0x17,0xa1,0x64,0xd0,0xef,0x2d,0x03,0x52,0x7c,0x5c,0x4a,0x6e,
  0x91,0x73,0x42,0x42,0x37,0xc0,0x6d,0xfd,0x4d,0xe9,0x54,0xda,0xde,0x8c,0x13,0x68,0x75,0x67,0xc7,0x3a,
  0x5a,0xc4,0xf4,0x4d,0xb1,0x92,0x77,0x62,0x3f,0x7f,0xa6,0x39,0x49,0x24,0xd1,0x16,0xef,0x57,0x65,0x07,
  0x48,0xb6,0xe8,0xe6,0xe7,0xac,0xe4,0xc1,0x52,0x37,0xe8,0x3f,0x56,0x21,0x92,0xa4,0xf6,0x62,0xab,0x71,
  0x5c,0xcf,0x0d,0xb6,0x8a,0xbb,0x1c,0xe9,0xf4,0x0d,0x7d,0xd1,0x84,0xf5,0x6d,0x1a,0xea,0xec,0xf5,0x68,
  0x16,0xfc,0xa3,0xf8,0x86,0x38,0xd8,0xb6,0xff,0x17,0xfb,0x7f,0x33,0x86,0x1a,0x79,0xd5,0x1e,0x00,0x00,
};
static const size_t WEB_UI_GZ_LEN = sizeof(WEB_UI_GZ);
// --- fin del panel web ---
// ---- ELM327 por Bluetooth LE ----

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

class GolfDashboardFirmware {
public:

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

// ESP32-WROOM-32 (ESP32 original; requiere Bluetooth clasico SPP).
static constexpr char ELM_NAME[] = "OBDII";
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

// Mapa de PIDs disponibles. Si responden varias computadoras (motor, caja,
// hibrido...) se suman sus mapas: quedarse con la primera linea podia marcar
// como no disponibles datos del motor cuando la primera en responder era otra.
static bool bitmap(const char* response, uint8_t base, uint32_t& bits) {
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
static uint8_t protocolNumber(const char* response) {
  const char* p = response;
  while (*p && (isspace(static_cast<unsigned char>(*p)) || *p == '>')) ++p;
  if (*p == 'A' || *p == 'a') {
    const int next = hex(p[1]);
    if (next >= 1 && next <= 10) ++p;  // "A6": automatico + protocolo 6
  }
  const int v = hex(*p);
  return v >= 1 && v <= 10 ? uint8_t(v) : 0;
}
static bool isCan11(uint8_t protocol) { return protocol == 6 || protocol == 8; }
static bool isCan29(uint8_t protocol) { return protocol == 7 || protocol == 9; }

// Tipo de combustible (PID 51, SAE J1979) y su relacion aire/combustible
// estequiometrica de referencia. 0 = desconocido o mezcla: usar la configurada.
static float stoichForFuel(uint8_t fuel) {
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
static const char* fuelName(uint8_t fuel) {
  switch (fuel) {
    case 1: return "gasolina"; case 2: return "metanol"; case 3: return "etanol";
    case 4: return "diesel"; case 5: return "GLP"; case 6: return "GNC";
    case 7: return "propano"; case 8: return "electrico";
    default: return "";
  }
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
BleElm ble;
// Tipo de Bluetooth del ELM327: LE (compatibles con iPhone) o clasico.
bool useBle = true;
// Nombres vistos en la ultima busqueda BLE, para mostrarlos en la pagina.
char foundNames[160] = "";
Adafruit_SSD1306 oled{128, 64, &Wire, -1, OLED_I2C_HZ, OLED_I2C_HZ};
static constexpr uint8_t PIDS[] = {0x0C, 0x0D, 0x05, 0x5C, 0x10, 0x00, 0x0F, 0x0B, 0x04, 0x11, 0x42};
Dashboard shared;
AdapterSettings adapter;
Preferences preferences;
// Servidor asincrono: atiende varias conexiones a la vez. El WebServer sincrono
// del core atendia una sola y esperaba hasta 5 s a una conexion abierta sin
// pedido (Safari y Chrome las abren por adelantado), y la pagina no cargaba.
AsyncWebServer web{80};
// Hasta cuando no buscar el ELM porque un telefono acaba de unirse al Wi-Fi.
std::atomic<uint32_t> searchHoldUntil{0};
// Dos modos. Configuracion: solo Wi-Fi y la pagina, Bluetooth apagado del todo.
// Pantalla: Bluetooth al ELM327 y, si se eligio, sin Wi-Fi. El Bluetooth se
// enciende recien al pulsar "Conectar" en la pagina.
std::atomic<bool> bluetoothActive{false};
std::atomic<bool> bluetoothRequested{false};
std::atomic<bool> wifiOffRequested{false};
std::atomic<bool> restartRequested{false};
bool wifiOn = false;
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
// Relacion estequiometrica para el AFR calculado: la del combustible que informa
// la ECU (PID 51); si no lo informa, la de Config (gasolina por defecto).
float afrReference(const Dashboard& d) {
  const float fromEcu = Obd::stoichForFuel(d.fuelType);
  return fromEcu > 0 ? fromEcu : STOICHIOMETRIC_AFR;
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
void sendLive(AsyncWebServerRequest* request) {
  Dashboard d = snapshot();
  uint32_t now = millis();
  const char* states[] = {"Conectando Bluetooth", "Detectando ECU", "OBD conectado", "Reconectando OBD"};
  String out; out.reserve(2400);
  out = "{\"state\":" + jsonText(states[static_cast<unsigned>(d.link)]);
  out += ",\"bt\":"; out += bluetoothActive.load() ? "true" : "false";
  out += ",\"ble\":"; out += useBle ? "true" : "false";
  char found[sizeof(foundNames)];
  portENTER_CRITICAL(&guard); memcpy(found, foundNames, sizeof(found)); portEXIT_CRITICAL(&guard);
  out += ",\"found\":" + jsonText(found);
  out += ",\"page\":"+String(d.page)+",\"mask\":"+String(d.extraMask);
  out += ",\"rpmHz\":"+String(d.rpmHz,2)+",\"speedHz\":"+String(d.speedHz,2);
  const float reference = afrReference(d);
  out += ",\"fuel\":" + jsonText(Obd::fuelName(d.fuelType));
  out += ",\"reference\":"+String(reference,2)+",\"afr\":";
  const Reading& lambda = d.fields[LAMBDA];
  const bool lambdaFast = d.page == 1;
  const bool lambdaFresh = lambda.valid && d.link == Link::Ready &&
    uint32_t(now-lambda.at) <= (lambdaFast ? FAST_STALE_MS : EXTRA_STALE_MS);
  out += lambdaFresh ? String(lambda.value*reference,2) : "null";
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
  AsyncWebServerResponse* response = request->beginResponse(200, "application/json", out);
  response->addHeader("Cache-Control", "no-store");
  request->send(response);
}
bool allowWebWrite(AsyncWebServerRequest* request) {
  const AsyncWebHeader* header = request->getHeader("X-Golf-Token");
  if (header && header->value() == webToken) return true;
  request->send(403,"text/plain; charset=utf-8","Recarga la página para obtener una sesión válida.");
  return false;
}
// ---- Diagnostico: por que se reinicio y cuanta memoria queda ----
const char* resetReasonText() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "encendido";
    case ESP_RST_SW: return "reinicio por software";
    case ESP_RST_PANIC: return "CUELGUE (excepcion)";
    case ESP_RST_INT_WDT: case ESP_RST_TASK_WDT: case ESP_RST_WDT: return "CUELGUE (watchdog)";
    case ESP_RST_BROWNOUT: return "FALTA DE ENERGIA (brownout)";
    case ESP_RST_EXT: return "boton EN/RST";
    case ESP_RST_DEEPSLEEP: return "salida de reposo";
    default: return "otro";
  }
}
void logHeap(const char* where) {
  Serial.printf("[%s] memoria libre %u, bloque mayor %u, minimo historico %u, equipos Wi-Fi %d, enlace %u, %lu s\n",
                where, ESP.getFreeHeap(), ESP.getMaxAllocHeap(), ESP.getMinFreeHeap(),
                WiFi.softAPgetStationNum(), static_cast<unsigned>(snapshot().link), (unsigned long)(millis() / 1000));
}

// Si el ELM aun no esta conectado, corta la busqueda Bluetooth en curso y la
// pausa hasta 2 min (o hasta guardar ajustes): comparte radio con el Wi-Fi.
void freeRadioForWeb() {
  if (!bluetoothActive.load() || useBle || snapshot().link != Link::Connecting) return;
  searchHoldUntil.store(millis() + 120000);
  esp_bt_gap_cancel_discovery();
}
String postArg(AsyncWebServerRequest* request, const char* name) {
  const AsyncWebParameter* p = request->getParam(name, true);
  return p ? p->value() : String();
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
  if (!WiFi.softAP(WIFI_AP_NAME,WIFI_AP_PASSWORD,1,false,4)) Serial.println("No se pudo iniciar Wi-Fi AP.");
  // Menos potencia de transmision = picos de consumo menores. Con Wi-Fi y
  // Bluetooth juntos, una fuente USB floja puede reiniciar la placa (brownout).
  // Dentro del auto el alcance sobra.
  WiFi.setTxPower(WIFI_POWER_11dBm);
  char token[17]; snprintf(token,sizeof(token),"%08lx%08lx",(unsigned long)esp_random(),(unsigned long)esp_random());
  webToken = token;
  web.on("/",HTTP_GET,[this](AsyncWebServerRequest* request) {
    // Abrir el panel libera la radio: si se esta buscando el ELM, la busqueda
    // Bluetooth (hasta 32 s) dejaba la pagina a medio llegar, en negro.
    freeRadioForWeb();
    logHeap("web GET /");
    // Comprimido y directo desde la flash: ~3 KB, sin copiarlo a la RAM.
    AsyncWebServerResponse* response = request->beginResponse(200,"text/html; charset=utf-8",WEB_UI_GZ,WEB_UI_GZ_LEN);
    response->addHeader("Content-Encoding","gzip");
    response->addHeader("Cache-Control","no-store"); request->send(response);
  });
  // Clave de sesion para las escrituras (la pagina la pide aparte). Un sitio
  // ajeno no puede leerla: el navegador bloquea leer respuestas de otro origen.
  // Diagnostico minimo: si esto carga y la pagina no, el problema es otro.
  web.on("/diag",HTTP_GET,[this](AsyncWebServerRequest* request) {
    logHeap("web GET /diag");
    String out = "{\"reinicio\":" + jsonText(resetReasonText());
    out += ",\"segundos\":" + String(millis() / 1000);
    out += ",\"memoriaLibre\":" + String(ESP.getFreeHeap());
    out += ",\"bloqueMayor\":" + String(ESP.getMaxAllocHeap());
    out += ",\"minimoHistorico\":" + String(ESP.getMinFreeHeap());
    out += ",\"equiposWifi\":" + String(WiFi.softAPgetStationNum());
    out += ",\"enlace\":" + String(static_cast<unsigned>(snapshot().link)) + "}";
    AsyncWebServerResponse* response = request->beginResponse(200,"application/json",out);
    response->addHeader("Cache-Control","no-store"); request->send(response);
  });
  web.on("/api/token",HTTP_GET,[this](AsyncWebServerRequest* request) {
    AsyncWebServerResponse* response = request->beginResponse(200,"text/plain",webToken);
    response->addHeader("Cache-Control","no-store"); request->send(response);
  });
  web.on("/api/live",HTTP_GET,[this](AsyncWebServerRequest* request) {sendLive(request);});
  web.on("/api/config",HTTP_GET,[this](AsyncWebServerRequest* request) {
    AdapterSettings a = adapterSnapshot();
    AsyncWebServerResponse* response = request->beginResponse(200,"application/json",
      "{\"name\":"+jsonText(a.name)+",\"mac\":"+jsonText(a.mac)+",\"ble\":"+(preferences.getBool("ble", true) ? "true" : "false")+"}");
    response->addHeader("Cache-Control","no-store"); request->send(response);
  });
  web.on("/api/page",HTTP_POST,[this](AsyncWebServerRequest* request) {
    if (!allowWebWrite(request)) return;
    String page = postArg(request,"page");
    if (page != "0" && page != "1") {request->send(400,"text/plain","Pagina invalida"); return;}
    portENTER_CRITICAL(&guard); shared.page = page == "1" ? 1 : 0; ++shared.revision; portEXIT_CRITICAL(&guard);
    request->send(200,"text/plain","OK");
  });
  web.on("/api/extras",HTTP_POST,[this](AsyncWebServerRequest* request) {
    if (!allowWebWrite(request)) return;
    String mask = postArg(request,"mask"); bool valid = mask.length() > 0 && mask.length() <= 4;
    for (unsigned i=0; i<mask.length(); ++i) if (mask[i]<'0'||mask[i]>'9') valid=false;
    uint32_t number = mask.toInt();
    if (!valid || number >= (uint32_t(1)<<FIELD_COUNT)) {request->send(400,"text/plain","Seleccion invalida");return;}
    portENTER_CRITICAL(&guard); shared.extraMask=number; ++shared.revision; portEXIT_CRITICAL(&guard);
    request->send(200,"text/plain","OK");
  });
  web.on("/api/config",HTTP_POST,[this](AsyncWebServerRequest* request) {
    if (!allowWebWrite(request)) return;
    AdapterSettings next = adapterSnapshot();
    String name=postArg(request,"name"), pin=postArg(request,"pin"), mac=postArg(request,"mac"); name.trim(); mac.trim();
    if (!name.length()) name = next.name;  // vacio: conservar el actual (BLE puede buscar sin nombre)
    bool valid=name.length()>0 && name.length()<sizeof(next.name) && pin.length()<sizeof(next.pin);
    for (unsigned i=0; i<name.length(); ++i) if (name[i]<32 || uint8_t(name[i])>126) valid=false;
    for (unsigned i=0; i<pin.length(); ++i) if (pin[i]<32 || uint8_t(pin[i])>126) valid=false;
    uint8_t parsed[6];
    if (mac.length() && !parseMac(mac.c_str(),parsed)) valid=false;
    if (!valid) {request->send(400,"text/plain; charset=utf-8","Revisa nombre, PIN (máximo 16 caracteres) y MAC.");return;}
    strlcpy(next.name,name.c_str(),sizeof(next.name)); strlcpy(next.mac,mac.c_str(),sizeof(next.mac));
    if (pin.length()) strlcpy(next.pin,pin.c_str(),sizeof(next.pin));
    if (preferences.putBytes("adapter",&next,sizeof(next)) != sizeof(next)) {
      request->send(500,"text/plain","No se pudo guardar en memoria. Revisa por USB."); return;
    }
    portENTER_CRITICAL(&guard); adapter=next; portEXIT_CRITICAL(&guard);
    const String type = postArg(request,"ble");
    if (type == "1" || type == "0") {
      const bool wantBle = type == "1";
      preferences.putBool("ble", wantBle);
      if (bluetoothActive.load() && wantBle != useBle) {
        restartRequested.store(true);
        request->send(200,"text/plain; charset=utf-8","Guardado. Reiniciando para cambiar el tipo de Bluetooth.");
        return;
      }
    }
    reconnectRequested.store(true);
    request->send(200,"text/plain; charset=utf-8","Guardado. Reconectando Bluetooth; puede tardar varias decenas de segundos.");
  });
  web.on("/api/connect",HTTP_POST,[this](AsyncWebServerRequest* request) {
    if (!allowWebWrite(request)) return;
    const bool soloPantalla = postArg(request,"soloPantalla") == "1";
    wifiOffRequested.store(soloPantalla);
    bluetoothRequested.store(true);
    request->send(200,"text/plain; charset=utf-8", soloPantalla
      ? "Conectando al ELM327. El Wi-Fi se apaga en 2 s: desde ahora mira la pantalla. Para volver a configurar, mantener BOOT 3 s."
      : "Bluetooth encendido: buscando el ELM327. La pagina sigue disponible.");
  });
  web.onNotFound([this](AsyncWebServerRequest* request) {request->send(404,"text/plain","Abre http://192.168.4.1/");});
  web.begin();
  // Nombre facil para el telefono: http://golfdash.local/ (la IP sigue valiendo).
  if (MDNS.begin("golfdash")) MDNS.addService("http", "tcp", 80);
  else Serial.println("mDNS no disponible; usar http://192.168.4.1/");
  // Al unirse un telefono, si el ELM no esta conectado se corta la busqueda
  // Bluetooth en curso: comparte radio con el Wi-Fi y no deja cargar el panel.
  WiFi.onEvent([this](arduino_event_id_t, arduino_event_info_t) { freeRadioForWeb(); },
               ARDUINO_EVENT_WIFI_AP_STACONNECTED);
  Serial.printf("Wi-Fi %s, abrir http://192.168.4.1/\n",WIFI_AP_NAME);
}

char response[768];

// Una sola consulta en vuelo. Si falta '>', se reinicia la conexion para no
// atribuir una respuesta tardia al comando siguiente. Solo bloquea la tarea OBD.
int linkAvailable() { return useBle ? ble.available() : elm.available(); }
int linkRead() { return useBle ? ble.read() : elm.read(); }
size_t linkWrite(const uint8_t* data, size_t length) { return useBle ? ble.write(data, length) : elm.write(data, length); }
bool linkConnected() { return useBle ? ble.connected() : elm.connected(0); }
void linkDisconnect() { if (useBle) ble.disconnect(); else elm.disconnect(); }
Reply command(const char* text, uint32_t timeout) {
  if (reconnectRequested.load()) return Reply::Disconnected;
  while (linkAvailable()) linkRead();
  response[0] = 0;
  char outbound[32];
  const int length = snprintf(outbound, sizeof(outbound), "%s\r", text);
  if (length < 0 || size_t(length) >= sizeof(outbound)) return Reply::Overflow;
  // Comando y terminador en una escritura para evitar dos envios SPP separados.
  if (linkWrite(reinterpret_cast<const uint8_t*>(outbound), length) != size_t(length))
    return Reply::Disconnected;
  const uint32_t start = millis();
  size_t used = 0;
  bool overflow = false;
  while (uint32_t(millis() - start) < timeout) {
    while (linkAvailable()) {
      int ch = linkRead();
      if (ch < 0) break;
      if (ch == '>') {
        response[used] = 0;
        return overflow ? Reply::Overflow : Reply::Complete;
      }
      if (used + 1 < sizeof(response)) response[used++] = static_cast<char>(ch);
      else overflow = true;
    }
    if (!linkConnected() || reconnectRequested.load()) return Reply::Disconnected;
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
  // En CAN se pregunta solo a la computadora del motor (7E0 / 18DA10F1): asi la
  // caja u otras computadoras no responden encima. Si el motor no contesta con
  // esa direccion, se vuelve a la consulta general de OBD-II.
  if (at("ATDPN", false)) {
    const uint8_t protocol = Obd::protocolNumber(response);
    const char* engine = Obd::isCan11(protocol) ? "ATSH7E0" : Obd::isCan29(protocol) ? "ATSH18DA10F1" : nullptr;
    const char* general = Obd::isCan11(protocol) ? "ATSH7DF" : "ATSH18DB33F1";
    uint32_t engineBits = 0;
    if (engine && at(engine) && query(0x00) && Obd::bitmap(response, 0x00, engineBits)) {
      bits0 = engineBits;
      Serial.printf("Protocolo %u (CAN): consultas dirigidas a la computadora del motor.\n", protocol);
    } else if (engine) {
      at(general);
      Serial.printf("Protocolo %u (CAN): el motor no respondio por direccion; consulta general.\n", protocol);
    } else {
      Serial.printf("Protocolo %u: consulta general OBD-II.\n", protocol);
    }
  }
  for (FieldId id : {RPM, SPEED, COOLANT, MAF, IAT, MAP, LOAD, THROTTLE})
    setSupport(id, Obd::supported(bits0, 0x00, PIDS[id]) ? Support::Yes : Support::No);

  // No consultar 015C a ciegas de forma continua: comprobar primero el soporte.
  Support oil = Support::Unknown;
  Support voltage = Support::Unknown;
  Support lambda = Support::Unknown;
  uint8_t lambdaPid = 0;
  uint8_t fuelType = 0;
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
          if (Obd::supported(bits40, 0x40, 0x51) && query(0x51)) {
            uint8_t fuel = 0;
            if (Obd::payload(response, 0x51, &fuel, 1)) fuelType = fuel;
          }
        }
      }
    }
  }
  setSupport(OIL, oil);
  setSupport(VOLTAGE, voltage);
  setSupport(LAMBDA, lambda);
  portENTER_CRITICAL(&guard);
  shared.lambdaPid = lambdaPid;
  shared.fuelType = fuelType;
  ++shared.revision;
  portEXIT_CRITICAL(&guard);
  Serial.printf("MAF PID10, lambda medida S1 PID%02X (00=no disponible).\n", lambdaPid);
  if (fuelType) Serial.printf("Combustible informado por la ECU: %s (%u).\n", Obd::fuelName(fuelType), fuelType);
  if (!at("ATDPN", false)) return false;
  Serial.printf("Protocolo ELM (A=automatico): %s\n", response);
  return true;
}

// La busqueda Bluetooth clasica ocupa la misma radio que el Wi-Fi. Repetida
// sin pausa, el telefono no logra unirse a GolfDashboard y no se puede corregir
// el nombre o PIN del ELM desde el panel. Cada busqueda por nombre dura hasta
// 32 s en este core, y mientras dura el telefono puede no completar la
// verificacion de la clave Wi-Fi (el iPhone lo informa como "contrasena
// incorrecta"). Si el ELM no aparece en dos busquedas, lo normal es que falte
// configurar su nombre: se deja de buscar 5 min para poder unirse y
// corregirlo. Guardar ajustes en el panel corta la espera y busca de inmediato.
// Con el ELM bien configurado se encuentra en la primera busqueda.
uint32_t bluetoothRetryDelay(unsigned failures) {
  if (failures < 2) return 3000;
  return 300000;
}

// Tras conectar por nombre (que escanea), guarda la MAC del adaptador: las
// conexiones siguientes van directo por direccion, sin escanear, y la radio
// queda libre para el Wi-Fi. Se puede borrar o cambiar desde el panel.
void saveLearnedMac(const AdapterSettings& wanted, const String& mac) {
  uint8_t parsed[6];
  if (mac.length() != 17 || !parseMac(mac.c_str(), parsed)) return;
  AdapterSettings next = adapterSnapshot();
  if (strcmp(next.name, wanted.name) != 0 || next.mac[0]) return;  // cambiaron los ajustes
  strlcpy(next.mac, mac.c_str(), sizeof(next.mac));
  if (preferences.putBytes("adapter", &next, sizeof(next)) != sizeof(next)) return;
  portENTER_CRITICAL(&guard); adapter = next; portEXIT_CRITICAL(&guard);
  Serial.printf("ELM encontrado: MAC %s guardada; las proximas conexiones van directo.\n", mac.c_str());
}
void learnAdapterAddress(const AdapterSettings& wanted) {
  BTScanResults* results = elm.getScanResults();
  if (!results) return;
  for (int i = 0; i < results->getCount(); ++i) {
    BTAdvertisedDevice* device = results->getDevice(i);
    if (!device || !device->haveName() || device->getName() != std::string(wanted.name)) continue;
    saveLearnedMac(wanted, device->getAddress().toString(true));
    return;
  }
  Serial.println("ELM conectado por nombre; su MAC no aparecio en la busqueda (se seguira usando el nombre).");
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
    const uint32_t hold = searchHoldUntil.exchange(0);
    if (hold && int32_t(hold - millis()) > 0 && WiFi.softAPgetStationNum() > 0) {
      Serial.println("Telefono conectado: busqueda del ELM en pausa hasta 2 min; guardar ajustes la reanuda.");
      waitOrReconfigure(hold - millis());
      reconnectRequested.store(false);
    }
    AdapterSettings wanted = adapterSnapshot();
    Serial.printf("Conectando a %s por Bluetooth %s; contacto encendido.\n", wanted.name, useBle ? "LE" : "clasico");
    bool connected;
    if (useBle) {
      connected = ble.connect(wanted.name, wanted.mac);
      portENTER_CRITICAL(&guard); strlcpy(foundNames, ble.found(), sizeof(foundNames)); ++shared.revision; portEXIT_CRITICAL(&guard);
      Serial.printf("BLE cerca: %s\n", ble.found()[0] ? ble.found() : "(ninguno con nombre)");
      if (connected) Serial.printf("ELM BLE conectado: %s (%s).\n", ble.connectedName().c_str(), ble.address().c_str());
    } else {
      elm.setPin(wanted.pin, strlen(wanted.pin));
      uint8_t address[6];
      if (wanted.mac[0] && parseMac(wanted.mac,address)) connected = elm.connect(address);
      else connected = elm.connect(String(wanted.name));
    }
    if (!connected) {
      ++btFailures;
      const uint32_t wait = bluetoothRetryDelay(btFailures);
      Serial.printf("ELM no encontrado; nueva busqueda en %lu s (guardar el nombre en el panel busca ya).\n", (unsigned long)(wait / 1000));
      waitOrReconfigure(wait);
      if (reconnectRequested.load()) btFailures = 0;
      continue;
    }
    btFailures = 0;
    if (!wanted.mac[0]) { if (useBle) saveLearnedMac(wanted, ble.address()); else learnAdapterAddress(wanted); }
    linkState(Link::Initializing);
    if (!initializeElm()) {
      Serial.printf("No se pudo iniciar OBD. Ultima respuesta: %s\n", response);
      linkState(Link::Recovering);
      linkDisconnect();
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
    while (linkConnected() && !reconnectRequested.load()) {
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
    linkDisconnect();
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
  if (!bluetoothActive.load()) {
    oled.println("MODO CONFIGURACION");
    oled.setCursor(0, 14); oled.print("WiFi "); oled.println(WIFI_AP_NAME);
    oled.setCursor(0, 26); oled.print("Clave "); oled.println(WIFI_AP_PASSWORD);
    oled.setCursor(0, 38); oled.println("http://192.168.4.1");
    oled.setCursor(0, 54); oled.println("Pagina: Conectar");
  } else if (d.link != Link::Ready) {
    oled.println("GOLF MK4 / OBD");
    oled.setCursor(0, 20);
    if (d.link == Link::Connecting) oled.println("Conectando Bluetooth");
    else if (d.link == Link::Initializing) oled.println("Detectando ECU...");
    else oled.println("Sin conexion OBD");
    oled.setCursor(0, 40); oled.println("ELM 327 + contacto ON");
    oled.setCursor(0, 56); oled.print(wifiOn ? "WiFi: 192.168.4.1" : "BOOT 3s: configurar");
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
    afr.value *= afrReference(d);
    printValue(afr, now, FAST_STALE_MS, 2);
  }
  oled.display();
}

void startBluetooth() {
  if (bluetoothActive.load()) return;
  useBle = preferences.getBool("ble", true);
  const AdapterSettings a = adapterSnapshot();
  if (useBle) {
    ble.begin("GolfDashboard");
  } else {
    if (!elm.begin("GolfDashboard", true)) {
      Serial.println("No se pudo iniciar Bluetooth SPP.");
      return;
    }
    elm.setPin(a.pin, strlen(a.pin));
  }
  bluetoothActive.store(true);
  portENTER_CRITICAL(&guard); ++shared.revision; portEXIT_CRITICAL(&guard);
  if (xTaskCreatePinnedToCore(runObdTask, "OBD", 8192, this, 2, nullptr, 0) != pdPASS) {
    Serial.println("No se pudo crear tarea OBD.");
  }
  Serial.printf("Bluetooth %s encendido: buscando el ELM327 %s.\n", useBle ? "LE" : "clasico", a.name);
}
void stopWifi() {
  web.end();
  MDNS.end();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_OFF);
  wifiOn = false;
  Serial.println("Wi-Fi apagado: modo solo pantalla (mantener BOOT 3 s para volver a configurar).");
}
void enterSetupMode() {
  preferences.putBool("soloPantalla", false);
  Serial.println("BOOT 3 s: volviendo al modo configuracion.");
  delay(200);
  ESP.restart();
}
void setup() {
  Serial.begin(115200);
  Serial.printf("\nGolf Dashboard: arranque por %s.\n", resetReasonText());
  preferences.begin("golfdash",false);
  pinMode(PAGE_BUTTON_PIN, INPUT_PULLUP);
  Wire.begin(OLED_SDA, OLED_SCL, OLED_I2C_HZ);
  displayReady = oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS);
  if (!displayReady) Serial.println("OLED no iniciada: revisar 3V3, GND, SDA21, SCL22 y 0x3C/0x3D.");
  else render(snapshot());
  if (preferences.getBool("soloPantalla", false)) {
    Serial.println("Modo solo pantalla: directo al ELM327, sin Wi-Fi (mantener BOOT 3 s para configurar).");
    startBluetooth();
  } else {
    configureNetwork();
    wifiOn = true;
    Serial.println("Modo configuracion: Bluetooth apagado. Wi-Fi GolfDashboard, abrir http://192.168.4.1/ y pulsar Conectar.");
  }
}
void loop() {
  static uint32_t revision = UINT32_MAX, lastPaint = 0;
  static TickType_t lastWake = xTaskGetTickCount();
  static bool lastRaw = HIGH, stable = HIGH;
  static uint32_t buttonChangedAt = 0;
  uint32_t now = millis();
  static uint32_t lastHeapLog = 0;
  if (uint32_t(now - lastHeapLog) >= 10000) { lastHeapLog = now; logHeap("estado"); }
  bool raw = digitalRead(PAGE_BUTTON_PIN);
  if (raw != lastRaw) { lastRaw = raw; buttonChangedAt = now; }
  static uint32_t pressedAt = 0;
  if (raw != stable && uint32_t(now - buttonChangedAt) >= BUTTON_DEBOUNCE_MS) {
    stable = raw;
    if (stable == LOW) pressedAt = now;
    else if (pressedAt && uint32_t(now - pressedAt) < 1500) changePage();  // pulsacion corta
  }
  // Mantener BOOT 3 s con el programa funcionando: volver al modo configuracion.
  if (stable == LOW && pressedAt && uint32_t(now - pressedAt) >= 3000) { pressedAt = 0; enterSetupMode(); }
  // "Conectar" desde la pagina: se atiende aqui, fuera del servidor web.
  if (restartRequested.load()) { delay(1500); ESP.restart(); }
  if (bluetoothRequested.exchange(false)) {
    if (wifiOffRequested.load()) {
      preferences.putBool("soloPantalla", true);
      delay(1500);  // deja salir la respuesta de la pagina antes de apagar el Wi-Fi
      stopWifi();
    }
    startBluetooth();
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
