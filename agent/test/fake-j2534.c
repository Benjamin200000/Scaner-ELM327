/*
 * Biblioteca J2534 falsa, para testear el enlace FFI sin hardware.
 *
 * Implementa la API PassThru 04.04 con una ECU mínima detrás, que responde
 * OBD-II sobre ISO15765. NO sustituye al equipo real: lo que verifica es que
 * el lado de Node arma bien las estructuras, pasa bien los punteros, lee los
 * mensajes del tamaño correcto y traduce los códigos de error.
 *
 * Detalle que importa: en Windows `unsigned long` son 4 bytes tanto en 32
 * como en 64 bits. En Linux son 8. Como la norma J2534 define la estructura
 * con campos de 32 bits, acá se usa uint32_t explícito: así el layout es el
 * mismo que va a encontrar el lado de Node contra la DLL de Autel.
 */
#include <stdint.h>
#include <string.h>
#include <stdio.h>

#define STATUS_NOERROR            0x00
#define ERR_NOT_SUPPORTED         0x01
#define ERR_INVALID_CHANNEL_ID    0x02
#define ERR_INVALID_PROTOCOL_ID   0x03
#define ERR_NULL_PARAMETER        0x04
#define ERR_FAILED                0x07
#define ERR_DEVICE_NOT_CONNECTED  0x08
#define ERR_TIMEOUT               0x09
#define ERR_BUFFER_EMPTY          0x10
#define ERR_INVALID_DEVICE_ID     0x1A

#define PROTO_ISO15765 6

typedef struct {
    uint32_t ProtocolID;
    uint32_t RxStatus;
    uint32_t TxFlags;
    uint32_t Timestamp;
    uint32_t DataSize;
    uint32_t ExtraDataIndex;
    uint8_t  Data[4128];
} PASSTHRU_MSG;

static int      g_abierto  = 0;
static uint32_t g_deviceId = 0;
static uint32_t g_channelId = 0;
static uint32_t g_filterId = 0;
static char     g_ultimoError[80] = "Sin error";

/* Estado UDS de la ECU falsa, para probar la lectura de memoria. */
static int      g_extended   = 0;
static int      g_unlocked   = 0;
static uint8_t  g_seed[4]    = {0x11, 0x22, 0x33, 0x44};
static uint32_t g_up_addr    = 0;
static int32_t  g_up_left    = 0;
static uint8_t  g_up_counter = 1;
static uint8_t  g_flash[0x2000];
static int      g_flash_init = 0;

static void flash_init(void) {
    if (g_flash_init) return;
    const char *hdr = "EDC17-SIM CAL v1.0";
    for (int i = 0; hdr[i]; i++) g_flash[i] = (uint8_t)hdr[i];
    for (int i = 0x12; i < (int)sizeof(g_flash); i++) g_flash[i] = (uint8_t)((i * 7 + 0x3b) & 0xff);
    g_flash_init = 1;
}

static void flash_read(uint32_t addr, int n, uint8_t *out) {
    uint32_t base = addr >= 0x80000000u ? addr - 0x80000000u : addr;
    for (int i = 0; i < n; i++) out[i] = g_flash[(base + i) % sizeof(g_flash)];
}

/* Misma llave de prueba que security.ts y el simulador. */
static void expected_key(const uint8_t *seed, uint8_t *key) {
    uint32_t s = (uint32_t)seed[0] << 24 | (uint32_t)seed[1] << 16 |
                 (uint32_t)seed[2] << 8 | seed[3];
    uint32_t k = ((s ^ 0x12345678u) + 0x9abcdef0u);
    key[0] = (k >> 24) & 0xff; key[1] = (k >> 16) & 0xff;
    key[2] = (k >> 8) & 0xff;  key[3] = k & 0xff;
}

static uint32_t rd_int(const uint8_t *p, int n) {
    uint32_t v = 0;
    for (int i = 0; i < n; i++) v = (v << 8) | p[i];
    return v;
}

