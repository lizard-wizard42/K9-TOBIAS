#pragma once
#include <math.h>
#include <stdint.h>
typedef struct { uint16_t hz, ms; } SoundNote;
// Exact same score for manual laughter and the emotion, at its original tempo.
static const SoundNote sound_laugh[] = {{2700,13},{2603,13},{2507,13},{2410,13},{2314,13},{2218,13},{2122,13},{2025,13},{0,90},{2625,13},{2530,13},{2437,13},{2342,13},{2248,13},{2153,13},{2060,13},{1965,13},{0,78},{2550,13},{2458,13},{2366,13},{2273,13},{2182,13},{2090,13},{1997,13},{1905,13},{0,66},{2475,13},{2385,13},{2295,13},{2205,13},{2115,13},{2025,13},{1935,13},{1845,13},{0,54},{2400,13},{2312,13},{2224,13},{2137,13},{2048,13},{1960,13},{1873,13},{1785,13},{0,42},{2352,65},{2640,65},{2352,65}};
#define K9_LAUGH_START 0.8f
#define K9_LAUGH_END 1.845f
static inline unsigned short k9_laugh_hz(float t) {
  if(t < K9_LAUGH_START || t >= K9_LAUGH_END) return 0;
  float ms=(t-K9_LAUGH_START)*1000.0f;
  for(unsigned i=0;i<sizeof(sound_laugh)/sizeof(sound_laugh[0]);i++) {
    if(ms < sound_laugh[i].ms) return sound_laugh[i].hz;
    ms-=sound_laugh[i].ms;
  }
  return 0;
}
static inline int k9_laugh_syllable(float t) {
  float ms=(t-K9_LAUGH_START)*1000.0f;
  const int pauses[5]={90,78,66,54,42};
  for(int i=0;i<5;i++) { if(ms < 104+pauses[i]) return i; ms-=104+pauses[i]; }
  return 5;
}
static inline float k9_laugh_pulse(float t) {
  if(t < K9_LAUGH_START || t >= K9_LAUGH_END) return 0;
  float ms=(t-K9_LAUGH_START)*1000.0f;
  const int pauses[5]={90,78,66,54,42};
  for(int i=0;i<5;i++) {
    if(ms < 104+pauses[i]) return ms < 104 ? sinf(3.14159265f*ms/104.0f) : 0;
    ms-=104+pauses[i];
  }
  return sinf(3.14159265f*ms/195.0f);
}
