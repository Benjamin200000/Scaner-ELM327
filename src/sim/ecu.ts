import { type SimEngineState, type SimProfile, golf20_8v } from './profiles';

/**
 * Simulador de un adaptador ELM327 con una ECU detrás.
 *
 * Imita lo que de verdad complica el desarrollo contra hardware real:
 * el eco de comandos, el prompt '>', NO DATA, los formatos de respuesta
 * distintos entre CAN y KWP, y las respuestas multilínea del modo 09.
 *
 * Es deliberadamente estricto: si el driver manda algo que un ELM327 real
 * no aceptaría, acá responde '?' igual que el chip.
 */

export interface SimOptions {
  profile?: SimProfile;
  /** Retardo por comando, en ms. Un ELM327 real tarda 30-80 ms. */
  latencyMs?: number;
  /** Fuerza que la ECU no responda, para probar el manejo de timeout. */
  ecuSilent?: boolean;
  /** Versión que reporta ATZ / ATI. */
  version?: string;
  /** Se comporta como un clon barato: rechaza los comandos avanzados. */
  clon?: boolean;
}

interface ElmFlags {
  echo: boolean;
  linefeed: boolean;
  spaces: boolean;
  headers: boolean;
  protocol: string;
  /** Cabecera fijada con ATSH; vacía = direccionamiento funcional. */
  sh: string;
}

const CR = '\r';
const PROMPT = '>';

export class Elm327Simulator {
  private readonly profile: SimProfile;
  private readonly latencyMs: number;
  private readonly version: string;
  private ecuSilent: boolean;
  private readonly clon: boolean;
  private state: SimEngineState;
  private flags: ElmFlags;
  private clearedAt: number | null = null;
  /** Estado de la ECU KWP2000 que hay detrás del adaptador. */
  private kwp = {
    session: 0x81,          // sesión por defecto
    lastTesterPresent: 0,
    /** Intervalo de servicio: km y días restantes. */
    serviceDistanceKm: 1500,
    serviceDays: 42,
    /** Cuántas veces se reinició, para verificar en los tests. */
    serviceResets: 0,
  };

  constructor(opts: SimOptions = {}) {
    this.profile = opts.profile ?? golf20_8v;
    this.latencyMs = opts.latencyMs ?? 40;
    this.version = opts.version ?? 'ELM327 v1.5';
    this.ecuSilent = opts.ecuSilent ?? false;
    this.clon = opts.clon ?? false;
    this.state = this.profile.initial();
    this.flags = this.defaultFlags();
  }

  private defaultFlags(): ElmFlags {
    return { echo: true, linefeed: true, spaces: true, headers: false, protocol: '0', sh: '' };
  }

  get latency(): number {
    return this.latencyMs;
  }

  get activeProfile(): SimProfile {
    return this.profile;
  }

  setEcuSilent(silent: boolean): void {
    this.ecuSilent = silent;
  }

  /** Avanza el motor simulado. Lo llama el transporte con un reloj. */
  advance(dtSeconds: number): void {
    this.profile.step(this.state, dtSeconds);
  }

  snapshot(): Readonly<SimEngineState> {
    return this.state;
  }

  /**
   * Procesa una línea de comando y devuelve la respuesta completa del chip,
   * incluido el eco y el prompt, tal como llegaría por el cable.
   */
  handle(rawLine: string): string {
    const cmd = rawLine.trim();
    const echo = this.flags.echo ? cmd + CR : '';
    const body = this.respond(cmd.replace(/\s+/g, '').toUpperCase());
    const sep = this.flags.linefeed ? '\r\n' : CR;
    const text = body.length > 0 ? body.join(sep) + sep : '';
    return echo + text + CR + PROMPT;
  }

  private respond(cmd: string): string[] {
    if (cmd.length === 0) return [];
    if (cmd.startsWith('AT')) return this.atCommand(cmd.slice(2));
    if (/^[0-9A-F]+$/.test(cmd)) return this.obdCommand(cmd);
    return ['?'];
  }

