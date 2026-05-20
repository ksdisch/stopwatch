// Audio engine tests.
//
// Pre-PR (#82) audio code shipped with 3 ambient profiles: white / brown /
// pink. The `ambient-colors-expand` PR adds 4 new colors: green / blue /
// violet / gray. This test pins the registration contract for the
// `AMBIENT_PROFILES` array via the public `getAmbientProfiles()` surface so
// a future refactor that drops or reorders an entry is caught at the unit
// boundary rather than via smoke. The test is intentionally minimal — it
// only exercises the pure synchronous map over the static array; no
// AudioContext is instantiated at any point.
describe('SFX ambient profile registration', () => {
  it('exposes all 7 profiles in the documented order', () => {
    const ids = SFX.getAmbientProfiles().map(p => p.id);
    assertArrayEqual(ids, ['white', 'brown', 'pink', 'green', 'blue', 'violet', 'gray']);
  });

  it('capitalizes each profile name for dropdown rendering', () => {
    const profiles = SFX.getAmbientProfiles();
    assertEqual(profiles.length, 7);
    assertEqual(profiles[0].name, 'White');
    assertEqual(profiles[1].name, 'Brown');
    assertEqual(profiles[2].name, 'Pink');
    assertEqual(profiles[3].name, 'Green');
    assertEqual(profiles[4].name, 'Blue');
    assertEqual(profiles[5].name, 'Violet');
    assertEqual(profiles[6].name, 'Gray');
  });
});
