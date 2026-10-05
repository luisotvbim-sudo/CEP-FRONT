using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CepHoras.Updates;

public sealed record MsiRelease(Version Version, Uri PackageUri, long Size, string Sha256, byte[] Manifest, byte[] Signature);

internal static class MsiUpdateTrust
{
    internal const string PackageAsset = "CEP-Horas-Windows-win-x64.msi";
    internal const string ManifestAsset = "CEP-Horas-Windows-win-x64.manifest.json";
    internal const string SignatureAsset = "CEP-Horas-Windows-win-x64.manifest.sig";
    internal const long MaximumPackageBytes = 512L * 1024 * 1024;
    internal const int MaximumManifestBytes = 64 * 1024;
    internal const int MaximumSignatureBytes = 1024;
    private static readonly Regex VersionPattern = new(@"\A(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,4})\z", RegexOptions.CultureInvariant);
    private static readonly Regex HashPattern = new(@"\A[0-9a-fA-F]{64}\z", RegexOptions.CultureInvariant);

    internal static Version NormalizeVersion(Version value) => new(value.Major, value.Minor, Math.Max(0, value.Build));

    internal static Version? ParseVersion(string? value)
    {
        if (value is null || !VersionPattern.IsMatch(value) || !Version.TryParse(value, out var version) ||
            version.Major > 255 || version.Minor > 255 || version.Build > 65535) return null;
        return version;
    }

    internal static Uri AssetUri(Version version, string asset) =>
        new($"https://github.com/luisotvbim-sudo/CEP-FRONT/releases/download/installer-v{version.ToString(3)}/{asset}");

    internal static bool IsExactAsset(Uri uri, Version version, string asset) =>
        uri.IsAbsoluteUri && uri.AbsoluteUri == AssetUri(version, asset).AbsoluteUri;

    // Verify the original bytes before interpreting JSON. Reformatting is not permitted.
    internal static MsiRelease Validate(byte[] manifest, byte[] signature, Version? expectedVersion, string publicKeyPem)
    {
        if (manifest.Length is < 1 or > MaximumManifestBytes || signature.Length is < 1 or > MaximumSignatureBytes)
            throw new InvalidDataException("Metadados de atualização fora do limite.");
        // Callers can retain and mutate byte arrays. Verify and parse the same private
        // snapshot so concurrent mutation cannot change JSON after authentication.
        manifest = manifest.ToArray();
        signature = signature.ToArray();
        using var rsa = RSA.Create();
        rsa.ImportFromPem(publicKeyPem);
        if (rsa.KeySize < 2048 || !rsa.VerifyData(manifest, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pss))
            throw new InvalidDataException("A assinatura da atualização não é válida.");
        try
        {
            using var document = JsonDocument.Parse(manifest, new JsonDocumentOptions { MaxDepth = 4 });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Manifesto de atualização inválido.");
            var fields = new HashSet<string>(StringComparer.Ordinal);
            foreach (var field in root.EnumerateObject())
            {
                if (!fields.Add(field.Name) || field.Name is not ("product" or "version" or "asset" or "size" or "sha256"))
                    throw new InvalidDataException("O manifesto contém campos inesperados ou repetidos.");
            }
            if (fields.Count != 5 || root.GetProperty("product").GetString() != "Conceito.CepHoras" ||
                root.GetProperty("asset").GetString() != PackageAsset ||
                ParseVersion(root.GetProperty("version").GetString()) is not { } version || (expectedVersion is not null && version != expectedVersion) ||
                !root.GetProperty("size").TryGetInt64(out var size) || size <= 0 || size > MaximumPackageBytes ||
                root.GetProperty("sha256").GetString() is not { } hash || !HashPattern.IsMatch(hash))
                throw new InvalidDataException("Identidade, versão ou integridade do manifesto inválida.");
            return new(version, AssetUri(version, PackageAsset), size, hash.ToUpperInvariant(), manifest, signature);
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or KeyNotFoundException)
        {
            throw new InvalidDataException("Manifesto de atualização inválido.", error);
        }
    }

    internal static void ValidateRelease(MsiRelease release, string publicKeyPem)
    {
        var trusted = Validate(release.Manifest, release.Signature, release.Version, publicKeyPem);
        if (!IsExactAsset(release.PackageUri, trusted.Version, PackageAsset) || release.Size != trusted.Size ||
            !string.Equals(release.Sha256, trusted.Sha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Os metadados não correspondem ao manifesto assinado.");
    }
}
