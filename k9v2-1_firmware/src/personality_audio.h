#pragma once
#include <math.h>
static inline unsigned short k9_personality_hz(int id, float t) {
  if(t<0) return 0;
  if(id==19 && t>=1.3f && t<2.1f) return (unsigned short)(1700+(t-1.3f)*1000); // curious whistle
  if(id==20 && ((t>=2 && t<2.4f)||(t>=3 && t<3.4f))) return 650+((int)(t*30)%2)*110;
  if(id==21 && t>=2 && t<2.7f) return (unsigned short)(1800-(t-2)*900);
  if(id==22 && t>=1 && t<4.5f) {
    const unsigned short melody[]={1046,1318,1568,2093,1568,2093,2637};
    float beat=(t-1)*2;
    return beat-floorf(beat)<.75f ? melody[((int)beat)%7] : 0;
  }
  if(id==23 && t>=2 && t<3.2f) {
    const unsigned short hello[]={1568,2093,2350,2093};
    float beat=(t-2)/.3f;
    return beat-floorf(beat)<.7f ? hello[((int)beat)%4] : 0;
  }
  if(id==24 && t>=1 && t<3) return ((int)(t*8)%2) ? 0 : (unsigned short)(900+((int)(t*4)%4)*400);
  if(id==24 && t>=4 && t<4.6f) return (unsigned short)(1200+(t-4)*1800);
  return 0;
}
