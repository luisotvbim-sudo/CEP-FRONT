using System.Diagnostics;
using System.Security.Cryptography;

internal static class BuildPreflightTests
{
    internal static async Task<int> Run()
    {
        if (!OperatingSystem.IsWindows()) return 0;
        DirectoryInfo? root = new(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "scripts", "build-corporate-msi.ps1"))) root = root.Parent;
        if (root is null) throw new Exception("Não encontrou o script de build para os testes de preflight.");
        var fixture = Path.Combine(Path.GetTempPath(), "CepHoras-BuildPreflight-" + Guid.NewGuid().ToString("N"));
        var script = Path.Combine(fixture, "scripts", "build-corporate-msi.ps1");
        var publicPath = Path.Combine(fixture, "desktop", "CepHoras.Updates", "MsiUpdatePublicKey.pem");
        Directory.CreateDirectory(Path.GetDirectoryName(script)!);
        Directory.CreateDirectory(Path.GetDirectoryName(publicPath)!);
        File.Copy(Path.Combine(root.FullName, "scripts", "build-corporate-msi.ps1"), script);
        var runner = Path.Combine(fixture, "assert-preflight.ps1");
        await File.WriteAllTextAsync(runner, """
            param([string]$Build, [string]$Expected, [switch]$MissingSdk)
            $ErrorActionPreference = 'Stop'
            if ($MissingSdk) { function global:dotnet { $global:LASTEXITCODE = 0 } }
            try { & $Build -Version 'invalid-fixture'; throw 'O build não recusou a fixture.' }
            catch {
                if (-not $_.Exception.Message.Contains($Expected, [StringComparison]::Ordinal)) { throw }
                $output = Join-Path (Split-Path (Split-Path $Build)) '.local/corporate-msi'
                if (Test-Path -LiteralPath $output) { throw 'Preflight criou saída antes de recusar a fixture.' }
            }
            """);
        try
        {
            using var key = RSA.Create(3072);
            await File.WriteAllTextAsync(publicPath, key.ExportSubjectPublicKeyInfoPem());
            await Denied(runner, script, "Versão MSI inválida", false);
            // A deliberately non-key marker is sufficient: no test private material goes to disk.
            await File.WriteAllTextAsync(publicPath, "-----BEGIN PRIVATE KEY-----\nsynthetic-fixture\n-----END PRIVATE KEY-----\n");
            await Denied(runner, script, "somente a chave pública SPKI", false);
            using var weak = RSA.Create(2048);
            await File.WriteAllTextAsync(publicPath, weak.ExportSubjectPublicKeyInfoPem());
            await Denied(runner, script, "RSA 3072", false);
            await File.WriteAllTextAsync(publicPath, key.ExportSubjectPublicKeyInfoPem());
            await Denied(runner, script, ".NET SDK 10", true);
            Console.WriteLine("4 verificações de preflight de build passaram sem compilar/instalar MSI.");
            return 4;
        }
        finally { Directory.Delete(fixture, recursive: true); }
    }

    private static async Task Denied(string runner, string build, string expected, bool missingSdk)
    {
        var info = new ProcessStartInfo("pwsh") { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var argument in new[] { "-NoProfile", "-File", runner, "-Build", build, "-Expected", expected }) info.ArgumentList.Add(argument);
        if (missingSdk) info.ArgumentList.Add("-MissingSdk");
        using var process = Process.Start(info) ?? throw new Exception("Não iniciou o teste de preflight.");
        var output = process.StandardOutput.ReadToEndAsync();
        var errors = process.StandardError.ReadToEndAsync();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        await process.WaitForExitAsync(deadline.Token);
        if (process.ExitCode != 0) throw new Exception("Preflight falhou: " + await output + await errors);
        await output;
        await errors;
    }
}
