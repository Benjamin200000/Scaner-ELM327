using System.Buffers.Binary;

namespace Scaner.Core;

public static class MemoryUpload
{
    public static async Task<MemoryResult> Read(DiagnosticSession session, uint address, int length, IProgress<int>? progress = null, CancellationToken ct = default)
    {
        if (length <= 0 || length > 16 * 1024 * 1024 || (ulong)address + (uint)length > 0x100000000UL) throw new ArgumentOutOfRangeException(nameof(length));
        using var output = new MemoryStream(); bool active = false;
        try
        {
            async Task<byte[]> Exchange(byte[] bytes, CancellationToken token)
            {
                var replies = await session.RequestAsync(bytes, token);
                var reply = replies.FirstOrDefault() ?? throw new DiagnosticException("Sin respuesta UDS");
                return DiagnosticSession.Positive(reply, bytes[0]);
            }
            var start = await Exchange([0x10, 3], ct);
            if (start.Length < 2 || start[1] != 3) throw new DiagnosticException("Sesión extendida no confirmada");
            byte[] request = [0x35, 0, 0x44, 0, 0, 0, 0, 0, 0, 0, 0];
            BinaryPrimitives.WriteUInt32BigEndian(request.AsSpan(3, 4), address);
            BinaryPrimitives.WriteUInt32BigEndian(request.AsSpan(7, 4), (uint)length);
            var upload = await Exchange(request, ct); active = true;
            if (upload.Length < 3) throw new DiagnosticException("Respuesta RequestUpload incompleta");
            int sizeBytes = upload[1] >> 4;
            if ((upload[1] & 15) != 0 || sizeBytes < 1 || sizeBytes > 4 || upload.Length != sizeBytes + 2) throw new DiagnosticException("Formato RequestUpload no soportado");
            uint maxBlock = 0; for (int i = 0; i < sizeBytes; i++) maxBlock = (maxBlock << 8) | upload[2 + i];
            if (maxBlock < 3 || maxBlock > 4095) throw new DiagnosticException("Tamaño de bloque UDS fuera del transporte admitido");
            byte sequence = 1;
            while (output.Length < length)
            {
                ct.ThrowIfCancellationRequested();
                var block = await Exchange([0x36, sequence], ct);
                if (block.Length < 3 || block.Length > maxBlock || block[1] != sequence) throw new DiagnosticException("Bloque TransferData inválido o contador incorrecto");
                int count = block.Length - 2;
                if (count > length - output.Length) throw new DiagnosticException("La ECU envió más bytes de los solicitados");
                output.Write(block, 2, count); sequence = unchecked((byte)(sequence + 1)); progress?.Report((int)output.Length);
            }
            _ = await Exchange([0x37], ct); active = false;
            return new(output.ToArray(), length, true, null);
        }
        catch (Exception ex) when (ex is DiagnosticException or IOException or TimeoutException or OperationCanceledException)
        { return new(output.ToArray(), length, false, ex is OperationCanceledException ? "Cancelado" : ex.Message); }
        finally
        {
            if (active) try { await session.RequestAsync([0x37], CancellationToken.None); } catch (Exception ex) when (ex is IOException or DiagnosticException or TimeoutException) { session.Trace.Add(new(DateTimeOffset.Now, "AVISO", ex.Message)); }
            try { await session.RequestAsync([0x10, 1], CancellationToken.None); } catch (Exception ex) when (ex is IOException or DiagnosticException or TimeoutException) { session.Trace.Add(new(DateTimeOffset.Now, "AVISO", ex.Message)); }
        }
    }
}
