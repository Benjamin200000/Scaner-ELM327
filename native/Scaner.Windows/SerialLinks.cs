using System.IO.Ports;
using System.Diagnostics;
using System.Text;
using Scaner.Core;

namespace Scaner.Windows;

public sealed class ElmSerialLink : IDiagnosticLink
{
    private readonly SerialPort port;
    public string Description => $"ELM327 · {port.PortName} · {port.BaudRate} baudios";
    public bool IsSimulation => false;
    private bool can;
    public bool SupportsCanMode06 => can;
    private ElmSerialLink(string name, int baud) { port = new(name, baud) { ReadTimeout = 200, WriteTimeout = 2000, NewLine = "\r", DtrEnable = true, RtsEnable = true }; }
    public static async Task<ElmSerialLink> Open(string name, int baud, CancellationToken ct = default)
    {
        var link = new ElmSerialLink(name, baud);
        try
        {
            await Task.Run(() => link.port.Open(), ct);
            await link.Command("ATZ", ct);
            foreach (var command in new[] { "ATE0", "ATL0", "ATS1", "ATH1", "ATSP0", "ATCAF1", "ATAT1" })
            {
                var answer = await link.Command(command, ct);
                if (!answer.Contains("OK", StringComparison.OrdinalIgnoreCase)) throw new DiagnosticException($"El adaptador rechazó {command}: {answer.Trim()}");
            }
            return link;
        }
        catch { await link.DisposeAsync(); throw; }
    }
    public Task<string> Command(string command, CancellationToken ct = default) => Task.Run(() =>
    {
        port.DiscardInBuffer(); port.Write(command + "\r");
        var buffer = new StringBuilder(); var timer = Stopwatch.StartNew();
        while (timer.Elapsed < TimeSpan.FromSeconds(20))
        {
            ct.ThrowIfCancellationRequested();
            try { int b = port.ReadChar(); if (b == '>') return buffer.ToString(); buffer.Append((char)b); if (buffer.Length > 128 * 1024) throw new DiagnosticException("Respuesta ELM demasiado grande"); } catch (TimeoutException) { }
        }
        throw new TimeoutException("El ELM327 no respondió al prompt; revisar COM, Bluetooth y baud rate");
    }, ct);
    public async Task<IReadOnlyList<EcuReply>> RequestAsync(byte[] request, CancellationToken cancellation = default)
    {
        var raw = await Command(Convert.ToHexString(request), cancellation);
        var replies = ElmFrames.Parse(raw);
        if (replies.Count > 0) can = replies.All(r => r.HasDtcCount);
        return replies;
    }
    public ValueTask DisposeAsync() { port.Dispose(); return ValueTask.CompletedTask; }
}

