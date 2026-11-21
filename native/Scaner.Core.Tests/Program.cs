using Scaner.Core;
using System.Text;

int passed = 0, failed = 0;
async Task Test(string title, Func<Task> fn)
{ try { await fn(); Console.WriteLine("PASS " + title); passed++; } catch (Exception ex) { Console.Error.WriteLine("FAIL " + title + ": " + ex); failed++; } }
void Equal<T>(T expected, T actual) { if (!Equals(expected, actual)) throw new Exception($"Expected {expected}; actual {actual}"); }
void True(bool value) { if (!value) throw new Exception("Assertion failed"); }
void Throws(Action action) { try { action(); } catch (Exception ex) when (ex is DiagnosticException or ArgumentException or System.Xml.XmlException) { return; } throw new Exception("Expected rejection"); }
Task Sync(Action fn) { fn(); return Task.CompletedTask; }
await Test("ELM single CAN frame", () => Sync(() => { var r = ElmFrames.Parse("7E8 04 41 0C 0D 48\r>").Single(); Equal(0x7E8u, r.Address); Equal("410C0D48", Convert.ToHexString(r.Data)); }));
await Test("ELM 29-bit CAN header", () => Sync(() => { var r = ElmFrames.Parse("18DAF110 04 41 0C 0D 48").Single(); Equal(0x18DAF110u, r.Address); Equal(4, r.Data.Length); }));
await Test("ISO-TP reassembles interleaved ECUs separately", () => Sync(() =>
{
    var r = ElmFrames.Parse("7E8 10 0A 49 02 01 41 42 43\r7E9 04 41 0C 0D 48\r7E8 21 44 45 46 47 00 00 00");
    Equal(2, r.Count); Equal("49020141424344454647", Convert.ToHexString(r.Single(x => x.Address == 0x7E8).Data));
}));
await Test("ISO-TP rejects missing sequence", () => Sync(() => Throws(() => ElmFrames.Parse("7E8 10 0A 49 02 01 41 42 43\r7E8 22 44 45 46 47"))));
await Test("ISO-TP rejects unfinished payload", () => Sync(() => Throws(() => ElmFrames.Parse("7E8 10 0A 49 02 01 41 42 43"))));
await Test("ELM rejects truncated single frame", () => Sync(() => Throws(() => ElmFrames.Parse("7E8 06 41 0C"))));
await Test("ELM no data is absence, not zero", () => Sync(() => Equal(0, ElmFrames.Parse("SEARCHING...\rNO DATA\r>").Count)));
await Test("ELM hardware error propagated", () => Sync(() => Throws(() => ElmFrames.Parse("CAN ERROR"))));
await Test("ISO9141 valid checksum", () => Sync(() => Equal("410C0D48", Convert.ToHexString(ElmFrames.Parse("48 6B 10 41 0C 0D 48 65").Single().Data))));
await Test("ISO9141 corrupt checksum rejected", () => Sync(() => Throws(() => ElmFrames.Parse("48 6B 10 41 0C 0D 48 00"))));
await Test("DTC all code families", () => Sync(() => { Equal("P0171", Obd.Dtc(1, 0x71)); Equal("C1234", Obd.Dtc(0x52, 0x34)); Equal("U0300", Obd.Dtc(0xC3, 0)); }));
await Test("Gasoline readiness supported/incomplete bits", () => Sync(() =>
{
    var r = Obd.DecodeReadiness([0x81, 0x07, 0xE0, 0x20]); True(r.Mil); Equal(1, r.TroubleCodes); True(!r.CompressionIgnition);
    True(!r.Monitors.Single(x => x.Name == "Sonda O2").Complete); True(r.Monitors.Single(x => x.Name == "Calefactor O2").Complete);
}));
await Test("Diesel readiness has DPF, not O2 label", () => Sync(() => { var r = Obd.DecodeReadiness([0, 0x0F, 0x40, 0x40]); True(r.CompressionIgnition); True(r.Monitors.Single(x => x.Name == "Filtro de partículas").Supported); True(!r.Monitors.Single(x => x.Name == "Filtro de partículas").Complete); }));
await Test("Readiness rejects truncated data", () => Sync(() => Throws(() => Obd.DecodeReadiness([0, 0, 0]))));
await Test("Negative response never parsed as positive", () => Sync(() => Throws(() => DiagnosticSession.Positive(new(0x7E8, [0x7F, 0x23, 0x33]), 0x23))));
await Test("Wrong service rejected", () => Sync(() => Throws(() => DiagnosticSession.Positive(new(0x7E8, [0x62, 1]), 1))));
await Test("Simulator PID discovery and live rpm", async () => { await using var s = new DiagnosticSession(new SimulatedLink()); var supported = await s.SupportedPids(); True(supported.Contains(0x0C)); Equal(850.0, (await s.Read(Obd.Parameters.Single(p => p.Pid == 0x0C))).Value); });
await Test("Simulator stored DTC and identity", async () => { await using var s = new DiagnosticSession(new SimulatedLink()); Equal("P0171", (await s.Faults()).First().Code); Equal("WVWZZZ1JZXW000001", (await s.Identity())["VIN · 7E8"]); });
await Test("Freeze request includes frame number", async () => { var link = new RecordingLink(); await using var s = new DiagnosticSession(link); await s.Read(Obd.Parameters.Single(p => p.Pid == 0x0C), 2); Equal("020C00", Convert.ToHexString(link.Sent[0])); });
await Test("UDS identity verifies DID", async () => { await using var s = new DiagnosticSession(new SimulatedLink()); True((await s.UdsIdentification(0xF190)).Contains("SIM-ECU")); });
await Test("UDS memory complete byte-for-byte with session restoration", async () => { var link = new RecordingLink(); await using var s = new DiagnosticSession(link); var r = await s.ReadMemory(33, 173); True(r.Complete); True(r.Data.SequenceEqual(link.Inner.Memory.Skip(33).Take(173))); Equal("1001", Convert.ToHexString(link.Sent[^1])); });
await Test("UDS denied region records partial data without zero padding", async () => { await using var s = new DiagnosticSession(new SimulatedLink()); var r = await s.ReadMemory(65500, 128); True(!r.Complete); Equal(0, r.Data.Length); True(r.Error!.Contains("31")); });
await Test("UDS cancellation preserves received bytes", async () => { using var ct = new CancellationTokenSource(); var link = new RecordingLink { AfterRead = () => ct.Cancel() }; await using var s = new DiagnosticSession(link); var r = await s.ReadMemory(0, 512, ct: ct.Token); True(!r.Complete); Equal(64, r.Data.Length); Equal("Cancelado", r.Error); Equal("1001", Convert.ToHexString(link.Sent[^1])); });
await Test("UDS truncated block records incomplete", async () => { await using var s = new DiagnosticSession(new BrokenLink()); var r = await s.ReadMemory(0, 32); True(!r.Complete); Equal(0, r.Data.Length); });
await Test("UDS rejects address overflow", async () => { await using var s = new DiagnosticSession(new SimulatedLink()); try { await s.ReadMemory(0xFFFFFFF0, 64); throw new Exception("Not rejected"); } catch (ArgumentOutOfRangeException) { } });
await Test("Calibration endian and signed", () => Sync(() => { var m = new MapDefinition("test", 0, 16, true, true, 1, 2, "X*0.5", "°"); var b = Hex.Parse("FEFF0400"); var v = Calibration.Read(b, m); Equal(-1.0, v[0]); Equal(2.0, v[1]); }));
await Test("Calibration big endian", () => Sync(() => { var m = new MapDefinition("test", 0, 16, false, false, 1, 1, "X", "raw"); Equal(258.0, Calibration.Read([1, 2], m)[0]); }));
await Test("Calibration editing affects selected cell only", () => Sync(() => { var m = new MapDefinition("test", 0, 16, false, true, 1, 2, "X", "raw"); byte[] b = [1, 0, 2, 0]; Calibration.WriteRaw(b, m, 1, 0xABCD); Equal("0100CDAB", Convert.ToHexString(b)); }));
await Test("Calibration rejects out-of-range raw", () => Sync(() => Throws(() => Calibration.WriteRaw([0, 0], new("t", 0, 16, false, true, 1, 1, "X", ""), 0, 65536))));
await Test("Calibration refuses maps outside ROM", () => Sync(() => Throws(() => Calibration.Read([1, 2], new("t", 1, 16, false, true, 1, 1, "X", "")))));
await Test("Calibration compare exact offsets and length check", () => Sync(() => { Equal(1, Calibration.Compare([0, 1, 2], [0, 3, 2]).Single().Address); Throws(() => Calibration.Compare([1], [1, 2])); }));
await Test("SHA256 known vector", () => Sync(() => Equal("BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD", Calibration.Sha256(Encoding.ASCII.GetBytes("abc")))));
await Test("Formula precedence unary and parentheses", () => Sync(() => Equal(-2.0, Formula.Evaluate("-(X + 2) / 2", 2))));
await Test("Formula rejects code execution", () => Sync(() => Throws(() => Formula.Evaluate("System.IO.File.Delete(X)", 2))));
await Test("Formula rejects divide by zero", () => Sync(() => Throws(() => Formula.Evaluate("X/0", 1))));
const string xdf = """
<XDFFORMAT><XDFTABLE><title>Test</title><XDFAXIS id="z"><EMBEDDEDDATA mmedaddress="0x0" mmedelementsizebits="16" mmedtypeflags="0x03" mmedrowcount="1" mmedcolcount="2"/><units>rpm</units><MATH equation="X*0.5"/></XDFAXIS></XDFTABLE></XDFFORMAT>
""";
await Test("XDF imports signed little endian and conversion", () => Sync(() => { var m = Calibration.ImportXdf(xdf).Single(); True(m.LittleEndian); True(m.Signed); Equal(2, m.Columns); Equal(-1.0, Calibration.Read([254, 255, 0, 0], m)[0]); }));
await Test("XDF unsupported math fails instead of inventing scale", () => Sync(() => Throws(() => Calibration.ImportXdf(xdf.Replace("X*0.5", "SIN(X)")))));
await Test("XDF floating-point flags rejected", () => Sync(() => Throws(() => Calibration.ImportXdf(xdf.Replace("0x03", "0x100")))));
await Test("CAN DTC count byte is not a code", async () => { await using var session = new DiagnosticSession(new ReplyLink(_ => [new(0x7E8, [0x43, 1, 2, 3, 0, 0])])); var codes = await session.Faults(); Equal(1, codes.Count); Equal("P0203", codes[0].Code); });
await Test("K-Line DTC does not consume a count byte", async () => { await using var session = new DiagnosticSession(new ReplyLink(_ => [new(0x10, [0x43, 1, 2, 3, 0], false)])); var codes = await session.Faults(); Equal(2, codes.Count); Equal("P0102", codes[0].Code); Equal("P0300", codes[1].Code); });
await Test("CAN truncated DTC list fails", async () => { await using var session = new DiagnosticSession(new ReplyLink(_ => [new(0x7E8, [0x43, 2, 1, 2])])); try { await session.Faults(); throw new Exception("Not rejected"); } catch (DiagnosticException) { } });
await Test("DTC no response is not a clean bill of health", async () => { await using var session = new DiagnosticSession(new ReplyLink(_ => [])); try { await session.Faults(); throw new Exception("Not rejected"); } catch (DiagnosticException) { } });
await Test("KWP checksum and explicit length", () => Sync(() => { var r = ElmFrames.Parse("84 F1 10 41 0C 0D 48 27").Single(); Equal("410C0D48", Convert.ToHexString(r.Data)); True(!r.HasDtcCount); }));
await Test("OBD identity combines numbered K-Line packets", async () => { await using var session = new DiagnosticSession(new ReplyLink(r => [new(0x10, [0x49, r[1], 2, 0x43, 0x44], false), new(0x10, [0x49, r[1], 1, 0x41, 0x42], false)])); Equal("ABCD", (await session.Identity())["VIN · 10"]); });
await Test("Simulator clear DTC changes subsequent result", async () => { await using var session = new DiagnosticSession(new SimulatedLink()); Equal(2, (await session.Faults()).Count); await session.RequestAsync([4]); Equal(0, (await session.Faults()).Count); });
await Test("Mode06 signed values and margins", () => Sync(() => { var r = Mode06.Decode(0x7E8, [1, 2, 0x80, 0xFF, 0xF6, 0xFF, 0xEC, 0, 0]).Single(); Equal(-10, r.Value); Equal(-20, r.Minimum); True(r.Passed); Equal(50.0, r.Position); }));
await Test("Mode06 invalid record rejected", () => Sync(() => Throws(() => Mode06.Decode(0x7E8, [1, 2, 3]))));
await Test("Mode06 discovers and reads simulated monitor", async () => { await using var session = new DiagnosticSession(new SimulatedLink()); var result = await Mode06.Read(session, CancellationToken.None); Equal(1, result.Count); Equal(5, result[0].Value); True(result[0].Passed); });
await Test("Knowledge resources embedded without Node", () => Sync(() => { Equal(11, Knowledge.Root.GetProperty("dtcs").GetArrayLength()); True(Knowledge.Dtc("P0171")!.Contains("causes")); True(Knowledge.Dtc("PFFFF") is null); True(Knowledge.Maps(0).Count > 0); }));
await Test("Rules never evaluate missing values as zero", () => Sync(() => { var r = DiagnosticRules.Evaluate(new Dictionary<string, double>(), "gasolina", null); Equal(6, r.Count); True(r.All(x => x.Status == "NO EVALUADA")); }));
await Test("Rules require displacement for theoretical MAF", () => Sync(() => { var r = DiagnosticRules.Evaluate(new Dictionary<string, double> { { "rpm", 2000 }, { "maf", 5 }, { "load", 80 } }, "gasolina", null); Equal("NO EVALUADA", r.Single(x => x.Rule == "MAF vs. teórico").Status); }));
await Test("Rules do not mix unknown fuel with gasoline hypothesis", () => Sync(() => { var r = DiagnosticRules.Evaluate(new Dictionary<string, double> { { "ltft1", 25 } }, null, null); Equal("NO EVALUADA", r.Single(x => x.Rule == "Corrección positiva").Status); }));
await Test("Rules report supported pattern without confirming failure", () => Sync(() => { var r = DiagnosticRules.Evaluate(new Dictionary<string, double> { { "ltft1", 25 } }, "gasolina", null); Equal("PATRÓN COMPATIBLE", r.Single(x => x.Rule == "Corrección positiva").Status); }));
await Test("Rules reject non-finite sensor data", () => Sync(() => { var r = DiagnosticRules.Evaluate(new Dictionary<string, double> { { "coolant", double.NaN } }, "gasolina", null); Equal("NO EVALUADA", r.Single(x => x.Rule == "Refrigerante elevado").Status); }));
await Test("XDF XML entities prohibited", () => Sync(() => Throws(() => Calibration.ImportXdf("<!DOCTYPE XDFFORMAT [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><XDFFORMAT>&x;</XDFFORMAT>"))));
await Test("XDF zero baseoffset accepted", () => Sync(() => Equal(1, Calibration.ImportXdf(xdf.Replace("<XDFFORMAT>", "<XDFFORMAT><XDFHEADER><BASEOFFSET offset=\"0\" subtract=\"0\"/></XDFHEADER>")).Count)));
await Test("XDF unknown nonzero baseoffset rejected", () => Sync(() => Throws(() => Calibration.ImportXdf(xdf.Replace("<XDFFORMAT>", "<XDFFORMAT><BASEOFFSET offset=\"0x80000\"/>")))));
await Test("Upload complete and sequence wraps through zero", async () => { var link = new RecordingLink(); await using var session = new DiagnosticSession(link); var result = await MemoryUpload.Read(session, 10, 64 * 260); True(result.Complete); True(result.Data.SequenceEqual(link.Inner.Memory.Skip(10).Take(64 * 260))); True(link.Sent.Any(r => r[0] == 0x36 && r[1] == 0)); Equal("1001", Convert.ToHexString(link.Sent[^1])); });
await Test("Upload denied region does not create padded memory", async () => { await using var session = new DiagnosticSession(new SimulatedLink()); var result = await MemoryUpload.Read(session, 65500, 128); True(!result.Complete); Equal(0, result.Data.Length); });
await Test("Upload zero-byte block is incomplete", async () => { await using var session = new DiagnosticSession(new ReplyLink(r => [new(0x7E8, r[0] switch { 0x10 => [0x50, r[1]], 0x35 => [0x75, 0x20, 0, 66], 0x36 => [0x76, r[1]], _ => [0x77] })])); var result = await MemoryUpload.Read(session, 0, 100); True(!result.Complete); Equal(0, result.Data.Length); });
await Test("Upload checks echoed sequence", async () => { await using var session = new DiagnosticSession(new ReplyLink(r => [new(0x7E8, r[0] switch { 0x10 => [0x50, r[1]], 0x35 => [0x75, 0x20, 0, 66], 0x36 => [0x76, 99, 1, 2], _ => [0x77] })])); var result = await MemoryUpload.Read(session, 0, 100); True(!result.Complete); });
await Test("KKL formulas retain unit and unknown data", () => Sync(() => { Equal(800.0, KklMeasurements.Decode(1, 20, 200).Value); Equal(90.0, KklMeasurements.Decode(5, 10, 190).Value); True(KklMeasurements.Decode(255, 1, 2).Value is null); True(KklMeasurements.Decode(255, 1, 2).Text.Contains("255")); }));
Console.WriteLine($"RESULT: {passed} passed, {failed} failed");
return failed == 0 ? 0 : 1;

