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
}

interface ElmFlags {
  echo: boolean;
  linefeed: boolean;
  spaces: boolean;
  headers: boolean;
  protocol: string;
}

const CR = '\r';
const PROMPT = '>';

export class Elm327Simulator {
  private readonly profile: SimProfile;
  private readonly latencyMs: number;
  private readonly version: string;
  private ecuSilent: boolean;
  private state: SimEngineState;
  private flags: ElmFlags;
  private clearedAt: number | null = null;

  constructor(opts: SimOptions = {}) {
    this.profile = opts.profile ?? golf20_8v;
    this.latencyMs = opts.latencyMs ?? 40;
    this.version = opts.version ?? 'ELM327 v1.5';
    this.ecuSilent = opts.ecuSilent ?? false;
    this.state = this.profile.initial();
    this.flags = this.defaultFlags();
  }

  private defaultFlags(): ElmFlags {
    return { echo: true, linefeed: true, spaces: true, headers: false, protocol: '0' };
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
    if (/^SH[0-9A-F]{3,6}$/.test(arg)) return ['OK'];
    if (/^(WM|SW|IIA|SR|CRA|CF|CM)/.test(arg)) return ['OK'];
    return ['?'];
  }

  private obdCommand(hex: string): string[] {
    if (this.ecuSilent) return ['NO DATA'];
    const mode = hex.slice(0, 2);
    const pid = hex.slice(2, 4);
    switch (mode) {
      case '01':
        return this.mode01(pid);
      case '03':
        return this.mode03();
      case '04':
        this.clearedAt = Date.now();
        return ['44'];
      case '07':
        return this.mode07();
      case '09':
        return this.mode09(pid);
      case '0A':
        return this.mode0A();
      default:
        // Un ELM327 real devuelve esto cuando la ECU rechaza el servicio.
        return ['NO DATA'];
    }
  }

  private mode01(pid: string): string[] {
    if (/^([02468ACE]0|00)$/.test(pid) || pid === '20' || pid === '40' ||
        pid === '60' || pid === '80' || pid === 'A0' || pid === 'C0') {
      const bitmap = this.supportBitmap(pid);
      if (!bitmap) return ['NO DATA'];
      return [this.frame(['41', pid, ...bitmap])];
    }
    if (!this.profile.supportedPids.includes(pid)) return ['NO DATA'];
    const bytes = this.pidValue(pid);
    if (!bytes) return ['NO DATA'];
    return [this.frame(['41', pid, ...bytes])];
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
        // MIL + cantidad de DTC confirmados.
        const stored = this.activeDtcs('stored').length;
        const a = (stored > 0 ? 0x80 : 0x00) | stored;
        return [byte(a), '07', 'E5', '00'];
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

  private mode03(): string[] {
    return this.dtcResponse('43', this.activeDtcs('stored').map((d) => d.code));
  }

  private mode07(): string[] {
    return this.dtcResponse('47', this.activeDtcs('pending').map((d) => d.code));
  }

  private mode0A(): string[] {
    return this.dtcResponse('4A', this.activeDtcs('permanent').map((d) => d.code));
  }

  /**
   * CAN lleva un byte de cantidad después del modo; KWP/ISO9141 no, y rellena
   * con 00 00 hasta completar tres DTC por trama. Esa diferencia es real y el
   * parser tiene que tolerar ambas.
   */
  private dtcResponse(mode: string, codes: string[]): string[] {
    const isCan = Number(this.profile.protocolNumber) >= 6;
    const payload = codes.flatMap(encodeDtc);
    if (isCan) {
      if (codes.length === 0) return [this.frame([mode, '00'])];
      return [this.frame([mode, byte(codes.length), ...payload])];
    }
    if (codes.length === 0) return ['NO DATA'];
    const padded = [...payload];
    while (padded.length % 6 !== 0) padded.push('00');
    const lines: string[] = [];
    for (let i = 0; i < padded.length; i += 6) {
      lines.push(this.frame([mode, ...padded.slice(i, i + 6)]));
    }
    return lines;
  }

  /** Modo 09: respuestas largas, que el ELM327 parte en líneas numeradas. */
  private mode09(pid: string): string[] {
    const text = pid === '02' ? this.profile.vin
      : pid === '0A' ? this.profile.ecuName
      : pid === '04' ? this.profile.calId
      : null;
    if (pid === '00') {
      const bits = new Uint8Array(4);
      for (const p of ['02', '04', '0A']) {
        const idx = parseInt(p, 16) - 1;
        if (idx >= 0 && idx < 32) bits[idx >> 3] = (bits[idx >> 3] ?? 0) | (0x80 >> (idx & 7));
      }
      return [this.frame(['49', '00',
        ...Array.from(bits, (b) => byte(b))])];
    }
    if (text === null) return ['NO DATA'];
    const chars = Array.from(new TextEncoder().encode(text), (b) => byte(b));
    const payload = ['49', pid, '01', ...chars];
    // El chip anuncia el largo total y numera las líneas de 7 bytes.
    const lines: string[] = [byte(payload.length).padStart(3, '0')];
    for (let i = 0, n = 0; i < payload.length; i += 7, n++) {
      const slice = payload.slice(i, i + 7);
      while (slice.length < 7) slice.push('00');
      lines.push(`${n.toString(16).toUpperCase()}:${this.flags.spaces ? ' ' : ''}${
        this.flags.spaces ? slice.join(' ') : slice.join('')}`);
    }
    return lines;
  }

  /**
   * Aplica ATH y ATS al armar la trama, como hace el chip.
   *
   * El checksum de KWP no se incluye a propósito: un ELM327 real lo valida
   * y lo descarta, no lo entrega al host.
   */
  private frame(bytes: string[]): string {
    const isCan = Number(this.profile.protocolNumber) >= 6;
    const out = this.flags.headers
      ? isCan
        ? ['7E8', byte(bytes.length), ...bytes]
        : ['48', '6B', '10', ...bytes]
      : bytes;
    return this.flags.spaces ? out.join(' ') : out.join('');
  }
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
