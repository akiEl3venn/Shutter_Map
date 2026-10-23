# Third-party notices

This list covers the photo fallback decoders and the existing OpenCC character mapping. Package versions are pinned in `package-lock.json`.

| Component | Version / source revision | License | License file |
| --- | --- | --- | --- |
| libheif-js | 1.23.5 | LGPL-3.0 | [libheif-js-LICENSE](libheif-js-LICENSE) |
| libheif, inside the HEIF WASM | 1.23.5 (verified through the WASM version API) | LGPL-3.0; bundled file also includes its MIT wrapper notice and GPL-3.0 text | [libheif-LICENSE](libheif-LICENSE) |
| libde265, inside the HEIF WASM | 1.0.15 (verified through the WASM version API) | LGPL-3.0; bundled file includes GPL-3.0 text and sample MIT notice | [libde265-LICENSE](libde265-LICENSE) |
| jSquash / @jsquash/jxl | 1.3.0, npm release commit `1b1964194611ece3ec984ab91c04726d1088f05e` | Apache-2.0 | [jSquash-LICENSE](jSquash-LICENSE) |
| libjxl, inside the JPEG XL WASM | `9f544641ec83f6abd9da598bdd08178ee8a003e0`, pinned by the jSquash release's codec Makefile | BSD-3-Clause | [libjxl-LICENSE](libjxl-LICENSE) |
| utif2 | 4.1.0 | MIT | [utif2-LICENSE](utif2-LICENSE) |
| pako, utif2 dependency | 1.0.11 | MIT | [pako-LICENSE](pako-LICENSE) |
| wasm-feature-detect, installed jSquash dependency | 1.9.0; not used by the decode-only runtime bundle | Apache-2.0 | [wasm-feature-detect-LICENSE](wasm-feature-detect-LICENSE) |
| OpenCC | Existing generated `TSCharacters` + `JPShinjitaiCharacters` snapshot; original upstream revision was not recorded | Apache-2.0 | [OpenCC-LICENSE](OpenCC-LICENSE) |

The libheif-js, libheif, jSquash, utif2, pako and wasm-feature-detect license texts are copied without changes from their installed npm packages. OpenCC's existing license is retained. The following texts were absent from those packages and copied from the corresponding upstream source:

- [libde265 1.0.15 COPYING](https://github.com/strukturag/libde265/blob/v1.0.15/COPYING).
- [libjxl LICENSE at the pinned codec revision](https://github.com/libjxl/libjxl/blob/9f544641ec83f6abd9da598bdd08178ee8a003e0/LICENSE).

## HEIF WASM replacement and source

The application loads `libheif.wasm` on demand as a separate same-origin file. It is not embedded in JavaScript as base64. Users may replace it with an interface-compatible build: replace `node_modules/libheif-js/libheif-wasm/libheif.wasm` (and its JavaScript glue if the interface changes), then run `npm run build`. Vite emits a separate asset with a new content hash. No integrity pin, signing gate or license check prevents replacement or debugging a modified decoder.

This separation supports replacing and relinking the LGPL library. Preserve these notices and the corresponding source/build information when distributing the application; a separate WASM file alone does not remove the other LGPL obligations.

- [libheif-js source and packaging instructions](https://github.com/catdad-experiments/libheif-js).
- [libheif Emscripten build source, v1.23.5](https://github.com/catdad-experiments/libheif-emscripten/tree/v1.23.5).
- [libheif source, v1.23.5](https://github.com/strukturag/libheif/tree/v1.23.5).
- [libde265 source, v1.0.15](https://github.com/strukturag/libde265/tree/v1.0.15).
- [jSquash release codec build recipe](https://github.com/jamsinclair/jSquash/blob/1b1964194611ece3ec984ab91c04726d1088f05e/packages/jxl/codec/Makefile).

All decoder assets are served by this application. No photo bytes or metadata are sent to these upstream projects.
