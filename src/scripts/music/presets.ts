import type { Instrument, Preset } from './types';

/** Asset identity is immutable: recorded takes retain id AND version. */
const generalUser = {
  version: '2.0.3-684543d5-v1', kind: 'soundfont' as const, bank: 0,
  source: 'https://github.com/mrbumpy409/GeneralUser-GS/tree/684543d5e5efaef08d02be50dcda8d552478fa60',
  license: 'GeneralUser GS license 2.0', licenseUrl: '/music/GeneralUser-LICENSE.txt',
};
const vcsl = {
  version: 'dfcf4a491877-v1', kind: 'samples' as const, program: 0, bank: 0,
  source: 'https://github.com/sgossner/VCSL/tree/dfcf4a4918771eee884b96ad4493de82ef84daf6',
  license: 'CC0 1.0', licenseUrl: '/music/CC0-1.0.txt',
};

export const PRESETS: readonly Preset[] = [
  {
    ...generalUser, id: 'gu-piano', name: 'GeneralUser · Acoustic grand', instrument: 'piano',
    url: '/music/gu-piano.sf2', program: 0, range: [21, 108], defaultGain: 1.953,
    attack: 0.004, release: 0.4, bytes: 2178864,
    sustain: 'Original SoundFont decay, damping envelope, sample loops and modulators preserved.',
    mapping: 'GM bank 0, program 0. Original 17-sample zones; see /music/gu-piano-mapping.json.',
  },
  {
    ...generalUser, id: 'gu-harmonica', name: 'GeneralUser · Harmonica', instrument: 'harmonica',
    url: '/music/gu-harmonica.sf2', program: 22, range: [48, 97], defaultGain: 1.760,
    attack: 0.004, release: 0.15, bytes: 64998,
    sustain: 'Original SoundFont sustain loops while held, followed by its programmed release.',
    mapping: 'GM bank 0, program 22. Original 6-sample zones; see /music/gu-harmonica-mapping.json.',
  },
  {
    ...generalUser, id: 'gu-guitar', name: 'GeneralUser · Nylon guitar', instrument: 'guitar',
    url: '/music/gu-guitar.sf2', program: 24, range: [40, 88], defaultGain: 2.132,
    attack: 0.004, release: 0.4, bytes: 423374,
    sustain: 'Original plucked-string decay, damping envelope, sample loops and modulators preserved.',
    mapping: 'GM bank 0, program 24. Original 12-sample zones; see /music/gu-guitar-mapping.json.',
  },
  {
    ...vcsl, id: 'vcsl-piano', name: 'VCSL · Kawai grand (Legacy)', instrument: 'piano',
    url: '/music/vcsl-piano/manifest.json', range: [21, 99], defaultGain: 0.780,
    attack: 0.004, release: 0.4, bytes: 15001568,
    sustain: 'Full natural sampled decay; no loop. Four-millisecond attack and 400-millisecond damper release.',
    mapping: '17 original SFZ zones active at fixed velocity 96; round robin 1, original tuning and level offsets. Full source range 21–99. Lossless FLAC; see preset manifest.',
  },
  {
    ...vcsl, id: 'vcsl-harmonica', name: 'VCSL · Hohner Super 64', instrument: 'harmonica',
    url: '/music/vcsl-harmonica/manifest.json', range: [48, 97], defaultGain: 0.402,
    attack: 0.004, release: 0.1, bytes: 7025110,
    sustain: 'Natural attack, then a 0.65–2.35-second sustain-body loop with a 200-millisecond prepared crossfade. 100-millisecond release.',
    mapping: '13 original Normal-articulation SFZ zones, original tuning and level offsets; source leading offset honored. Lossless FLAC; exact loop times in manifest.',
  },
  {
    id: 'freepats-guitar', version: '2019-06-18-v1', name: 'FreePats · Spanish classical guitar', instrument: 'guitar',
    kind: 'soundfont', url: '/music/freepats-guitar.sf2', program: 0, bank: 0,
    range: [29, 88], defaultGain: 1.530, attack: 0.004, release: 1.5, bytes: 19822546,
    sustain: 'Unmodified original SoundFont plucked-string decay, release, mapping and sample loops.',
    mapping: 'Original 48-sample SF2 zones, bank 0/program 0; playable mapped range 29–88. See /music/freepats-guitar-mapping.json.',
    source: 'https://freepats.zenvoid.org/Guitar/acoustic-guitar.html',
    license: 'CC0 1.0', licenseUrl: '/music/CC0-1.0.txt',
  },
];

export const DEFAULT_PRESETS: Record<Instrument, string> = {
  piano: 'gu-piano', harmonica: 'gu-harmonica', guitar: 'gu-guitar',
};

export function presetById(id: string): Preset {
  const preset = PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`Unknown instrument preset: ${id}`);
  return preset;
}
