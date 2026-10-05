using System.Runtime.InteropServices;

namespace CepHoras.Desktop;

internal static class WindowsPolicyNotification
{
    internal static void NotifyShell()
    {
        const uint wmSettingChange = 0x001a;
        const uint abortIfHung = 0x0002;
        _ = SendMessageTimeout(new nint(0xffff), wmSettingChange, 0, "Policy", abortIfHung, 5_000, out _);
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern nint SendMessageTimeout(
        nint window,
        uint message,
        nint word,
        string parameter,
        uint flags,
        uint timeout,
        out nint result);
}