  private atCommand(arg: string): string[] {
    // Comandos sin parámetro.
    switch (arg) {
      case 'Z':
        this.flags = this.defaultFlags();
        return [this.version];
      case 'I':
        return [this.version];
      case 'E0':
        this.flags.echo = false;
        return ['OK'];
      case 'E1':
        this.flags.echo = true;
        return ['OK'];
      case 'L0':
        this.flags.linefeed = false;
        return ['OK'];
      case 'L1':
        this.flags.linefeed = true;
        return ['OK'];
      case 'S0':
        this.flags.spaces = false;
        return ['OK'];
      case 'S1':
        this.flags.spaces = true;
        return ['OK'];
      case 'H0':
        this.flags.headers = false;
        return ['OK'];
      case 'H1':
        this.flags.headers = true;
        return ['OK'];
      case 'RV':
        return [`${this.state.voltage.toFixed(1)}V`];
      case 'DP':
        return [this.flags.protocol === '0'
          ? `AUTO, ${this.profile.protocolName}`
          : this.profile.protocolName];
      case 'DPN':
        return [this.flags.protocol === '0'
          ? `A${this.profile.protocolNumber}`
          : this.profile.protocolNumber];
      case 'D':
      case 'AT0':
      case 'AT1':
      case 'AT2':
      case 'M0':
      case 'CAF1':
      case 'CAF0':
        return ['OK'];
    }
    // Comandos con parámetro.
    if (/^SP(0|[1-9A]|H[0-9A])$/.test(arg)) {
      this.flags.protocol = arg.replace(/^SPH?/, '');
      return ['OK'];
    }
    if (/^ST[0-9A-F]{1,2}$/.test(arg)) return ['OK'];
    if (/^SH[0-9A-F]{3,8}$/.test(arg)) {
      this.flags.sh = arg.slice(2);
      return ['OK'];
    }
    // Comandos que un ELM327 genuino acepta y varios clones no.
    if (this.clon && /^(AL|NL|FCS|CRA|CAF|@1)/.test(arg)) return ['?'];
    if (/^(AL|NL|AR|CFC[01]|FCSM[012]|V[01]|R[01]|BI|PC|WS)$/.test(arg)) return ['OK'];
    if (/^(FCSH|FCSD|CRA|TP|TA|SD|BRD|BRT|PP)[0-9A-F ]*$/.test(arg)) return ['OK'];
    if (arg === '@1') return ['OBDII to RS232 Interpreter'];
    if (arg === 'IGN') return ['ON'];
    if (arg === 'KW') return ['1:8F 2:E9'];
    if (arg === 'CS') return ['T:00 R:00'];
    if (/^(WM|SW|IIA|SR|CRA|CF|CM)/.test(arg)) return ['OK'];
    return ['?'];
  }

  private obdCommand(hex: string): string[] {
    if (this.ecuSilent) return ['NO DATA'];
    const mode = hex.slice(0, 2);
    const pid = hex.slice(2, 4);
    switch (mode) {
      case '01': {
        // Más de un PID en la solicitud: respuesta agrupada.
        const pids = hex.slice(2).match(/.{2}/g) ?? [];
        if (pids.length > 1) return this.mode01Multiple(pids);
        return this.mode01(pid);
      }
      case '02':
        return this.mode02(pid, hex.slice(4));
      case '03':
        return this.mode03();
      case '04':
        this.clearedAt = Date.now();
        return ['44'];
      case '07':
        return this.mode07();
      case '06':
        return this.mode06(pid);
      case '09':
        return this.mode09(pid);
      case '0A':
        return this.mode0A();
      default: {
        const sid = parseInt(mode, 16);
        if (sid >= 0x10) return this.kwpService(sid, hex.slice(2));
        // Un ELM327 real devuelve esto cuando la ECU rechaza el servicio.
        return ['NO DATA'];
      }
    }
  }

