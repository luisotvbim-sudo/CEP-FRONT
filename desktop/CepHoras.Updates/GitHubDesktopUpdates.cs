using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

namespace CepHoras.Updates;

public sealed record DesktopRelease(Version Version, Uri DownloadUri, string Sha256, long Size);

public sealed class GitHubDesktopUpdates
{
    private const long MaximumPackageBytes = 250L * 1024 * 1024;
    private const string AssetName = "CEP-Horas-win-x64.msix";
    private static readonly Uri ReleasesUri = new("https://api.github.com/repos/luisotvbim-sudo/CEP-FRONT/releases?per_page=100");
    private static readonly Regex TagPattern = new(@"^desktop-v\d+\.\d+\.\d+\.\d+$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex DigestPattern = new(@"^sha256:[0-9a-fA-F]{64}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly HttpClient SharedClient = CreateClient();
    private readonly HttpClient client;

    public GitHubDesktopUpdates(HttpClient? client = null) => this.client = client ?? SharedClient;

    public async Task<DesktopRelease?> CheckAsync(Version installedVersion, CancellationToken cancellationToken = default)
    {
        using var response = await client.GetAsync(ReleasesUri, cancellationToken);
        if (!response.IsSuccessStatusCode) return null;
        var json = await response.Content.ReadAsStringAsync(cancellationToken);
        return ParseLatestRelease(json, installedVersion);
    }

    public static DesktopRelease? ParseLatestRelease(string json, Version installedVersion)
    {
        using var document = JsonDocument.Parse(json);
        if (document.RootElement.ValueKind != JsonValueKind.Array) return null;

        DesktopRelease? latest = null;
        foreach (var release in document.RootElement.EnumerateArray())
        {
            if (release.ValueKind != JsonValueKind.Object ||
                !release.TryGetProperty("tag_name", out var tag) ||
                tag.ValueKind != JsonValueKind.String ||
                !TagPattern.IsMatch(tag.GetString() ?? "") ||
                !Version.TryParse((tag.GetString() ?? "")["desktop-v".Length..], out var version) ||
                version <= installedVersion ||
                (release.TryGetProperty("draft", out var draft) && draft.ValueKind == JsonValueKind.True) ||
                (release.TryGetProperty("prerelease", out var prerelease) && prerelease.ValueKind == JsonValueKind.True) ||
                !release.TryGetProperty("assets", out var assets) ||
                assets.ValueKind != JsonValueKind.Array)
                continue;

            foreach (var asset in assets.EnumerateArray())
            {
                if (asset.ValueKind != JsonValueKind.Object ||
                    !asset.TryGetProperty("name", out var name) || name.ValueKind != JsonValueKind.String ||
                    name.GetString() != AssetName ||
                    !asset.TryGetProperty("digest", out var digest) || digest.ValueKind != JsonValueKind.String ||
                    !DigestPattern.IsMatch(digest.GetString() ?? "") ||
                    !asset.TryGetProperty("size", out var size) || !size.TryGetInt64(out var bytes) ||
                    bytes <= 0 || bytes > MaximumPackageBytes ||
                    !asset.TryGetProperty("browser_download_url", out var link) || link.ValueKind != JsonValueKind.String ||
                    !Uri.TryCreate(link.GetString(), UriKind.Absolute, out var downloadUri) ||
                    downloadUri.Scheme != Uri.UriSchemeHttps || downloadUri.Host != "github.com" ||
                    !downloadUri.AbsolutePath.StartsWith("/luisotvbim-sudo/CEP-FRONT/releases/download/", StringComparison.Ordinal) ||
                    !downloadUri.AbsolutePath.EndsWith("/" + AssetName, StringComparison.Ordinal))
                    continue;

                var candidate = new DesktopRelease(version, downloadUri, digest.GetString()!["sha256:".Length..].ToUpperInvariant(), bytes);
                if (latest is null || candidate.Version > latest.Version) latest = candidate;
            }
        }
        return latest;
    }

    public async Task<string> DownloadAsync(DesktopRelease release, string installedManifestPath,
        CancellationToken cancellationToken = default, string? downloadDirectory = null)
    {
        var directory = downloadDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Conceito", "CepHoras", "Updates");
        Directory.CreateDirectory(directory);
        var destination = Path.Combine(directory, $"CEP-Horas-{release.Version}-{Guid.NewGuid():N}.msix");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(10));
        var downloadToken = timeout.Token;
        try
        {
            using var response = await client.GetAsync(release.DownloadUri, HttpCompletionOption.ResponseHeadersRead, downloadToken);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength is { } length && length != release.Size)
                throw new InvalidDataException("O tamanho do pacote mudou durante o download.");

            await using var input = await response.Content.ReadAsStreamAsync(downloadToken);
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buffer = new byte[81920];
            long total = 0;
            await using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                int read;
                while ((read = await input.ReadAsync(buffer, downloadToken)) > 0)
                {
                    total += read;
                    if (total > release.Size || total > MaximumPackageBytes)
                        throw new InvalidDataException("O pacote excede o tamanho anunciado.");
                    hash.AppendData(buffer, 0, read);
                    await output.WriteAsync(buffer.AsMemory(0, read), downloadToken);
                }
                await output.FlushAsync(downloadToken);
            }
            if (total != release.Size ||
                !string.Equals(Convert.ToHexString(hash.GetHashAndReset()), release.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("A verificação SHA-256 do pacote falhou.");
            VerifyPackageIdentity(destination, installedManifestPath, release.Version);
            return destination;
        }
        catch
        {
            if (File.Exists(destination)) File.Delete(destination);
            throw;
        }
    }

    public static void VerifyPackageIdentity(string packagePath, string installedManifestPath, Version expectedVersion)
    {
        if (!File.Exists(installedManifestPath))
            throw new InvalidDataException("A instalação atual não possui identidade MSIX.");
        using var archive = ZipFile.OpenRead(packagePath);
        var entry = archive.GetEntry("AppxManifest.xml");
        if (entry is null || entry.Length > 100_000)
            throw new InvalidDataException("O novo MSIX não possui manifesto válido.");
        using var reader = new StreamReader(entry.Open());
        var incoming = ParseIdentity(reader.ReadToEnd());
        var current = ParseIdentity(File.ReadAllText(installedManifestPath));
        if (current.Name != "Conceito.CepHoras" || incoming.Name != current.Name ||
            incoming.Publisher != current.Publisher || incoming.Architecture != "x64" ||
            incoming.Version != expectedVersion.ToString(4))
            throw new InvalidDataException("A identidade ou a versão do MSIX não corresponde ao CEP Horas instalado.");
    }

    private static (string? Name, string? Publisher, string? Version, string? Architecture) ParseIdentity(string xml)
    {
        using var text = new StringReader(xml);
        using var reader = XmlReader.Create(text, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null });
        var document = XDocument.Load(reader);
        XNamespace ns = "http://schemas.microsoft.com/appx/manifest/foundation/windows10";
        var identity = document.Root?.Element(ns + "Identity");
        return ((string?)identity?.Attribute("Name"), (string?)identity?.Attribute("Publisher"),
            (string?)identity?.Attribute("Version"), (string?)identity?.Attribute("ProcessorArchitecture"));
    }

    private static HttpClient CreateClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("CEP-Horas-Desktop/0.2");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }
}
