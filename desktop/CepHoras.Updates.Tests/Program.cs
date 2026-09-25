using CepHoras.Updates;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;

const string validAsset = """
    {"name":"CEP-Horas-win-x64.msix","size":1200,"digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","browser_download_url":"https://github.com/luisotvbim-sudo/CEP-FRONT/releases/download/desktop-v0.2.1.0/CEP-Horas-win-x64.msix"}
    """;

var valid = $"[{{\"tag_name\":\"desktop-v0.2.1.0\",\"draft\":false,\"prerelease\":false,\"assets\":[{validAsset}]}}]";
var installed = new Version(0, 2, 0, 0);
var update = GitHubDesktopUpdates.ParseLatestRelease(valid, installed);
Assert(update is not null && update.Version == new Version(0, 2, 1, 0), "Detecta versão nova");
Assert(update!.Size == 1200 && update.Sha256.Length == 64, "Lê metadados de integridade");
Assert(GitHubDesktopUpdates.ParseLatestRelease(valid, new Version(0, 2, 1, 0)) is null, "Ignora versão instalada");
Assert(GitHubDesktopUpdates.ParseLatestRelease(valid.Replace("\"prerelease\":false", "\"prerelease\":true"), installed) is null, "Ignora pré-lançamento");
Assert(GitHubDesktopUpdates.ParseLatestRelease(valid.Replace("sha256:", "invalid:"), installed) is null, "Rejeita digest inválido");
Assert(GitHubDesktopUpdates.ParseLatestRelease(valid.Replace("github.com/luisotvbim-sudo", "example.com/luisotvbim-sudo"), installed) is null, "Rejeita origem de download diferente");
Assert(GitHubDesktopUpdates.ParseLatestRelease(valid.Replace("\"size\":1200", "\"size\":999999999"), installed) is null, "Rejeita pacote grande demais");
Assert(GitHubDesktopUpdates.ParseLatestRelease(valid.Replace("CEP-Horas-win-x64.msix", "outro.msix"), installed) is null, "Rejeita outro asset");
Assert(GitHubDesktopUpdates.ParseLatestRelease(valid.Replace("\"name\":\"CEP-Horas-win-x64.msix\"", "\"name\":123"), installed) is null, "Ignora nome de asset malformado");
Assert(GitHubDesktopUpdates.ParseLatestRelease(valid.Replace("\"browser_download_url\":\"https://github.com/luisotvbim-sudo/CEP-FRONT/releases/download/desktop-v0.2.1.0/CEP-Horas-win-x64.msix\"", "\"browser_download_url\":123"), installed) is null, "Ignora URL malformada");

var testDirectory = Path.Combine(Path.GetTempPath(), "CepHoras-Update-Test-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(testDirectory);
try
{
    var currentManifest = Path.Combine(testDirectory, "current.xml");
    var package = Path.Combine(testDirectory, "update.msix");
    File.WriteAllText(currentManifest, Manifest("CN=Conceito Engenharia", "0.2.0.0"));
    WritePackage(package, Manifest("CN=Conceito Engenharia", "0.2.1.0"));
    GitHubDesktopUpdates.VerifyPackageIdentity(package, currentManifest, new Version(0, 2, 1, 0));
    AssertThrows(() => GitHubDesktopUpdates.VerifyPackageIdentity(package, currentManifest, new Version(0, 2, 2, 0)), "Rejeita versão divergente");

    var payload = File.ReadAllBytes(package);
    using var http = new HttpClient(new StaticPackageHandler(payload));
    var downloader = new GitHubDesktopUpdates(http);
    var downloadDirectory = Path.Combine(testDirectory, "downloads");
    var release = new DesktopRelease(new Version(0, 2, 1, 0), new Uri("https://github.com/test.msix"),
        Convert.ToHexString(SHA256.HashData(payload)), payload.Length);
    var downloaded = await downloader.DownloadAsync(release, currentManifest, downloadDirectory: downloadDirectory);
    Assert(File.Exists(downloaded), "Baixa e verifica pacote completo após fechar o arquivo");
    var previousCount = Directory.GetFiles(downloadDirectory).Length;
    await AssertThrowsAsync(() => downloader.DownloadAsync(release with { Sha256 = new string('0', 64) },
        currentManifest, downloadDirectory: downloadDirectory), "Rejeita conteúdo com SHA-256 divergente");
    Assert(Directory.GetFiles(downloadDirectory).Length == previousCount, "Remove download parcial inválido");

    var wrongPublisher = Path.Combine(testDirectory, "wrong-publisher.msix");
    WritePackage(wrongPublisher, Manifest("CN=Outro", "0.2.1.0"));
    AssertThrows(() => GitHubDesktopUpdates.VerifyPackageIdentity(wrongPublisher, currentManifest, new Version(0, 2, 1, 0)), "Rejeita outro publicador");
}
finally { Directory.Delete(testDirectory, recursive: true); }

Console.WriteLine("16 verificações de atualização passaram.");

static void Assert(bool condition, string message)
{
    if (!condition) throw new Exception(message);
}

static void AssertThrows(Action action, string message)
{
    try { action(); }
    catch (InvalidDataException) { return; }
    throw new Exception(message);
}

static async Task AssertThrowsAsync(Func<Task> action, string message)
{
    try { await action(); }
    catch (InvalidDataException) { return; }
    throw new Exception(message);
}

static string Manifest(string publisher, string version) =>
    $"<Package xmlns=\"http://schemas.microsoft.com/appx/manifest/foundation/windows10\"><Identity Name=\"Conceito.CepHoras\" Publisher=\"{publisher}\" Version=\"{version}\" ProcessorArchitecture=\"x64\" /></Package>";

static void WritePackage(string path, string manifest)
{
    using var zip = ZipFile.Open(path, ZipArchiveMode.Create);
    using var writer = new StreamWriter(zip.CreateEntry("AppxManifest.xml").Open());
    writer.Write(manifest);
}

sealed class StaticPackageHandler(byte[] payload) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
        Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(payload) });
}