  /**
   * ECU KWP2000 mínima (ISO 14230-3).
   *
   * Está acá para que las rutinas de servicio se puedan ejercitar completas
   * sin vehículo: sesión extendida, testerPresent, respuestas negativas y la
   * diferencia entre lo que la ECU acepta en sesión por defecto y lo que
   * exige sesión extendida.
   */
  private kwpService(sid: number, argHex: string): string[] {
    const args = bytesOf(argHex);
    const positive = (data: number[] = []): string[] =>
      this.frame([byte(sid + 0x40), ...data.map(byte)]);
    const negative = (nrc: number): string[] =>
      this.frame(['7F', byte(sid), byte(nrc)]);

    const extended = this.kwp.session === 0x85 || this.kwp.session === 0x86;

    switch (sid) {
      case 0x10: {
        const type = args[0];
        if (type === undefined) return negative(0x12);
        // La sesión de programación no se habilita en el simulador: es la
        // que puede dejar una ECU inutilizable y no hay razón para
        // practicarla contra un modelo de juguete.
        if (type === 0x86) return negative(0x33);
        if (type !== 0x81 && type !== 0x85 && type !== 0x89) return negative(0x12);
        this.kwp.session = type;
        return positive([type]);
      }

      case 0x3e: // testerPresent
        this.kwp.lastTesterPresent = Date.now();
        // Subfunción 0x02: la ECU no debe responder.
        if (args[0] === 0x02) return [];
        return positive();

      case 0x20: // stopDiagnosticSession
        this.kwp.session = 0x81;
        return positive();

      case 0x1a: { // readEcuIdentification
        const id = args[0];
        if (id === undefined) return negative(0x12);
        const text = id === 0x9b ? this.profile.ecuName
          : id === 0x94 ? this.profile.calId
          : id === 0x90 ? this.profile.vin
          : null;
        if (text === null) return negative(0x31);
        const chars = Array.from(new TextEncoder().encode(text), (b) => b);
        return positive([id, ...chars]);
      }

      case 0x21: { // readDataByLocalIdentifier
        const id = args[0];
        if (id === undefined) return negative(0x12);
        // 0x30: bloque con el intervalo de servicio.
        if (id === 0x30) {
          const km = Math.round(this.kwp.serviceDistanceKm / 100);
          return positive([id, km >> 8, km & 0xff, this.kwp.serviceDays]);
        }
        return negative(0x31);
      }

      case 0x3b: { // writeDataByLocalIdentifier
        const id = args[0];
        if (id === undefined) return negative(0x12);
        // Escribir exige sesión extendida. Es la condición que más se
        // olvida y la que hace fallar las rutinas en la práctica.
        if (!extended) return negative(0x80);
        if (id !== 0x30) return negative(0x31);
        this.kwp.serviceDistanceKm = 15000;
        this.kwp.serviceDays = 365;
        this.kwp.serviceResets += 1;
        return positive([id]);
      }

      case 0x31: { // startRoutineByLocalIdentifier
        if (!extended) return negative(0x80);
        const routine = args[0];
        if (routine === undefined) return negative(0x12);
        // Una rutina que exige el motor detenido: si gira, condiciones
        // no cumplidas. Sirve para probar el manejo de ese caso.
        if (this.state.rpm > 100) return negative(0x22);
        return positive([routine]);
      }

      case 0x22: { // readDataByIdentifier (UDS)
        const destino = this.direccionada();
        const mapa = destino === 'segunda' ? this.profile.segunda?.uds : this.profile.uds;
        if (destino === 'nadie' || !mapa) return ['NO DATA'];
        const did = argHex.slice(0, 4).toUpperCase();
        const texto = mapa[did];
        const ecu = destino === 'segunda' ? 'segunda' : 'principal';
        if (texto === undefined) return this.frame(['7F', '22', '31'], ecu);
        const chars = Array.from(new TextEncoder().encode(texto), (b) => byte(b));
        return this.frame(['62', did.slice(0, 2), did.slice(2, 4), ...chars], ecu);
      }

      case 0x27: // securityAccess
        return negative(0x33);

      default:
        return negative(0x11); // servicio no soportado
    }
  }

