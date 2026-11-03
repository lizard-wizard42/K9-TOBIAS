#include <assert.h>
#include <math.h>
#include "../src/gait_core.h"
int main(void) {
 gc_poses q; gc_poses_defaults(&q);
 gc_anim_state a; gc_anim_start(&a,GC_ANIM_SCRATCH);
 float leg[4]={0},max=0,maxSpeed=0; int strokes=0,wasSound=0,sawGetup=0;
 for(int frame=0;frame<2500;frame++) {
  float prev[4];for(int i=0;i<4;i++)prev[i]=leg[i];
  gc_anim_run(&q,&a,.01f,leg);
  if(a.anim==GC_ANIM_GETUP)sawGetup=1;
  if(a.anim==GC_ANIM_SCRATCH) {
   float sum=0;for(int i=0;i<4;i++)sum+=fabsf(leg[i]-prev[i])/.01f;
   if(sum>maxSpeed)maxSpeed=sum;
   if(leg[2]>max)max=leg[2];
   assert(fabsf(leg[0])<.01 && fabsf(leg[1])<.01);
   assert(leg[2]<=80.001f && leg[3]<=60.001f);
   unsigned short hz=gc_scratch_hz(a.t);
   if(hz) {
    assert(hz>=1400 && hz<=2300);
    assert(leg[2]<=prev[2]+.001f); // sound only on the downward rubbing stroke
    if(!wasSound)strokes++;
   }
   wasSound=hz>0;
  }
 }
 assert(strokes==24 && max>79.9f && maxSpeed<=150.5f);
 assert(sawGetup && a.anim==GC_ANIM_NONE);
 for(int i=0;i<4;i++)assert(fabsf(leg[i])<.5f);
}