/// <summary>KKL is a serial K-line interface, not the proprietary Ross-Tech HEX protocol.</summary>
public sealed class KklSession : IAsyncDisposable
{
    private readonly SerialPort port;
    private byte? counter;
    public string Identification { get; private set; } = "";
    public int Version { get; private set; }
    public KklSession(string name, int baud) { port = new(name, baud) { ReadTimeout = 1500, WriteTimeout = 1000, DtrEnable = true, RtsEnable = true }; }
    public Task Open(byte address, CancellationToken ct) => Task.Run(() =>
    {
        port.Open(); port.DiscardInBuffer();
        byte value = (byte)(address & 0x7F);
        if (System.Numerics.BitOperations.PopCount(value) % 2 == 0) value |= 128;
        void Bit(bool high) { ct.ThrowIfCancellationRequested(); port.BreakState = !high; Thread.Sleep(200); }
        try
        {
            Bit(false); for (int i = 0; i < 8; i++) Bit((value & (1 << i)) != 0); Bit(true);
            if (Read(ct) != 0x55) throw new DiagnosticException("Sin sincronización K-Line 0x55; revisar cable, contacto y baud rate");
            byte low = Read(ct), high = Read(ct); Version = ((high & 127) << 7) + (low & 127);
            if (Version != 1281) throw new DiagnosticException($"La ECU anunció protocolo {Version}; esta sesión KKL implementa KW1281");
            Thread.Sleep(25); Write((byte)~high, ct);
            Identification = string.Join("\r\n", ReceiveUntilAck(ct).Where(b => b[2] == 0xF6).Select(b => Encoding.ASCII.GetString(b[3..]).Trim()));
        }
        catch { port.BreakState = false; port.Dispose(); throw; }
    }, ct);
    private byte Read(CancellationToken ct) { ct.ThrowIfCancellationRequested(); return (byte)port.ReadByte(); }
    private void Write(byte value, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested(); port.Write([value], 0, 1);
        byte echo = Read(ct);
        if (echo != value) throw new DiagnosticException($"Eco KKL incorrecto: esperado {value:X2}, recibido {echo:X2}");
    }
    private void Send(byte title, byte[] data, CancellationToken ct)
    {
        Thread.Sleep(25);
        if (counter is null) throw new DiagnosticException("No se ha recibido el contador inicial de la ECU");
        counter = unchecked((byte)(counter.Value + 1));
        byte[] block = [checked((byte)(data.Length + 3)), counter.Value, title, .. data];
        foreach (var b in block) { Write(b, ct); if (Read(ct) != (byte)~b) throw new DiagnosticException("Complemento KW1281 incorrecto"); Thread.Sleep(2); }
        Write(3, ct);
    }
    private byte[] Receive(CancellationToken ct)
    {
        byte Ack() { var b = Read(ct); Thread.Sleep(2); Write((byte)~b, ct); return b; }
        int size = Ack(); if (size < 3 || size > 255) throw new DiagnosticException("Longitud KW1281 inválida");
        byte[] block = new byte[size]; block[0] = (byte)size;
        for (int i = 1; i < size; i++) block[i] = Ack();
        if (Read(ct) != 3) throw new DiagnosticException("Final KW1281 inválido");
        var expected = counter is byte previous ? unchecked((byte)(previous + 1)) : block[1];
        if (block[1] != expected) throw new DiagnosticException($"Contador KW1281 fuera de secuencia: {block[1]:X2} / {expected:X2}");
        counter = block[1]; return block;
    }
    private List<byte[]> ReceiveUntilAck(CancellationToken ct)
    {
        var blocks = new List<byte[]>();
        for (int i = 0; i < 64; i++)
        {
            var block = Receive(ct); if (block[2] == 9) return blocks;
            if (block[2] == 0x0A) throw new DiagnosticException("ECU respondió NAK KW1281");
            blocks.Add(block); Send(9, [], ct);
        }
        throw new DiagnosticException("La ECU no terminó los bloques KW1281");
    }
    public Task<IReadOnlyList<string>> ReadGroup(byte group, CancellationToken ct) => Task.Run<IReadOnlyList<string>>(() =>
    {
        Send(0x29, [group], ct);
        var output = new List<string>();
        foreach (var b in ReceiveUntilAck(ct).Where(b => b[2] == 0xE7))
            for (int i = 3; i + 2 < b.Length; i += 3) output.Add(Measurement(b[i], b[i + 1], b[i + 2]));
        return output;
    }, ct);
    public Task<IReadOnlyList<string>> Faults(CancellationToken ct) => Task.Run<IReadOnlyList<string>>(() =>
    {
        Send(7, [], ct); var output = new List<string>();
        foreach (var b in ReceiveUntilAck(ct).Where(b => b[2] == 0xFC))
            for (int i = 3; i + 2 < b.Length; i += 3) { int code = b[i] * 256 + b[i + 1]; if (code != 0 && code != 65535) output.Add($"{code:D5} · estado {b[i + 2]:X2} · {((b[i + 2] & 128) != 0 ? "esporádica" : "presente")}"); }
        return output;
    }, ct);
    public Task KeepAlive(CancellationToken ct) => Task.Run(() => { Send(9, [], ct); ReceiveUntilAck(ct); }, ct);
    private static string Measurement(byte code, byte a, byte b) => $"{KklMeasurements.Decode(code, a, b).Text} [crudo {code:X2} {a:X2} {b:X2}]";
    public ValueTask DisposeAsync() { port.Dispose(); return ValueTask.CompletedTask; }
}