  /** Cuántas veces se reinició el intervalo de servicio. Para los tests. */
  get serviceResetCount(): number {
    return this.kwp.serviceResets;
  }

  /** Sesión de diagnóstico activa. Para los tests. */
  get kwpSession(): number {
    return this.kwp.session;
  }

  /**
   * Modo 01 con varios PID en una misma solicitud.
   *
   * SAE J1979 lo permite hasta seis sobre CAN. El simulador lo soporta solo
   * en los perfiles CAN, igual que un vehículo real: en K-Line la trama no
   * da el largo necesario y la ECU no contesta.
   */
  private mode01Multiple(pids: string[]): string[] {
    const isCan = Number(this.profile.protocolNumber) >= 6;
    if (!isCan || pids.length > 6) return ['NO DATA'];

    const salida: string[] = [];
    for (const pid of pids) {
      if (!this.profile.supportedPids.includes(pid)) continue;
      const bytes = this.pidValue(pid);
      if (!bytes) continue;
      salida.push(pid, ...bytes);
    }
    if (salida.length === 0) return ['NO DATA'];
    return this.frame(['41', ...salida]);
  }

  private mode01(pid: string): string[] {
    if (/^([02468ACE]0|00)$/.test(pid) || pid === '20' || pid === '40' ||
        pid === '60' || pid === '80' || pid === 'A0' || pid === 'C0') {
      const bitmap = this.supportBitmap(pid);
      if (!bitmap) return ['NO DATA'];
      const lineas = this.frame(['41', pid, ...bitmap]);
      // La segunda unidad también contesta el bloque inicial.
      if (pid === '00' && this.profile.segunda && this.direccionada() === 'todas') {
        const bits = new Uint8Array(4);
        for (const pp of this.profile.segunda.supportedPids) {
          const idx = parseInt(pp, 16) - 1;
          if (idx >= 0 && idx < 32) bits[idx >> 3] = (bits[idx >> 3] ?? 0) | (0x80 >> (idx & 7));
        }
        lineas.push(...this.frame(['41', '00', ...Array.from(bits, (b) => byte(b))], 'segunda'));
      }
      return lineas;
    }
    if (!this.profile.supportedPids.includes(pid)) return ['NO DATA'];
    const bytes = this.pidValue(pid);
    if (!bytes) return ['NO DATA'];
    return this.frame(['41', pid, ...bytes]);
  }

  /** Bitmap de 4 bytes: bit más significativo = primer PID del rango. */
  private supportBitmap(basePid: string): string[] | null {
    const base = parseInt(basePid, 16);
    const bits = new Uint8Array(4);
    let any = false;
    for (let i = 0; i < 32; i++) {
      const target = base + i + 1;
      const key = target.toString(16).toUpperCase().padStart(2, '0');
      if (this.profile.supportedPids.includes(key)) {
        bits[i >> 3] = (bits[i >> 3] ?? 0) | (0x80 >> (i & 7));
        any = true;
      }
    }
    // El bit 32 indica "el siguiente rango también está soportado".
    const nextBase = base + 0x20;
    if (nextBase <= 0xc0) {
      const hasNext = this.profile.supportedPids.some((p) => {
        const v = parseInt(p, 16);
        return v > nextBase && v <= nextBase + 0x20;
      });
      if (hasNext) {
        bits[3] = (bits[3] ?? 0) | 0x01;
        any = true;
      }
    }
    if (!any && base !== 0) return null;
    return Array.from(bits, (b) => b.toString(16).toUpperCase().padStart(2, '0'));
  }

