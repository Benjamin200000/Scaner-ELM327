#pragma once

// ESP32-WROOM-32 (ESP32 original; requiere Bluetooth clasico SPP).
constexpr char ELM_NAME[] = "ELM 327";
// Si el nombre no conecta, escribir la MAC del adaptador y activar esta opcion.
constexpr bool USE_ELM_MAC = false;
constexpr uint8_t ELM_MAC[6] = {0, 0, 0, 0, 0, 0};
// Se utiliza solo si el adaptador solicita PIN. Probar "0000" si 1234 falla.
constexpr char ELM_PIN[] = "1234";

constexpr uint8_t OLED_ADDRESS = 0x3C;
constexpr int OLED_SDA = 21;
constexpr int OLED_SCL = 22;
constexpr uint32_t OLED_I2C_HZ = 400000;
constexpr uint32_t OLED_FRAME_MS = 50; // Hasta 20 refrescos/s; no inventa mediciones.

// ATST20 = 0x20 * 4 ms = 128 ms: espera ELM, NO pausa entre consultas.
// ATAT2 usa temporizacion adaptativa agresiva; ATAT1 es la alternativa estable.
// Si aparecen fallos intermitentes, usar ATAT1 y ATST32 (200 ms).
constexpr char ELM_ADAPTIVE_COMMAND[] = "ATAT2";
constexpr char ELM_TIMEOUT_COMMAND[] = "ATST20";
constexpr uint32_t PID_RESPONSE_MS = 1300;
constexpr uint32_t AUTO_PROTOCOL_MS = 20000;
constexpr uint32_t COOLANT_INTERVAL_MS = 1500;
constexpr uint32_t OIL_INTERVAL_MS = 4000;
constexpr uint32_t FAST_STALE_MS = 1800;
constexpr uint32_t COOLANT_STALE_MS = 10000;
constexpr uint32_t OIL_STALE_MS = 15000;

// Pulsacion corta BOOT mientras el programa YA esta ejecutandose.
// No mantener BOOT al encender: ese boton tambien selecciona el modo de carga.
constexpr int PAGE_BUTTON_PIN = 0;
constexpr uint32_t BUTTON_DEBOUNCE_MS = 40;
// AFR mostrado = lambda medida * esta referencia configurable.
// 14,7 es una referencia de gasolina sin etanol; no identifica tu combustible.
constexpr float STOICHIOMETRIC_AFR = 14.7f;
static_assert(STOICHIOMETRIC_AFR > 0, "La referencia estequiometrica debe ser positiva");
constexpr char WIFI_AP_NAME[] = "GolfDashboard";
constexpr char WIFI_AP_PASSWORD[] = "GolfOBD2026"; // Cambiar antes de compartir el codigo.
constexpr uint32_t EXTRA_INTERVAL_MS = 1000;
constexpr uint32_t EXTRA_STALE_MS = 30000;
