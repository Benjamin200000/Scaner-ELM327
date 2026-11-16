using System.Text;
using System.Buffers.Binary;

namespace Scaner.Core;

public record Parameter(byte Pid, string Name, string Unit, int Bytes, Func<byte[], double?> Decode, bool Verified=true);
public record Reading(string Parameter, double? Value, string Unit, string Status, string Raw);
public record TroubleCode(string Ecu, string Code, string Description, string State);
public record MonitorStatus(string Name, bool Supported, bool Complete);
public record Readiness(bool Mil, int TroubleCodes, bool CompressionIgnition, IReadOnlyList<MonitorStatus> Monitors);
public record TraceEntry(DateTimeOffset Time, string Direction, string Bytes);
public record MemoryResult(byte[] Data, int Requested, bool Complete, string? Error);

public static class Obd
{
    private static int U16(byte[] b) => b[0] * 256 + b[1];
    public static readonly Parameter[] Parameters =
    [
        new(0x04,"Carga calculada","%",1,b=>b[0]*100.0/255), new(0x05,"Refrigerante","°C",1,b=>b[0]-40),
        new(0x06,"Corrección corta B1","%",1,b=>(b[0]-128)/1.28), new(0x07,"Corrección larga B1","%",1,b=>(b[0]-128)/1.28),
        new(0x0A,"Presión combustible","kPa",1,b=>b[0]*3), new(0x0B,"Presión colector","kPa",1,b=>b[0]),
        new(0x0C,"Régimen","rpm",2,b=>U16(b)/4.0), new(0x0D,"Velocidad","km/h",1,b=>b[0]),
        new(0x0E,"Avance encendido","°",1,b=>b[0]/2.0-64), new(0x0F,"Aire admisión","°C",1,b=>b[0]-40),
        new(0x10,"Caudal MAF","g/s",2,b=>U16(b)/100.0), new(0x11,"Mariposa","%",1,b=>b[0]*100.0/255),
        new(0x1F,"Tiempo encendido","s",2,b=>U16(b)), new(0x21,"Distancia con MIL","km",2,b=>U16(b)),
        new(0x23,"Presión riel","kPa",2,b=>U16(b)*10), new(0x2C,"EGR solicitada","%",1,b=>b[0]*100.0/255),
        new(0x2D,"Error EGR","%",1,b=>(b[0]-128)*100.0/128),new(0x2F,"Combustible","%",1,b=>b[0]*100.0/255),
        new(0x31,"Distancia desde borrado","km",2,b=>U16(b)),new(0x33,"Presión atmosférica","kPa",1,b=>b[0]),
        new(0x42,"Tensión ECU","V",2,b=>U16(b)/1000.0),new(0x43,"Carga absoluta","%",2,b=>U16(b)*100.0/255),
        new(0x44,"Lambda solicitada","λ",2,b=>U16(b)*2.0/65536),new(0x46,"Temperatura ambiente","°C",1,b=>b[0]-40),
        new(0x4D,"Tiempo con MIL","min",2,b=>U16(b)),new(0x51,"Tipo combustible (código)","",1,b=>b[0]),
        new(0x5C,"Aceite","°C",1,b=>b[0]-40),new(0x5E,"Consumo","L/h",2,b=>U16(b)/20.0),new(0x62,"Par motor","%",1,b=>b[0]-125),
        new(0x70,"Boost solicitado [sin verificar]","kPa",7,b=>(b[0]&1)!=0?(b[1]*256+b[2])*.03125:null,false),
        new(0x70,"Boost real [sin verificar]","kPa",7,b=>(b[0]&2)!=0?(b[3]*256+b[4])*.03125:null,false),
        new(0x78,"Escape 1 [sin verificar]","°C",9,b=>(b[0]&1)!=0?(b[1]*256+b[2])*.1-40:null,false),
        new(0x7A,"Diferencial DPF [sin verificar]","kPa",9,b=>(b[0]&8)!=0?(b[3]*256+b[4])*.01-327.68:null,false),
        new(0x7C,"Entrada DPF [sin verificar]","°C",9,b=>(b[0]&1)!=0?(b[1]*256+b[2])*.1-40:null,false),
        new(0x7C,"Salida DPF [sin verificar]","°C",9,b=>(b[0]&8)!=0?(b[3]*256+b[4])*.1-40:null,false)
    ];
    public static string Dtc(byte a, byte b) => $"{"PCBU"[a >> 6]}{(a >> 4) & 3}{a & 15:X}{b:X2}";
    public static string DtcDescription(string code) => code switch
    {
        "P0100"=>"Circuito del caudalímetro MAF", "P0101"=>"Rango/rendimiento del MAF", "P0115"=>"Circuito temperatura refrigerante",
        "P0120"=>"Circuito posición mariposa", "P0130"=>"Circuito sonda O2 B1S1", "P0171"=>"Mezcla pobre banco 1",
        "P0172"=>"Mezcla rica banco 1", "P0300"=>"Fallos de combustión múltiples", "P0301"=>"Fallo de combustión cilindro 1",
        "P0401"=>"Flujo EGR insuficiente", "P0420"=>"Eficiencia catalizador banco 1", "P0299"=>"Presión de sobrealimentación insuficiente",
        "P0234"=>"Sobrepresión de turbo", "P2002"=>"Eficiencia filtro de partículas", _=>"Sin referencia local; consultar documentación del fabricante"
    };
    public static Readiness DecodeReadiness(byte[] bytes)
    {
        if (bytes.Length < 4) throw new DiagnosticException("PID 01 incompleto");
        var diesel = (bytes[1] & 8) != 0;
        var monitors = new List<MonitorStatus>();
        var continuous = new[] {"Fallo de combustión", "Sistema de combustible", "Componentes integrales"};
        for (int i=0;i<3;i++) monitors.Add(new(continuous[i],(bytes[1]&(1<<i))!=0,(bytes[1]&(1<<(i+4)))==0));
        var names = diesel ? new Dictionary<int,string>{{0,"Catalizador NMHC"},{1,"NOx/SCR"},{3,"Presión turbo"},{5,"Sensor de escape"},{6,"Filtro de partículas"},{7,"EGR/VVT"}}
            : new Dictionary<int,string>{{0,"Catalizador"},{1,"Catalizador calefactado"},{2,"Evaporativo"},{3,"Aire secundario"},{4,"Refrigerante A/C"},{5,"Sonda O2"},{6,"Calefactor O2"},{7,"EGR/VVT"}};
        foreach(var (bit,name) in names) monitors.Add(new(name,(bytes[2]&(1<<bit))!=0,(bytes[3]&(1<<bit))==0));
        return new((bytes[0]&128)!=0,bytes[0]&127,diesel,monitors);
    }
}