  private pidValue(pid: string): string[] | null {
    const s = this.state;
    const u8 = (v: number): string[] => [byte(v)];
    const u16 = (v: number): string[] => {
      const n = clamp(Math.round(v), 0, 0xffff);
      return [byte(n >> 8), byte(n & 0xff)];
    };
    switch (pid) {
      case '01': {
        // Byte A: testigo de avería y cantidad de códigos confirmados.
        // Bytes B, C y D: estado de los monitores, propio de cada perfil.
        const stored = this.activeDtcs('stored').length;
        const a = (stored > 0 ? 0x80 : 0x00) | stored;
        const [b, c, d] = this.profile.readiness;
        return [byte(a), byte(b), byte(c), byte(d)];
      }
      case '03': return ['02', '00']; // lazo cerrado, banco 1
      case '04': return u8(Math.round((s.loadPct * 255) / 100));
      case '05': return u8(Math.round(s.coolantC + 40));
      case '06': return u8(Math.round(s.stftPct * 1.28 + 128));
      case '07': return u8(Math.round(s.ltftPct * 1.28 + 128));
      case '0B': return u8(Math.round(s.mapKpa));
      case '0C': return u16(s.rpm * 4);
      case '0D': return u8(Math.round(s.speedKmh));
      case '0E': return u8(Math.round(s.timingAdvance * 2 + 128));
      case '0F': return u8(Math.round(s.iatC + 40));
      case '10': return u16(s.mafGs * 100);
      case '11': return u8(Math.round((s.throttlePct * 255) / 100));
      case '13': return ['03', '00'];
      case '1C': return ['06', '00'];
      case '1F': return u16(Math.round(s.t));
      case '21': return u16(0);
      case '23': return u16(Math.round(s.railBarActual * 10));
      case '2F': return u8(Math.round((62 * 255) / 100));
      case '31': return u16(Math.round(s.t * 0.004));
      case '33': return u8(Math.round(s.baroKpa));
      case '42': return u16(s.voltage * 1000);
      case '46': return u8(Math.round(s.iatC + 40));
      case '4D': return u16(Math.round(s.t / 60));
      case '51': return [this.profile.fuel === 'diesel' ? '04' : '01'];
      case '5C': return u8(Math.round(s.coolantC + 8 + 40));
      case '62': return u8(Math.round(s.loadPct * 1.2) + 125);
      case '70': return this.boostBytes();
      case '78': return this.egtBytes();
      case '7A': return this.dpfPressureBytes();
      case '7C': return this.dpfTempBytes();
      default: return null;
    }
  }

  /**
   * PID 70: presión de sobrealimentación solicitada y real.
   *
   * Máscara 0x03 = los dos primeros campos presentes, escala 0.03125 kPa.
   * Es la convención que usa el decodificador; el layout real de este PID
   * varía entre fabricantes y está marcado como no verificado.
   */
  private boostBytes(): string[] {
    const s = this.state;
    const enc = (mbar: number): string[] => {
      const n = clamp(Math.round((mbar / 10) / 0.03125), 0, 0xffff);
      return [byte(n >> 8), byte(n & 0xff)];
    };
    return ['03', ...enc(s.boostMbarTarget), ...enc(s.boostMbarActual), '00', '00'];
  }

  private egtBytes(): string[] {
    const enc = (c: number): string[] => {
      const n = clamp(Math.round((c + 40) * 10), 0, 0xffff);
      return [byte(n >> 8), byte(n & 0xff)];
    };
    return ['01', ...enc(this.state.dpfInletC), '00', '00', '00', '00', '00', '00'];
  }

  /** PID 7A: presión diferencial del DPF. Escala 0.01 kPa, offset -327.68 kPa. */
  private dpfPressureBytes(): string[] {
    const kpa = this.state.dpfDiffMbar / 10;
    const n = clamp(Math.round((kpa + 327.68) / 0.01), 0, 0xffff);
    return ['18', '00', '00', byte(n >> 8), byte(n & 0xff), '00', '00', '00', '00'];
  }

  /** PID 7C: temperaturas de entrada y salida del DPF. */
  private dpfTempBytes(): string[] {
    const enc = (c: number): string[] => {
      const n = clamp(Math.round((c + 40) * 10), 0, 0xffff);
      return [byte(n >> 8), byte(n & 0xff)];
    };
    const s = this.state;
    return ['09', ...enc(s.dpfInletC), ...enc(s.dpfOutletC), '00', '00', '00', '00'];
  }

