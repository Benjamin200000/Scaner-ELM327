using System.Runtime.InteropServices;
using System.Buffers.Binary;
using System.Diagnostics;
using Microsoft.Win32;
using Scaner.Core;

namespace Scaner.Windows;

public record PassThruDevice(string Name,string Library,string Architecture)
{
    public override string ToString()=>$"{Name} · {Architecture}";
}
public static class J2534Discovery
{
    public static IReadOnlyList<PassThruDevice> Devices()
    {
        var devices=new List<PassThruDevice>();
        foreach(var view in new[]{RegistryView.Registry32,RegistryView.Registry64})
        {
            using var root=RegistryKey.OpenBaseKey(RegistryHive.LocalMachine,view);
            using var supported=root.OpenSubKey(@"SOFTWARE\PassThruSupport.04.04");
            if(supported is null)continue;
            foreach(var name in supported.GetSubKeyNames())
            {
                using var key=supported.OpenSubKey(name);
                var file=key?.GetValue("FunctionLibrary") as string;
                if(string.IsNullOrWhiteSpace(file))continue;
                file=Environment.ExpandEnvironmentVariables(file.Trim('"'));
                devices.Add(new(key?.GetValue("Name") as string??name,file,Architecture(file)));
            }
        }
        return devices.DistinctBy(d=>d.Library,StringComparer.OrdinalIgnoreCase).ToArray();
    }
    public static string Architecture(string path)
    {
        try
        {
            using var stream=File.OpenRead(path);using var reader=new BinaryReader(stream);
            if(reader.ReadUInt16()!=0x5A4D)return "desconocida";
            stream.Position=0x3C;int pe=reader.ReadInt32();
            if(pe<0||pe>stream.Length-6)return "desconocida";
            stream.Position=pe;if(reader.ReadUInt32()!=0x4550)return "desconocida";
            return reader.ReadUInt16() switch{0x14C=>"x86",0x8664=>"x64",0xAA64=>"ARM64",_=>"desconocida"};
        }
        catch(IOException){return "no disponible";}
        catch(UnauthorizedAccessException){return "sin permiso";}
    }
}

