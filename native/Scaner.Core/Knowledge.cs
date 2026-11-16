using System.Text.Json;

namespace Scaner.Core;

public static class Knowledge
{
    private static readonly Lazy<JsonDocument> document=new(()=>
    {
        using var stream=typeof(Knowledge).Assembly.GetManifestResourceStream("Scaner.Core.Data.knowledge.json")??throw new IOException("Base de conocimiento no incluida");
        return JsonDocument.Parse(stream);
    });
    public static JsonElement Root=>document.Value.RootElement;
    public static string Formatted=>JsonSerializer.Serialize(Root,new JsonSerializerOptions{WriteIndented=true});
    public static string? Dtc(string code)
    {
        foreach(var item in Root.GetProperty("dtcs").EnumerateArray())
            if(item.GetProperty("code").GetString()==code)return JsonSerializer.Serialize(item,new JsonSerializerOptions{WriteIndented=true});
        return null;
    }
    public static IReadOnlyList<MapDefinition> Maps(int definition)
    {
        var tables=Root.GetProperty("definitions")[definition].GetProperty("tablas");
        return tables.EnumerateArray().Select(t=>new MapDefinition(t.GetProperty("titulo").GetString()!,t.GetProperty("direccion").GetUInt32(),t.GetProperty("bits").GetInt32(),t.GetProperty("signed").GetBoolean(),!t.GetProperty("bigEndian").GetBoolean(),t.GetProperty("filas").GetInt32(),t.GetProperty("columnas").GetInt32(),t.GetProperty("conversion").GetString()!,t.GetProperty("unidad").GetString()!)).ToArray();
    }
}

public record RuleResult(string Rule,string Status,string Observation,string NextStep);
public static class DiagnosticRules
{
    /// <summary>Results use current readings only; absent or invalid values cannot become zero.</summary>
    public static IReadOnlyList<RuleResult> Evaluate(IReadOnlyDictionary<string,double> data,string? fuel,double? displacement)
    {
        var results=new List<RuleResult>();
        void Check(string id,string[] needed,string? applies,Func<RuleResult?> evaluate)
        {
            if(applies is not null&&fuel is not null&&applies!=fuel)return;
            var missing=needed.Where(k=>!data.TryGetValue(k,out var value)||!double.IsFinite(value)).ToArray();
            if(missing.Length>0){results.Add(new(id,"NO EVALUADA","Faltan: "+string.Join(", ",missing),"Leer los parámetros necesarios en la misma sesión"));return;}
            if(applies is not null&&fuel is null){results.Add(new(id,"NO EVALUADA","Combustible sin identificar","Elegir gasolina o diésel"));return;}
            var result=evaluate();results.Add(result??new(id,"SIN INDICIO EN ESTA LECTURA","No se alcanzó el umbral de la regla","No confirma ausencia de fallas"));
        }
        double V(string k)=>data[k];
        Check("Corrección positiva",["ltft1"],"gasolina",()=>V("ltft1")>=12?new("Corrección positiva",V("ltft1")>=20?"PATRÓN COMPATIBLE":"INDICIO",$"Corrección larga {V("ltft1"):F1}%: compatible con aire no medido o falta de combustible","Prueba de humo; medir presión en carga; contrastar MAF"):null);
        Check("Corrección negativa",["ltft1"],"gasolina",()=>V("ltft1")<=-12?new("Corrección negativa",V("ltft1")<=-20?"PATRÓN COMPATIBLE":"INDICIO",$"Corrección larga {V("ltft1"):F1}%: compatible con exceso de combustible o aire sobreestimado","Medir presión y caída tras corte; contrastar temperatura; revisar admisión"):null);
        Check("MAF vs. teórico",["maf","rpm","load"],null,()=>
        {
            if(displacement is null||displacement<=0)return new("MAF vs. teórico","NO EVALUADA","Falta cilindrada válida","Introducir cilindrada real en litros");
            if(V("rpm")<500||V("load")<40)return new("MAF vs. teórico","FUERA DE CONDICIÓN","Requiere motor en marcha y carga ≥40%","Medir bajo condiciones documentadas");
            double expected=V("rpm")/120*displacement.Value*1.18*V("load")/100;
            return V("maf")/expected<=.75?new("MAF vs. teórico","INDICIO",$"MAF {V("maf"):F1} g/s frente a estimación {expected:F1} g/s","Estimación, no especificación: contrastar MAF, EGR, filtro y cableado"):null;
        });
        Check("Desviación turbo",["boost_cmd","boost_actual"],null,()=>
        {
            if(V("boost_cmd")<=0)return new("Desviación turbo","FUERA DE CONDICIÓN","Presión solicitada no positiva","Verificar datos de origen");
            double delta=(V("boost_actual")-V("boost_cmd"))/V("boost_cmd")*100;
            return Math.Abs(delta)>=8?new("Desviación turbo",Math.Abs(delta)>=15?"PATRÓN COMPATIBLE":"INDICIO",$"Desviación {delta:F1}%: compatible con {(delta>0?"sobrepresión":"presión insuficiente")}","Contrastar MAP con manómetro y revisar actuador/estanqueidad"):null;
        });
        Check("Presión DPF",["dpf_delta","rpm"],"diesel",()=>V("rpm")<=1200&&V("dpf_delta")>=2?new("Presión DPF","OBSERVACIÓN",$"Diferencial {V("dpf_delta"):F1} kPa a {V("rpm"):F0} rpm","Comparar bajo distintos regímenes; verificar sensor y mangueras antes de atribuirlo al filtro"):null);
        Check("Refrigerante elevado",["coolant"],null,()=>V("coolant")>=108?new("Refrigerante elevado",V("coolant")>=115?"PATRÓN COMPATIBLE":"INDICIO",$"Temperatura {V("coolant"):F1} °C","Verificar refrigeración, electroventilador, nivel y temperatura real"):null);
        Check("Tensión de carga",["module_voltage","rpm"],null,()=>
        {
            if(V("rpm")<500)return new("Tensión de carga","FUERA DE CONDICIÓN","Motor detenido","Medir con motor en marcha");
            double voltage=V("module_voltage");return voltage<13||voltage>15?new("Tensión de carga","INDICIO",$"Tensión {voltage:F2} V con motor a {V("rpm"):F0} rpm","Medir bornes a 2000 rpm, correa y caídas de tensión; revisar especificación de alternador inteligente"):null;
        });
        return results;
    }
}