  private activeDtcs(kind: 'stored' | 'pending' | 'permanent') {
    if (this.clearedAt !== null && kind !== 'permanent') return [];
    return this.profile.dtcs.filter((d) => d.kind === kind);
  }

  /**
   * Modo 02: datos congelados.
   *
   * Solo hay trama si existe un código almacenado. Los valores son los que
   * había al momento de guardarlo, no los actuales: por eso el perfil fija
   * una foto propia en lugar de reusar el estado vivo.
   */
  private mode02(pid: string, frameHex: string): string[] {
    const frame = frameHex === '' ? 0 : parseInt(frameHex, 16);
    if (frame !== 0) return ['NO DATA'];
    const almacenados = this.activeDtcs('stored');
    if (almacenados.length === 0) return ['NO DATA'];

    // PID 02 del modo 02: el código que disparó la foto.
    if (pid === '02') {
      const codigo = almacenados[0]?.code ?? 'P0000';
      return this.frame(['42', '02', '00', ...encodeDtc(codigo)]);
    }

    // La foto: régimen y carga más altos que el ralentí actual, porque la
    // falla se registró conduciendo.
    const foto: Record<string, string[]> = {
      '04': ['6E'],              // 43 % de carga
      '05': ['67'],              // 63 °C
      '0C': ['1F', '40'],        // 2000 rpm
      '0D': ['3C'],              // 60 km/h
      '0F': ['44'],              // 28 °C
      '10': ['04', 'B0'],        // 12 g/s
      '11': ['38'],              // 22 % de mariposa
      '0B': ['60'],              // 96 kPa
    };
    const bytes = foto[pid];
    if (!bytes) return ['NO DATA'];
    return this.frame(['42', pid, '00', ...bytes]);
  }

  private mode03(): string[] {
    return this.dtcDeTodas('43', 'stored');
  }

  private mode07(): string[] {
    return this.dtcDeTodas('47', 'pending');
  }

  private mode0A(): string[] {
    return this.dtcDeTodas('4A', 'permanent');
  }

  /** Cada unidad del bus informa sus propios códigos, en líneas separadas. */
  private dtcDeTodas(mode: string, kind: 'stored' | 'pending' | 'permanent'): string[] {
    const principal = this.dtcResponse(mode, this.activeDtcs(kind).map((d) => d.code));
    const seg = this.profile.segunda;
    if (!seg) return principal;
    const codigos = this.clearedAt !== null && kind !== 'permanent'
      ? [] : seg.dtcs.filter((d) => d.kind === kind).map((d) => d.code);
    const segunda = this.dtcResponse(mode, codigos, 'segunda');
    const utiles = (l: string[]): string[] => l.filter((x) => x !== 'NO DATA');
    const todo = [...utiles(principal), ...utiles(segunda)];
    return todo.length > 0 ? todo : ['NO DATA'];
  }

  /** A quién va dirigida la solicitud según ATSH. */
  private direccionada(): 'todas' | 'principal' | 'segunda' | 'nadie' {
    const sh = this.flags.sh.toUpperCase();
    if (sh === '' || sh === '7DF') return 'todas';
    if (sh === '7E0') return 'principal';
    if (sh === '7E1') return this.profile.segunda ? 'segunda' : 'nadie';
    // En K-Line la cabecera lleva formato, destino y origen.
    if (sh.length === 6) return 'principal';
    return 'nadie';
  }

  /**
   * CAN lleva un byte de cantidad después del modo; KWP/ISO9141 no, y rellena
   * con 00 00 hasta completar tres DTC por trama. Esa diferencia es real y el
   * parser tiene que tolerar ambas.
   */
  private dtcResponse(mode: string, codes: string[],
                      ecu: 'principal' | 'segunda' = 'principal'): string[] {
    const isCan = Number(this.profile.protocolNumber) >= 6;
    const payload = codes.flatMap(encodeDtc);
    if (isCan) {
      if (codes.length === 0) return this.frame([mode, '00'], ecu);
      return this.frame([mode, byte(codes.length), ...payload], ecu);
    }
    if (codes.length === 0) return ['NO DATA'];
    const padded = [...payload];
    while (padded.length % 6 !== 0) padded.push('00');
    const lines: string[] = [];
    for (let i = 0; i < padded.length; i += 6) {
      lines.push(...this.frame([mode, ...padded.slice(i, i + 6)], ecu));
    }
    return lines;
  }