/* Cola de respuestas pendientes de la ECU simulada. */
#define MAX_COLA 8
static PASSTHRU_MSG g_cola[MAX_COLA];
static int g_colaN = 0;

static void encolar(const uint8_t *datos, uint32_t n) {
    if (g_colaN >= MAX_COLA) return;
    PASSTHRU_MSG *m = &g_cola[g_colaN++];
    memset(m, 0, sizeof(*m));
    m->ProtocolID = PROTO_ISO15765;
    m->RxStatus = 0;
    m->Timestamp = 123456;
    /* Cabecera CAN de la ECU: 7E8. */
    m->Data[0] = 0x00; m->Data[1] = 0x00; m->Data[2] = 0x07; m->Data[3] = 0xE8;
    m->ExtraDataIndex = 4;
    memcpy(&m->Data[4], datos, n);
    m->DataSize = 4 + n;
}

int32_t PassThruOpen(void *pName, uint32_t *pDeviceID) {
    (void)pName;
    if (!pDeviceID) return ERR_NULL_PARAMETER;
    if (g_abierto) { snprintf(g_ultimoError, sizeof g_ultimoError, "El dispositivo ya esta abierto"); return ERR_FAILED; }
    g_abierto = 1;
    g_deviceId = 4242;
    *pDeviceID = g_deviceId;
    return STATUS_NOERROR;
}

int32_t PassThruClose(uint32_t DeviceID) {
    if (!g_abierto || DeviceID != g_deviceId) return ERR_INVALID_DEVICE_ID;
    g_abierto = 0; g_channelId = 0; g_colaN = 0;
    return STATUS_NOERROR;
}

int32_t PassThruConnect(uint32_t DeviceID, uint32_t ProtocolID, uint32_t Flags,
                        uint32_t BaudRate, uint32_t *pChannelID) {
    (void)Flags;
    if (!g_abierto || DeviceID != g_deviceId) return ERR_INVALID_DEVICE_ID;
    if (!pChannelID) return ERR_NULL_PARAMETER;
    if (ProtocolID != PROTO_ISO15765) {
        snprintf(g_ultimoError, sizeof g_ultimoError, "Protocolo %u no soportado", ProtocolID);
        return ERR_INVALID_PROTOCOL_ID;
    }
    if (BaudRate != 500000 && BaudRate != 250000) return ERR_FAILED;
    g_channelId = 77;
    *pChannelID = g_channelId;
    return STATUS_NOERROR;
}

int32_t PassThruDisconnect(uint32_t ChannelID) {
    if (ChannelID != g_channelId) return ERR_INVALID_CHANNEL_ID;
    g_channelId = 0; g_colaN = 0;
    return STATUS_NOERROR;
}

int32_t PassThruStartMsgFilter(uint32_t ChannelID, uint32_t FilterType,
                               PASSTHRU_MSG *pMask, PASSTHRU_MSG *pPattern,
                               PASSTHRU_MSG *pFlow, uint32_t *pFilterID) {
    (void)FilterType;
    if (ChannelID != g_channelId) return ERR_INVALID_CHANNEL_ID;
    if (!pMask || !pPattern || !pFlow || !pFilterID) return ERR_NULL_PARAMETER;
    /* Un filtro de control de flujo sin los tres mensajes es un error real. */
    if (pMask->DataSize != 4 || pPattern->DataSize != 4 || pFlow->DataSize != 4) {
        snprintf(g_ultimoError, sizeof g_ultimoError, "Filtro mal formado");
        return ERR_FAILED;
    }
    *pFilterID = ++g_filterId;
    return STATUS_NOERROR;
}

int32_t PassThruStopMsgFilter(uint32_t ChannelID, uint32_t FilterID) {
    if (ChannelID != g_channelId) return ERR_INVALID_CHANNEL_ID;
    (void)FilterID;
    return STATUS_NOERROR;
}