public sealed class J2534Link : IDiagnosticLink
{
    // J2534 ULONG is always 32 bits, including in a 64-bit Windows process.
    public const int MessageSize=24+4128;
    private IntPtr library;
    private uint device,channel,filter;
    private bool opened,connected,filtered;
    private readonly uint tx,rx,flags;
    private readonly PassThruDevice descriptor;
    private readonly object sync=new();
    private readonly OpenFn open;
    private readonly CloseFn close;
    private readonly ConnectFn connect;
    private readonly DisconnectFn disconnect;
    private readonly ReadFn read;
    private readonly WriteFn write;
    private readonly FilterFn startFilter;
    private readonly StopFilterFn stopFilter;
    private readonly IoctlFn ioctl;
    private readonly ErrorFn lastError;
    public string Description=>$"J2534 · {descriptor.Name} · CAN {tx:X} → {rx:X}";
    public bool IsSimulation=>false;
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]private delegate uint OpenFn(IntPtr name,out uint id);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]private delegate uint CloseFn(uint id);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]private delegate uint ConnectFn(uint id,uint protocol,uint flags,uint baud,out uint channel);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]private delegate uint DisconnectFn(uint channel);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]private delegate uint ReadFn(uint channel,IntPtr message,ref uint count,uint timeout);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]private delegate uint WriteFn(uint channel,IntPtr message,ref uint count,uint timeout);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]private delegate uint FilterFn(uint channel,uint type,IntPtr mask,IntPtr pattern,IntPtr flow,out uint filter);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]private delegate uint StopFilterFn(uint channel,uint filter);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]private delegate uint IoctlFn(uint channel,uint id,IntPtr input,IntPtr output);
    [UnmanagedFunctionPointer(CallingConvention.StdCall,CharSet=CharSet.Ansi)]private delegate uint ErrorFn(System.Text.StringBuilder error);
    [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)]private static extern IntPtr LoadLibraryEx(string path,IntPtr file,uint flags);
    private J2534Link(PassThruDevice descriptor,uint tx,uint rx)
    {
        this.descriptor=descriptor;this.tx=tx;this.rx=rx;
        if(tx>0x1FFFFFFF||rx>0x1FFFFFFF||(tx>0x7FF)!=(rx>0x7FF))throw new DiagnosticException("Identificadores CAN incompatibles");
        flags=tx>0x7FF?0x100u:0;
        var arch=J2534Discovery.Architecture(descriptor.Library);
        var process=Environment.Is64BitProcess?"x64":"x86";
        if(arch is "x86" or "x64"&&arch!=process)throw new DiagnosticException($"La DLL Autel es {arch}. Abre ScanerELM327-{arch}.exe en lugar de la versión {process}.");
        if(!Path.IsPathFullyQualified(descriptor.Library))throw new DiagnosticException("Selecciona una DLL por su ruta absoluta");
        library=LoadLibraryEx(descriptor.Library,IntPtr.Zero,0x100|0x1000);
        if(library==IntPtr.Zero)throw new DiagnosticException($"No se pudo cargar el driver J2534 (Windows {Marshal.GetLastWin32Error()}); instala el paquete oficial de Autel y sus dependencias");
        T Export<T>(string name)where T:Delegate=>Marshal.GetDelegateForFunctionPointer<T>(NativeLibrary.GetExport(library,name));
        try
        {
            open=Export<OpenFn>("PassThruOpen");close=Export<CloseFn>("PassThruClose");connect=Export<ConnectFn>("PassThruConnect");disconnect=Export<DisconnectFn>("PassThruDisconnect");
            read=Export<ReadFn>("PassThruReadMsgs");write=Export<WriteFn>("PassThruWriteMsgs");startFilter=Export<FilterFn>("PassThruStartMsgFilter");stopFilter=Export<StopFilterFn>("PassThruStopMsgFilter");
            ioctl=Export<IoctlFn>("PassThruIoctl");lastError=Export<ErrorFn>("PassThruGetLastError");
        }
        catch{NativeLibrary.Free(library);library=IntPtr.Zero;throw;}
    }
    public static async Task<J2534Link> Open(PassThruDevice device,uint request,uint response,uint baud,CancellationToken ct)
    {
        var link=new J2534Link(device,request,response);
        try
        {
            await Task.Run(()=>
            {
                ct.ThrowIfCancellationRequested();link.Check(link.open(IntPtr.Zero,out link.device),"abrir equipo");link.opened=true;
                link.Check(link.connect(link.device,6,link.flags,baud,out link.channel),"conectar ISO15765");link.connected=true;
                IntPtr mask=link.Message(link.flags!=0?0x1FFFFFFFu:0x7FFu,[]),pattern=link.Message(response,[]),flow=link.Message(request,[]);
                try {link.Check(link.startFilter(link.channel,3,mask,pattern,flow,out link.filter),"crear filtro de flujo ISO-TP");link.filtered=true;}
                finally{Marshal.FreeHGlobal(mask);Marshal.FreeHGlobal(pattern);Marshal.FreeHGlobal(flow);}
            },ct);
            return link;
        }
        catch{await link.DisposeAsync();throw;}
    }
    private void Check(uint result,string action)
    {
        if(result==0)return;var detail=new System.Text.StringBuilder(256);lastError(detail);
        throw new DiagnosticException($"J2534 {action}: 0x{result:X2} · {detail}");
    }
    private IntPtr Message(uint id,byte[] data,bool padding=false)
    {
        if(data.Length>4124)throw new ArgumentOutOfRangeException(nameof(data));
        var bytes=new byte[MessageSize];
        BinaryPrimitives.WriteUInt32LittleEndian(bytes,6); // ISO15765
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(8),flags|(padding?0x40u:0)); // Padding is a transmission option, not a filter flag.
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(16),(uint)data.Length+4);
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(24),id);data.CopyTo(bytes,28);
        var pointer=Marshal.AllocHGlobal(MessageSize);Marshal.Copy(bytes,0,pointer,bytes.Length);return pointer;
    }
    public Task<IReadOnlyList<EcuReply>> RequestAsync(byte[] request,CancellationToken cancellation=default)=>Task.Run<IReadOnlyList<EcuReply>>(()=>
    {
        lock(sync)
        {
            cancellation.ThrowIfCancellationRequested();ObjectDisposedException.ThrowIf(!connected,this);
            Check(ioctl(channel,8,IntPtr.Zero,IntPtr.Zero),"limpiar recepción");
            IntPtr message=Message(tx,request,true);
            try
            {
                uint count=1;Check(write(channel,message,ref count,2000),"enviar mensaje");
                if(count!=1)throw new DiagnosticException("El driver no confirmó el envío");
                var timer=Stopwatch.StartNew();var deadline=TimeSpan.FromSeconds(3);
                while(timer.Elapsed<deadline)
                {
                    cancellation.ThrowIfCancellationRequested();count=1;
                    uint result=read(channel,message,ref count,100);
                    if(result is 0x09 or 0x10)continue; // ERR_TIMEOUT / ERR_BUFFER_EMPTY
                    Check(result,"recibir mensaje");if(count==0)continue;
                    var bytes=new byte[MessageSize];Marshal.Copy(message,bytes,0,bytes.Length);
                    uint protocol=BinaryPrimitives.ReadUInt32LittleEndian(bytes),status=BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(4));
                    uint size=BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(16));
                    if(protocol!=6||(status&0x0B)!=0)continue;
                    if((status&0x10)!=0)throw new DiagnosticException("Error de padding ISO15765");
                    if(size<5||size>4128)throw new DiagnosticException("El driver devolvió un tamaño de mensaje inválido");
                    uint source=BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(24));if(source!=rx)continue;
                    var payload=bytes[28..(24+(int)size)];
                    if(payload.Length>=3&&payload[0]==0x7F&&payload[1]==request[0]&&payload[2]==0x78)
                    {deadline=TimeSpan.FromSeconds(30);continue;}
                    return [new(source,payload)];
                }
                throw new TimeoutException("La ECU no respondió por J2534. Revisar contacto, dirección CAN, velocidad y protocolo de la ECU");
            }
            finally{Marshal.FreeHGlobal(message);}
        }
    },cancellation);
    public ValueTask DisposeAsync()
    {
        lock(sync)
        {
            try{if(filtered)stopFilter(channel,filter);}finally{filtered=false;try{if(connected)disconnect(channel);}finally{connected=false;try{if(opened)close(device);}finally{opened=false;if(library!=IntPtr.Zero){NativeLibrary.Free(library);library=IntPtr.Zero;}}}}
        }
        return ValueTask.CompletedTask;
    }
}
