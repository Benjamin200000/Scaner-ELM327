using Scaner.Core;
using System.IO.Ports;
using System.Globalization;
using System.Text.Json;
using System.Diagnostics;

namespace Scaner.Windows;

public sealed class MainForm : Form
{
    private readonly ComboBox adapter = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 190 };
    private readonly ComboBox port = new() { Width = 100 };
    private readonly ComboBox baud = new() { Width = 90 };
    private readonly ComboBox devices = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 300 };
    private readonly TextBox tx = new() { Text = "7E0", Width = 65 }, rx = new() { Text = "7E8", Width = 65 };
    private readonly ComboBox canBaud = new() { Width = 90, DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly NumericUpDown kklAddress = new() { Minimum = 1, Maximum = 127, Value = 1, Hexadecimal = true, Width = 65 };
    private readonly Label status = new() { Dock = DockStyle.Bottom, Height = 34, Text = "  Sin conexión · Windows nativo · " + (Environment.Is64BitProcess ? "64 bits" : "32 bits"), BackColor = Color.FromArgb(226, 235, 241), TextAlign = ContentAlignment.MiddleLeft };
    private readonly TabControl tabs = new() { Dock = DockStyle.Fill };
    private readonly TextBox overview = TextArea(), trace = TextArea(), identity = TextArea(), emissions = TextArea(), kklOutput = TextArea(), memoryOutput = TextArea(), mapInfo = TextArea();
    private readonly DataGridView live = Grid(), faults = Grid(), mapGrid = Grid(), history = Grid();
    private readonly CheckedListBox selection = new() { Dock = DockStyle.Left, Width = 245, CheckOnClick = true };
    private readonly TrendGraph graph = new() { Dock = DockStyle.Bottom, Height = 180 };
    private readonly CheckBox polling = new() { Text = "Actualizar automáticamente", AutoSize = true };
    private readonly System.Windows.Forms.Timer liveTimer = new() { Interval = 1500 }, kklTimer = new() { Interval = 1500 };
    private readonly ComboBox memoryMethod = new() { Width = 180, DropDownStyle = ComboBoxStyle.DropDownList };
    private string lastMethod = "0x23";
    private readonly TextBox memoryAddress = new() { Text = "00000000", Width = 110 };
    private readonly NumericUpDown memoryLength = new() { Minimum = 1, Maximum = 16 * 1024 * 1024, Value = 512, Width = 110 };
    private readonly ProgressBar progress = new() { Width = 200 };
    private readonly TextBox command = new() { Text = "010C", Width = 220 };
    private readonly ComboBox maps = new() { Width = 350, DropDownStyle = ComboBoxStyle.DropDownList, DisplayMember = "Title" };
    private readonly List<Button> actions = [];
    private readonly TextBox patterns = TextArea();
    private readonly ComboBox fuel = new() { Width = 105, DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly NumericUpDown displacement = new() { Minimum = 0, Maximum = 20, DecimalPlaces = 1, Increment = .1m, Width = 65 };
    private readonly Dictionary<string, double> snapshot = [];
    private readonly NumericUpDown group = new() { Minimum = 0, Maximum = 255, Value = 1, Width = 70 };
    private DiagnosticSession? session;
    private KklSession? kkl;
    private CancellationTokenSource? operation;
    private HashSet<byte>? supported;
    private bool busy, closing, allowClose;
    private MemoryResult? lastMemory;
    private uint lastAddress;
    private byte[]? original, edited;
    private string? originalPath;
    private bool updatingMap;
    private readonly string historyDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ScanerELM327", "sesiones");
    public int TabCount => tabs.TabCount;
    public MainForm()
    {
        Text = "Scaner ELM327 · Diagnóstico nativo";
        MinimumSize = new(1060, 760); Size = new(1380, 920); StartPosition = FormStartPosition.CenterScreen;
        Font = new("Segoe UI", 10); BackColor = Color.FromArgb(244, 247, 250);
        var title = new Label { Text = "SCANER   /   Diagnóstico automotriz", Font = new("Segoe UI Semibold", 21), ForeColor = Color.White, BackColor = Color.FromArgb(19, 40, 58), Dock = DockStyle.Top, Height = 72, Padding = new(22, 15, 0, 0) };
        adapter.Items.AddRange(["Simulador gasolina", "Simulador diésel", "ELM327 Bluetooth / USB", "Autel / otro J2534", "KKL · KW1281"]); adapter.SelectedIndex = 0;
        baud.Items.AddRange(["38400", "9600", "115200", "10400"]); baud.Text = "38400";
        canBaud.Items.AddRange(["500000", "250000"]); canBaud.SelectedIndex = 0;
        var connection = Flow(); connection.Dock = DockStyle.Top; connection.AutoSize = true; connection.AutoSizeMode = AutoSizeMode.GrowAndShrink; connection.WrapContents = true; connection.AutoScroll = false;
        connection.Controls.AddRange([Label("Interfaz"),adapter,Button("Buscar",()=>RefreshDevices()),Label("COM"),port,Label("Baudios"),baud,Label("DLL J2534"),devices,
            Button("Elegir DLL",()=>ChooseDll()),Label("CAN TX/RX"),tx,rx,canBaud,Label("Unidad KKL (hex)"),kklAddress,Button("Conectar",Connect),Button("Desconectar",Disconnect)]);
        Controls.Add(tabs); Controls.Add(connection); Controls.Add(title); Controls.Add(status);
        memoryMethod.Items.AddRange(["UDS 0x23 · dirección", "UDS 0x35 · subida"]); memoryMethod.SelectedIndex = 0;
        fuel.Items.AddRange(["Desconocido", "Gasolina", "Diésel"]); fuel.SelectedIndex = 0;
        BuildTabs(); RefreshDevices().GetAwaiter().GetResult();
        adapter.SelectedIndexChanged += (_, _) => { if (adapter.SelectedIndex == 4) baud.Text = "10400"; else if (adapter.SelectedIndex == 2) baud.Text = "38400"; };
        liveTimer.Tick += async (_, _) => { if (polling.Checked && !busy && session is not null) await Run(ReadLive); }; liveTimer.Start();
        kklTimer.Tick += async (_, _) => { if (kkl is not null && !busy) await Run(() => kkl.KeepAlive(operation!.Token)); }; kklTimer.Start();
        FormClosing += OnClosing;
    }
    private static Label Label(string text) => new() { Text = text, AutoSize = true, Margin = new(8, 10, 2, 0) };
    private static TextBox TextArea() => new() { Multiline = true, ReadOnly = true, Dock = DockStyle.Fill, ScrollBars = ScrollBars.Both, WordWrap = false, Font = new("Consolas", 10), BackColor = Color.White, BorderStyle = BorderStyle.FixedSingle };
    private static DataGridView Grid() => new() { Dock = DockStyle.Fill, ReadOnly = true, AllowUserToAddRows = false, AllowUserToDeleteRows = false, AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill, RowHeadersVisible = false, BackgroundColor = Color.White, BorderStyle = BorderStyle.None, SelectionMode = DataGridViewSelectionMode.FullRowSelect, AutoGenerateColumns = true };
    private static FlowLayoutPanel Flow() => new() { Dock = DockStyle.Top, Height = 46, Padding = new(4), AutoScroll = true, WrapContents = false };
    private Button Button(string title, Func<Task> action, bool tracked = true)
    {
        var b = new Button { Text = title, AutoSize = true, Height = 32, Padding = new(5, 0, 5, 0) };
        b.Click += async (_, _) => await Run(action); if (tracked) actions.Add(b); return b;
    }
    private TabPage Page(string title, Control body, params Control[] controls)
    {
        var p = new TabPage(title) { Padding = new(12) }; p.Controls.Add(body);
        if (controls.Length > 0) { var row = Flow(); row.Controls.AddRange(controls); p.Controls.Add(row); }
        tabs.TabPages.Add(p); return p;
    }
    private void BuildTabs()
    {
        overview.Text = "CONEXIÓN Y CAPACIDADES\r\n\r\nAplicación de escritorio con controles nativos de Windows.\r\nNo necesita Chrome, Node ni un servidor local.\r\n\r\nELM327 Bluetooth Classic: emparejar en Windows y seleccionar su COM saliente.\r\nKKL USB: instalar FTDI/CH340 y usar un COM; diagnóstico KW1281.\r\nAutel J2534: instalar el driver oficial y abrir la versión x86/x64 que coincida con su DLL.\r\n\r\nSelecciona un simulador para explorar sin conectar un vehículo.\r\n\r\nMercado chileno: se consulta lo que responde cada ECU. No se deduce compatibilidad por país.\r\nGolf ME3.7: identificación pendiente de confirmar antes de elegir un perfil de lectura.\r\n\r\nLos datos sin referencia no se convierten en diagnósticos confirmados.\r\nLa lectura UDS manual requiere direcciones documentadas de la ECU.\r\nEl taller de mapas trabaja sobre copias de BIN, sin escribir flash.";
        Page("Inicio", overview, Button("Guardar sesión", ExportSession), Button("Imprimir informe / PDF", PrintReport));
        foreach (var p in Obd.Parameters) { int index = selection.Items.Add($"{p.Pid:X2} · {p.Name}"); selection.SetItemChecked(index, new byte[] { 0x05, 0x0C, 0x0D, 0x10, 0x42 }.Contains(p.Pid)); }
        var livePanel = new Panel { Dock = DockStyle.Fill }; livePanel.Controls.Add(live); livePanel.Controls.Add(selection); livePanel.Controls.Add(graph);
        Page("Datos en vivo", livePanel, Button("Leer selección", ReadLive), polling, Button("Descubrir PID", Discover), Button("Exportar sesión", ExportSession));
        Page("Códigos y congelados", faults, Button("Almacenados", () => ReadFaults(3)), Button("Pendientes", () => ReadFaults(7)), Button("Permanentes", () => ReadFaults(0x0A)), Button("Datos congelados", ReadFreeze), Button("Borrar códigos…", ClearFaults));
        Page("Computadoras", identity, Button("Identificar OBD", ReadIdentity), Button("Identificar UDS", ReadUdsIdentity));
        Page("Emisiones", emissions, Button("Leer monitores", ReadEmissions), Button("Autodiagnósticos modo 06", ReadMode06));
        Page("VAG / KKL", kklOutput, Label("Grupo"), group, Button("Leer mediciones", ReadKklGroup), Button("Leer fallas VAG", ReadKklFaults));
        var cancel = new Button { Text = "Cancelar lectura", AutoSize = true }; cancel.Click += (_, _) => operation?.Cancel();
        Page("Lectura ECU", memoryOutput, Label("Dirección hex"), memoryAddress, Label("Bytes"), memoryLength, memoryMethod, Button("Leer ECU", ReadMemory), cancel, progress, Button("Guardar BIN", SaveMemory));
        Page("Mapas / BIN", mapGrid, Button("Abrir BIN", OpenBinary), Button("Importar XDF", OpenXdf), maps, Button("Editar valor crudo", EditMapCell), Button("Comparar BIN", CompareBinary), Button("Exportar copia…", ExportBinary));
        maps.SelectedIndexChanged += (_, _) => ShowMap();
        Page("Información de BIN", mapInfo);
        Page("Terminal", trace, command, Button("Enviar lectura", Terminal), Button("Guardar traza", ExportSession));
        Page("Historial", history, Button("Actualizar", RefreshHistory), Button("Abrir registro", OpenHistory));
        var help = TextArea(); help.Text = HelpText; Page("Ayuda y fuentes", help);
        Page("Interpretación", patterns, Label("Combustible"), fuel, Label("Cilindrada (L, 0 = desconocida)"), displacement, Button("Evaluar lectura actual", EvaluateRules));
        var knowledge = TextArea(); knowledge.Text = Knowledge.Display; Page("Base de conocimiento", knowledge);
        var mapTools = Flow(); mapTools.Dock = DockStyle.Bottom;
        mapTools.Controls.AddRange([Button("Mapa de demostración", () => LoadBuiltInMaps(1)), Button("Referencia ME7.5 1.8T…", () => LoadBuiltInMaps(0))]);
        tabs.TabPages[7].Controls.Add(mapTools);
        faults.SelectionChanged += (_, _) =>
        {
            if (faults.CurrentRow?.Cells.Cast<DataGridViewCell>().FirstOrDefault(c => c.OwningColumn?.DataPropertyName == "Code")?.Value is string code)
            { var reference = Knowledge.DtcDisplay(code); if (reference is not null) patterns.Text = reference; }
        };
    }
    private async Task Run(Func<Task> action)
    {
        if (busy || closing) return; busy = true; operation = new(); foreach (var button in actions) button.Enabled = false;
        try { await action(); }
        catch (OperationCanceledException) { status.Text = "  Operación cancelada"; }
        catch (Exception ex)
        {
            status.Text = "  " + ex.Message; trace.AppendText($"{DateTimeOffset.Now:O} ERROR {ex.Message}\r\n");
            if (!closing) MessageBox.Show(this, ex.Message, "No se pudo completar la operación", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        finally { operation.Dispose(); operation = null; busy = false; foreach (var button in actions) button.Enabled = true; UpdateTrace(); }
    }
    private CancellationToken Ct => operation?.Token ?? CancellationToken.None;
    private DiagnosticSession Connected => session ?? throw new DiagnosticException("Conecta un ELM327, J2534 o simulador. Para KKL usa la pestaña VAG / KKL");
    private Task RefreshDevices()
    {
        var selected = port.Text; port.Items.Clear(); port.Items.AddRange(SerialPort.GetPortNames().Order().Cast<object>().ToArray());
        if (selected.Length > 0) port.Text = selected; else if (port.Items.Count > 0) port.SelectedIndex = 0;
        devices.Items.Clear(); devices.Items.AddRange(J2534Discovery.Devices().Cast<object>().ToArray()); if (devices.Items.Count > 0) devices.SelectedIndex = 0; return Task.CompletedTask;
    }
    private Task ChooseDll()
    {
        using var dialog = new OpenFileDialog { Filter = "Driver J2534 (*.dll)|*.dll" };
        if (dialog.ShowDialog(this) == DialogResult.OK) { var device = new PassThruDevice(Path.GetFileName(dialog.FileName), dialog.FileName, J2534Discovery.Architecture(dialog.FileName)); devices.Items.Add(device); devices.SelectedItem = device; }
        return Task.CompletedTask;
    }
    private async Task Disconnect()
    {
        polling.Checked = false; snapshot.Clear();
        if (session is not null) { await session.DisposeAsync(); session = null; }
        if (kkl is not null) { await kkl.DisposeAsync(); kkl = null; }
        supported = null; status.Text = "  Sin conexión";
    }
    private async Task Connect()
    {
        await Disconnect();
        if (adapter.SelectedIndex == 4)
        {
            var link = new KklSession(port.Text, int.Parse(baud.Text, CultureInfo.InvariantCulture));
            try { await link.Open((byte)kklAddress.Value, Ct); kkl = link; } catch { await link.DisposeAsync(); throw; }
            kklOutput.Text = $"KW{link.Version} · {port.Text}\r\n{link.Identification}"; status.Text = "  KKL conectado · KW1281 · temporización no validada con hardware"; tabs.SelectedIndex = 5; return;
        }
        IDiagnosticLink transport = adapter.SelectedIndex switch
        {
            0 => new SimulatedLink(),
            1 => new SimulatedLink { Diesel = true },
            2 => await ElmSerialLink.Open(port.Text, int.Parse(baud.Text, CultureInfo.InvariantCulture), Ct),
            3 => await J2534Link.Open(devices.SelectedItem as PassThruDevice ?? throw new DiagnosticException("No hay driver J2534 seleccionado"), Hex.Number(tx.Text), Hex.Number(rx.Text), uint.Parse(canBaud.Text, CultureInfo.InvariantCulture), Ct),
            _ => throw new DiagnosticException("Selecciona interfaz")
        };
        session = new(transport); if (transport.IsSimulation) fuel.SelectedIndex = adapter.SelectedIndex == 1 ? 2 : 1; status.Text = "  " + transport.Description;
        overview.Text += $"\r\n\r\n{DateTime.Now:g} · {transport.Description}\r\n";
        try { await Discover(); await ReadIdentity(); } catch (Exception ex) when (ex is DiagnosticException or TimeoutException or IOException) { overview.Text += "Conectado al adaptador; ECU aún sin respuesta: " + ex.Message; }
    }
    private async Task Discover() { supported = await Connected.SupportedPids(Ct); status.Text = $"  {Connected.Link.Description} · {supported.Count} PID anunciados"; }
    private async Task ReadLive()
    {
        var readings = new List<Reading>(); snapshot.Clear();
        foreach (int index in selection.CheckedIndices.Cast<int>().ToArray())
        {
            Ct.ThrowIfCancellationRequested(); var p = Obd.Parameters[index];
            if (supported is not null && !supported.Contains(p.Pid)) { readings.Add(new(p.Name, null, p.Unit, "NO COMPATIBLE", "")); continue; }
            try { var reading = await Connected.Read(p, ct: Ct); readings.Add(reading); if (reading.Value is double observed && ParamId(p.Pid) is string id) snapshot[id] = observed; if (p.Pid == 0x0C && reading.Value is double rpm) graph.Add(rpm); }
            catch (Exception ex) when (ex is DiagnosticException or TimeoutException) { readings.Add(new(p.Name, null, p.Unit, ex.Message, "")); }
        }
        live.DataSource = readings; AppendPatterns(readings); await EvaluateRules();
    }
    private void AppendPatterns(List<Reading> readings)
    {
        var rpm = readings.FirstOrDefault(r => r.Parameter == "Régimen")?.Value;
        var temp = readings.FirstOrDefault(r => r.Parameter == "Refrigerante")?.Value;
        if (temp > 110) status.Text = "  Temperatura alta observada; verificar condiciones y documentación del motor";
        else if (rpm == 0) status.Text = "  Motor detenido · lectura disponible · " + Connected.Link.Description;
    }
    private static string? ParamId(byte pid) => pid switch { 4 => "load", 5 => "coolant", 6 => "stft1", 7 => "ltft1", 0x0C => "rpm", 0x10 => "maf", 0x42 => "module_voltage", _ => null };
    private Task EvaluateRules()
    {
        var result = DiagnosticRules.Evaluate(snapshot, fuel.SelectedIndex switch { 1 => "gasolina", 2 => "diesel", _ => null }, displacement.Value == 0 ? null : (double)displacement.Value);
        patterns.Text = "LECTURA ACTUAL · hipótesis a verificar, sin diagnósticos confirmados\r\n\r\n" + string.Join("\r\n\r\n", result.Select(r => $"{r.Status} · {r.Rule}\r\n{r.Observation}\r\nSiguiente comprobación: {r.NextStep}"));
        return Task.CompletedTask;
    }
    private Task LoadBuiltInMaps(int index)
    {
        if (index == 0 && MessageBox.Show(this, "Referencia ME7.5 1.8T de un ROM concreto: no aplica automáticamente al Golf ni a ME3.7. Confirma que solo la usarás como referencia hasta verificar direcciones y versión de software.", "Definición de referencia", MessageBoxButtons.OKCancel) != DialogResult.OK) return Task.CompletedTask;
        maps.Items.Clear(); maps.Items.AddRange(Knowledge.Maps(index).Cast<object>().ToArray()); maps.SelectedIndex = 0; return Task.CompletedTask;
    }
    private Task PrintReport()
    {
        var current = Connected;
        string report = $"SCANER ELM327 · {DateTimeOffset.Now:O}\r\n{current.Link.Description}\r\n{(current.Link.IsSimulation ? "SIMULACIÓN" : "Lecturas de vehículo")}\r\n\r\n{identity.Text}\r\n\r\n{emissions.Text}\r\n\r\n{patterns.Text}\r\n\r\nTraza reciente:\r\n" + string.Join("\r\n", current.Trace.TakeLast(250).Select(t => $"{t.Time:HH:mm:ss.fff} {t.Direction} {t.Bytes}"));
        using var document = new System.Drawing.Printing.PrintDocument(); document.DocumentName = "Informe diagnóstico Scaner"; int offset = 0;
        using var font = new Font("Consolas", 9);
        document.PrintPage += (sender, e) =>
        {
            if (e.Graphics is null) return; var area = e.MarginBounds;
            e.Graphics.MeasureString(report[offset..], font, area.Size, StringFormat.GenericTypographic, out int chars, out _);
            if (chars == 0) { e.HasMorePages = false; return; }
            e.Graphics.DrawString(report.Substring(offset, chars), font, Brushes.Black, area, StringFormat.GenericTypographic); offset += chars; e.HasMorePages = offset < report.Length;
        };
        using var dialog = new PrintDialog { Document = document, UseEXDialog = true }; if (dialog.ShowDialog(this) == DialogResult.OK) document.Print(); return Task.CompletedTask;
    }
    private async Task ReadFaults(byte mode) { faults.DataSource = (await Connected.Faults(mode, Ct)).ToList(); }
    private async Task ReadFreeze()
    {
        var readings = new List<Reading>(); foreach (int index in selection.CheckedIndices.Cast<int>().ToArray())
        { try { readings.Add(await Connected.Read(Obd.Parameters[index], 2, Ct)); } catch (DiagnosticException ex) { readings.Add(new(Obd.Parameters[index].Name, null, "", ex.Message, "")); } }
        faults.DataSource = readings;
    }
    private async Task ClearFaults()
    {
        _ = Connected;
        if (MessageBox.Show(this, "Se borrarán códigos y datos congelados, y se reiniciarán los monitores de emisiones. Guarda la sesión antes. ¿Continuar?", "Borrar códigos OBD", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
        using var verify = new Form { Text = "Confirmar borrado", Width = 420, Height = 170, StartPosition = FormStartPosition.CenterParent };
        var input = new TextBox { Dock = DockStyle.Top }; var label = new Label { Text = "Escribe BORRAR para enviar el modo OBD 04", Dock = DockStyle.Top, Height = 35 }; var confirm = new Button { Text = "Confirmar", Dock = DockStyle.Bottom, DialogResult = DialogResult.OK }; verify.Controls.Add(input); verify.Controls.Add(label); verify.Controls.Add(confirm); verify.AcceptButton = confirm;
        if (verify.ShowDialog(this) != DialogResult.OK || input.Text != "BORRAR") return;
        var replies = await Connected.RequestAsync([4], Ct); if (replies.Count == 0) throw new DiagnosticException("No hubo confirmación de borrado");
        foreach (var reply in replies) DiagnosticSession.Positive(reply, 4); await ReadFaults(3);
    }
    private async Task ReadIdentity() { var result = await Connected.Identity(Ct); identity.Text = string.Join("\r\n", result.Select(k => $"{k.Key}: {k.Value}")); }
    private async Task ReadUdsIdentity()
    {
        foreach (var (did, name) in new[] { ((ushort)0xF190, "VIN"), ((ushort)0xF187, "Repuesto"), ((ushort)0xF189, "Versión software"), ((ushort)0xF191, "Hardware"), ((ushort)0xF18C, "Serie") })
        { try { identity.AppendText($"\r\n{name} ({did:X4}): {await Connected.UdsIdentification(did, Ct)}"); } catch (DiagnosticException ex) { identity.AppendText($"\r\n{name}: {ex.Message}"); } }
    }
    private async Task ReadEmissions()
    {
        var replies = await Connected.RequestAsync([1, 1], Ct); var lines = new List<string>();
        foreach (var reply in replies)
        {
            var bytes = DiagnosticSession.Positive(reply, 1); if (bytes.Length < 6 || bytes[1] != 1) throw new DiagnosticException("Respuesta PID 01 incompleta");
            var result = Obd.DecodeReadiness(bytes[2..]);
            lines.Add($"ECU {reply.Address:X} · MIL {(result.Mil ? "ENCENDIDA" : "apagada")} · DTC: {result.TroubleCodes} · {(result.CompressionIgnition ? "Diésel" : "Gasolina")} · Crudo {Convert.ToHexString(bytes)}");
            lines.AddRange(result.Monitors.Select(m => $"{m.Name}: {(!m.Supported ? "NO COMPATIBLE" : m.Complete ? "COMPLETO" : "INCOMPLETO")}"));
        }
        lines.Add("\r\nEstado OBD de monitores. No constituye un certificado de revisión técnica chilena."); emissions.Text = string.Join("\r\n", lines);
    }
    private async Task ReadMode06()
    {
        var results = await Mode06.Read(Connected, Ct);
        emissions.Text = "MODO 06 · unidades internas; escala declarada, sin conversión supuesta\r\n\r\n" + string.Join("\r\n", results.Select(r => $"ECU {r.Ecu:X} · MID {r.Mid:X2} · TID {r.Tid:X2} · escala {r.Scale:X2}: {r.Value} [{r.Minimum}, {r.Maximum}] · {(r.Passed ? "APROBÓ" : "NO APROBÓ")} · posición {r.Position:F1}%"));
        if (results.Count == 0) emissions.AppendText("Sin resultados comunicados por la ECU");
    }
    private async Task ReadKklGroup()
    {
        if (kkl is null) throw new DiagnosticException("Conecta el cable KKL primero");
        kklOutput.AppendText($"\r\nGrupo {group.Value}:\r\n{string.Join("\r\n", await kkl.ReadGroup((byte)group.Value, Ct))}\r\n");
    }
    private async Task ReadKklFaults()
    { if (kkl is null) throw new DiagnosticException("Conecta el cable KKL primero"); kklOutput.AppendText("\r\n" + string.Join("\r\n", await kkl.Faults(Ct))); }
    private async Task ReadMemory()
    {
        if (!Connected.Link.IsSimulation && Connected.Link is not J2534Link) throw new DiagnosticException("Usa J2534 para lectura UDS de memoria; el ELM327 se mantiene para diagnóstico");
        if (!Connected.Link.IsSimulation && MessageBox.Show(this, "Lectura manual UDS: confirma que la dirección, longitud y sesión extendida corresponden a la documentación de esta ECU. No se solicita ninguna llave de seguridad ni se escribe flash.", "Lectura manual", MessageBoxButtons.OKCancel) != DialogResult.OK) return;
        lastAddress = Hex.Number(memoryAddress.Text); int length = (int)memoryLength.Value; progress.Maximum = length; progress.Value = 0;
        lastMethod = memoryMethod.SelectedIndex == 1 ? "0x35" : "0x23";
        var advance = new Progress<int>(v => { if (!IsDisposed) progress.Value = Math.Min(v, progress.Maximum); });
        lastMemory = lastMethod == "0x35" ? await MemoryUpload.Read(Connected, lastAddress, length, advance, Ct) : await Connected.ReadMemory(lastAddress, length, advance, Ct);
        memoryOutput.Text = $"{(lastMemory.Complete ? "LECTURA COMPLETA" : "LECTURA INCOMPLETA")} · {lastMemory.Data.Length}/{length} bytes\r\n{lastMemory.Error}\r\nSHA-256: {Calibration.Sha256(lastMemory.Data)}\r\n\r\n" + Hex.Dump(lastMemory.Data.Take(16384).ToArray(), lastAddress);
        if (lastMemory.Data.Length > 16384) memoryOutput.AppendText("\r\nVista limitada a 16 KiB. Guardar BIN conserva todos los bytes recibidos.");
    }
    private async Task SaveMemory()
    {
        var result = lastMemory ?? throw new DiagnosticException("Primero realiza una lectura");
        if (result.Data.Length == 0) throw new DiagnosticException("No se recibieron bytes; no se genera un BIN vacío");
        using var dialog = new SaveFileDialog { Filter = "BIN (*.bin)|*.bin", FileName = result.Complete ? "ecu-lectura.bin" : "ecu-lectura.partial.bin" };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        await File.WriteAllBytesAsync(dialog.FileName, result.Data, Ct);
        await File.WriteAllTextAsync(dialog.FileName + ".json", JsonSerializer.Serialize(new { created = DateTimeOffset.Now, address = lastAddress, method = lastMethod, result.Requested, received = result.Data.Length, result.Complete, result.Error, sha256 = Calibration.Sha256(result.Data), transport = session?.Link.Description }, JsonOptions), Ct);
    }
    private async Task OpenBinary()
    {
        using var dialog = new OpenFileDialog { Filter = "Memoria ECU (*.bin)|*.bin|Todos|*.*" }; if (dialog.ShowDialog(this) != DialogResult.OK) return;
        if (new FileInfo(dialog.FileName).Length > 64 * 1024 * 1024) throw new DiagnosticException("Límite del visor: 64 MiB");
        original = await File.ReadAllBytesAsync(dialog.FileName, Ct); edited = original.ToArray(); originalPath = dialog.FileName;
        mapInfo.Text = $"Archivo: {originalPath}\r\nTamaño: {original.Length} bytes\r\nSHA-256 original: {Calibration.Sha256(original)}\r\n\r\nImporta un XDF que corresponda exactamente al software de tu ECU.\r\nSe admiten tablas enteras de 8/16/32 bits y fórmulas aritméticas.\r\nLas direcciones de una ME7.5 1.8T no se aplican a una ME3.7 ni a otro ROM.\r\n\r\nLos cambios se hacen sobre una copia. No hay escritura de flash.\r\nNo se corrigen checksums: un BIN editado NO queda validado para programar.\r\n\r\n" + Hex.Dump(original.Take(4096).ToArray()); ShowMap();
    }
    private async Task OpenXdf()
    {
        using var dialog = new OpenFileDialog { Filter = "TunerPro XDF (*.xdf)|*.xdf" }; if (dialog.ShowDialog(this) != DialogResult.OK) return;
        var definitions = Calibration.ImportXdf(await File.ReadAllTextAsync(dialog.FileName, Ct)); maps.Items.Clear(); maps.Items.AddRange(definitions.Cast<object>().ToArray()); maps.SelectedIndex = 0;
    }
    private void ShowMap()
    {
        if (updatingMap || edited is null || maps.SelectedItem is not MapDefinition map) return;
        try
        {
            updatingMap = true; var values = Calibration.Read(edited, map);
            mapGrid.DataSource = values.Select((v, i) => new { Celda = i, Fila = i / map.Columns, Columna = i % map.Columns, Direccion = $"{map.Address + i * (map.Bits / 8):X8}", Crudo = Calibration.ReadRaw(edited, map, i), Valor = v, Unidad = map.Unit }).ToList();
        }
        catch (Exception ex) { mapGrid.DataSource = null; mapInfo.AppendText("\r\n" + ex.Message); status.Text = "  " + ex.Message; }
        finally { updatingMap = false; }
    }
    private Task EditMapCell()
    {
        if (edited is null || maps.SelectedItem is not MapDefinition map || mapGrid.CurrentRow is null) throw new DiagnosticException("Abre BIN, importa XDF y selecciona una celda");
        int cell = mapGrid.CurrentRow.Index;
        using var dialog = new Form { Text = "Editar valor crudo · copia local", Width = 480, Height = 190, StartPosition = FormStartPosition.CenterParent };
        var value = new TextBox { Dock = DockStyle.Top, Text = Calibration.ReadRaw(edited, map, cell).ToString(CultureInfo.InvariantCulture) };
        var note = new Label { Dock = DockStyle.Top, Height = 60, Text = $"{map.Title} · celda {cell}\r\nIntroduce un entero crudo. Fórmula física: {map.Equation}" };
        var ok = new Button { Text = "Aplicar a la copia", Dock = DockStyle.Bottom, DialogResult = DialogResult.OK }; dialog.Controls.Add(value); dialog.Controls.Add(note); dialog.Controls.Add(ok); dialog.AcceptButton = ok;
        if (dialog.ShowDialog(this) == DialogResult.OK) { Calibration.WriteRaw(edited, map, cell, long.Parse(value.Text, CultureInfo.InvariantCulture)); ShowMap(); status.Text = "  Copia editada; checksums pendientes de validación externa"; }
        return Task.CompletedTask;
    }
    private async Task CompareBinary()
    {
        if (original is null) throw new DiagnosticException("Abre el BIN original primero");
        using var dialog = new OpenFileDialog { Filter = "BIN (*.bin)|*.bin" }; if (dialog.ShowDialog(this) != DialogResult.OK) return;
        var other = await File.ReadAllBytesAsync(dialog.FileName, Ct); var differences = Calibration.Compare(original, other);
        mapInfo.Text = $"Original: {Calibration.Sha256(original)}\r\nComparado: {Calibration.Sha256(other)}\r\nBytes distintos: {differences.Count}\r\n" + string.Join("\r\n", differences.Take(10000).Select(d => $"{d.Address:X8}: {d.Before:X2} → {d.After:X2}")); tabs.SelectedIndex = 8;
    }
    private async Task ExportBinary()
    {
        if (original is null || edited is null) throw new DiagnosticException("Abre un BIN primero");
        using var dialog = new SaveFileDialog { Filter = "BIN (*.bin)|*.bin", FileName = "calibracion-editada-NO-VALIDADA.bin" }; if (dialog.ShowDialog(this) != DialogResult.OK) return;
        if (string.Equals(Path.GetFullPath(dialog.FileName), Path.GetFullPath(originalPath!), StringComparison.OrdinalIgnoreCase)) throw new DiagnosticException("Elige otro archivo para conservar el BIN original");
        var changes = Calibration.Compare(original, edited);
        await File.WriteAllBytesAsync(dialog.FileName, edited, Ct);
        await File.WriteAllTextAsync(dialog.FileName + ".json", JsonSerializer.Serialize(new { created = DateTimeOffset.Now, originalSha256 = Calibration.Sha256(original), modifiedSha256 = Calibration.Sha256(edited), checksumValidated = false, flashReady = false, changes }, JsonOptions), Ct);
        status.Text = "  Copia exportada con registro de cambios; no validada para programación";
    }
    private async Task Terminal()
    {
        var bytes = Hex.Parse(command.Text);
        if (bytes.Length == 0 || !new byte[] { 1, 2, 3, 7, 9, 10, 0x19, 0x22, 0x23, 0x3E }.Contains(bytes[0])) throw new DiagnosticException("Terminal de lectura: servicios 01, 02, 03, 07, 09, 0A, 19, 22, 23, 3E. El borrado se hace desde Códigos");
        var replies = await Connected.RequestAsync(bytes, Ct); if (replies.Count == 0) trace.AppendText("Sin respuesta\r\n");
    }
    private void UpdateTrace()
    { if (session is not null) trace.Text = string.Join("\r\n", session.Trace.TakeLast(1500).Select(t => $"{t.Time:HH:mm:ss.fff} {t.Direction,-8} {t.Bytes}")); }
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
    private async Task ExportSession()
    {
        var current = Connected; Directory.CreateDirectory(historyDirectory);
        var path = Path.Combine(historyDirectory, $"sesion-{DateTime.Now:yyyyMMdd-HHmmss-fff}.json");
        await File.WriteAllTextAsync(path, JsonSerializer.Serialize(new { version = "0.2.0", created = DateTimeOffset.Now, transport = current.Link.Description, simulation = current.Link.IsSimulation, trace = current.Trace }, JsonOptions), Ct);
        status.Text = "  Sesión guardada: " + path; await RefreshHistory();
    }
    private Task RefreshHistory()
    {
        Directory.CreateDirectory(historyDirectory); history.DataSource = new DirectoryInfo(historyDirectory).GetFiles("*.json").OrderByDescending(f => f.LastWriteTimeUtc).Select(f => new { Archivo = f.Name, Fecha = f.LastWriteTime, Tamano = f.Length, Ruta = f.FullName }).ToList(); return Task.CompletedTask;
    }
    private async Task OpenHistory()
    {
        if (history.CurrentRow?.Cells["Ruta"].Value is not string path) return;
        trace.Text = await File.ReadAllTextAsync(path, Ct); tabs.SelectedIndex = 9;
    }
    internal async Task<int> ValidateSimulation()
    {
        adapter.SelectedIndex = 0; await Connect(); await ReadLive();
        int rows = live.Rows.Count; if (rows == 0) throw new InvalidOperationException("No se generaron lecturas");
        await ReadFaults(3); if (faults.Rows.Count != 2) throw new InvalidOperationException("DTC de simulación incorrectos");
        await ReadIdentity(); if (!identity.Text.Contains("WVWZZZ1JZXW000001")) throw new InvalidOperationException("VIN de simulación incorrecto");
        await ReadEmissions(); if (!emissions.Text.Contains("ECU 7E8")) throw new InvalidOperationException("Monitores de simulación ausentes");
        await ReadMemory(); if (lastMemory is not { Complete: true }) throw new InvalidOperationException("Lectura simulada incompleta");
        await Disconnect(); tabs.SelectedIndex = 1; return rows;
    }
    private async void OnClosing(object? sender, FormClosingEventArgs e)
    {
        if (allowClose) return; e.Cancel = true; if (closing) return; closing = true; liveTimer.Stop(); kklTimer.Stop(); operation?.Cancel();
        while (busy) await Task.Delay(50);
        try { await Disconnect(); } finally { allowClose = true; Close(); }
    }
    private const string HelpText = """
    SCANER ELM327 · WINDOWS NATIVO

    Instala los drivers oficiales antes de conectar hardware.
    ELM327 Bluetooth Classic: empareja el adaptador en Windows y usa el puerto COM saliente.
    Prueba el baud rate documentado por el fabricante: 38400, 9600 o 115200.
    KKL: cable USB/serie K-Line y COM FTDI/CH340. No es compatible automáticamente con HEX-V2/HEX-NET propietarios de Ross-Tech.
    KKL implementa KW1281: identificación, fallas y grupos de medición; el handshake físico aún necesita validación con vehículo.
    J2534: instala el controlador oficial Autel. La app detecta las DLL registradas (API 04.04).
    Abre el EXE de la misma arquitectura que la DLL, aunque Windows sea de 64 bits.
    El transporte nativo J2534 implementa ISO15765 CAN/ISO-TP, 11/29 bits y 250/500 kbit/s.
    Otros protocolos anunciados por Autel no se habilitan automáticamente.

    COBERTURA
    OBD-II: descubrimiento de PID, datos en vivo, congelados, códigos almacenados/pendientes/permanentes, borrado confirmado, identidad y monitores.
    UDS: identificación por DID y lectura manual 0x23 / subida 0x35 con progreso, cancelación y registro de lecturas incompletas.
    ECU: no se adivinan direcciones, algoritmos de seguridad ni perfiles por nombre de vehículo.
    Mapas: BIN + tablas XDF enteras, endian explícito, edición de valores crudos, comparación, SHA-256 y copia exportada.
    Un XDF debe coincidir con la referencia y versión exacta de la ECU.
    Sin corrección de checksum ni programación de flash; los BIN editados se marcan no validados.
    El historial y las trazas se guardan localmente, sin cuentas ni servidor.
    No se certifica el resultado de la revisión técnica chilena por los monitores OBD.

    FUENTES REVISADAS
    https://github.com/gmenounos/kw1281test — KW1281, eco KKL, bloques y límites de cables (MIT).
    https://github.com/rnd-ash/OpenVehicleDiag — protocolos y estructura de diagnóstico; referencia, sin copiar código.
    https://github.com/bri3d/VW_Flash — ejemplos específicos de UDS/ECU; no es un perfil para ME3.7.
    https://github.com/NefMoto/NefMotoOpenSource — lectura/programación ME7 específica; no intercambiable con UDS CAN.

    El código web y sus funciones se conservan en el repositorio. Consulta native/docs/COBERTURA.md para las diferencias de esta versión nativa.
    """;
}

public sealed class TrendGraph : Control
{
    private readonly Queue<double> values = [];
    public TrendGraph() { DoubleBuffered = true; BackColor = Color.FromArgb(19, 40, 58); }
    public void Add(double value) { values.Enqueue(value); while (values.Count > 120) values.Dequeue(); Invalidate(); }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e); e.Graphics.DrawString("Régimen · últimas 120 lecturas (rpm)", Font, Brushes.White, 14, 12);
        if (values.Count < 2) return; var data = values.ToArray(); double max = Math.Max(1500, data.Max() * 1.1);
        var points = data.Select((v, i) => new PointF(14 + i * (Width - 28f) / Math.Max(1, data.Length - 1), Height - 20 - (float)(v / max) * (Height - 60))).ToArray();
        using var pen = new Pen(Color.FromArgb(59, 214, 179), 2); e.Graphics.DrawLines(pen, points);
        e.Graphics.DrawString($"{data[^1]:N0} rpm", Font, Brushes.White, Width - 120, 12);
    }
}
