using System.Globalization;

namespace Scaner.Core;

public record KklMeasurement(double? Value, string Unit, string Text);
public static class KklMeasurements
{
    public static KklMeasurement Decode(byte code, byte a, byte b)
    {
        KklMeasurement N(double n, string unit = "", int decimals = 1) => new(n, unit, n.ToString("F" + decimals, CultureInfo.CurrentCulture) + (unit.Length > 0 ? " " + unit : ""));
        KklMeasurement T(string text) => new(null, "", text);
        string Char(byte c) => c >= 32 && c <= 126 ? ((char)c).ToString() : ".";
        return code switch
        {
            0 => T("—"),
            1 => N(.2 * a * b, "rpm", 0),
            2 => N(a * .002 * b, "%"),
            3 => N(.002 * a * b, "°"),
            4 => T($"{Math.Abs(b - 127) * .01 * a:F1} °{(b > 127 ? "ATDC" : "BTDC")}"),
            5 => N(a * (b - 100) * .1, "°C"),
            6 => N(.001 * a * b, "V", 2),
            7 => N(.01 * a * b, "km/h", 0),
            8 => N(.1 * a * b),
            9 => N((b - 127) * .02 * a, "°"),
            10 => T(b == 0 ? "Frío" : "Caliente"),
            11 => N(.0001 * a * (b - 128) + 1),
            12 => N(.001 * a * b, "Ω"),
            13 => N((b - 127) * .001 * a, "mm"),
            14 => N(.005 * a * b, "bar", 2),
            15 => N(.01 * a * b, "ms"),
            16 => T($"{Convert.ToString(a, 2).PadLeft(8, '0')} {Convert.ToString(b, 2).PadLeft(8, '0')}"),
            17 => T($"\"{Char(a)}{Char(b)}\""),
            18 => N(.04 * a * b, "mbar", 0),
            19 => N(a * b * .01, "l"),
            20 => N(a * (b - 128) / 128.0, "%"),
            21 => N(.001 * a * b, "V", 2),
            22 => N(.001 * a * b, "ms", 2),
            23 => N(b / 256.0 * a, "%"),
            24 => N(.001 * a * b, "A", 2),
            25 => N(b * 1.421 + a / 182.0, "g/s", 2),
            26 => N(b - a, "°C", 0),
            27 => T($"{Math.Abs(b - 128) * .01 * a:F1} °{(b < 128 ? "ATDC" : "BTDC")}"),
            28 => N(b - a, "", 0),
            29 => T(b < a ? "Mapa 1" : "Mapa 2"),
            30 => N(b / 12.0 * a, "° k/w"),
            31 => N(b / 2560.0 * a),
            32 => N(b > 128 ? b - 256 : b, "", 0),
            33 => N(a == 0 ? 100 * b : 100.0 * b / a, "%"),
            34 => N((b - 128) * .01 * a, "kW", 2),
            35 => N(.01 * a * b, "l/h", 2),
            36 => N(a * 2560 + b * 10, "km", 0),
            38 => N((b - 128) * .001 * a, "° k/w"),
            39 => N(b / 256.0 * a, "mg/h", 0),
            40 => N(b * .1 + 25.5 * a - 400, "A"),
            41 => N(b + a * 255, "Ah", 0),
            42 => N(b * .1 + 25.5 * a - 400, "kW"),
            43 => N(b * .1 + 25.5 * a, "V"),
            44 => T($"{a:D2}:{b:D2}"),
            45 => N(.1 * a * b / 100),
            46 => N((a * b - 3200) * .0027, "° k/w"),
            47 => N((b - 128) * a, "ms", 0),
            48 => N(b + a * 255, "", 0),
            49 => N(b / 4.0 * a * .1, "mg/h"),
            50 => N(a == 0 ? (b - 128) / .01 : (b - 128) / (.01 * a), "mbar", 0),
            51 => N((b - 128) / 255.0 * a, "mg/h"),
            52 => N(b * .02 * a - a, "Nm"),
            53 => N((b - 128) * 1.4222 + .006 * a, "g/s", 2),
            54 => N(a * 256 + b, "", 0),
            55 => N(a * b / 200.0, "s", 2),
            56 => N(a * 256 + b, "WSC", 0),
            57 => N(a * 256 + b + 65536, "WSC", 0),
            58 => N(b > 128 ? 1.0225 * (256 - b) : 1.0225 * b, "/s"),
            59 => N((a * 256 + b) / 32768.0),
            60 => N((a * 256 + b) * .01, "s", 2),
            61 => N(a == 0 ? b - 128 : (b - 128) / (double)a),
            62 => N(.256 * a * b, "S", 0),
            63 => T($"\"{Char(a)}{Char(b)}\"?"),
            64 => N(a + b, "Ω", 0),
            65 => N(.01 * a * (b - 127), "mm"),
            66 => N(a * b / 511.12, "V", 2),
            67 => N(640 * a + b * 2.5, "°"),
            68 => N((256 * a + b) / 7.365, "°/s"),
            69 => N((256 * a + b) * .3254, "bar", 2),
            70 => N((256 * a + b) * .192, "m/s²"),
            _ => T($"Sin conversión · código {code} · A={a} B={b}")
        };
    }
}