sealed class RecordingLink : IDiagnosticLink
{
    public SimulatedLink Inner { get; } = new(); public List<byte[]> Sent { get; } = []; public Action? AfterRead { get; init; }
    public string Description => "recording"; public bool IsSimulation => true;
    public async Task<IReadOnlyList<EcuReply>> RequestAsync(byte[] request, CancellationToken cancellation = default) { Sent.Add(request.ToArray()); var r = await Inner.RequestAsync(request, cancellation); if (request[0] == 0x23) AfterRead?.Invoke(); return r; }
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
sealed class BrokenLink : IDiagnosticLink
{
    public string Description => "broken"; public bool IsSimulation => true;
    public Task<IReadOnlyList<EcuReply>> RequestAsync(byte[] request, CancellationToken cancellation = default) => Task.FromResult<IReadOnlyList<EcuReply>>([new(0x7E8, request[0] == 0x10 ? [0x50, request[1]] : [0x63, 1, 2])]);
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

sealed class ReplyLink(Func<byte[], IReadOnlyList<EcuReply>> reply) : IDiagnosticLink
{
    public string Description => "scripted test"; public bool IsSimulation => true;
    public Task<IReadOnlyList<EcuReply>> RequestAsync(byte[] request, CancellationToken cancellation = default) { cancellation.ThrowIfCancellationRequested(); return Task.FromResult(reply(request)); }
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
