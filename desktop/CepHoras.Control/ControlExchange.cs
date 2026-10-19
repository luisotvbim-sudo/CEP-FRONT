using System.IO;
using CepHoras.Control.Protocol;

namespace CepHoras.Control;

internal static class ControlExchange
{
    internal static async Task Run(Stream pipe, Func<ControlRequest, ControlResponse> handle, CancellationToken stop)
    {
        ControlRequest request;
        using (var reading = CancellationTokenSource.CreateLinkedTokenSource(stop))
        {
            reading.CancelAfter(TimeSpan.FromSeconds(5));
            request = await ControlWire.Read<ControlRequest>(pipe, reading.Token);
        }
        stop.ThrowIfCancellationRequested();
        var response = handle(request);
        using var writing = CancellationTokenSource.CreateLinkedTokenSource(stop);
        writing.CancelAfter(TimeSpan.FromSeconds(5));
        await ControlWire.Write(pipe, response, writing.Token);
    }
}
