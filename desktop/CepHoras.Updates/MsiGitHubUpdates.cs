using System.Net;
using System.Reflection;
using System.Security.Cryptography;

namespace CepHoras.Updates;

public sealed class GitHubMsiUpdates
{
    private const string LatestAssets = "https://github.com/luisotvbim-sudo/CEP-FRONT/releases/latest/download/";
    private static readonly HttpClient SharedClient = CreateClient();
    private readonly HttpClient client;
    private readonly string publicKeyPem;
    private readonly Action<string, Version> verifyIdentity;

    public GitHubMsiUpdates() : this(SharedClient, ReadPublicKey(), MsiPackageIdentity.Verify) { }

    internal GitHubMsiUpdates(HttpClient client, string publicKeyPem, Action<string, Version> verifyIdentity)
    {
        this.client = client;
        this.publicKeyPem = publicKeyPem;
        this.verifyIdentity = verifyIdentity;
    }

    public async Task<MsiRelease?> CheckAsync(Version installed, CancellationToken cancellationToken = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(60));
        var token = timeout.Token;
        // Static assets avoid GitHub's anonymous REST quota shared by PCs behind a NAT.
        // The publisher marks only stable installer releases as latest. Authenticity and
        // the canonical package tag still come exclusively from the signed bytes.
        var manifest = await ReadLatestAsset(MsiUpdateTrust.ManifestAsset, MsiUpdateTrust.MaximumManifestBytes, token);
        if (manifest is null) return null;
        var signature = await ReadLatestAsset(MsiUpdateTrust.SignatureAsset, MsiUpdateTrust.MaximumSignatureBytes, token);
        if (signature is null) return null;
        var release = MsiUpdateTrust.Validate(manifest, signature, null, publicKeyPem);
        return release.Version > MsiUpdateTrust.NormalizeVersion(installed) ? release : null;
    }

    public async Task<string> DownloadAsync(MsiRelease release, string privateDestination, CancellationToken cancellationToken = default)
    {
        MsiUpdateTrust.ValidateRelease(release, publicKeyPem);
        var directory = Path.GetFullPath(privateDestination);
        ValidateDownloadDirectory(directory);
        var destination = Path.Combine(directory, $"CEP-Horas-{release.Version.ToString(3)}-{Guid.NewGuid():N}.msi");
        var temporary = destination + ".partial";
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(10));
        try
        {
            using var response = await GetAsync(release.PackageUri, timeout.Token);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength is { } length && length != release.Size)
                throw new InvalidDataException("O tamanho do pacote mudou durante o download.");
            await using var input = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            long total = 0;
            var buffer = new byte[81920];
            await using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                int read;
                while ((read = await input.ReadAsync(buffer, timeout.Token)) > 0)
                {
                    total += read;
                    if (total > release.Size || total > MsiUpdateTrust.MaximumPackageBytes)
                        throw new InvalidDataException("O pacote excede o tamanho assinado.");
                    hash.AppendData(buffer, 0, read);
                    await output.WriteAsync(buffer.AsMemory(0, read), timeout.Token);
                }
                await output.FlushAsync(timeout.Token);
                // A ready journal must never refer to bytes still only in the OS cache.
                output.Flush(flushToDisk: true);
            }
            if (total != release.Size || !string.Equals(Convert.ToHexString(hash.GetHashAndReset()), release.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("A verificação SHA-256 do MSI falhou.");
            timeout.Token.ThrowIfCancellationRequested();
            verifyIdentity(temporary, release.Version);
            // Native identity inspection is synchronous. Cancellation during it must
            // still remove the partial package instead of publishing success.
            timeout.Token.ThrowIfCancellationRequested();
            ValidateDownloadDirectory(directory);
            File.Move(temporary, destination);
            return destination;
        }
        catch
        {
            if (File.Exists(temporary)) File.Delete(temporary);
            if (File.Exists(destination)) File.Delete(destination);
            throw;
        }
    }

    public void VerifyDownloadedPackage(string packagePath, MsiRelease release)
    {
        MsiUpdateTrust.ValidateRelease(release, publicKeyPem);
        ValidateDownloadDirectory(Path.GetDirectoryName(Path.GetFullPath(packagePath))!);
        if ((File.GetAttributes(packagePath) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("O pacote não pode ser um link.");
        using (var stream = new FileStream(packagePath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            if (stream.Length != release.Size || !string.Equals(Convert.ToHexString(SHA256.HashData(stream)), release.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("O pacote validado foi alterado.");
            verifyIdentity(packagePath, release.Version);
        }
    }

    private static void ValidateDownloadDirectory(string path)
    {
        var directory = new DirectoryInfo(path);
        if (!directory.Exists) throw new InvalidDataException("A pasta privada da atualização não está disponível.");
        // A normal leaf below a junction still redirects privileged writes elsewhere.
        for (DirectoryInfo? current = directory; current is not null; current = current.Parent)
            if (!current.Exists || (current.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("A pasta da atualização não pode conter links.");
    }

    private async Task<byte[]?> ReadLatestAsset(string asset, int maximum, CancellationToken token)
    {
        using var response = await GetAsync(new Uri(LatestAssets + asset), token);
        if (response.StatusCode == HttpStatusCode.NotFound) return null;
        response.EnsureSuccessStatusCode();
        return await ReadLimited(response.Content, maximum, token);
    }

    private async Task<HttpResponseMessage> GetAsync(Uri initial, CancellationToken token)
    {
        var uri = initial;
        for (var redirects = 0; redirects <= 5; redirects++)
        {
            if (!IsDownloadOrigin(uri))
                throw new InvalidDataException("Origem de atualização não autorizada.");
            var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, token);
            // Also reject auto-followed responses from an injected client's handler.
            if (response.RequestMessage?.RequestUri is { } actual && !IsDownloadOrigin(actual))
            { response.Dispose(); throw new InvalidDataException("Redirecionamento de atualização não autorizado."); }
            if ((int)response.StatusCode is 301 or 302 or 303 or 307 or 308)
            {
                var location = response.Headers.Location;
                response.Dispose();
                if (location is null || redirects == 5) throw new InvalidDataException("Redirecionamento de atualização inválido.");
                uri = location.IsAbsoluteUri ? location : new Uri(uri, location);
                continue;
            }
            return response;
        }
        throw new InvalidDataException("Limite de redirecionamentos excedido.");
    }

    internal static bool IsDownloadOrigin(Uri uri) => uri.IsAbsoluteUri && uri.Scheme == "https" && uri.IsDefaultPort &&
        uri.UserInfo.Length == 0 && uri.Fragment.Length == 0 &&
        uri.Host is "github.com" or "release-assets.githubusercontent.com" or "objects.githubusercontent.com";

    private static async Task<byte[]> ReadLimited(HttpContent content, int maximum, CancellationToken token)
    {
        if (content.Headers.ContentLength is { } size && (size < 1 || size > maximum)) throw new InvalidDataException("Resposta de atualização fora do limite.");
        await using var input = await content.ReadAsStreamAsync(token);
        using var output = new MemoryStream();
        var buffer = new byte[8192];
        int read;
        while ((read = await input.ReadAsync(buffer, token)) > 0)
        {
            if (output.Length + read > maximum) throw new InvalidDataException("Resposta de atualização fora do limite.");
            output.Write(buffer, 0, read);
        }
        return output.ToArray();
    }

    private static string ReadPublicKey()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("CepHoras.Updates.MsiUpdatePublicKey.pem")
            ?? throw new InvalidDataException("Chave pública de atualização ausente do aplicativo.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private static HttpClient CreateClient()
    {
        var client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = Timeout.InfiniteTimeSpan };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("CEP-Horas-MSI-Updater/1.0");
        client.DefaultRequestHeaders.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoCache = true };
        return client;
    }
}
