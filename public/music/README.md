# Instrument packages for Play

These six local presets are loaded on demand. GeneralUser GS is the default for each instrument. Files are cached for reuse within the current music session. All source identity, mapping and level information is independent of recorded takes.

| Preset | Source version | Package bytes | Mapping |
| --- | --- | ---: | --- |
| GeneralUser acoustic grand | 2.0.3, commit `684543d5e5efaef08d02be50dcda8d552478fa60` | 2,178,864 | Original GM bank 0 / program 0; 17 samples |
| GeneralUser harmonica | same | 64,998 | Original GM bank 0 / program 22; 6 samples |
| GeneralUser nylon guitar | same | 423,374 | Original GM bank 0 / program 24; 12 samples |
| VCSL Kawai grand, Legacy | commit `dfcf4a4918771eee884b96ad4493de82ef84daf6` | 15,001,568 | Original 17 SFZ zones active at velocity 96, range MIDI 21–99 |
| VCSL Hohner Super 64, Normal | same | 7,025,110 | Original 13 SFZ zones, range MIDI 48–97 |
| FreePats Spanish classical guitar | 2019-06-18 | 19,822,546 | Unmodified complete single-instrument SF2, bank 0 / program 0, 48 samples, range MIDI 29–88 |

## Preparation and source integrity

Run `node scripts/prepare-music-assets.mjs` from the repository after `npm ci`. Preparation requires curl, FFmpeg (FLAC encoder), and 7-Zip. `FFMPEG` and `SEVEN_ZIP` can override those executable paths. HTTP(S) proxy environment variables are honored by curl. Source downloads are cached outside the shipped assets in `output/music-source/`. The script pins GitHub revisions, records SHA-256 hashes, and emits `sources.json`, per-preset mapping files, sample manifests, and `level-reference.json`. Normal builds use these checked-in assets and do not download or regenerate them.

The GeneralUser packages recursively copy only the selected preset, its instruments and its samples using SpessaSynth Core 4.3.22. Original generators, global zones, modulators, sample relationships, loop points and envelopes remain intact. The FreePats SoundFont is byte-for-byte the extracted original. SF2 mapping reports include the original sample data and generator mappings. The catalog's `attack` and `release` describe the voice cleanup envelope for the application; SoundFont playback itself uses the source programming.

The VCSL piano uses **Kawai Legacy**, not the newer Kawai or Steinway set. This is a deliberate compact, fixed-velocity edition: it selects the original SFZ regions containing velocity 96, using round robin 1. Other velocity layers, release-trigger noises and pedal articulations are not packaged. The source mapping, gain offsets, fine tuning and complete natural sample tails are retained. The 17 original regions cover MIDI 21 through 99. Piano samples do not loop. A 4 ms attack prevents clicks; a 400 ms damper release follows the source SFZ.

The VCSL harmonica uses the Normal articulation. Its upstream WAV files have no embedded sustain loop. To sustain indefinitely without replaying the attack, preparation creates a body loop from 0.65 s to 2.35 s. The final 200 ms is blended with the 200 ms immediately preceding the loop start, using the equal-gain smoothstep curve `t²(3−2t)`. This makes the final loop sample join the sample immediately before the beginning of the next cycle. Source-authorized leading sample offsets are removed before loop positioning. The natural attack stays outside the loop; release uses the source's 100 ms envelope. Release-trigger breath recordings, accented articulation and vibrato articulation are not included. These are disclosed playback adaptations, not claims that the original samples already contained loops.

VCSL samples retain their sample rate, channel count and PCM precision, encoded losslessly as FLAC. The only PCM modification is the disclosed harmonica loop crossfade and source-specified leading offset removal. The manifest records every source region, original velocity range, source offset, tuning, loop position and output hash. `root` can be fractional: `source MIDI root − source tune cents / 100`, so the Web Audio playback-rate calculation preserves source tuning correction.

## Level coordination

Preset gains use one fixed reference procedure, recorded in `level-reference.json`: render MIDI 60, 64 and 67 separately at velocity 96; compare the first second's dry stereo RMS; use 128-frame SoundFont synthesis blocks, CC7 and CC11 both 127, and no effects. A single preset gain targets average RMS 0.06, with reference peak limited to 0.65 and gain capped at 16. Gains are 1.953 / 1.760 / 2.132 for GeneralUser piano / harmonica / guitar, 0.780 / 0.402 for VCSL piano / harmonica, and 1.530 for FreePats guitar. The shared output stage adds headroom for simultaneous notes and tracks. Individual sample dynamics and timbres are retained. This numerical reference is not a perceptual loudness or listening evaluation, and different registers/chords naturally vary.

## Sources and licenses

- GeneralUser GS by S. Christian Collins: <https://github.com/mrbumpy409/GeneralUser-GS>. The original **GeneralUser GS license 2.0** is provided in `GeneralUser-LICENSE.txt`; it allows software integration and repackaging and explains the upstream sample provenance caveat. It is not labeled CC0.
- Versilian Community Sample Library by Versilian Studios: <https://versilian-studios.com/vcsl/> and <https://github.com/sgossner/VCSL>. **CC0 1.0**; original project readme is `VCSL-README.md`.
- FreePats Spanish classical guitar by roberto@zenvoid.org: <https://freepats.zenvoid.org/Guitar/acoustic-guitar.html>. **CC0 1.0**; original readme is `FreePats-README.txt`.
- Full CC0 text: `CC0-1.0.txt`. SpessaSynth library, core, and the stb-vorbis decoder are Apache-2.0; their license texts are included in `/licenses/`.
