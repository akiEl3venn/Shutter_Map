# Contributing place names

The UTF-8 files in `data/place-names/` supplement and correct the GeoNames names used by local place search. They do not add locations or change coordinates. GeoNames supplies the base data under CC BY 4.0.

Find a place on [geonames.org](https://www.geonames.org/), open its place page and copy the numeric ID from the URL: for example, `6167865` in the Toronto URL. Check that you have the intended city or landmark, rather than a similarly named administrative area.

Add one entry per line to the appropriate lowercase language file (`zh.tsv`, `ja.tsv`, `en.tsv`, `ko.tsv`, or another two- or three-letter language code):

```text
geonameid<TAB>name<TAB>optional English note
6167865	多伦多	Toronto
```

Use actual tabs between columns. The ID must be a positive integer; names must be nonempty, with no tabs or surrounding whitespace. Blank lines and lines starting with `#` are ignored. Do not repeat the same ID and name in one file. Include the English place name in the optional note when opening a pull request so reviewers can identify it easily; notes are not included in generated data.

In `zh.tsv`, the first entry for each ID becomes its Chinese **display name**, overriding GeoNames. Use simplified Chinese. Additional entries for that ID are searchable **aliases**. Traditional characters are matched automatically, so add a traditional-language alias only when the wording differs, such as `雪梨` for `悉尼`.

Entries in other languages are searchable aliases and do not replace the display name. Community aliases appear before GeoNames aliases and are exempt from the ten-alias limit. Only locations selected by a build receive names; entries outside its coverage are skipped and counted. The development build covers China, Japan, France and Canada.

Before opening a pull request, run:

```sh
npm run names:check
```

This validates every file without requiring a GeoNames download. Errors identify the filename and line. Generated `public/geo-*/` data is not committed; contribute only the TSV changes and their review notes.
