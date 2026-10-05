using System.Buffers.Binary;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace CepHoras.Control.Protocol;

public sealed record ControlRequest(
    string Operation,
    string? RequestId = null,
    string? Action = null,
    int DelaySeconds = 0,
    string? ApprovedVersion = null,
    string? BrokerInstanceId = null);

public sealed record ControlResponse(
    string Code,
    string Message,
    bool Active = false,
    string? RequestId = null,
    string? Action = null,
    DateTimeOffset? ExecuteAt = null,
    bool Cancelled = false,
    string? UpdateVersion = null,
    string? UpdatePhase = null,
    string? InstalledVersion = null,
    string? BrokerInstanceId = null,
    string? OriginalBrokerInstanceId = null);

public static class ControlWire
{
    public const string ServiceName = "CepHorasControl";
    public const string PipeName = "Conceito.CepHoras.Control.v2";

    public static async Task<T> Read<T>(Stream stream, CancellationToken token)
    {
        var size = new byte[4];
        await stream.ReadExactlyAsync(size, token);
        var length = BinaryPrimitives.ReadInt32LittleEndian(size);
        if (length is < 1 or > 4096) throw new InvalidDataException("Mensagem fora do limite.");
        var bytes = new byte[length];
        await stream.ReadExactlyAsync(bytes, token);
        try { return JsonSerializer.Deserialize<T>(bytes) ?? throw new InvalidDataException("Mensagem vazia."); }
        finally { Array.Clear(bytes); }
    }

    public static async Task Write<T>(Stream stream, T value, CancellationToken token)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
        try
        {
            if (bytes.Length > 4096) throw new InvalidDataException("Mensagem fora do limite.");
            var size = new byte[4];
            BinaryPrimitives.WriteInt32LittleEndian(size, bytes.Length);
            await stream.WriteAsync(size, token);
            await stream.WriteAsync(bytes, token);
            await stream.FlushAsync(token);
        }
        finally { Array.Clear(bytes); }
    }
}

public static class ControlClient
{
    public static async Task<ControlResponse> Send(ControlRequest request)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        using var pipe = new NamedPipeClientStream(
            ".",
            ControlWire.PipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous,
            TokenImpersonationLevel.Identification);
        await pipe.ConnectAsync(timeout.Token);
        // Authenticate the server before transmitting an authorized operation.
        if (!GetNamedPipeServerProcessId(pipe.SafePipeHandle, out var process) ||
            process == 0 || process != GetServiceProcessId())
            throw new UnauthorizedAccessException("O canal não pertence ao serviço instalado do CEP Horas.");
        await ControlWire.Write(pipe, request, timeout.Token);
        return await ControlWire.Read<ControlResponse>(pipe, timeout.Token);
    }

    public static uint GetServiceProcessId()
    {
        var scm = OpenSCManager(null, null, 1);
        if (scm == 0) return 0;
        try
        {
            var service = OpenService(scm, ControlWire.ServiceName, 4);
            if (service == 0) return 0;
            try
            {
                return QueryServiceStatusEx(service, 0, out var status, Marshal.SizeOf<ServiceStatus>(), out _) && status.State == 4
                    ? status.ProcessId
                    : 0;
            }
            finally { CloseServiceHandle(service); }
        }
        finally { CloseServiceHandle(scm); }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatus
    {
        internal uint Type, State, Accepted, Win32Exit, ServiceExit, Checkpoint, WaitHint, ProcessId, Flags;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint process);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern nint OpenSCManager(string? machine, string? database, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern nint OpenService(nint scm, string name, uint access);
    [DllImport("advapi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryServiceStatusEx(nint service, int level, out ServiceStatus status, int size, out int needed);
    [DllImport("advapi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseServiceHandle(nint handle);
}
