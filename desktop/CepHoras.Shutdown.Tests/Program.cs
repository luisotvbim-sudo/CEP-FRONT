using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows.Interop;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using CepHoras.Desktop;

internal static class Program
{
    // Sends messages ONLY to this disposable test window. Never broadcasts or shuts down Windows.
    [STAThread]
    private static void Main()
    {
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        var password = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, ShutdownTestPolicy.Iterations, HashAlgorithmName.SHA256, 32);
        var now = 1_000L;
        var policy = new ShutdownTestPolicy(salt, hash, () => now);
        Assert(!policy.IsAuthorized && !policy.Authorize("wrong"), "wrong password must not authorize");
        Assert(policy.Authorize(password) && policy.IsAuthorized, "correct password authorizes");
        now += 60_000;
        Assert(!policy.IsAuthorized, "authorization expires after exactly 60 seconds");
        var prompts = 0;
        var cancellations = 0;
        var endings = 0;
        using var source = new HwndSource(new HwndSourceParameters("CEP Horas disposable shutdown test")
        { Width = 1, Height = 1, WindowStyle = 0x00CF0000 });
        using (var guard = new ShutdownTestGuard(source, policy, () => prompts++, () => cancellations++, () => endings++))
        {
            Assert(guard.ReasonRegistered, "Windows accepted the shutdown reason");
            Assert(SendMessage(source.Handle, 0x11, 0, 0) == 0, "native query blocked");
            Assert(SendMessage(source.Handle, 0x11, 0, 0) == 0, "duplicate native query blocked");
            Pump();
            Assert(prompts == 1, "one asynchronous prompt for overlapping queries");
            Assert(policy.Authorize(password), "authorize before next attempt");
            guard.UpdateReason();
            Assert(!guard.ReasonRegistered, "reason removed while authorized");
            Assert(SendMessage(source.Handle, 0x11, 0, 0) != 0, "authorized native query allowed");
            Assert(guard.Windows.Count >= 2, "WPF internal application window is included");
            foreach (var hwnd in guard.Windows)
                Assert(SendMessage(hwnd, 0x11, 0, 0) != 0, "authorized query allowed on ALL WPF windows");
            Pump();
            Assert(!app.Dispatcher.HasShutdownStarted && endings == 0, "query alone must not close WPF before confirmed end-session");
            SendMessage(source.Handle, 0x16, 0, 0);
            Assert(cancellations == 1 && !policy.IsAuthorized && guard.ReasonRegistered, "canceled shutdown rearms");
            foreach (var flags in new[] { 1u, 0x40000000u, 0x80000000u, 0xC0000001u })
                Assert(SendMessage(source.Handle, 0x11, 0, unchecked((nint)(long)flags)) != 0, "maintenance/critical/logoff must pass");
            Pump();
            Assert(prompts == 1, "no prompts for special Windows requests");
            Assert(policy.Authorize(password), "second authorization");
            now += 60_001;
            Assert(SendMessage(source.Handle, 0x11, 0, 0) == 0, "expired authorization blocks native query");
            Pump();
            Assert(prompts == 2, "expired authorization asks again");
            SendMessage(source.Handle, 0x16, 1, 0);
            Assert(endings == 1, "confirmed end-session invokes cleanup");
        }
        Assert(SendMessage(source.Handle, 0x11, 0, 0) != 0, "disposing removes blocking hook");

        var file = Path.Combine(Path.GetTempPath(), $"cep-shutdown-fixture-{Guid.NewGuid():N}.dat");
        try
        {
            Assert(ShutdownTestPolicy.Load(file) is null, "absent configuration disables test");
            var json = JsonSerializer.SerializeToUtf8Bytes(new { Version = 1, Salt = salt, Hash = hash });
            File.WriteAllBytes(file, ProtectedData.Protect(json, null, DataProtectionScope.CurrentUser));
            Assert(ShutdownTestPolicy.Load(file)!.Authorize(password), "DPAPI configuration verifies password");
            File.WriteAllBytes(file, [1, 2, 3]);
            try { ShutdownTestPolicy.Load(file); throw new Exception("corrupt configuration accepted"); }
            catch (CryptographicException) { }
        }
        finally { if (File.Exists(file)) File.Delete(file); }
        var dialog = new ShutdownPasswordWindow(policy);
        dialog.Loaded += (_, _) =>
        {
            var input = (PasswordBox)dialog.FindName("Password");
            var error = (TextBlock)dialog.FindName("Error");
            var submit = FindButton(dialog, "Liberar por 60 segundos");
            input.Password = "wrong";
            submit.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            Assert(error.Text.Contains("Senha incorreta") && !policy.IsAuthorized && input.Password.Length == 0,
                "real password UI rejects and clears wrong password");
            input.Password = password;
            submit.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        };
        Assert(dialog.ShowDialog() == true && policy.IsAuthorized, "real password UI authorizes correct password");
        policy.Reset();
        var canceled = new ShutdownPasswordWindow(policy);
        canceled.Loaded += (_, _) => canceled.Close();
        Assert(canceled.ShowDialog() != true && !policy.IsAuthorized, "closing password dialog keeps block");
        Console.WriteLine("PASS: native block/allow, asynchronous prompt, wrong password, expiry, cancellation, logoff/critical/maintenance, disposal and DPAPI. No system shutdown requested.");
        app.Shutdown();
    }

    private static void Pump()
    {
        var frame = new DispatcherFrame();
        Dispatcher.CurrentDispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, () => frame.Continue = false);
        Dispatcher.PushFrame(frame);
    }
    private static void Assert(bool value, string message) { if (!value) throw new Exception(message); }
    private static Button FindButton(DependencyObject parent, string content)
    {
        foreach (var child in LogicalTreeHelper.GetChildren(parent).OfType<DependencyObject>())
        {
            if (child is Button button && Equals(button.Content, content)) return button;
            try { return FindButton(child, content); } catch (InvalidOperationException) { }
        }
        throw new InvalidOperationException("button missing");
    }
    [DllImport("user32.dll")]
    private static extern nint SendMessage(nint window, int message, nint wParam, nint lParam);
}
