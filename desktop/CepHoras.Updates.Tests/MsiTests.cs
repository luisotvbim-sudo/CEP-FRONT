using CepHoras.Updates;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal static class MsiTests
{
    private static int checks;

    internal static async Task Run()
    {
        // Ephemeral test key only: never exported to disk or used for distribution.
        using var key = RSA.Create(3072);
        using var otherKey = RSA.Create(3072);
        var publicKey = key.ExportSubjectPublicKeyInfoPem();
        var version = new Version(0, 4, 8);
        byte[] payload = Encoding.UTF8.GetBytes("MSI content for transport tests; native identity is injected separately.");
        var manifest = Manifest(version, payload);
        var signature = Sign(key, manifest);
        var release = MsiUpdateTrust.Validate(manifest, signature, version, publicKey);
        Assert(release.Version == version && release.Size == payload.Length, "Lê manifesto assinado");
        Throws(() => MsiUpdateTrust.Validate(manifest, Sign(otherKey, manifest), version, publicKey), "Rejeita chave diferente");
        Throws(() => MsiUpdateTrust.Validate(manifest, signature[..^1], version, publicKey), "Rejeita assinatura truncada");
        var altered = manifest.ToArray(); altered[^2] ^= 1;
        Throws(() => MsiUpdateTrust.Validate(altered, signature, version, publicKey), "Rejeita bytes alterados");
        var reformatted = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(manifest) + "\n");
        Throws(() => MsiUpdateTrust.Validate(reformatted, signature, version, publicKey), "Assina bytes exatos, não JSON recanonicalizado");
        Throws(() => MsiUpdateTrust.Validate(manifest, signature, new Version(0, 4, 9), publicKey), "Rejeita versão divergente da tag");
        foreach (var bad in new[] {
            Encoding.UTF8.GetString(manifest).Replace("Conceito.CepHoras", "Other.Product"),
            Encoding.UTF8.GetString(manifest).Replace(MsiUpdateTrust.PackageAsset, "other.msi"),
            Encoding.UTF8.GetString(manifest).Replace("0.4.8", "0.4.8.0"),
            Encoding.UTF8.GetString(manifest).Replace("0.4.8", "00.4.8"),
            Encoding.UTF8.GetString(manifest).Replace("0.4.8", "0.4.8\\n"),
            Encoding.UTF8.GetString(manifest).Replace($"\"size\":{payload.Length}", "\"size\":536870913"),
            Encoding.UTF8.GetString(manifest).Replace($"\"size\":{payload.Length}", "\"size\":0"),
            Encoding.UTF8.GetString(manifest).Replace("{", "{\"command\":\"run\","),
            Encoding.UTF8.GetString(manifest).Replace("{", "{\"product\":\"Conceito.CepHoras\",")
        })
        {
            var bytes = Encoding.UTF8.GetBytes(bad);
            Throws(() => MsiUpdateTrust.Validate(bytes, Sign(key, bytes), version, publicKey), "Rejeita manifesto malformado mesmo assinado");
        }
        Throws(() => MsiUpdateTrust.Validate(new byte[65537], signature, version, publicKey), "Limita manifesto a 64 KiB");
        Throws(() => MsiUpdateTrust.Validate(manifest, new byte[1025], version, publicKey), "Limita assinatura a 1 KiB");
        Assert(MsiUpdateTrust.ParseVersion("255.255.65535") is not null && MsiUpdateTrust.ParseVersion("256.0.0") is null && MsiUpdateTrust.ParseVersion("0.0.65536") is null, "Limites MSI");
        Assert(MsiUpdateTrust.NormalizeVersion(new Version(0, 4, 8, 99)) == version, "Ignora revision instalada");

        var discoveryRequests = new List<Uri>();
        using var http = new HttpClient(new DelegateHandler(request => {
            discoveryRequests.Add(request.RequestUri!);
            return ResponseFor(request, manifest, signature, payload);
        }));
        var identities = 0;
        var updater = new GitHubMsiUpdates(http, publicKey, (_, target) => { Assert(target == version, "Passa versão para validação MSI"); identities++; });
        var found = await updater.CheckAsync(new Version(0, 4, 7, 100));
        Assert(found is not null && found.Version == version && found.PackageUri == MsiUpdateTrust.AssetUri(version, MsiUpdateTrust.PackageAsset), "Descobre versão assinada e deriva URL da tag MSI canônica");
        Assert(await updater.CheckAsync(new Version(0, 4, 8, 999)) is null, "Ignora mesma versão com revision");
        Assert(await updater.CheckAsync(new Version(0, 4, 9)) is null, "Impede downgrade");
        Assert(discoveryRequests.Count == 6 && discoveryRequests.All(uri => uri.AbsoluteUri.StartsWith("https://github.com/luisotvbim-sudo/CEP-FRONT/releases/latest/download/", StringComparison.Ordinal)), "Consulta somente assets estáticos, sem REST ou token");
        foreach (var missing in new[] { MsiUpdateTrust.ManifestAsset, MsiUpdateTrust.SignatureAsset })
        {
            using var unavailableHttp = new HttpClient(new DelegateHandler(request => request.RequestUri!.AbsolutePath.EndsWith(missing, StringComparison.Ordinal)
                ? new(HttpStatusCode.NotFound) : ResponseFor(request, manifest, signature, payload)));
            Assert(await new GitHubMsiUpdates(unavailableHttp, publicKey, (_, _) => { }).CheckAsync(new Version(0, 4, 7)) is null, "404 sem MSI estável disponível não interrompe o aplicativo");
        }
        var badSignature = signature.ToArray(); badSignature[0] ^= 1;
        using (var invalidHttp = new HttpClient(new DelegateHandler(request => ResponseFor(request, manifest, badSignature, payload))))
            await ThrowsAsync(() => new GitHubMsiUpdates(invalidHttp, publicKey, (_, _) => { }).CheckAsync(new Version(0, 4, 7)), "Check rejeita assinatura alterada");
        using (var invalidHttp = new HttpClient(new DelegateHandler(request => ResponseFor(request, manifest, Sign(otherKey, manifest), payload))))
            await ThrowsAsync(() => new GitHubMsiUpdates(invalidHttp, publicKey, (_, _) => { }).CheckAsync(new Version(0, 4, 7)), "Check rejeita outra chave");
        var nextManifest = Manifest(new Version(0, 4, 9), payload);
        using (var raceHttp = new HttpClient(new DelegateHandler(request => ResponseFor(request, nextManifest, signature, payload))))
            await ThrowsAsync(() => new GitHubMsiUpdates(raceHttp, publicKey, (_, _) => { }).CheckAsync(new Version(0, 4, 7)), "Troca de latest entre manifesto e assinatura falha com segurança");
        foreach (var metadata in new[] { (Manifest: new byte[65537], Signature: signature), (Manifest: manifest, Signature: new byte[1025]) })
        {
            using var oversizedHttp = new HttpClient(new DelegateHandler(request => ResponseFor(request, metadata.Manifest, metadata.Signature, payload)));
            await ThrowsAsync(() => new GitHubMsiUpdates(oversizedHttp, publicKey, (_, _) => { }).CheckAsync(new Version(0, 4, 7)), "Limita metadados estáticos antes de parse");
        }
        using (var malformedHttp = new HttpClient(new DelegateHandler(request => ResponseFor(request, altered, Sign(key, altered), payload))))
            await ThrowsAsync(() => new GitHubMsiUpdates(malformedHttp, publicKey, (_, _) => { }).CheckAsync(new Version(0, 4, 7)), "Check rejeita JSON malformado mesmo assinado");
        using (var redirectHttp = new HttpClient(new DelegateHandler(request => {
            var uri = request.RequestUri!;
            if (uri.AbsolutePath.Contains("/latest/", StringComparison.Ordinal))
            {
                var response = new HttpResponseMessage(HttpStatusCode.Redirect);
                response.Headers.Location = MsiUpdateTrust.AssetUri(version, uri.AbsolutePath.Split('/')[^1]);
                return response;
            }
            return ResponseFor(request, manifest, signature, payload);
        })))
            Assert((await new GitHubMsiUpdates(redirectHttp, publicKey, (_, _) => { }).CheckAsync(new Version(0, 4, 7)))?.Version == version, "Aceita redirect latest para tag GitHub");
        var rejectedRequests = 0;
        using (var redirectHttp = new HttpClient(new DelegateHandler(_ => {
            rejectedRequests++;
            var response = new HttpResponseMessage(HttpStatusCode.Redirect);
            response.Headers.Location = new Uri("https://api.github.com/repos/luisotvbim-sudo/CEP-FRONT/releases");
            return response;
        })))
            await ThrowsAsync(() => new GitHubMsiUpdates(redirectHttp, publicKey, (_, _) => { }).CheckAsync(new Version(0, 4, 7)), "Não segue latest para REST nem origem não autorizada");
        Assert(rejectedRequests == 1, "Não transmite requisição REST após redirect");

        var directory = Path.Combine(Path.GetTempPath(), "CepHoras-MsiUpdate-Test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var downloaded = await updater.DownloadAsync(release, directory);
            Assert(Path.GetDirectoryName(downloaded) == directory && File.ReadAllBytes(downloaded).SequenceEqual(payload) && identities == 1, "Download valida arquivo e identidade antes de renomear");
            updater.VerifyDownloadedPackage(downloaded, release);
            Assert(identities == 2, "Revalida identidade imediatamente antes da instalação");
            await ThrowsAsync(() => updater.DownloadAsync(release with { PackageUri = new Uri("https://example.com/evil.msi") }, directory), "Rejeita URI injetada no objeto release");
            await ThrowsAsync(() => updater.DownloadAsync(release with { Size = payload.Length + 1 }, directory), "Rejeita tamanho injetado");
            await ThrowsAsync(() => updater.DownloadAsync(release with { Sha256 = new string('0', 64) }, directory), "Rejeita hash injetado");
            var wrongHash = Manifest(version, payload, new string('0', 64));
            var wrongRelease = MsiUpdateTrust.Validate(wrongHash, Sign(key, wrongHash), version, publicKey);
            await ThrowsAsync(() => updater.DownloadAsync(wrongRelease, directory), "Rejeita hash do download divergente do manifesto assinado");
            Assert(!Directory.GetFiles(directory).Any(path => path.EndsWith(".partial")), "Remove arquivos parciais inválidos");
            File.AppendAllText(downloaded, "tampering");
            Throws(() => updater.VerifyDownloadedPackage(downloaded, release), "Rejeita alteração após download");

            using var identityHttp = new HttpClient(new DelegateHandler(request => ResponseFor(request, manifest, signature, payload)));
            var identityFailure = new GitHubMsiUpdates(identityHttp, publicKey, (_, _) => throw new InvalidDataException("Wrong identity"));
            await ThrowsAsync(() => identityFailure.DownloadAsync(release, directory), "Remove pacote com identidade divergente");
            Assert(Directory.GetFiles(directory).Length == 1, "Falha de identidade não deixa MSI disponível");
            using var truncatedHttp = new HttpClient(new DelegateHandler(_ => new(HttpStatusCode.OK) { Content = new ByteArrayContent(payload[..^1]) }));
            await ThrowsAsync(() => new GitHubMsiUpdates(truncatedHttp, publicKey, (_, _) => { }).DownloadAsync(release, directory), "Rejeita download truncado");

            foreach (var target in new[] { "https://evil.test/update", "http://github.com/update", "https://user:password@github.com/update", "https://github.com:444/update" })
            {
                var requests = 0;
                using var redirectHttp = new HttpClient(new DelegateHandler(_ => { requests++; var response = new HttpResponseMessage(HttpStatusCode.Redirect); response.Headers.Location = new Uri(target); return response; }));
                await ThrowsAsync(() => new GitHubMsiUpdates(redirectHttp, publicKey, (_, _) => { }).DownloadAsync(release, directory), "Rejeita redirect inseguro antes de transmitir");
                Assert(requests == 1, "Não acessa origem proibida");
            }
            using (var redirectHttp = new HttpClient(new DelegateHandler(request => {
                if (request.RequestUri!.Host == "github.com") { var response = new HttpResponseMessage(HttpStatusCode.Redirect); response.Headers.Location = new Uri("https://release-assets.githubusercontent.com/github-production-release-asset/test?token=ephemeral"); return response; }
                return new(HttpStatusCode.OK) { Content = new ByteArrayContent(payload) };
            })))
            {
                var redirected = await new GitHubMsiUpdates(redirectHttp, publicKey, (_, _) => { }).DownloadAsync(release, directory);
                Assert(File.Exists(redirected), "Aceita CDN GitHub HTTPS autorizada");
            }
        }
        finally { Directory.Delete(directory, true); }

        var properties = new Dictionary<string, string> {
            ["ProductName"] = "CEP Horas", ["Manufacturer"] = "Conceito", ["ProductVersion"] = "0.4.8", ["UpgradeCode"] = "{" + MsiPackageIdentity.ExpectedUpgradeCode + "}", ["ALLUSERS"] = "1"
        };
        MsiPackageIdentity.Validate(properties, "x64;1046", version); checks++;
        foreach (var property in properties.Keys.ToArray())
        {
            var wrong = new Dictionary<string, string>(properties) { [property] = "Other" };
            Throws(() => MsiPackageIdentity.Validate(wrong, "x64;1046", version), "Rejeita identidade MSI divergente: " + property);
        }
        foreach (var template in new[] { "Intel;1046", "Arm64;1046", ";1046", "x64,Intel;1046" })
            Throws(() => MsiPackageIdentity.Validate(properties, template, version), "Rejeita arquitetura MSI incompatível");
        foreach (var allUsers in new[] { "", "0", "2" })
            Throws(() => MsiPackageIdentity.Validate(new Dictionary<string, string>(properties) { ["ALLUSERS"] = allUsers }, "x64;1046", version), "Rejeita escopo por usuário ou variável");
        Console.WriteLine($"{checks} verificações do atualizador MSI passaram.");
    }

    private static byte[] Manifest(Version version, byte[] payload, string? hash = null) => JsonSerializer.SerializeToUtf8Bytes(new {
        product = "Conceito.CepHoras", version = version.ToString(3), asset = MsiUpdateTrust.PackageAsset, size = payload.Length, sha256 = hash ?? Convert.ToHexString(SHA256.HashData(payload))
    });
    private static byte[] Sign(RSA key, byte[] bytes) => key.SignData(bytes, HashAlgorithmName.SHA256, RSASignaturePadding.Pss);
    private static HttpResponseMessage ResponseFor(HttpRequestMessage request, byte[] manifest, byte[] signature, byte[] payload)
    {
        var uri = request.RequestUri!;
        if (uri.Host == "api.github.com") throw new Exception("O atualizador MSI não deve consumir REST.");
        var content = uri.AbsolutePath.EndsWith(".manifest.json") ? manifest : uri.AbsolutePath.EndsWith(".manifest.sig") ? signature : payload;
        return new(HttpStatusCode.OK) { Content = new ByteArrayContent(content) };
    }
    private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); checks++; }
    private static void Throws(Action action, string message) { try { action(); } catch (InvalidDataException) { checks++; return; } throw new Exception(message); }
    private static async Task ThrowsAsync(Func<Task> action, string message) { try { await action(); } catch (InvalidDataException) { checks++; return; } throw new Exception(message); }
    private sealed class DelegateHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            var response = respond(request); response.RequestMessage ??= request; return Task.FromResult(response);
        }
    }
}
