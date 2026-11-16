namespace Scaner.Core;

public record MonitorTest(uint Ecu, byte Mid, byte Tid, byte Scale, int Value, int Minimum, int Maximum, bool Passed, double? Position);
public static class Mode06
{
    public static IReadOnlyList<MonitorTest> Decode(uint ecu, byte[] data)
    {
        if (data.Length % 9 != 0) throw new DiagnosticException("Registros modo 06 incompletos");
        var tests = new List<MonitorTest>();
        for (int i = 0; i < data.Length; i += 9)
        {
            int Word(int index) { int v = data[index] * 256 + data[index + 1]; return data[i + 2] >= 0x80 && v >= 0x8000 ? v - 0x10000 : v; }
            int value = Word(i + 3), min = Word(i + 5), max = Word(i + 7);
            if (min > max) throw new DiagnosticException("Límites de monitor modo 06 incoherentes");
            tests.Add(new(ecu, data[i], data[i + 1], data[i + 2], value, min, max, value >= min && value <= max, max > min ? Math.Clamp((value - min) * 100.0 / (max - min), 0, 100) : null));
        }
        return tests;
    }
    public static async Task<IReadOnlyList<MonitorTest>> Read(DiagnosticSession session, CancellationToken ct)
    {
        if (!session.Link.SupportsCanMode06) throw new DiagnosticException("Modo 06 nativo solo implementado para CAN; no se aplica el formato CAN a K-Line");
        var mids = new SortedSet<byte>();
        for (int page = 0; page <= 0xE0; page += 32)
        {
            bool more = false;
            foreach (var r in await session.RequestAsync([6, (byte)page], ct))
            {
                var b = DiagnosticSession.Positive(r, 6);
                if (b.Length < 6 || b[1] != page) throw new DiagnosticException("Mapa de monitores incompleto");
                for (int bit = 0; bit < 31; bit++) if ((b[2 + bit / 8] & (0x80 >> (bit % 8))) != 0) mids.Add((byte)(page + bit + 1));
                more |= (b[5] & 1) != 0;
            }
            if (!more) break;
        }
        var results = new List<MonitorTest>();
        foreach (var mid in mids)
            foreach (var r in await session.RequestAsync([6, mid], ct))
            {
                var b = DiagnosticSession.Positive(r, 6);
                var records = Decode(r.Address, b[1..]);
                if (records.Any(t => t.Mid != mid)) throw new DiagnosticException("MID no coincide con el solicitado");
                results.AddRange(records);
            }
        return results;
    }
}
