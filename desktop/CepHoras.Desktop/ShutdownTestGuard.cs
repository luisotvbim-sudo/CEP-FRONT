using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows.Interop;
using System.Windows.Threading;

namespace CepHoras.Desktop;

internal sealed class ShutdownTestGuard : IDisposable
{
    internal const int QueryEndSession = 0x11, EndSession = 0x16;
    private readonly HwndSource source;
    private readonly ShutdownTestPolicy policy;
    private readonly Action prompt;
    private readonly Action canceled;
    private readonly Action ending;
    private readonly DispatcherTimer timer;
    private readonly SubclassProcedure procedure;
    internal IReadOnlyList<nint> Windows => windows;
    private readonly List<nint> windows = [];
    private bool promptPending, disposed, sessionEnded;
    internal bool ReasonRegistered { get; private set; }

    internal ShutdownTestGuard(HwndSource source, ShutdownTestPolicy policy, Action prompt, Action canceled, Action ending)
    {
        this.source = source;
        this.policy = policy;
        this.prompt = prompt;
        this.canceled = canceled;
        this.ending = ending;
        procedure = Hook;
        UpdateReason();
        if (!ReasonRegistered) throw new Win32Exception(Marshal.GetLastWin32Error());
        // WPF's internal application HWND calls Application.Shutdown during QUERY,
        // before Windows confirms ENDSESSION. Intercept that HWND as well as the main
        // window so a canceled shutdown cannot silently remove the test guard.
        var attachFailed = false;
        EnumThreadWindows(GetCurrentThreadId(), (hwnd, _) =>
        {
            if (SetWindowSubclass(hwnd, procedure, 1, 0)) windows.Add(hwnd);
            else attachFailed = true;
            return true;
        }, 0);
        if (attachFailed || !windows.Contains(source.Handle))
        {
            foreach (var window in windows) RemoveWindowSubclass(window, procedure, 1);
            ShutdownBlockReasonDestroy(source.Handle);
            throw new Win32Exception("Não foi possível observar a janela do aplicativo.");
        }
        timer = new DispatcherTimer(TimeSpan.FromSeconds(1), DispatcherPriority.Background,
            (_, _) => UpdateReason(), source.Dispatcher);
    }

    internal bool BlockRequest()
    {
        if (disposed || policy.IsAuthorized) return false;
        UpdateReason();
        if (!promptPending)
        {
            promptPending = true;
            source.Dispatcher.BeginInvoke(() =>
            {
                try { if (!disposed) prompt(); }
                finally { promptPending = false; }
            });
        }
        return true;
    }

    private nint Hook(nint hwnd, uint message, nint wParam, nint lParam, nuint id, nuint data)
    {
        if (message == QueryEndSession)
        {
            // Restart Manager maintenance, forced termination and logoff are not part of this test.
            var special = (unchecked((uint)lParam.ToInt64()) & 0xC0000001u) != 0;
            if (!special && BlockRequest())
            {
                return 0; // Never wait for a password inside the Windows message handler.
            }
            return 1;
        }
        else if (message == EndSession && wParam == 0)
        {
            policy.Reset();
            UpdateReason();
            canceled();
            return 0;
        }
        else if (message == EndSession)
        {
            if (!sessionEnded)
            {
                sessionEnded = true;
                ending();
            }
            return 0;
        }
        return DefSubclassProc(hwnd, message, wParam, lParam);
    }

    internal void UpdateReason()
    {
        if (disposed) return;
        if (policy.IsAuthorized)
        {
            if (ReasonRegistered) ShutdownBlockReasonDestroy(source.Handle);
            ReasonRegistered = false;
        }
        else if (!ReasonRegistered)
        {
            ReasonRegistered = ShutdownBlockReasonCreate(source.Handle,
                "CEP Horas — teste: cancele o desligamento e informe a senha no aplicativo.");
        }
    }

    public void Dispose()
    {
        if (disposed) return;
        timer.Stop();
        foreach (var window in windows) RemoveWindowSubclass(window, procedure, 1);
        if (ReasonRegistered) ShutdownBlockReasonDestroy(source.Handle);
        ReasonRegistered = false;
        disposed = true;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShutdownBlockReasonCreate(nint hwnd, string reason);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShutdownBlockReasonDestroy(nint hwnd);
    private delegate nint SubclassProcedure(nint hwnd, uint message, nint wParam, nint lParam, nuint id, nuint data);
    private delegate bool EnumWindowProcedure(nint hwnd, nint data);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumThreadWindows(uint thread, EnumWindowProcedure callback, nint data);
    [DllImport("comctl32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowSubclass(nint window, SubclassProcedure callback, nuint id, nuint data);
    [DllImport("comctl32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RemoveWindowSubclass(nint window, SubclassProcedure callback, nuint id);
    [DllImport("comctl32.dll")]
    private static extern nint DefSubclassProc(nint window, uint message, nint wParam, nint lParam);
}