/* ECU mínima: responde modo 01 y modo 03. */
int32_t PassThruWriteMsgs(uint32_t ChannelID, PASSTHRU_MSG *pMsg,
                          uint32_t *pNumMsgs, uint32_t Timeout) {
    (void)Timeout;
    if (ChannelID != g_channelId) return ERR_INVALID_CHANNEL_ID;
    if (!pMsg || !pNumMsgs || *pNumMsgs == 0) return ERR_NULL_PARAMETER;
    if (pMsg->DataSize < 5) return ERR_FAILED;

    const uint8_t *p = &pMsg->Data[4];       /* salta la cabecera CAN */
    uint32_t n = pMsg->DataSize - 4;
    uint8_t modo = p[0];
    uint8_t pid  = n > 1 ? p[1] : 0;

    if (modo == 0x01) {
        if (pid == 0x00) { uint8_t r[] = {0x41,0x00,0xBE,0x3E,0xB8,0x11}; encolar(r,6); }
        else if (pid == 0x20) { uint8_t r[] = {0x41,0x20,0x80,0x00,0x00,0x00}; encolar(r,6); }
        else if (pid == 0x0C) { uint8_t r[] = {0x41,0x0C,0x0D,0x48}; encolar(r,4); }  /* 852 rpm */
        else if (pid == 0x05) { uint8_t r[] = {0x41,0x05,0x7B}; encolar(r,3); }        /* 83 C */
        else if (pid == 0x0D) { uint8_t r[] = {0x41,0x0D,0x00}; encolar(r,3); }
        else { /* sin respuesta: la app lo tiene que tomar como NO DATA */ }
    } else if (modo == 0x03) {
        uint8_t r[] = {0x43,0x01,0x01,0x33};  /* un codigo: P0133 */
        encolar(r,4);
    } else if (modo == 0x09 && pid == 0x02) {
        uint8_t r[] = {0x49,0x02,0x01,'W','V','W','Z','Z','Z'};
        encolar(r,9);
    } else if (modo == 0x10) {               /* sesión de diagnóstico */
        if (pid == 0x02) { uint8_t r[] = {0x7f,0x10,0x33}; encolar(r,3); }
        else { g_extended = (pid == 0x03 || pid == 0x85); g_unlocked = 0;
               uint8_t r[] = {0x50, pid}; encolar(r,2); }
    } else if (modo == 0x27) {               /* acceso de seguridad */
        if (p[1] & 1) {                      /* pedir semilla */
            uint8_t r[] = {0x67, p[1], g_seed[0], g_seed[1], g_seed[2], g_seed[3]};
            encolar(r,6);
        } else {                             /* enviar llave */
            uint8_t key[4]; expected_key(g_seed, key);
            if (n >= 6 && p[2]==key[0] && p[3]==key[1] && p[4]==key[2] && p[5]==key[3]) {
                g_unlocked = 1; uint8_t r[] = {0x67, p[1]}; encolar(r,2);
            } else { uint8_t r[] = {0x7f,0x27,0x35}; encolar(r,3); }
        }
    } else if (modo == 0x23) {               /* leer memoria por dirección */
        flash_init();
        if (!g_extended) { uint8_t r[] = {0x7f,0x23,0x7f}; encolar(r,3); }
        else {
            int naddr = p[1] & 0x0f, nsize = (p[1] >> 4) & 0x0f;
            uint32_t addr = rd_int(&p[2], naddr);
            uint32_t sz = rd_int(&p[2+naddr], nsize);
            if (sz == 0 || sz > 0x100) { uint8_t r[] = {0x7f,0x23,0x31}; encolar(r,3); }
            else { uint8_t out[0x104]; out[0]=0x63; flash_read(addr,sz,&out[1]); encolar(out, sz+1); }
        }
    } else if (modo == 0x35) {               /* solicitar subida */
        flash_init();
        if (!g_unlocked) { uint8_t r[] = {0x7f,0x35,0x33}; encolar(r,3); }
        else {
            int naddr = p[2] & 0x0f, nsize = (p[2] >> 4) & 0x0f;
            g_up_addr = rd_int(&p[3], naddr);
            g_up_left = (int32_t)rd_int(&p[3+naddr], nsize);
            g_up_counter = 1;
            uint8_t r[] = {0x75, 0x20, 0x00, 0x40};  /* bloque máx 0x40 */
            encolar(r,4);
        }
    } else if (modo == 0x36) {               /* transferir bloque */
        if (g_up_left <= 0) { uint8_t r[] = {0x7f,0x36,0x24}; encolar(r,3); }
        else if (p[1] != g_up_counter) { uint8_t r[] = {0x7f,0x36,0x73}; encolar(r,3); }
        else {
            int blk = g_up_left < 0x40 ? g_up_left : 0x40;
            uint8_t out[0x42]; out[0]=0x76; out[1]=g_up_counter;
            flash_read(g_up_addr, blk, &out[2]);
            g_up_addr += blk; g_up_left -= blk;
            g_up_counter = (g_up_counter % 0xff) + 1;
            encolar(out, blk + 2);
        }
    } else if (modo == 0x37) {               /* terminar transferencia */
        g_up_left = 0; uint8_t r[] = {0x77}; encolar(r,1);
    } else if (modo == 0x3e) {               /* tester present */
        if (!(n >= 2 && (p[1] & 0x80))) { uint8_t r[] = {0x7e,0x00}; encolar(r,2); }
    }
    return STATUS_NOERROR;
}

