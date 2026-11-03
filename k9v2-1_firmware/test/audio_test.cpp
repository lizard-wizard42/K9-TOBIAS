#include <cassert>
#define K9_SPEAKER_GPIO 25
#include "speaker.h"
#include "action_sounds.h"
int main() {
  soundBegin();
  soundCommand("sound_unmute"); soundCommand("sound_volume_100");
  soundEmotionSync(13,3.0f,1800); assert(lastDuty>0 && soundHz==1800);
  soundCommand("sound_mute"); soundEmotionSync(13,3.1f,1600); assert(lastDuty==0);
  soundCommand("sound_unmute"); assert(lastDuty>0);
  soundCommand("sound_stop"); soundEmotionSync(13,3.2f,2000); assert(lastDuty==0);
  soundEmotionSync(0,0);
  soundEmotionSync(22,1.1f); assert(lastDuty>0);
  soundCommand("sound_beep"); soundEmotionSync(0,0); assert(soundNotes);
  soundCommand("sound_stop");

  for(auto pose:{"stand","sit","lie","getup","beg","cal","wake","sleep"}) {
    soundCommand("sound_alarm"); soundForAction(pose);
    assert(!soundNotes && !soundAlarmLoop && lastDuty==0);
  }
  for(auto cmd:{"sound_pulse","sound_march","sound_arcade","sound_cosmos","sound_whistle"}) {
    soundCommand(cmd); assert(soundNotes && !soundAlarmLoop);
    for(int i=0; i<100 && soundNotes; ++i) { clockMs=soundDeadline; soundTask(); }
    assert(!soundNotes && lastDuty==0 && String(soundMusic)=="");
  }
  soundCommand("sound_alarm");
  for(int i=0;i<100;++i) { clockMs=soundDeadline; soundTask(); }
  assert(soundNotes && soundAlarmLoop);
  soundCommand("sound_mute"); soundTask(); assert(lastDuty==0);
  soundCommand("sound_unmute"); soundCommand("sound_alarm"); assert(!soundNotes);
  soundCommand("sound_alarm"); soundCommand("sound_pulse"); assert(!soundAlarmLoop);
  soundCommand("sound_stop"); assert(!soundNotes && lastDuty==0);
  soundCommand("sound_volume_20"); soundCommand("sound_beep"); assert(lastDuty==16);
  soundCommand("sound_volume_0"); assert(lastDuty==0);
  soundBegin(); assert(soundVolume==0);
  soundCommand("sound_volume_100");
  soundDanceSync(true);
  for(int i=0;i<200;++i) { clockMs=soundDeadline; soundTask(); soundDanceSync(true); }
  assert(danceTrack>2 && soundNotes);
  soundDanceSync(false); assert(!soundNotes);
  soundLaughSync(1.0f); assert(soundHz==k9_laugh_hz(1.0f));
  soundCommand("sound_mute");soundLaughSync(1.1f);assert(lastDuty==0);
  soundCommand("sound_stop");soundLaughSync(1.2f);assert(lastDuty==0);
  soundLaughSync(-1);assert(!soundNotes);
}
