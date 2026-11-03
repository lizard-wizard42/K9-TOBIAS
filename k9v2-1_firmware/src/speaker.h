#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include "laugh_timeline.h"
#include "personality_audio.h"
#ifdef K9_SPEAKER_GPIO
// DevKit only. LEDC channel 6 uses timer 3, separate from servo channels 0..3.
static int emotionSeen=0;
static bool emotionEnabled=false, emotionOwnsSound=false;
static constexpr uint8_t SOUND_CHANNEL = 6;
static const SoundNote soundWhistle[] = {{1400,12},{1450,12},{1500,12},{1550,12},{1600,12},{1650,12},{1700,12},{1750,12},{1800,12},{1850,12},{1900,12},{1950,12},{2000,12},{2050,12},{2100,12},{2150,12},{2200,12},{2250,12},{2300,12},{2350,12},{2400,12},{2450,12},{2500,12},{2550,12},{2600,12},{2600,100},{0,90},{2600,15},{2560,15},{2520,15},{2480,15},{2440,15},{2400,15},{2360,15},{2320,15},{2280,15},{2240,15},{2200,15},{2160,15},{2120,15},{2080,15},{2040,15},{2000,15},{1960,15},{1920,15},{1880,15},{1840,15},{1800,15},{1760,15},{1720,15},{1680,15},{1640,15},{1600,15},{1600,90}};
static const SoundNote soundBeep[] = {{2096,95},{0,45},{2352,95}};
static const SoundNote soundHello[] = {{1762,100},{2096,100},{0,45},{2352,100},{2096,100},{0,45},{2640,100},{2352,210}};
static const SoundNote soundAlert[] = {{1978,85},{2640,85},{0,45},{1978,85},{2640,85},{0,45},{2352,85},{0,45},{2352,85},{2096,180}};
static const SoundNote soundRobot[] = {{1762,55},{0,45},{2352,55},{2096,55},{0,45},{1762,55},{2640,55},{0,45},{1978,55},{2550,14},{2498,14},{2446,14},{2394,14},{2342,14},{2290,14},{2239,14},{2186,14},{2134,14},{2083,14},{2031,14},{1978,14},{1927,14},{1875,14},{2096,100},{0,45},{2352,100}};
// Short synthesized effects concentrated near the audible sweep range.
static const SoundNote sound_wake[] = {{1538,14},{1567,14},{1596,14},{1625,14},{1655,14},{1684,14},{1714,14},{1743,14},{1772,14},{1802,14},{1832,14},{1861,14},{1890,14},{1919,14},{1948,14},{1978,14},{2008,14},{2037,14},{2066,14},{2096,14},{0,100},{1762,85},{1978,85},{2352,85},{0,45},{2096,85},{2352,85},{2640,85},{2963,190}};
static const SoundNote sound_spell[] = {{1570,65},{1978,65},{2352,65},{1978,65},{1762,65},{2096,65},{2640,65},{2096,65},{0,90},{1875,12},{1921,12},{1966,12},{2012,12},{2057,12},{2103,12},{2149,12},{2194,12},{2240,12},{2286,12},{2332,12},{2378,12},{2422,12},{2468,12},{2514,12},{2560,12},{2606,12},{2651,12},{2697,12},{2743,12},{2788,12},{2834,12},{2879,12},{2925,12},{2640,65},{2352,65},{2096,65},{2352,65},{2640,65},{2963,65},{2640,240}};
static const SoundNote sound_sad[] = {{2352,180},{2352,22},{2335,22},{2318,22},{2301,22},{2284,22},{2266,22},{2249,22},{2232,22},{2216,22},{2198,22},{2181,22},{2164,22},{2146,22},{2130,22},{2113,22},{2096,22},{0,180},{1978,230},{1978,25},{1956,25},{1935,25},{1913,25},{1892,25},{1870,25},{1849,25},{1828,25},{1806,25},{1784,25},{1763,25},{1742,25},{1720,25},{1699,25},{1677,25},{1656,25},{1634,25},{1612,25},{1592,25},{1570,25},{0,100},{1570,320}};
static const SoundNote sound_crazy[] = {{1762,70},{2352,70},{0,45},{1978,70},{0,45},{2640,70},{2096,70},{1800,14},{1868,14},{1936,14},{2005,14},{2073,14},{2141,14},{2209,14},{2277,14},{2345,14},{2414,14},{2482,14},{2550,14},{0,150},{2550,14},{2483,14},{2416,14},{2350,14},{2283,14},{2217,14},{2150,14},{2084,14},{2017,14},{1950,14},{2096,55},{2220,55},{2096,55},{2220,55},{2096,55},{0,100},{2352,230}};
// Original short motifs for the public edition; no third-party song transcriptions.
static const SoundNote music_pulse[] = {{1047,90},{0,50},{1568,130},{1175,80},{0,70},{1760,170},{1397,90},{0,90},{2093,130},{1568,210},{0,100}};
static const SoundNote music_march[] = {{988,210},{0,70},{1319,100},{0,50},{1175,310},{1568,160},{0,100},{880,140},{1397,240},{0,80},{1760,110},{1175,260},{0,100}};
static const SoundNote music_arcade[] = {{1760,75},{1319,115},{0,55},{2093,100},{1568,70},{1047,140},{0,65},{1397,95},{1976,160},{1175,110},{0,100}};
static const SoundNote music_cosmos[] = {{880,180},{1397,270},{0,90},{1175,150},{1976,240},{1568,130},{0,120},{1047,300},{1760,170},{1319,260},{0,100}};
// Alternating piercing tones and short triple bursts; only this effect loops.
static const SoundNote soundAlarmNotes[] = {{2730,180},{2100,180},{2730,180},{2100,180},{3000,75},{0,40},{3000,75},{0,40},{3000,75},{0,90}};
static bool soundAlarmLoop = false;
static const SoundNote* soundNotes = nullptr;
static const char* soundMusic = "";
static bool danceSeen = false, danceEnabled = false, danceOwnsSound = false;
static uint8_t danceTrack = 0;
static bool laughSeen=false, laughEnabled=false, laughOwnsSound=false;
static uint8_t soundCount = 0, soundIndex = 0;
static uint32_t soundDeadline = 0;
static bool soundMuted = false;
static bool soundAutomatic = true;
static uint8_t soundVolume = 100;
static const uint8_t soundDuties[] = {0,4,8,12,16,21,25,29,34,38,43,47,52,58,63,69,76,83,91,102,128};
static Preferences soundPrefs;
static uint16_t soundHz = 0;
static void soundApply() {
  if (soundHz && !soundMuted) {
    ledcSetup(SOUND_CHANNEL, soundHz, 8);
    // Fundamental amplitude sin(pi*duty): 43/256 is about half of 128/256.
    ledcWrite(SOUND_CHANNEL, soundDuties[soundVolume / 5]);
  } else ledcWrite(SOUND_CHANNEL, 0);
}
static void soundStop() {
  soundNotes = nullptr;
  soundAlarmLoop = false;
  soundMusic = "";
  soundHz = 0;
  ledcWrite(SOUND_CHANNEL, 0);
}
static void soundBegin() {
  soundPrefs.begin("k9-sound", false);
  soundMuted = soundPrefs.getBool("muted", false);
  soundAutomatic = soundPrefs.getBool("automatic", true);
  soundVolume = soundPrefs.getUChar("volume", soundPrefs.getBool("low", false) ? 50 : 100);
  if (soundVolume > 100 || soundVolume % 5) soundVolume = 100;
  ledcSetup(SOUND_CHANNEL, 1000, 8);
  ledcAttachPin(K9_SPEAKER_GPIO, SOUND_CHANNEL);
  soundStop();
}
static void soundTask() {
  if (!soundNotes || (int32_t)(millis() - soundDeadline) < 0) return;
  if (soundIndex >= soundCount) {
    if (soundAlarmLoop) soundIndex=0;
    else { soundStop(); return; }
  }
  const SoundNote note = soundNotes[soundIndex++];
  soundHz = note.hz;
  soundApply();
  soundDeadline = millis() + note.ms;
}
static void soundPlay(const SoundNote* notes, uint8_t count) {
  soundStop();
  soundNotes=notes; soundCount=count; soundIndex=0; soundDeadline=millis(); soundTask();
}
static bool soundCommand(const String& cmd) {
  if (cmd == "sound_mute" || cmd == "sound_unmute") {
    const bool value = cmd == "sound_mute";
    if (value != soundMuted) { soundMuted=value; soundPrefs.putBool("muted", value); }
    soundApply();
    return true;
  }
  if (cmd == "sound_auto_on" || cmd == "sound_auto_off") {
    const bool value = cmd == "sound_auto_on";
    if (value != soundAutomatic) { soundAutomatic=value; soundPrefs.putBool("automatic", value); }
    if (!soundAutomatic) soundStop();
    return true;
  }
  if (cmd.startsWith("sound_volume_")) {
    for (uint8_t value = 0; value <= 100; value += 5) {
      if (cmd != String("sound_volume_") + String(value)) continue;
      if (value != soundVolume) { soundVolume=value; soundPrefs.putUChar("volume", value); }
      soundApply();
      return true;
    }
    return false;
  }
  const SoundNote* notes = nullptr;
  uint8_t count = 0;
  if (cmd == "sound_stop") { emotionEnabled=false; emotionOwnsSound=false; danceEnabled=false; danceOwnsSound=false; laughEnabled=false; laughOwnsSound=false; soundStop(); return true; }
  if (cmd == "sound_beep") { notes=soundBeep; count=sizeof(soundBeep)/sizeof(SoundNote); }
  else if (cmd == "sound_whistle") { notes=soundWhistle; count=sizeof(soundWhistle)/sizeof(SoundNote); }
  else if (cmd == "sound_hello") { notes=soundHello; count=sizeof(soundHello)/sizeof(SoundNote); }
  else if (cmd == "sound_alert") { notes=soundAlert; count=sizeof(soundAlert)/sizeof(SoundNote); }
  else if (cmd == "sound_robot") { notes=soundRobot; count=sizeof(soundRobot)/sizeof(SoundNote); }
  else if (cmd == "sound_wake") { notes=sound_wake; count=sizeof(sound_wake)/sizeof(SoundNote); }
  else if (cmd == "sound_spell") { notes=sound_spell; count=sizeof(sound_spell)/sizeof(SoundNote); }
  else if (cmd == "sound_sad") { notes=sound_sad; count=sizeof(sound_sad)/sizeof(SoundNote); }
  else if (cmd == "sound_laugh") { notes=sound_laugh; count=sizeof(sound_laugh)/sizeof(SoundNote); }
  else if (cmd == "sound_crazy") { notes=sound_crazy; count=sizeof(sound_crazy)/sizeof(SoundNote); }
  else if (cmd == "sound_pulse") { notes=music_pulse; count=sizeof(music_pulse)/sizeof(SoundNote); }
  else if (cmd == "sound_march") { notes=music_march; count=sizeof(music_march)/sizeof(SoundNote); }
  else if (cmd == "sound_arcade") { notes=music_arcade; count=sizeof(music_arcade)/sizeof(SoundNote); }
  else if (cmd == "sound_cosmos") { notes=music_cosmos; count=sizeof(music_cosmos)/sizeof(SoundNote); }
  else if (cmd == "sound_alarm") { notes=soundAlarmNotes; count=sizeof(soundAlarmNotes)/sizeof(SoundNote); }
  else return false;
  const char* selected = nullptr;
  if (cmd == "sound_alarm") selected = "sound_alarm";
  if (cmd == "sound_pulse") selected = "sound_pulse";
  if (cmd == "sound_march") selected = "sound_march";
  if (cmd == "sound_arcade") selected = "sound_arcade";
  if (cmd == "sound_cosmos") selected = "sound_cosmos";
  emotionEnabled=false; emotionOwnsSound=false;
  danceEnabled = false; danceOwnsSound = false; laughEnabled=false; laughOwnsSound=false;
  if (selected && cmd == soundMusic) { soundStop(); return true; }
  soundPlay(notes, count);
  if (selected) soundMusic = selected;
  soundAlarmLoop = cmd == "sound_alarm";
  return true;
}
// Follow the actual animation state, including natural completion and cancellation.
static void soundDanceSync(bool active) {
  if (!active) {
    if (danceSeen && danceOwnsSound) soundStop();
    danceSeen=false; danceEnabled=false; danceOwnsSound=false;
    return;
  }
  if (!danceSeen) {
    laughEnabled=false; laughOwnsSound=false;
    danceSeen=true; danceEnabled=true; danceOwnsSound=true; danceTrack=0; soundStop();
  }
  if (!danceEnabled || soundNotes) return;
  switch (danceTrack++ % 4) {
    case 0: soundPlay(music_pulse, sizeof(music_pulse)/sizeof(SoundNote)); soundMusic="sound_pulse"; break;
    case 1: soundPlay(music_arcade, sizeof(music_arcade)/sizeof(SoundNote)); soundMusic="sound_arcade"; break;
    case 2: soundPlay(music_march, sizeof(music_march)/sizeof(SoundNote)); soundMusic="sound_march"; break;
    case 3: soundPlay(music_cosmos, sizeof(music_cosmos)/sizeof(SoundNote)); soundMusic="sound_cosmos"; break;
  }
}

