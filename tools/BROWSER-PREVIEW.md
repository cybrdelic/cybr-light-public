# Dedicated Windows preview

From the repository, run `./tools/Start-BrowserPreview.ps1`. Optional `-Scene elements`, `-Port 4181` and `-CheckOnly` select/check the session.

The server serves this standalone repository and `/browser/`. It checks both the index and main module against this checkout before reusing a server; a mismatch requires another port and does not stop anyone else's process. Browser/profile/server files are under ignored `outputs/browser-preview/`.

Chrome or Edge runs in a dedicated profile with `--force-high-performance-gpu`. Verify the adapter from actual renderer state/footer. A launch flag alone does not prove GPU selection. Coordinate with any other GPU work before rendering or capturing.

Defaults retain 960×540, six bounces, interactive reconstruction and cached fluid frame zero. Existing noise/quality limits remain documented in [known issues](../docs/KNOWN_ISSUES.md); this launcher changes asset/session portability, not rendering math or image quality.
