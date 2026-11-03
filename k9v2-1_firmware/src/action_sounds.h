#pragma once
// Action cues only. Poses never trigger audio.
#ifdef K9_SPEAKER_GPIO
static const SoundNote action_wave[] = {{1762,77},{2096,77},{0,45},{2352,77},{2640,77},{2352,77},{2352,12},{2367,12},{2382,12},{2397,12},{2412,12},{2427,12}};
static const SoundNote action_waveleft[] = {{1978,81},{2352,81},{0,45},{2640,81},{2352,81},{2096,81},{2096,12},{2110,12},{2126,12},{2140,12},{2156,12},{2170,12}};
static const SoundNote action_bow[] = {{2352,89},{2096,89},{1762,89},{0,45},{1978,89},{1978,12},{1993,12},{2008,12},{2023,12},{2038,12},{2053,12}};
static const SoundNote action_wag[] = {{2096,93},{2640,93},{0,45},{2096,93},{2640,93},{0,45},{2352,93},{2352,12},{2367,12},{2382,12},{2397,12},{2412,12},{2427,12}};
static const SoundNote action_dig[] = {{1762,97},{0,45},{1762,97},{0,45},{1978,97},{0,45},{2096,97},{2096,12},{2110,12},{2126,12},{2140,12},{2156,12},{2170,12}};
static const SoundNote action_wiggle[] = {{1762,101},{2352,101},{1978,101},{2640,101},{2096,101},{2096,12},{2110,12},{2126,12},{2140,12},{2156,12},{2170,12}};
static void soundForAction(const String& action) {
  if (action == "stand" || action == "sit" || action == "lie" || action == "getup" || action == "beg" || action == "cal" || action == "wake" || action == "sleep") {
    danceEnabled=false; danceOwnsSound=false; laughEnabled=false; laughOwnsSound=false;
    soundStop(); return;
  }
  if (action == "dance" || action == "stretch" || action == "scratch") { soundStop(); return; }
  if (!soundAutomatic || soundMuted) return;
  if (action == "wave") { danceEnabled=false; danceOwnsSound=false; laughEnabled=false; laughOwnsSound=false; soundPlay(action_wave, sizeof(action_wave)/sizeof(SoundNote)); return; }
  if (action == "waveleft") { danceEnabled=false; danceOwnsSound=false; laughEnabled=false; laughOwnsSound=false; soundPlay(action_waveleft, sizeof(action_waveleft)/sizeof(SoundNote)); return; }
  if (action == "bow") { danceEnabled=false; danceOwnsSound=false; laughEnabled=false; laughOwnsSound=false; soundPlay(action_bow, sizeof(action_bow)/sizeof(SoundNote)); return; }
  if (action == "wag") { danceEnabled=false; danceOwnsSound=false; laughEnabled=false; laughOwnsSound=false; soundPlay(action_wag, sizeof(action_wag)/sizeof(SoundNote)); return; }
  if (action == "dig") { danceEnabled=false; danceOwnsSound=false; laughEnabled=false; laughOwnsSound=false; soundPlay(action_dig, sizeof(action_dig)/sizeof(SoundNote)); return; }
  if (action == "wiggle") { danceEnabled=false; danceOwnsSound=false; laughEnabled=false; laughOwnsSound=false; soundPlay(action_wiggle, sizeof(action_wiggle)/sizeof(SoundNote)); return; }
}
#endif
