#include <assert.h>
#include "../src/gait_core.h"
#include "../src/personality_audio.h"
int main(void) {
 assert(GC_ANIM_WAKE==17 && GC_ANIM_GLITCH==24 && GC_ANIM_PAUSE==25);
 gc_poses q; gc_poses_defaults(&q);
 for(int id=17;id<=24;id++) {
  gc_anim_state a; gc_anim_start(&a,id);
  float legs[4]={0};
  int audible=0;
  for(int n=0;n<2000;n++) {
   float prev[4]; for(int i=0;i<4;i++) prev[i]=legs[i];
   float hz=k9_personality_hz(id,a.t); if(hz) { audible++; assert(hz>=500 && hz<=3000); }
   gc_anim_run(&q,&a,.01f,legs);
   for(int i=0;i<4;i++) { assert(isfinite(legs[i])); assert(fabsf(legs[i])<=55); assert(fabsf(legs[i]-prev[i])<=1.001f); }
  }
  if(id==GC_ANIM_SLEEP) assert(a.anim==GC_ANIM_SLEEP);
  else { assert(a.anim==GC_ANIM_NONE); for(int i=0;i<4;i++) assert(fabsf(legs[i])<.5f); }
  assert((id>=19)==(audible>0));
  gc_anim_start(&a,GC_ANIM_PAUSE);
  float saved=legs[0]; for(int n=0;n<100;n++) gc_anim_run(&q,&a,.01f,legs);
  assert(legs[0]==saved);
  gc_anim_start(&a,GC_ANIM_STAND);
  for(int n=0;n<200;n++) gc_anim_run(&q,&a,.01f,legs);
  assert(a.anim==GC_ANIM_NONE);
 }
}