  /**
   * Modo 09: identificación. VIN, calibraciones, CVN y nombre de ECU.
   * En CAN va como un mensaje ISO-TP; en K-Line, en trozos con byte de orden.
   */
  private mode09(pid: string): string[] {
    const isCan = Number(this.profile.protocolNumber) >= 6;
    const ascii = (t: string, largo: number): string[] => {
      const b = Array.from(new TextEncoder().encode(t.slice(0, largo)), (x) => byte(x));
      while (b.length < largo) b.push('00');
      return b;
    };
    const emitir = (datos: string[], ecu: 'principal' | 'segunda'): string[] =>
      isCan ? this.frame(['49', pid, '01', ...datos], ecu)
        : this.largaLegacy('49', pid, datos, ecu);

    if (pid === '00') {
      const bits = new Uint8Array(4);
      for (const p of ['02', '04', '06', '0A']) {
        const idx = parseInt(p, 16) - 1;
        bits[idx >> 3] = (bits[idx >> 3] ?? 0) | (0x80 >> (idx & 7));
      }
      return this.frame(['49', '00', ...Array.from(bits, (b) => byte(b))]);
    }

    const seg = this.profile.segunda;
    const lineas: string[] = [];
    switch (pid) {
      case '02':
        if (this.profile.vin === null) return ['NO DATA'];
        return emitir(ascii(this.profile.vin, 17), 'principal');
      case '04':
        if (this.profile.calId !== null) lineas.push(...emitir(ascii(this.profile.calId, 16), 'principal'));
        if (seg) lineas.push(...emitir(ascii(seg.calId, 16), 'segunda'));
        break;
      case '06':
        if (this.profile.cvn) lineas.push(...emitir(this.profile.cvn.map((b) => byte(b)), 'principal'));
        break;
      case '0A':
        if (this.profile.ecuName !== null) lineas.push(...emitir(ascii(this.profile.ecuName, 20), 'principal'));
        if (seg) lineas.push(...emitir(ascii(seg.ecuName, 20), 'segunda'));
        break;
    }
    return lineas.length > 0 ? lineas : ['NO DATA'];
  }

  /**
   * Modo 06: resultados de los autodiagnósticos, solo en CAN.
   * Cada registro: MID, TID, unidad, valor, mínimo y máximo.
   */
  private mode06(mid: string): string[] {
    const isCan = Number(this.profile.protocolNumber) >= 6;
    const tests = this.profile.mode06 ?? [];
    if (!isCan || tests.length === 0) return ['NO DATA'];
    const n = parseInt(mid, 16);

    if (n % 0x20 === 0) {
      const bits = new Uint8Array(4);
      let alguno = false;
      for (const t of tests) {
        const idx = t.mid - n - 1;
        if (idx >= 0 && idx < 32) { bits[idx >> 3] = (bits[idx >> 3] ?? 0) | (0x80 >> (idx & 7)); alguno = true; }
      }
      if (tests.some((t) => t.mid > n + 0x20)) { bits[3] = (bits[3] ?? 0) | 0x01; alguno = true; }
      if (!alguno) return ['NO DATA'];
      return this.frame(['46', mid, ...Array.from(bits, (b) => byte(b))]);
    }

    const propios = tests.filter((t) => t.mid === n);
    if (propios.length === 0) return ['NO DATA'];
    const w = (v: number): string[] => [byte(v >> 8), byte(v & 0xff)];
    const datos = propios.flatMap((t) => [
      byte(t.mid), byte(t.tid), byte(t.uas), ...w(t.value), ...w(t.min), ...w(t.max),
    ]);
    return this.frame(['46', ...datos]);
  }

