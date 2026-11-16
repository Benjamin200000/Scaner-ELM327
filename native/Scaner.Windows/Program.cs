using Scaner.Core;
using System.Text.Json;

namespace Scaner.Windows;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        if(!args.Contains("--self-test")){Application.Run(new MainForm());return 0;}
        string Argument(string name,string fallback)
        {int i=Array.IndexOf(args,name);return i>=0&&i+1<args.Length?args[i+1]:fallback;}
        string result=Argument("--self-test","self-test.json"),fake=Argument("--fake-j2534","");
        int exit=1;
        using var form=new MainForm();
        form.Shown+=async(_,_)=>
        {
            try
            {
                int rows=await form.ValidateSimulation();
                if(form.TabCount<14||rows==0)throw new Exception("Faltan pantallas o datos nativos");
                int ffi=0;
                if(fake.Length>0)
                {
                    var descriptor=new PassThruDevice("Prueba ABI J2534",Path.GetFullPath(fake),J2534Discovery.Architecture(fake));
                    await using var session=new DiagnosticSession(await J2534Link.Open(descriptor,0x7E0,0x7E8,500000,CancellationToken.None));
                    var rpm=await session.Read(Obd.Parameters.Single(p=>p.Pid==0x0C));
                    if(rpm.Value!=850)throw new Exception("FFI J2534: RPM incorrectas");
                    var codes=await session.Faults();
                    if(codes.Count!=2||codes[0].Code!="P0171")throw new Exception("FFI J2534: DTC incorrectos");
                    var memory=await session.ReadMemory(33,173);
                    if(!memory.Complete||!memory.Data.SequenceEqual(Enumerable.Range(33,173).Select(i=>(byte)(i*17))))throw new Exception("FFI J2534: memoria incorrecta");
                    ffi=3;
                }
                using var screenshot=new Bitmap(form.Width,form.Height);form.DrawToBitmap(screenshot,form.ClientRectangle);screenshot.Save(Path.ChangeExtension(result,".png"));
                File.WriteAllText(result,JsonSerializer.Serialize(new{passed=true,architecture=System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture.ToString(),nativeTabs=form.TabCount,liveRows=rows,j2534Checks=ffi}));exit=0;
            }
            catch(Exception ex){File.WriteAllText(result,JsonSerializer.Serialize(new{passed=false,error=ex.ToString()}));}
            finally{form.Close();}
        };
        Application.Run(form);return exit;
    }
}
