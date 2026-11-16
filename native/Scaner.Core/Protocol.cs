using System.Globalization;
using System.Text;

namespace Scaner.Core;

public record EcuReply(uint Address, byte[] Data, bool HasDtcCount = true);
public interface IDiagnosticLink : IAsyncDisposable
{
    string Description { get; }
    bool IsSimulation { get; }
    bool SupportsCanMode06 => true;
    Task<IReadOnlyList<EcuReply>> RequestAsync(byte[] request, CancellationToken cancellation = default);
}
public static class Hex
{
    public static byte[] Parse(string value) => Convert.FromHexString(string.Concat(value.Where(c => !char.IsWhiteSpace(c))));
    public static uint Number(string value) => uint.Parse(value.Trim().Replace("0x", "", StringComparison.OrdinalIgnoreCase), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
    public static string Dump(byte[] data, uint origin = 0) => string.Join(Environment.NewLine,
        data.Chunk(16).Select((row, i) => $"{(origin + i * 16):X8}  {Convert.ToHexString(row).Chunk(2).Select(c => new string(c)).Aggregate("", (a, b) => a + b + " ").PadRight(48)} {new string(row.Select(b => b >= 32 && b < 127 ? (char)b : '.').ToArray())}"));
}
public sealed class DiagnosticException(string message) : Exception(message);

/// <summary>CAN ISO-TP frames are reassembled per ECU, never concatenated across responders.</summary>
public static class ElmFrames
{
    public static IReadOnlyList<EcuReply> Parse(string response)
    {
        var completed = new List<EcuReply>();
        var pending = new Dictionary<uint, (int Length, int Sequence, List<byte> Bytes)>();
        foreach (var raw in response.Replace(">", "").Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            var text = raw.Trim();
            if (text.Contains("NO DATA", StringComparison.OrdinalIgnoreCase)) continue;
            if (new[] { "STOPPED", "UNABLE TO CONNECT", "CAN ERROR", "BUS ERROR", "BUFFER FULL", "?" }.Any(x => text.Contains(x, StringComparison.OrdinalIgnoreCase)))
                throw new DiagnosticException(text);
            var line = string.Concat(text.Where(c => !char.IsWhiteSpace(c)));
            if (line.Length < 5 || !line.All(Uri.IsHexDigit)) continue;
            uint address;
            byte[] frame;
            // 11-bit CAN has a 3-digit header; 29-bit CAN has an 8-digit header.
            if (line.Length % 2 == 1) { address = Hex.Number(line[..3]); frame = Hex.Parse(line[3..]); }
            else if (line.StartsWith("18DA", StringComparison.OrdinalIgnoreCase) || line.StartsWith("18DB", StringComparison.OrdinalIgnoreCase))
            { address = Hex.Number(line[..8]); frame = Hex.Parse(line[8..]); }
            else
            {
                // Legacy ISO9141/KWP with 3-byte header and a checksum.
                frame = Hex.Parse(line);
                if (frame.Length < 5) continue;
                var sum = frame[..^1].Sum(b => (int)b) & 255;
                if (sum != frame[^1]) throw new DiagnosticException("Checksum K-Line incorrecto");
                int begin = (frame[0] & 0x80) != 0 && (frame[0] & 0x3F) == 0 ? 4 : 3;
                if (begin == 4 && (frame.Length < 6 || frame[3] != frame.Length - 5)) throw new DiagnosticException("Longitud KWP inválida");
                if ((frame[0] & 0x80) != 0 && (frame[0] & 0x3F) != 0 && (frame[0] & 0x3F) != frame.Length - 4) throw new DiagnosticException("Longitud KWP inválida");
                completed.Add(new(frame[2], frame[begin..^1], false)); continue;
            }
            if (frame.Length == 0) continue;
            switch (frame[0] >> 4)
            {
                case 0:
                    int length = frame[0] & 15;
                    if (length == 0 || length > 7 || frame.Length < length + 1) throw new DiagnosticException("Trama CAN incompleta");
                    completed.Add(new(address, frame[1..(length + 1)])); break;
                case 1:
                    if (frame.Length < 3) throw new DiagnosticException("Primera trama ISO-TP incompleta");
                    var total = ((frame[0] & 15) << 8) | frame[1];
                    if (total <= 7) throw new DiagnosticException("Longitud ISO-TP inválida");
                    pending[address] = (total, 1, frame[2..].ToList()); break;
                case 2:
                    if (!pending.TryGetValue(address, out var p) || (frame[0] & 15) != p.Sequence)
                        throw new DiagnosticException("Secuencia ISO-TP incorrecta");
                    p.Bytes.AddRange(frame[1..]);
                    if (p.Bytes.Count >= p.Length) { completed.Add(new(address, p.Bytes.Take(p.Length).ToArray())); pending.Remove(address); }
                    else pending[address] = (p.Length, (p.Sequence + 1) & 15, p.Bytes);
                    break;
            }
        }
        if (pending.Count > 0) throw new DiagnosticException("Respuesta ISO-TP incompleta");
        return completed;
    }
}

public sealed class SimulatedLink : IDiagnosticLink
{
    public string Description => "SIMULADOR · ECU de prueba · sin vehículo";
    public bool IsSimulation => true;
    private bool cleared;
    private uint uploadAddress;
    private int uploadLength, uploadOffset;
    private byte uploadSequence;
    private bool uploading;
    private byte[] Clear() { cleared = true; return [0x44]; }
    public bool Diesel { get; set; }
    public byte[] Memory { get; } = Enumerable.Range(0, 65536).Select(i => (byte)(i * 17)).ToArray();
    public Task<IReadOnlyList<EcuReply>> RequestAsync(byte[] request, CancellationToken cancellation = default)
    {
        cancellation.ThrowIfCancellationRequested();
        if (request.Length == 0) throw new ArgumentException("Solicitud vacía");
        byte[] result;
        var pid = request.Length > 1 ? request[1] : (byte)0;
        if (request[0] == 1 || request[0] == 2)
        {
            var data = pid switch
            {
                0x00 => Hex.Parse("BE3FA813"),
                0x20 => Hex.Parse("8001A001"),
                0x40 => Hex.Parse("44000000"),
                0x60 => Hex.Parse("00000000"),
                0x01 => Hex.Parse(cleared ? (Diesel ? "000F4848" : "0007E0E0") : (Diesel ? "820F4800" : "8207E000")),
                0x04 => new byte[] { 70 },
                0x05 => new byte[] { 130 },
                0x06 => new byte[] { 132 },
                0x07 => new byte[] { 128 },
                0x0A => new byte[] { 100 },
                0x0B => new byte[] { 100 },
                0x0C => new byte[] { 0x0D, 0x48 },
                0x0D => new byte[] { 0 },
                0x0E => new byte[] { 150 },
                0x0F => new byte[] { 65 },
                0x10 => new byte[] { 1, 120 },
                0x11 => new byte[] { 25 },
                0x1F => new byte[] { 1, 44 },
                0x21 or 0x31 => new byte[] { 0, 20 },
                0x23 => new byte[] { 5, 120 },
                0x2C => new byte[] { 30 },
                0x2D => new byte[] { 128 },
                0x2F => new byte[] { 160 },
                0x33 => new byte[] { 100 },
                0x42 => new byte[] { 0x36, 0xB0 },
                0x43 => new byte[] { 0, 128 },
                0x44 => new byte[] { 0x80, 0 },
                0x46 => new byte[] { 60 },
                0x4D => new byte[] { 0, 10 },
                0x51 => new byte[] { Diesel ? (byte)4 : (byte)1 },
                0x5C => new byte[] { 135 },
                0x5E => new byte[] { 0, 25 },
                0x62 => new byte[] { 145 },
                _ => Array.Empty<byte>()
            };
            result = data.Length == 0 ? [0x7F, request[0], 0x12] : request[0] == 2 ? [0x42, pid, 0, .. data] : [0x41, pid, .. data];
        }
        else result = request[0] switch
        {
            3 => cleared ? [0x43, 0] : [0x43, 2, 0x01, 0x71, 0x03, 0x00],
            7 => [0x47, 0],
            0x0A => [0x4A, 0],
            4 => Clear(),
            9 => pid switch { 2 => [0x49, 2, 1, .. Encoding.ASCII.GetBytes("WVWZZZ1JZXW000001")], 4 => [0x49, 4, 1, .. Encoding.ASCII.GetBytes("SIM-CAL-001")], 6 => [0x49, 6, 1, 0x12, 0x34, 0x56, 0x78], _ => [0x49, pid, 1, .. Encoding.ASCII.GetBytes("ECU SIMULADA")] },
            6 => pid == 0 ? [0x46, 0, 0x80, 0, 0, 0] : [0x46, pid, 1, 1, 0, 5, 0, 1, 0, 10],
            0x10 => [0x50, pid, 0, 50, 0, 200],
            0x3E => [0x7E, 0],
            0x22 => [0x62, .. request[1..], .. Encoding.ASCII.GetBytes("SIM-ECU-001")],
            0x23 => ReadMemory(request),
            0x35 => StartUpload(request),
            0x36 => Transfer(request),
            0x37 => EndUpload(),
            _ => [0x7F, request[0], 0x11]
        };
        return Task.FromResult<IReadOnlyList<EcuReply>>([new(0x7E8, result)]);
    }
    private byte[] StartUpload(byte[] request)
    {
        if (request.Length != 11 || request[1] != 0 || request[2] != 0x44) return [0x7F, 0x35, 0x13];
        uint address = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(request.AsSpan(3, 4));
        uint length = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(request.AsSpan(7, 4));
        if (length == 0 || (ulong)address + length > (ulong)Memory.Length) return [0x7F, 0x35, 0x31];
        uploadAddress = address; uploadLength = (int)length; uploadOffset = 0; uploadSequence = 1; uploading = true; return [0x75, 0x20, 0, 66];
    }
    private byte[] Transfer(byte[] request)
    {
        if (!uploading) return [0x7F, 0x36, 0x24];
        if (request.Length != 2 || request[1] != uploadSequence) return [0x7F, 0x36, 0x73];
        int count = Math.Min(64, uploadLength - uploadOffset);
        byte[] block = [0x76, uploadSequence, .. Memory.AsSpan((int)uploadAddress + uploadOffset, count).ToArray()];
        uploadOffset += count; uploadSequence = unchecked((byte)(uploadSequence + 1)); return block;
    }
    private byte[] EndUpload() { uploading = false; return [0x77]; }
    private byte[] ReadMemory(byte[] request)
    {
        if (request.Length != 8 || request[1] != 0x24) return [0x7F, 0x23, 0x13];
        uint address = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(request.AsSpan(2, 4));
        int size = request[6] * 256 + request[7];
        if ((ulong)address + (uint)size > (ulong)Memory.Length) return [0x7F, 0x23, 0x31];
        return [0x63, .. Memory.AsSpan((int)address, size).ToArray()];
    }
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