static void soundLaughSync(float t) {
  if (t < 0) {
    if (laughSeen && laughOwnsSound) soundStop();
    laughSeen=false; laughEnabled=false; laughOwnsSound=false;
    return;
  }
  if (!laughSeen) { danceEnabled=false; danceOwnsSound=false; soundStop(); laughSeen=true; laughEnabled=true; laughOwnsSound=true; }
  if (!laughEnabled) return;
  const uint16_t hz=k9_laugh_hz(t);
  if (hz != soundHz) { soundHz=hz; soundApply(); }
}
static void soundEmotionSync(int id, float t, unsigned short scratchHz=0) {
  if((id!=13 && (id<19 || id>24)) || t<0) {
    if(emotionOwnsSound) soundStop();
    emotionSeen=0; emotionEnabled=false; emotionOwnsSound=false; return;
  }
  if(emotionSeen!=id) {
    emotionSeen=id; emotionEnabled=true; emotionOwnsSound=true;
    danceEnabled=false; danceOwnsSound=false; laughEnabled=false; laughOwnsSound=false; soundStop();
  }
  if(!emotionEnabled) return;
  unsigned short hz=id==13 ? scratchHz : k9_personality_hz(id,t);
  if(hz!=soundHz) { soundHz=hz; soundApply(); }
}
#endif
