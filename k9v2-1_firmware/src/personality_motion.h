#ifndef K9_PERSONALITY_MOTION_H
#define K9_PERSONALITY_MOTION_H
// Pure choreography: time shared by movement, audio and telemetry. FL FR RL RR.
// Small motions, no travel beyond the established lying pose.
static inline float gc_personality_duration(int id) {
  switch(id) {
    case GC_ANIM_WAKE: return 8;
    case GC_ANIM_CURIOUS: return 6;
    case GC_ANIM_ANGRY: return 5;
    case GC_ANIM_SHY: return 6;
    case GC_ANIM_CELEBRATE: return 6;
    case GC_ANIM_GREET: return 6;
    case GC_ANIM_GLITCH: return 6;
    default: return 0;
  }
}
static inline void gc_personality_target(int id, float t, float p[4]) {
  for(int i=0;i<4;i++) p[i]=0;
  switch(id) {
    case GC_ANIM_WAKE:
      if(t<2) p[0]=p[1]=35;
      else if(t<4) p[2]=p[3]=-30;
      else if(t<6) { p[0]=p[2]=6*sinf((t-4)*6.2831853f); p[1]=p[3]=-p[0]; }
      break;
    case GC_ANIM_SLEEP: {
      float breath=t>3 ? 1.5f*(1-cosf((t-3)*1.256637f)) : 0;
      p[0]=p[1]=50+breath; p[2]=p[3]=-50-breath; break;
    }
    case GC_ANIM_CURIOUS:
      if(t<2) { p[0]=p[2]=10; p[1]=p[3]=-6; }
      else if(t<4) { p[0]=p[2]=-6; p[1]=p[3]=10; }
      break;
    case GC_ANIM_ANGRY:
      if(t<4) { p[0]=p[1]=22; if((t>2 && t<2.4f)||(t>3 && t<3.4f)) p[0]=p[1]=30; }
      break;
    case GC_ANIM_SHY:
      if(t<4.5f) { p[0]=p[1]=25; p[2]=8; p[3]=-5; }
      break;
    case GC_ANIM_CELEBRATE:
      if(t>1 && t<4.5f) { float wave=8*sinf((t-1)*6.2831853f); p[0]=p[2]=wave; p[1]=p[3]=-wave; }
      break;
    case GC_ANIM_GREET:
      if(t<1.5f) { p[0]=p[2]=p[3]=10; }
      else if(t<4) { p[0]=p[2]=p[3]=10; p[1]=40+6*sinf((t-1.5f)*6.2831853f); }
      break;
    case GC_ANIM_GLITCH:
      if(t>1 && t<3) { int beat=(int)((t-1)*4); p[0]=p[3]=(beat%2 ? 5:-5); p[1]=p[2]=-p[0]; }
      else if(t<4 && t>=3) { p[0]=p[3]=5; p[1]=p[2]=-5; }
      break;
  }
}
#endif
