# Third-party notices

This list covers photo decoding and export encoding, map decoders and the OpenCC character mapping. Package versions are pinned in `package-lock.json`.

| Component | Version / source revision | License | License file |
| --- | --- | --- | --- |
| @jsquash/avif | 2.1.1 | Apache-2.0 | [jSquash-LICENSE](jSquash-LICENSE) |
| libavif, inside the AVIF encoder | 1.0.1 per the wrapper changelog | BSD-2-Clause with third-party notices | [libavif-LICENSE](libavif-LICENSE) |
| libaom, inside the AVIF encoder | 3.7.0 (encoder version string in the WASM) | BSD-2-Clause; separate patent license | [libaom-LICENSE](libaom-LICENSE), [libaom-PATENTS](libaom-PATENTS) |
| @jsquash/webp | 1.5.0 | Apache-2.0 | [jSquash-LICENSE](jSquash-LICENSE) |
| libwebp, inside the WebP fallback encoder | Bundled with @jsquash/webp 1.5.0 | BSD-3-Clause | [libwebp-LICENSE.md](libwebp-LICENSE.md) |
| @cornerstonejs/codec-libjxl | 1.2.0 | BSD-3-Clause in the package manifest; the repository's LICENSE file is MIT | [cornerstone-codecs-LICENSE](cornerstone-codecs-LICENSE) |
| libjxl, inside the Cornerstone JPEG XL encoder | 0.11.1, `794a5dcf0d54f9f0b20d288a12e87afb91d20dfc`, pinned by the 1.2.0 release tag | BSD-3-Clause; separate patent grant | [libjxl-LICENSE](libjxl-LICENSE), [libjxl-PATENTS](libjxl-PATENTS) |
| gifenc | 1.0.3 | MIT | [gifenc-LICENSE.md](gifenc-LICENSE.md) |
| @mapbox/vector-tile | 3.0.0 | BSD-3-Clause | [vector-tile-LICENSE](vector-tile-LICENSE) |
| @mapbox/point-geometry, vector-tile dependency | 1.1.0 | ISC | [point-geometry-LICENSE](point-geometry-LICENSE) |
| pbf | 5.1.2 | BSD-3-Clause | [pbf-LICENSE](pbf-LICENSE) |
| libheif-js | 1.23.5 | LGPL-3.0 | [libheif-js-LICENSE](libheif-js-LICENSE) |
| libheif, inside the HEIF WASM | 1.23.5 (verified through the WASM version API) | LGPL-3.0; bundled file also includes its MIT wrapper notice and GPL-3.0 text | [libheif-LICENSE](libheif-LICENSE) |
| libde265, inside the HEIF WASM | 1.0.15 (verified through the WASM version API) | LGPL-3.0; bundled file includes GPL-3.0 text and sample MIT notice | [libde265-LICENSE](libde265-LICENSE) |
| jSquash / @jsquash/jxl | 1.3.0, npm release commit `1b1964194611ece3ec984ab91c04726d1088f05e` | Apache-2.0 | [jSquash-LICENSE](jSquash-LICENSE) |
| libjxl, inside the JPEG XL WASM | `9f544641ec83f6abd9da598bdd08178ee8a003e0`, pinned by the jSquash release's codec Makefile | BSD-3-Clause | [libjxl-LICENSE](libjxl-LICENSE) |
| utif2, TIFF decoder and IFD writer | 4.1.0 | MIT | [utif2-LICENSE](utif2-LICENSE) |
| pako, utif2 dependency | 1.0.11 | MIT | [pako-LICENSE](pako-LICENSE) |
| wasm-feature-detect, used by jSquash encoders | 1.9.0 | Apache-2.0 | [wasm-feature-detect-LICENSE](wasm-feature-detect-LICENSE) |
| OpenCC | Existing generated `TSCharacters` + `JPShinjitaiCharacters` snapshot; original upstream revision was not recorded | Apache-2.0 | [OpenCC-LICENSE](OpenCC-LICENSE) |

The map decoder, libheif-js, libheif, jSquash, utif2, pako and wasm-feature-detect license texts are copied without changes from their installed npm packages. OpenCC's existing license is retained. The following texts were absent from those packages and copied from the corresponding upstream source:

- [libde265 1.0.15 COPYING](https://github.com/strukturag/libde265/blob/v1.0.15/COPYING).
- [libjxl LICENSE at the pinned codec revision](https://github.com/libjxl/libjxl/blob/9f544641ec83f6abd9da598bdd08178ee8a003e0/LICENSE).

## Export encoder notices

The installed AVIF and WebP wrappers' LICENSE files are byte-identical to jSquash-LICENSE. The gifenc and libwebp notices are copied from the installed packages. libwebp's bundled codec README lists v1.0.2; the encoder binary's exact source revision has not been independently verified.

These texts were absent from the installed packages and copied without changes from the corresponding upstream source:

- [libavif v1.0.1 LICENSE](https://github.com/AOMediaCodec/libavif/blob/v1.0.1/LICENSE).
- libaom v3.7.0 [LICENSE](https://aomedia.googlesource.com/aom/+/refs/tags/v3.7.0/LICENSE) and [PATENTS](https://aomedia.googlesource.com/aom/+/refs/tags/v3.7.0/PATENTS).
- [Cornerstone codecs LICENSE at the 1.2.0 release tag](https://github.com/cornerstonejs/codecs/blob/%40cornerstonejs/codec-libjxl%401.2.0/LICENSE).
- [libjxl PATENTS at the encoder's pinned revision](https://github.com/libjxl/libjxl/blob/794a5dcf0d54f9f0b20d288a12e87afb91d20dfc/PATENTS). Its LICENSE is byte-identical to the existing libjxl-LICENSE, so that file covers both the decoder and the encoder.

## HEIF WASM replacement and source

The application loads `libheif.wasm` on demand as a separate same-origin file. It is not embedded in JavaScript as base64. Users may replace it with an interface-compatible build: replace `node_modules/libheif-js/libheif-wasm/libheif.wasm` (and its JavaScript glue if the interface changes), then run `npm run build`. Vite emits a separate asset with a new content hash. No integrity pin, signing gate or license check prevents replacement or debugging a modified decoder.

This separation supports replacing and relinking the LGPL library. Preserve these notices and the corresponding source/build information when distributing the application; a separate WASM file alone does not remove the other LGPL obligations.

- [libheif-js source and packaging instructions](https://github.com/catdad-experiments/libheif-js).
- [libheif Emscripten build source, v1.23.5](https://github.com/catdad-experiments/libheif-emscripten/tree/v1.23.5).
- [libheif source, v1.23.5](https://github.com/strukturag/libheif/tree/v1.23.5).
- [libde265 source, v1.0.15](https://github.com/strukturag/libde265/tree/v1.0.15).
- [jSquash release codec build recipe](https://github.com/jamsinclair/jSquash/blob/1b1964194611ece3ec984ab91c04726d1088f05e/packages/jxl/codec/Makefile).

All codec assets are served by this application. No photo bytes or metadata are sent to these upstream projects.