int32_t PassThruReadMsgs(uint32_t ChannelID, PASSTHRU_MSG *pMsg,
                         uint32_t *pNumMsgs, uint32_t Timeout) {
    (void)Timeout;
    if (ChannelID != g_channelId) return ERR_INVALID_CHANNEL_ID;
    if (!pMsg || !pNumMsgs) return ERR_NULL_PARAMETER;
    if (g_colaN == 0) { *pNumMsgs = 0; return ERR_BUFFER_EMPTY; }

    uint32_t pedidos = *pNumMsgs;
    uint32_t entregados = 0;
    while (entregados < pedidos && g_colaN > 0) {
        memcpy(&pMsg[entregados], &g_cola[0], sizeof(PASSTHRU_MSG));
        memmove(&g_cola[0], &g_cola[1], sizeof(PASSTHRU_MSG) * (g_colaN - 1));
        g_colaN--; entregados++;
    }
    *pNumMsgs = entregados;
    return STATUS_NOERROR;
}

int32_t PassThruReadVersion(uint32_t DeviceID, char *pFirmware, char *pDll, char *pApi) {
    if (!g_abierto || DeviceID != g_deviceId) return ERR_INVALID_DEVICE_ID;
    if (!pFirmware || !pDll || !pApi) return ERR_NULL_PARAMETER;
    strcpy(pFirmware, "FAKE-FW 1.00");
    strcpy(pDll, "FAKE-DLL 0.1");
    strcpy(pApi, "04.04");
    return STATUS_NOERROR;
}

int32_t PassThruGetLastError(char *pErrorDescription) {
    if (!pErrorDescription) return ERR_NULL_PARAMETER;
    strcpy(pErrorDescription, g_ultimoError);
    return STATUS_NOERROR;
}

int32_t PassThruIoctl(uint32_t ChannelID, uint32_t IoctlID, void *pInput, void *pOutput) {
    (void)ChannelID; (void)pInput;
    /* READ_VBATT = 0x03, devuelve milivoltios. */
    if (IoctlID == 0x03) {
        if (!pOutput) return ERR_NULL_PARAMETER;
        *(uint32_t *)pOutput = 13950;
        return STATUS_NOERROR;
    }
    if (IoctlID == 0x08 || IoctlID == 0x09) return STATUS_NOERROR; /* limpiar buffers */
    return ERR_NOT_SUPPORTED;
}