  /**
   * Arma las líneas tal como las emite un ELM327 real.
   *
   * Con ATH1 el chip entrega tramas crudas del bus:
   *  - CAN: identificador, byte PCI de ISO-TP y datos. Lo que no entra en
   *    una trama sale partido en primera + consecutivas, sin reensamblar.
   *  - K-Line: tres bytes de cabecera, datos y el checksum al final.
   * Con ATH0 el chip oculta todo eso y, en CAN, numera las líneas largas.
   */
  private frame(bytes: string[], ecu: 'principal' | 'segunda' = 'principal'): string[] {
    const isCan = Number(this.profile.protocolNumber) >= 6;
    const unir = (partes: string[]): string =>
      this.flags.spaces ? partes.join(' ') : partes.join('');

    if (isCan) {
      const id = ecu === 'principal' ? '7E8' : '7E9';
      if (this.flags.headers) {
        if (bytes.length <= 7) return [unir([id, byte(bytes.length), ...bytes])];
        const lineas = [unir([
          id, byte(0x10 | (bytes.length >> 8)), byte(bytes.length & 0xff),
          ...bytes.slice(0, 6),
        ])];
        for (let i = 6, n = 1; i < bytes.length; i += 7, n++) {
          const trozo = bytes.slice(i, i + 7);
          while (trozo.length < 7) trozo.push('00');
          lineas.push(unir([id, byte(0x20 | (n & 0x0f)), ...trozo]));
        }
        return lineas;
      }
      if (bytes.length <= 7) return [unir(bytes)];
      const lineas = [bytes.length.toString(16).toUpperCase().padStart(3, '0')];
      for (let i = 0, n = 0; i < bytes.length; i += n === 0 ? 6 : 7, n++) {
        const trozo = bytes.slice(i, i + (n === 0 ? 6 : 7));
        lineas.push(`${(n & 0x0f).toString(16).toUpperCase()}: ${unir(trozo)}`);
      }
      return lineas;
    }

    if (!this.flags.headers) return [unir(bytes)];
    const origen = ecu === 'principal' ? '10' : '18';
    // KWP2000 lleva el largo en el byte de formato; ISO 9141 usa 48 6B.
    const cabecera = this.profile.protocolNumber === '3'
      ? ['48', '6B', origen]
      : [byte(0x80 | bytes.length), 'F1', origen];
    const todo = [...cabecera, ...bytes];
    const suma = todo.reduce((a, h) => (a + parseInt(h, 16)) & 0xff, 0);
    return [unir([...todo, byte(suma)])];
  }

  /**
   * Respuesta larga en K-Line: una línea por trozo de cuatro bytes, cada
   * una con su byte de orden. Así llegan el VIN y las calibraciones.
   */
  private largaLegacy(modo: string, pid: string, datos: string[],
                      ecu: 'principal' | 'segunda' = 'principal'): string[] {
    const relleno = [...datos];
    while (relleno.length % 4 !== 0) relleno.unshift('00');
    const lineas: string[] = [];
    for (let i = 0, n = 1; i < relleno.length; i += 4, n++) {
      lineas.push(...this.frame([modo, pid, byte(n), ...relleno.slice(i, i + 4)], ecu));
    }
    return lineas;
  }
}

function bytesOf(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    out.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

const byte = (v: number): string =>
  clamp(Math.round(v), 0, 255).toString(16).toUpperCase().padStart(2, '0');

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/** 'P0171' -> ['01','71']. Dos bits de letra, dos de primer dígito. */
export function encodeDtc(code: string): string[] {
  const letters = { P: 0, C: 1, B: 2, U: 3 } as const;
  const letter = letters[code[0] as keyof typeof letters] ?? 0;
  const d1 = parseInt(code[1] ?? '0', 16) & 0x3;
  const rest = parseInt(code.slice(2), 16) & 0xfff;
  const a = (letter << 6) | (d1 << 4) | ((rest >> 8) & 0xf);
  const b = rest & 0xff;
  return [byte(a), byte(b)];
}
