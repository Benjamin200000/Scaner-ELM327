using System.Globalization;
using System.Security.Cryptography;
using System.Xml;
using System.Xml.Linq;

namespace Scaner.Core;

public record MapDefinition(string Title, uint Address, int Bits, bool Signed, bool LittleEndian, int Rows, int Columns, string Equation, string Unit);
public record BinaryChange(int Address, byte Before, byte After);
public static class Calibration
{
    public static string Sha256(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));
    public static IReadOnlyList<BinaryChange> Compare(byte[] original, byte[] modified)
    {
        if (original.Length != modified.Length) throw new DiagnosticException("Los BIN tienen tamaños diferentes; no se alinean automáticamente");
        return Enumerable.Range(0, original.Length).Where(i => original[i] != modified[i]).Select(i => new BinaryChange(i, original[i], modified[i])).ToArray();
    }
    public static IReadOnlyList<MapDefinition> ImportXdf(string xml)
    {
        using var reader = XmlReader.Create(new StringReader(xml), new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 16 * 1024 * 1024 });
        var document = XDocument.Load(reader);
        if (document.Descendants().Where(e => e.Name.LocalName.Equals("BASEOFFSET", StringComparison.OrdinalIgnoreCase)).Any(e => !new[] { "0", "0x0", "0x00", "0x00000000", "" }.Contains(((string?)e.Attribute("offset") ?? e.Value).Trim(), StringComparer.OrdinalIgnoreCase))) throw new DiagnosticException("XDF con BASEOFFSET requiere revisar el direccionamiento; no se aplica una dirección supuesta");
        var maps = new List<MapDefinition>();
        foreach (var table in document.Descendants("XDFTABLE"))
        {
            var axis = table.Elements("XDFAXIS").FirstOrDefault(e => (string?)e.Attribute("id") == "z");
            var data = axis?.Element("EMBEDDEDDATA");
            if (data is null) continue;
            uint Number(string key, uint fallback = 0) { var s = (string?)data.Attribute(key); return s is null ? fallback : s.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? Hex.Number(s) : uint.Parse(s, CultureInfo.InvariantCulture); }
            int bits = checked((int)Number("mmedelementsizebits", 16));
            if (bits is not (8 or 16 or 32)) throw new DiagnosticException("XDF: solo elementos de 8, 16 o 32 bits");
            if (data.Attributes().Any(a => a.Name.LocalName.Contains("stride", StringComparison.OrdinalIgnoreCase) && a.Value is not "0" and not "0x0" and not "0x00")) throw new DiagnosticException("XDF con stride no nulo requiere un lector específico");
            uint flags = Number("mmedtypeflags");
            if ((flags & ~3u) != 0) throw new DiagnosticException("XDF usa flags de datos no soportados; no se interpretan como enteros");
            var equation = (string?)axis?.Element("MATH")?.Attribute("equation") ?? "X";
            _ = Formula.Evaluate(equation, 0); // Fail closed on unsupported math, never silently use X.
            maps.Add(new((string?)table.Element("title") ?? "Sin título", Number("mmedaddress"), bits, (flags & 1) != 0, (flags & 2) != 0,
                checked((int)Number("mmedrowcount", 1)), checked((int)Number("mmedcolcount", 1)), equation, (string?)axis?.Element("units") ?? ""));
        }
        if (maps.Count == 0) throw new DiagnosticException("El XDF no contiene tablas compatibles");
        return maps;
    }
    public static double[] Read(byte[] binary, MapDefinition map)
    {
        if (map.Bits is not (8 or 16 or 32) || map.Rows <= 0 || map.Columns <= 0) throw new DiagnosticException("Definición de mapa inválida");
        long count = (long)map.Rows * map.Columns;
        if (count > 1000000 || (ulong)map.Address + (ulong)count * (uint)(map.Bits / 8) > (ulong)binary.Length) throw new DiagnosticException("La tabla está fuera de este BIN");
        return Enumerable.Range(0, (int)count).Select(i => Formula.Evaluate(map.Equation, ReadRaw(binary, map, i))).ToArray();
    }
    public static double ReadRaw(byte[] binary, MapDefinition map, int cell)
    {
        int size = map.Bits / 8, offset = checked((int)map.Address + cell * size);
        uint value = 0;
        for (int i = 0; i < size; i++) value = (value << 8) | binary[offset + (map.LittleEndian ? size - 1 - i : i)];
        if (!map.Signed) return value;
        return map.Bits switch { 8 => (sbyte)value, 16 => (short)value, 32 => (int)value, _ => throw new DiagnosticException("Bits inválidos") };
    }
    public static void WriteRaw(byte[] binary, MapDefinition map, int cell, long raw)
    {
        _ = Read(binary, map);
        if (cell < 0 || cell >= (long)map.Rows * map.Columns) throw new ArgumentOutOfRangeException(nameof(cell));
        long min = map.Signed ? -(1L << (map.Bits - 1)) : 0;
        long max = map.Signed ? (1L << (map.Bits - 1)) - 1 : (1L << map.Bits) - 1;
        if (raw < min || raw > max) throw new DiagnosticException($"Valor crudo fuera de rango [{min}, {max}]");
        int size = map.Bits / 8, offset = checked((int)map.Address + cell * size);
        for (int i = 0; i < size; i++) binary[offset + (map.LittleEndian ? i : size - 1 - i)] = (byte)(raw >> (8 * i));
    }
}

/// <summary>Arithmetic only: no eval, scripts, reflection or executable expressions.</summary>
public sealed class Formula
{
    private readonly string text;
    private readonly double x;
    private int position;
    private Formula(string expression, double value) { text = expression; x = value; }
    public static double Evaluate(string expression, double value)
    {
        if (expression.Length > 512) throw new DiagnosticException("Fórmula demasiado larga");
        var parser = new Formula(expression, value);
        var result = parser.Sum(); parser.Space();
        if (parser.position != expression.Length) throw new DiagnosticException("Fórmula no soportada: " + expression);
        if (!double.IsFinite(result)) throw new DiagnosticException("La fórmula produce un valor no finito");
        return result;
    }
    private void Space() { while (position < text.Length && char.IsWhiteSpace(text[position])) position++; }
    private bool Eat(char c) { Space(); if (position < text.Length && text[position] == c) { position++; return true; } return false; }
    private double Sum() { var v = Product(); while (true) { if (Eat('+')) v += Product(); else if (Eat('-')) v -= Product(); else return v; } }
    private double Product() { var v = Atom(); while (true) { if (Eat('*')) v *= Atom(); else if (Eat('/')) { var d = Atom(); if (d == 0) throw new DiagnosticException("División por cero en fórmula"); v /= d; } else return v; } }
    private double Atom()
    {
        if (Eat('+')) return Atom(); if (Eat('-')) return -Atom();
        if (Eat('(')) { var v = Sum(); if (!Eat(')')) throw new DiagnosticException("Falta paréntesis"); return v; }
        Space(); if (position < text.Length && char.ToUpperInvariant(text[position]) == 'X') { position++; return x; }
        int start = position;
        while (position < text.Length && (char.IsDigit(text[position]) || text[position] == '.')) position++;
        if (start == position || !double.TryParse(text[start..position], NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var n)) throw new DiagnosticException("Fórmula no soportada");
        return n;
    }
}
