# Optional datasets

The default gallery does not require external datasets. It uses the explicitly
reported analytic CIE matching-function approximation in `spectrum.hpp`.
`tools/fetch_cie.py` can fetch and checksum an optional official CIE observer
CSV. That third-party dataset is not included in this distribution and has its
own CC BY-SA license and attribution requirements. See `docs/REFERENCES.md`.
