#include <assert.h>
#include "../src/gait_core.h"
int main(void) {
  float elapsed=K9_LAUGH_START;
  for(unsigned i=0;i<sizeof(sound_laugh)/sizeof(sound_laugh[0]);i++) {
    assert(k9_laugh_hz(elapsed+sound_laugh[i].ms/2000.0f)==sound_laugh[i].hz);
    elapsed+=sound_laugh[i].ms/1000.0f;
  }
  assert(fabsf(elapsed-K9_LAUGH_END)<.0001f);
  gc_poses q; gc_poses_defaults(&q);
  gc_anim_state a; gc_anim_start(&a, GC_ANIM_LAUGH);
  float legs[4]={0}, before[4]={0}; int pulses=0, wasVoiced=0;
  for (int frame=0;frame<500 && a.anim==GC_ANIM_LAUGH;frame++) {
    for(int i=0;i<4;i++) before[i]=legs[i];
    gc_anim_run(&q,&a,.01f,legs);
    int voiced=a.anim==GC_ANIM_LAUGH && k9_laugh_hz(a.t)>0;
    if(voiced && !wasVoiced) pulses++;
    wasVoiced=voiced;
    for(int i=0;i<4;i++) { assert(legs[i]>=0 && legs[i]<=23); assert(fabsf(legs[i]-before[i])<=1.201f); }
    if(voiced) { assert(k9_laugh_hz(a.t)>=1785 && k9_laugh_hz(a.t)<=2850); assert(k9_laugh_pulse(a.t)>=0); }
  }
  assert(pulses==6 && a.anim==GC_ANIM_STAND);
  for(int i=0;i<100;i++) gc_anim_run(&q,&a,.01f,legs);
  assert(a.anim==GC_ANIM_NONE);
  for(int i=0;i<4;i++) assert(fabsf(legs[i]-q.stand[i])<.5f);
  return 0;
}