public sealed class DiagnosticSession(IDiagnosticLink link) : IAsyncDisposable
{
    public IDiagnosticLink Link { get; } = link;
    public uint? SelectedEcu {get;private set;}
    private readonly SemaphoreSlim gate = new(1,1);
    public List<TraceEntry> Trace { get; } = [];
    public async Task<IReadOnlyList<EcuReply>> RequestAsync(byte[] request, CancellationToken cancellation = default)
    {
        await gate.WaitAsync(cancellation);
        try
        {
            Trace.Add(new(DateTimeOffset.Now,"TX",Convert.ToHexString(request)));
            if (Trace.Count > 10000) Trace.RemoveRange(0,1000);
            var replies = await Link.RequestAsync(request,cancellation);
            foreach(var reply in replies) Trace.Add(new(DateTimeOffset.Now,$"RX {reply.Address:X}",Convert.ToHexString(reply.Data)));
            return replies;
        }
        catch(Exception ex){Trace.Add(new(DateTimeOffset.Now,"ERROR",ex.Message));throw;}
        finally { gate.Release(); }
    }
    public static byte[] Positive(EcuReply reply, byte service)
    {
        var b = reply.Data;
        if(b.Length>=3 && b[0]==0x7F) throw new DiagnosticException($"ECU {reply.Address:X}: servicio {b[1]:X2}, respuesta negativa {b[2]:X2} ({Negative(b[2])})");
        if(b.Length==0 || b[0] != service + 0x40) throw new DiagnosticException("La respuesta no corresponde al servicio solicitado");
        return b;
    }
    public static string Negative(byte code) => code switch {0x11=>"servicio no soportado",0x12=>"subfunción no soportada",0x13=>"longitud incorrecta",0x22=>"condiciones no cumplidas",0x31=>"fuera de rango",0x33=>"acceso de seguridad requerido",0x35=>"llave inválida",0x36=>"demasiados intentos",0x37=>"espera requerida",0x78=>"respuesta pendiente",_=>"consultar ECU"};
    public async Task<HashSet<byte>> SupportedPids(CancellationToken ct=default)
    {
        var supported = new HashSet<byte>();
        for(int page=0;page<=0x60;page+=0x20)
        {
            var replies = await RequestAsync([1,(byte)page],ct);
            var more = false;
            if(replies.Count==0)throw new DiagnosticException("La ECU no respondió al descubrimiento de PID");
            SelectedEcu??=replies[0].Address;
            foreach(var r in replies.Where(r=>r.Address==SelectedEcu))
            {
                var b=Positive(r,1);
                if(b.Length<6 || b[1]!=page) throw new DiagnosticException("Mapa de PID incompleto o incorrecto");
                uint mask=BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(2,4));
                for(int bit=0;bit<32;bit++) if((mask&(1u<<(31-bit)))!=0) supported.Add((byte)(page+bit+1));
                more |= (mask&1)!=0;
            }
            if(!more) break;
        }
        return supported;
    }
    public async Task<Reading> Read(Parameter parameter, byte mode=1, CancellationToken ct=default)
    {
        var replies=await RequestAsync(mode==2 ? [2,parameter.Pid,0] : [1,parameter.Pid],ct);
        if(replies.Count==0) return new(parameter.Name,null,parameter.Unit,"SIN RESPUESTA","");
        var reply=SelectedEcu is uint address?replies.FirstOrDefault(r=>r.Address==address):replies[0];
        if(reply is null)return new(parameter.Name,null,parameter.Unit,"SIN RESPUESTA DE ECU SELECCIONADA","");
        var data=Positive(reply,mode);
        int start=mode==2?3:2;
        if(data.Length<start+parameter.Bytes || data[1]!=parameter.Pid) throw new DiagnosticException("Respuesta PID incompleta o incorrecta");
        var value=parameter.Decode(data[start..]);
        return new(parameter.Name,value,parameter.Unit,value is null?"NO COMPATIBLE (máscara)":parameter.Verified?$"ECU {reply.Address:X}":$"ECU {reply.Address:X} · ESCALA SIN VERIFICAR",Convert.ToHexString(data));
    }
    public async Task<IReadOnlyList<TroubleCode>> Faults(byte mode=3, CancellationToken ct=default)
    {
        var codes=new List<TroubleCode>();
        var responses=await RequestAsync([mode],ct);
        if(responses.Count==0)throw new DiagnosticException("Sin respuesta; no se puede concluir que no haya fallas");
        foreach(var reply in responses)
        {
            var b=Positive(reply,mode);
            int first=reply.HasDtcCount?2:1;
            if(reply.HasDtcCount && (b.Length<2 || b.Length<2+2*b[1]))throw new DiagnosticException("Lista DTC CAN incompleta");
            int end=reply.HasDtcCount?2+2*b[1]:b.Length;
            for(int i=first;i+1<end;i+=2)
                if(b[i]!=0||b[i+1]!=0) {var code=Obd.Dtc(b[i],b[i+1]); codes.Add(new($"{reply.Address:X}",code,Obd.DtcDescription(code),mode==3?"Almacenado":mode==7?"Pendiente":"Permanente"));}
        }
        return codes;
    }
    public async Task<Dictionary<string,string>> Identity(CancellationToken ct=default)
    {
        var identity=new Dictionary<string,string>();
        foreach(var (pid,name) in new[]{((byte)2,"VIN"),((byte)4,"Calibración"),((byte)6,"CVN"),((byte)10,"Nombre ECU")})
        {
            try
            {
                var replies=await RequestAsync([9,pid],ct);
                if(replies.Count==0){identity[name]="SIN RESPUESTA";continue;}
                foreach(var group in replies.GroupBy(r=>r.Address))
                {
                    var parts=group.Select(r=>Positive(r,9)).ToArray();
                    if(parts.Any(b=>b.Length<3||b[1]!=pid))throw new DiagnosticException("Identificación incompleta");
                    var ordered=parts.OrderBy(b=>b[2]).ToArray();
                    if(ordered.Where((b,i)=>b[2]!=i+1).Any())throw new DiagnosticException("Paquetes de identificación fuera de secuencia");
                    var payload=ordered.SelectMany(b=>b[3..]).ToArray();
                    identity[$"{name} · {group.Key:X}"]=pid==6?Convert.ToHexString(payload):Encoding.ASCII.GetString(payload).Trim('\0',' ');
                }
            }
            catch(DiagnosticException ex) {identity[name]=ex.Message;}
        }
        return identity;
    }
    public async Task<string> UdsIdentification(ushort did, CancellationToken ct=default)
    {
        var reply=(await RequestAsync([0x22,(byte)(did>>8),(byte)did],ct)).FirstOrDefault()??throw new DiagnosticException("Sin respuesta UDS");
        var b=Positive(reply,0x22);
        if(b.Length<3 || b[1]!=(byte)(did>>8)||b[2]!=(byte)did) throw new DiagnosticException("DID UDS no coincide");
        return Encoding.ASCII.GetString(b[3..]).Trim('\0',' ')+"  ["+Convert.ToHexString(b[3..])+"]";
    }
    public async Task<MemoryResult> ReadMemory(uint address,int length,IProgress<int>? progress=null,CancellationToken ct=default)
    {
        if(length<=0 || length>16*1024*1024 || (ulong)address+(uint)length>0x100000000UL) throw new ArgumentOutOfRangeException(nameof(length));
        using var output=new MemoryStream();
        try
        {
            var session=(await RequestAsync([0x10,3],ct)).FirstOrDefault()??throw new DiagnosticException("Sin respuesta de sesión UDS");
            var start=Positive(session,0x10);
            if(start.Length<2||start[1]!=3) throw new DiagnosticException("Sesión UDS no confirmada");
            while(output.Length<length)
            {
                ct.ThrowIfCancellationRequested();
                int count=(int)Math.Min(64,length-output.Length);
                byte[] request=[0x23,0x24,0,0,0,0,0,(byte)count];
                BinaryPrimitives.WriteUInt32BigEndian(request.AsSpan(2,4),address+(uint)output.Length);
                var reply=(await RequestAsync(request,ct)).FirstOrDefault()??throw new DiagnosticException("Sin respuesta de memoria");
                var b=Positive(reply,0x23);
                if(b.Length!=count+1) throw new DiagnosticException("Longitud de bloque de memoria incorrecta");
                output.Write(b,1,count);
                progress?.Report((int)output.Length);
            }
            return new(output.ToArray(),length,true,null);
        }
        catch(Exception ex) when(ex is DiagnosticException or IOException or TimeoutException or OperationCanceledException)
        { return new(output.ToArray(),length,false,ex is OperationCanceledException?"Cancelado":ex.Message); }
        finally
        {
            // Return to default session; never hide a failed or incomplete read.
            try {await RequestAsync([0x10,1],CancellationToken.None);} catch(Exception ex) when(ex is IOException or DiagnosticException or TimeoutException) {Trace.Add(new(DateTimeOffset.Now,"AVISO",ex.Message));}
        }
    }
    public async ValueTask DisposeAsync() {await Link.DisposeAsync();gate.Dispose();}
}
