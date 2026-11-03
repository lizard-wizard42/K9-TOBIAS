// Adapted from miniRobo K9V2.1: https://www.minirobo.io/projects/k9v2-1
// Upstream personal/non-commercial terms apply to derived portions.
// These portions are not relicensed under the repository's MIT grant.
// See ../../THIRD_PARTY.md (repository root) for provenance.
#ifndef GAIT_CORE_H
#define GAIT_CORE_H
// ============================================================================
// gait_core.h — walker's gait/animation MATH, as pure functions.
//
// WHY THIS FILE EXISTS: the MuJoCo twin in ../../sim must run the *same* code
// the robot runs, not a transcription of it. Everything here is plain C99 with
// no Arduino, no globals and no I/O, so it compiles unchanged into
//   - the ESP32 firmware (main.cpp includes it), and
//   - a host shared library the Python sim harness loads via ctypes
//     (sim/gait_shim.c).
// The robot is open-loop and deterministic, so identical inputs must produce
// identical servo microseconds on both sides of the sim-to-real gap. That is
// checked by sim/tests/golden_trace.c, which holds a verbatim copy of the
// pre-refactor functions and diffs them against these, tick for tick.
//
// Only two behaviours are NEW versus the pre-refactor firmware, both inert at
// their defaults so the golden trace still matches exactly:
//   ampRatio  — front/rear stride amplitude ratio (mean-preserving; 1.0 = off)
//   dutySplit — left/right power-stroke duty difference (0.0 = off)
// ============================================================================
#include <math.h>
#include "laugh_timeline.h"

#ifndef GC_PI
#define GC_PI 3.14159265358979323846f
#endif
#define GC_DEG2RAD 0.0174533f          // matches main.cpp's DEG2RAD exactly
#define GC_NSERVO  4

enum { GC_FL = 0, GC_FR, GC_RL, GC_RR };

// +1 LEFT / -1 RIGHT — the side a leg's drive amplitude comes from.
static const int GC_SIDE[GC_NSERVO]  = { +1, -1, +1, -1 };
// 1 = front leg (FL/FR), 0 = rear (RL/RR) — which stride amplitude it gets.
static const int GC_FRONT[GC_NSERVO] = {  1,  1,  0,  0 };

static inline float gc_clampf(float v, float lo, float hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

// ---------------------------------------------------------------------------
// Parameters — every field is live-tunable from the telnet console.
// ---------------------------------------------------------------------------
typedef struct {
  float gaitFreq;              // Hz, cycles per second
  float strideDeg;             // MEAN leg swing amplitude (deg, half peak-to-peak)
  float postureDeg;            // forward posture bias, scaled by drive activity
  float turnGain;              // left/right amplitude differencing for turns
  float kpPitch;               // IMU pitch feedback (dead: no IMU fitted)
  float strokeDuty;            // fraction of the cycle on the slow power stroke
  float ampRatio;              // front/rear amplitude ratio, MEAN-PRESERVING:
                               //   ampFront = stride*2r/(1+r), ampRear = stride*2/(1+r)
                               //   so r changes the balance without changing the
                               //   mean — keeps the search space non-degenerate
                               //   against strideDeg. r = 1 => both = strideDeg.
  float dutySplit;             // duty_left  = strokeDuty + dutySplit/2
                               // duty_right = strokeDuty - dutySplit/2
                               //   ratchets one side forward and one back: a turn
                               //   authority that costs no extra amplitude.
  float legPhaseDeg[GC_NSERVO];// per-leg phase offset; {0,180,180,0} = diagonal trot
  float ampSlew;               // deg/s... actually drive-units/s ramp on wL/wR
  float postureMax;            // clamp on the posture term
  // TURN GAIT (2026-09-16). The bench found that gait D turns better than the drive
  // gait A, and the twin agrees at every throttle (9-21 vs 5-16 deg/s of yaw). It is the
  // SHAPE that matters, not the amplitude: halving amplitude nearly stops the turn
  // (1-2 deg/s), and a symmetric duty stops it dead (0-1) — yaw is the two sides
  // RATCHETING opposite ways, so it needs the stick-slip asymmetry as much as walking
  // does. So the gait blends toward a second set of gains as the command goes from
  // straight to spin. Because the blend is zero when driving straight, the turn gains
  // are INDEPENDENT of the drive gains and can be searched on their own.
  float turnFreq, turnStride, turnDuty, turnPosture, turnRatio;
  // How fast the blend reaches the turn gait: mix = (turn share)^turnSharp. 1 = linear;
  // 0.5 = a quarter-turn stick already gets half the turn gait. Bench round 2: the gait
  // whose duty was CLOSEST to the turn gait's turned best, so partial turns want the turn
  // gait's duty sooner. Straight driving is untouched either way (0^x = 0).
  float turnSharp;
  // STEERING WHILE DRIVING (2026-09-17: "full speed ahead and mixing in the right stick
  // turning slightly ... doesn't really work at all"). Three fixes, each switchable so the
  // bench can A/B them; all 0 = the old behaviour.
  float steerNorm;             // 1 = scale BOTH sides down when fwd+turn passes full, so the
                               //   left/right DIFFERENCE survives. The old clamp let the
                               //   outside side stay at 1.0 and threw away half of a turn.
  float spinOnly;              // 1 = blend toward the turn (spin) gait only as far as the two
                               //   sides COUNTER-rotate. The old blend also fired on arcs, so a
                               //   slight turn at full speed dragged both sides toward a slow
                               //   spinning gait instead of steering.
  float steerFloor;            // on an ARC (both sides the same way) the inside side never drops
                               //   below this fraction of the outside. Twin 2026-09-17: at full
                               //   throttle the turn grows as the inside legs slow to ~55 %, then
                               //   REVERSES below ~45 % (they stop pushing and pivot instead).
  float steerExpo;             // turn input -> |turn|^steerExpo. <1 makes SLIGHT stick count for
                               //   more; full stick is unchanged (1^x = 1). 1 = linear.
  float steerArc;              // turn authority LEFT at full throttle: turn x (1 - |fwd| x (1 -
                               //   steerArc)). With the floor, full authority is reached by a
                               //   third of the stick, leaving nothing for SLIGHT corrections; a
                               //   lower steerArc spreads the same arc range over the whole stick.
                               //   Spins (fwd 0) keep the full turn. 1 = off.
  float spinTake;              // SPIN TAKEOVER (2026-09-17: "a gradual turn until I max out the
                               //   right stick, which should indicate a full turn as if I wasn't
                               //   touching the left stick at all ... maybe an exponential curve").
                               //   The forward command is scaled by 1 - |turn|^spinTake, so a slight
                               //   turn keeps the drive, a full stick is a pure spin, and the arc
                               //   tightens along the curve in between. The inside floor fades out
                               //   on the same curve, or it would JUMP where the inside legs pass
                               //   through zero. 0 = off.
  float spinStart;             // the takeover only begins past this |turn|. The twin (2026-09-17):
                               //   wherever the inside legs pass through zero on the DRIVE gait's
                               //   shape, the turn direction depends on the floor and can reverse
                               //   hard — so that zone is squeezed into the end of the stick, and
                               //   everything before it is a forward arc. 0 = the takeover spans
                               //   the whole stick.
  float steerDuty;             // inside side's stroke duty goes UP by this x the turn share
                               //   (forward only). Duty is the strongest speed lever the bench
                               //   has found (0.60 walks clearly faster than 0.66), so a higher
                               //   duty SLOWS the inside legs without touching the outside.
  float retCap;                // deg/s ceiling for each leg's fast RETURN stroke (the servo's own limit
                               //   is ~503 deg/s unloaded). Steering and spin shift the duty per side, which can
                               //   push one side past it; that side's amplitude is scaled down to fit.
                               //   0 = off (the twin and the golden trace keep the old behaviour).
  float rearDutyAdd;           // REAR RETURN (2026-10-30, MK4 rear feet +8 mm): extra power-stroke duty for the
                               //   two REAR legs only. The rear foot is 22 % further from the knee, so it should
                               //   return its step FASTER than the front: rear duty = duty + rearDutyAdd shortens
                               //   the rear's fast return window. Applied to the drive gait only (fades out with
                               //   the spin blend), retCap still bounds the rate. 0 = off (old behaviour).
} gc_params;

// Live gait state. Zero-initialise for a cold start.
typedef struct {
  float wL, wR;                // slewed left/right drive amplitude, -1..+1
  float gaitPhase;             // radians, wrapped to [0, 2pi)
} gc_state;

// The servo command path, so the sim sees the same quantised staircase the real
// MG90S sees (integer microseconds, then a clamp).
typedef struct {
  int   center_us[GC_NSERVO];  // per-leg trim: legs hang vertical here
  int   dir[GC_NSERVO];        // +1/-1 so positive deg = forward for every leg
  float us_per_deg;
  int   min_us, max_us;
} gc_servo_cal;

static inline void gc_params_defaults(gc_params* p) {
  p->gaitFreq   = 1.4f;
  p->strideDeg  = 26.0f;
  p->postureDeg = 0.0f;
  p->turnGain   = 1.0f;
  p->kpPitch    = 0.0f;
  p->strokeDuty = 0.85f;
  p->turnFreq = p->gaitFreq; p->turnStride = p->strideDeg;   // = no blend, until a
  p->turnDuty = p->strokeDuty; p->turnPosture = p->postureDeg;  //   build sets them
  p->turnRatio = p->ampRatio;
  p->turnSharp = 1.0f;
  p->steerNorm = 0.0f; p->spinOnly = 0.0f; p->steerDuty = 0.0f;   // = the old mixer
  p->steerFloor = 0.0f; p->steerExpo = 1.0f; p->steerArc = 1.0f; p->spinTake = 0.0f; p->spinStart = 0.0f;
  p->retCap = 0.0f;
  p->rearDutyAdd = 0.0f;
  p->ampRatio   = 1.0f;
  p->dutySplit  = 0.0f;
  p->legPhaseDeg[GC_FL] = 0.0f;   p->legPhaseDeg[GC_FR] = 180.0f;
  p->legPhaseDeg[GC_RL] = 180.0f; p->legPhaseDeg[GC_RR] = 0.0f;
  p->ampSlew    = 3.0f;
  p->postureMax = 35.0f;
}

// ---------------------------------------------------------------------------
// The waveform. Asymmetric: a slow ramp (backward power stroke) for `duty` of
// the cycle, then a fast ramp back (forward return). Returns -1..+1.
// At duty = 0.5 it is a symmetric triangle; higher = slower push / faster flick
// = the stick-slip ratchet that is the ONLY source of forward motion on a robot
// whose legs cannot lift.
// ---------------------------------------------------------------------------
static inline float gc_wave(float phase, float duty) {
  float u = phase * (0.5f / GC_PI);         // radians -> cycles
  u -= floorf(u);                           // wrap to [0,1)
  float D = gc_clampf(duty, 0.05f, 0.95f);
  return (u < D) ?  1.0f - 2.0f * (u / D)                 // slow power stroke: +1 -> -1
                 : -1.0f + 2.0f * ((u - D) / (1.0f - D)); // fast return:      -1 -> +1
}

// One gait tick. Advances `s` and fills `legDeg` with commanded leg angles.
static inline void gc_update(const gc_params* p, gc_state* s,
                             float driveFwd, float driveTurn,
                             float pitchDeg, int fallen, float dt,
                             float legDeg[GC_NSERVO]) {
  float fwd  = driveFwd;
  float turn = driveTurn;
  if (p->steerExpo > 0.0f && p->steerExpo != 1.0f)
    turn = (turn < 0 ? -1.0f : 1.0f) * powf(fabsf(turn), p->steerExpo);
  float take = 0.0f;                         // how far the turn has taken the drive away
  if (p->spinTake > 0.0f) {
    float u = (gc_clampf(fabsf(turn), 0.0f, 1.0f) - p->spinStart) / (1.0f - p->spinStart + 1e-6f);
    take = powf(gc_clampf(u, 0.0f, 1.0f), p->spinTake);
    fwd *= 1.0f - take;
  }
  if (p->steerArc > 0.0f && p->steerArc < 1.0f)
    turn *= 1.0f - gc_clampf(fabsf(fwd), 0.0f, 1.0f) * (1.0f - p->steerArc);
  float tL  = fwd + p->turnGain * turn;
  float tR  = fwd - p->turnGain * turn;
  if (p->steerNorm > 0.5f) {                 // keep the difference: scale, don't clip
    float mx = fabsf(tL) > fabsf(tR) ? fabsf(tL) : fabsf(tR);
    if (mx > 1.0f) { tL /= mx; tR /= mx; }
  }
  tL = gc_clampf(tL, -1.0f, 1.0f);
  tR = gc_clampf(tR, -1.0f, 1.0f);
  if (p->steerFloor > 0.0f && tL * tR >= 0.0f && fabsf(tL + tR) > 1e-3f) {   // an arc, not a spin
    float big = fabsf(tL) > fabsf(tR) ? fabsf(tL) : fabsf(tR);
    float lo  = p->steerFloor * (1.0f - take) * big, dir = (tL + tR) > 0 ? 1.0f : -1.0f;
    if (fabsf(tL) < lo) tL = dir * lo;
    if (fabsf(tR) < lo) tR = dir * lo;
  }
  float lim = p->ampSlew * dt;
  s->wL += gc_clampf(tL - s->wL, -lim, lim);
  s->wR += gc_clampf(tR - s->wR, -lim, lim);

  float aL = fabsf(s->wL), aR = fabsf(s->wR);
  float act = (aL > aR) ? aL : aR;
  // how much of the command is TURN: 0 = straight, 1 = spin in place. From the SLEWED
  // wL/wR, so the blend moves as smoothly as the drive does.
  float mix  = fabsf(s->wL - s->wR) / (fabsf(s->wL) + fabsf(s->wR) + 1e-6f);
  if (p->spinOnly > 0.5f) {                  // arcs (both sides the same way) stay on the
    float same = fabsf(s->wL + s->wR) / (fabsf(s->wL) + fabsf(s->wR) + 1e-6f);   // drive gait
    mix *= (1.0f - same);
  }
  mix = powf(gc_clampf(mix, 0.0f, 1.0f), gc_clampf(p->turnSharp, 0.2f, 3.0f));
  float freq = p->gaitFreq + (p->turnFreq - p->gaitFreq) * mix;
  if (act > 0.01f && !fallen) {
    s->gaitPhase += 2.0f * GC_PI * freq * dt;
    if (s->gaitPhase >= 2.0f * GC_PI) s->gaitPhase -= 2.0f * GC_PI;
  }
  float posture = fallen ? 0.0f
      : gc_clampf((p->postureDeg + (p->turnPosture - p->postureDeg) * mix) * act
                  - p->kpPitch * pitchDeg,
                  -p->postureMax, p->postureMax);

  // how much of the command is TURN: 0 = straight, 1 = spin in place. Taken from the
  // SLEWED wL/wR, so the blend moves as smoothly as the drive does.
  float stride = p->strideDeg  + (p->turnStride  - p->strideDeg)  * mix;
  float duty   = p->strokeDuty + (p->turnDuty    - p->strokeDuty) * mix;
  float ratio  = p->ampRatio   + (p->turnRatio   - p->ampRatio)   * mix;

  float r        = gc_clampf(ratio, 0.05f, 20.0f);
  float ampFront = stride * (2.0f * r / (1.0f + r));
  float ampRear  = stride * (2.0f     / (1.0f + r));
  float dutyL    = duty + 0.5f * p->dutySplit;
  float dutyR    = duty - 0.5f * p->dutySplit;
  if (p->steerDuty > 0.0f && s->wL + s->wR > 0.0f) {      // forward arcs only
    float share = (s->wL - s->wR) / (fabsf(s->wL) + fabsf(s->wR) + 1e-6f);   // + = right turn
    if (share > 0) dutyR += p->steerDuty * share;         // right turn: right legs are inside
    else           dutyL -= p->steerDuty * share;         // left turn: left legs are inside
  }

  for (int i = 0; i < GC_NSERVO; i++) {
    float w    = (GC_SIDE[i]  > 0) ? s->wL   : s->wR;
    float duty = (GC_SIDE[i]  > 0) ? dutyL   : dutyR;
    if (!GC_FRONT[i] && p->rearDutyAdd != 0.0f) duty += p->rearDutyAdd * (1.0f - mix);   // rear returns faster
    float amp  = (GC_FRONT[i]    ) ? ampFront : ampRear;
    float sw   = gc_wave(s->gaitPhase + p->legPhaseDeg[i] * GC_DEG2RAD, duty);
    if (p->retCap > 0.0f) {                  // return stroke = 2*amp*|w|*f / (1-duty), see retCap
      float back = 1.0f - duty; if (back < 0.05f) back = 0.05f;
      float rate = 2.0f * amp * fabsf(w) * freq / back;
      if (rate > p->retCap) w *= p->retCap / rate;
    }
    legDeg[i]  = fallen ? 0.0f : (amp * w * sw) + posture;
  }
}

// Commanded leg angle -> the integer microseconds the servo actually receives.
static inline int gc_leg_us(const gc_servo_cal* c, int i, float deg) {
  int us = c->center_us[i] + (int)lroundf(c->dir[i] * deg * c->us_per_deg);
  return us < c->min_us ? c->min_us : (us > c->max_us ? c->max_us : us);
}

// ---------------------------------------------------------------------------
// Canned animations. Pure math too, so the twin can replay the get-up move —
// the one manoeuvre already known to be CoM-sensitive (docs: the sit->stand
// backward fall was fixed by battery position, not by code).
// ---------------------------------------------------------------------------
enum { GC_ANIM_NONE = 0, GC_ANIM_STAND, GC_ANIM_SIT, GC_ANIM_LIE,
       GC_ANIM_WAVE_FR, GC_ANIM_WAVE_FL, GC_ANIM_GETUP, GC_ANIM_DANCE,
       GC_ANIM_BOW, GC_ANIM_STRETCH, GC_ANIM_WAG, GC_ANIM_DIG, GC_ANIM_WIGGLE,
       GC_ANIM_SCRATCH,     // 13: sit and scratch the belly with the left rear leg (hub command "scratch")
       GC_ANIM_BEG,         // 14: "pedir": reclined sit (~60 deg trunk) on the haunches with BOTH FRONT legs raised, held (hub command "beg")
       GC_ANIM_BEGOUT, GC_ANIM_LAUGH, GC_ANIM_WAKE, GC_ANIM_SLEEP,
       GC_ANIM_CURIOUS, GC_ANIM_ANGRY, GC_ANIM_SHY, GC_ANIM_CELEBRATE,
       GC_ANIM_GREET, GC_ANIM_GLITCH, GC_ANIM_PAUSE };    // 15: staged way out of BEG, ending in stand

typedef struct {
  float stand[GC_NSERVO];
  float sit  [GC_NSERVO];
  float lie  [GC_NSERVO];
  float beg  [GC_NSERVO];
  float begBurstTo, begBurstDegS;    // the entry throw: rear legs sweep from the pre-sit angle to begBurstTo at begBurstDegS
  float waveCenter, waveAmp, waveHz, waveLean;
} gc_poses;

typedef struct { int anim; float t; int exitStage; float exitSettled; } gc_anim_state;

// ---------------------------------------------------------------------------
// THE DANCE (2026-09-19) — choreographed to dance/walker2_techno_10s.wav.
//
// The track is generated by dance/make_track.py and the two files share ONE
// grid: 120 BPM, 5 bars of 4/4, 10.000 s exactly. Change the tempo or the
// arrangement in that script and these constants and the bar programs below
// must move with it — nothing measures the music, the robot just counts.
//
//   bar 0  0-2 s   kick + hats                  nose bob, one per beat
//   bar 1  2-4 s   + bass + clap                side-to-side shimmy
//   bar 2  4-6 s   + acid stabs                 in-place diagonal trot
//   bar 3  6-8 s   BREAK (kick drops) + roll    slow push-ups, then a chug
//   bar 4  8-10 s  drop, final hit on beat 4    fast shimmy -> bow, held
//
// A 1-DOF leg can only swing fore/aft, so every move is one of four mixes of
// the four legs, and the bar programs are written in those terms:
//   common  all four together      the body slides/squats fore-aft
//   pitch   front +, rear -        nose down / nose up: the head bang
//   roll    left  +, right -       a yaw twist: the shimmy
//   diag    FL,RR + / FR,RL -      the trot pairs: stepping on the spot
//
// EVERY MOVE IS UNDER THE SERVO RETURN-RATE CEILING (503 deg/s no-load, see
// main.cpp). Peak rate of A*sin(2*pi*f*t) is 2*pi*A*f, worst case per bar:
//   0  26 deg @ 2 Hz = 327      1  22 @ 2 Hz + 6 @ 4 Hz = 427
//   2  26 deg @ 2 Hz +  5 @ 2 Hz = 390                    3  7 @ 8 Hz = 352
//   4  14 deg @ 4 Hz +  5 @ 2 Hz = 415      bow ramp 45 deg / 0.15 s = 300
// Ask for more than the servo can return and the move stops being the move.
// ---------------------------------------------------------------------------
#define GC_DANCE_BPM   120.0f
#define GC_DANCE_BEAT  (60.0f / GC_DANCE_BPM)        // 0.5 s
#define GC_DANCE_BAR   (4.0f * GC_DANCE_BEAT)        // 2.0 s
#define GC_DANCE_BARS  5
#define GC_DANCE_LEN   (GC_DANCE_BARS * GC_DANCE_BAR)  // 10.0 s = the track
#define GC_DANCE_SLEW  460.0f    // deg/s cap, above the choreography's own worst 427 (probe_dance.c)
                                 // only bites on the jump INTO the dance from wherever
                                 // the legs were, which is exactly what it is for.

// The pose the dance wants at time t (seconds from the downbeat). Pure function
// of t — no state — so the twin and any plot can evaluate it anywhere.
static inline void gc_dance_pose(float t, float tgt[GC_NSERVO]) {
  const float B = GC_DANCE_BEAT;
  const float w = 2.0f * GC_PI / B;          // rad/s at ONE cycle per beat (2 Hz)
  int bar = (int)(t / GC_DANCE_BAR);
  if (bar < 0) bar = 0;
  if (bar > GC_DANCE_BARS - 1) bar = GC_DANCE_BARS - 1;
  float u = t - bar * GC_DANCE_BAR;          // 0..2 s within the bar
  float common = 0.0f, pitch = 0.0f, roll = 0.0f, diag = 0.0f;
  switch (bar) {
    case 0:                                   // kick only: bob the nose on every beat
      pitch  = 26.0f * sinf(w * u);
      common = -2.0f * (1.0f - cosf(w * u));  // and dip the body into each one. NOT a
                                              //   constant lean: probe_dance.c caught that
                                              //   as a 4.85 deg STEP at the bar 0/1 seam —
                                              //   every bar must start and end at zero, or
                                              //   the servo is handed a move it cannot make.
      break;
    case 1:                                   // the bass lands: twist, with an 8th-note nod
      roll   = 22.0f * sinf(w * u);
      pitch  =  6.0f * sinf(2.0f * w * u);
      break;
    case 2:                                   // stabs: step on the spot, diagonal pairs
      diag   = 26.0f * sinf(w * u);
      common =  5.0f * sinf(w * u);
      break;
    case 3:                                   // the break: 1 Hz push-ups for three beats...
      if (u < 3.0f * B) {
        common = 15.0f * (1.0f - cosf(0.5f * w * u));       // 1.5 slow cycles, ends deep
      } else {                                              // ...then chug on the kick roll
        float k = (u - 3.0f * B) / B;                       // 0..1 across the last beat
        common = 30.0f * (1.0f - k);                        // stand back up out of the squat
        pitch  =  7.0f * sinf(4.0f * w * (u - 3.0f * B));   // 8 Hz = the 16th-note roll
      }
      break;
    default:                                  // bar 4, the drop: shimmy, then the finish
      if (u < 3.0f * B) {
        roll  = 14.0f * sinf(2.0f * w * u);   // 4 Hz, half the amplitude, twice the rate
        pitch =  5.0f * sinf(w * u);
      } else {                                // the final hit at 9.5 s: BOW and hold it
        float k = gc_clampf((u - 3.0f * B) / 0.15f, 0.0f, 1.0f);
        common =  7.5f * k;                   // front +45, rear -30 = common +/- pitch
        pitch  = 37.5f * k;
      }
      break;
  }
  for (int i = 0; i < GC_NSERVO; i++) {
    float fs = GC_FRONT[i] ? 1.0f : -1.0f;
    tgt[i] = gc_clampf(common + pitch * fs + roll * GC_SIDE[i] + diag * (GC_SIDE[i] * fs),
                       -60.0f, 60.0f);
  }
}

// 1 on the first 90 ms of every beat — the eyes/mouth flash on this, so the face
// is on the same grid as the legs.
static inline int gc_dance_beat(float t) {
  float u = t - GC_DANCE_BEAT * floorf(t / GC_DANCE_BEAT);
  return (t >= 0.0f && t < GC_DANCE_LEN && u < 0.090f) ? 1 : 0;
}



static inline void gc_poses_defaults(gc_poses* q) {
  q->stand[0]=0;  q->stand[1]=0;  q->stand[2]=0;   q->stand[3]=0;
  q->sit  [0]=0;  q->sit  [1]=0;  q->sit  [2]=60;  q->sit  [3]=60;
  q->lie  [0]=55; q->lie  [1]=55; q->lie  [2]=-55; q->lie  [3]=-55;
  q->beg  [0]=40; q->beg  [1]=40; q->beg  [2]=0;   q->beg  [3]=0;      // rear legs at 0 (the stand angle; the owner found 14 tipped it forward, 29/10), front legs up and forward 40
  q->begBurstTo = 30.0f; q->begBurstDegS = 200.0f;
  q->waveCenter = 60.0f; q->waveAmp = 22.0f; q->waveHz = 1.8f; q->waveLean = 22.0f;
}

// Slew every leg toward tgt at rateDegS; returns the worst remaining error.
static inline float gc_slew_to(const float tgt[GC_NSERVO], float rateDegS,
                               float dt, float legDeg[GC_NSERVO]) {
  float err = 0.0f, step = rateDegS * dt;
  for (int i = 0; i < GC_NSERVO; i++) {
    legDeg[i] += gc_clampf(tgt[i] - legDeg[i], -step, step);
    float e = fabsf(tgt[i] - legDeg[i]);
    if (e > err) err = e;
  }
  return err;
}

static inline void gc_anim_start(gc_anim_state* a, int which) { a->anim = which; a->t = 0.0f; a->exitStage = 0; a->exitSettled = 0.0f; }

// ---------------------------------------------------------------------------
// KEYFRAME POSES (2026-10-25). Ideas from Petoi OpenCat (str, dg, hsk) and Sesame Robot (bow,
// shake), re-cut for ONE hip servo per leg. Angles are in OUR axis (+ = forward, {FL,FR,RL,RR}),
// r = slew rate in deg/s PER LEG, h = hold in s. r * (legs moving) stays <= 150, the power
// governor's budget, so the governor never has to stretch them. UNTESTED ON THE ROBOT: try each
// one held in the hand first. They all start from stand and finish by standing again.
// Duration of a keyframe = (largest leg travel from the previous one) / r + h.
// ---------------------------------------------------------------------------
typedef struct { float t[GC_NSERVO]; float r; float h; } gc_kf;

static const gc_kf GC_KF_BOW[] = {          // play-bow: nose down, front feet ahead, tail wag
  {{30,30, 0, 0}, 60.0f, 0.2f}, {{50,50, 0, 0}, 40.0f, 2.5f},
  {{50,50, 8,-8}, 60.0f, 0.3f}, {{50,50,-8, 8}, 60.0f, 0.3f},
  {{50,50, 8,-8}, 60.0f, 0.3f}, {{50,50,-8, 8}, 60.0f, 0.3f},
  {{50,50, 0, 0}, 60.0f, 0.3f}, {{ 0, 0, 0, 0}, 50.0f, 0.3f} };
static const gc_kf GC_KF_STRETCH[] = {      // bow, stand, then the rear legs stretched back
  {{50,50, 0, 0}, 40.0f, 2.0f}, {{ 0, 0, 0, 0}, 40.0f, 0.5f},
  {{ 0, 0,-45,-45}, 40.0f, 2.0f}, {{ 0, 0, 0, 0}, 40.0f, 0.3f} };
static const gc_kf GC_KF_WAG[] = {          // tail wag: only the two rear servos, +-8 deg
  {{0,0, 8,-8}, 60.0f, 0.0f},
  {{0,0,-8, 8}, 60.0f, 0.05f}, {{0,0, 8,-8}, 60.0f, 0.05f}, {{0,0,-8, 8}, 60.0f, 0.05f},
  {{0,0, 8,-8}, 60.0f, 0.05f}, {{0,0,-8, 8}, 60.0f, 0.05f}, {{0,0, 8,-8}, 60.0f, 0.05f},
  {{0,0,-8, 8}, 60.0f, 0.05f}, {{0,0, 0, 0}, 60.0f, 0.1f} };
static const gc_kf GC_KF_DIG[] = {          // front paws alternate, like digging
  {{20,-4,0,0}, 70.0f, 0.05f}, {{-4,20,0,0}, 70.0f, 0.05f},
  {{20,-4,0,0}, 70.0f, 0.05f}, {{-4,20,0,0}, 70.0f, 0.05f},
  {{20,-4,0,0}, 70.0f, 0.05f}, {{-4,20,0,0}, 70.0f, 0.05f},
  {{20,-4,0,0}, 70.0f, 0.05f}, {{-4,20,0,0}, 70.0f, 0.05f}, {{0,0,0,0}, 70.0f, 0.1f} };
static const gc_kf GC_KF_WIGGLE[] = {       // body twist: left legs +, right legs -, slow and small
  {{4,-4,4,-4}, 30.0f, 0.0f},
  {{7,-7,7,-7}, 30.0f, 0.16f}, {{-7,7,-7,7}, 30.0f, 0.16f}, {{7,-7,7,-7}, 30.0f, 0.16f},
  {{-7,7,-7,7}, 30.0f, 0.16f}, {{7,-7,7,-7}, 30.0f, 0.16f}, {{-7,7,-7,7}, 30.0f, 0.16f},
  {{7,-7,7,-7}, 30.0f, 0.16f}, {{-7,7,-7,7}, 30.0f, 0.16f}, {{0,0,0,0}, 30.0f, 0.2f} };

// Raised belly scratch: left rear leg rubs between 68 and 80 degrees.
// Other legs stay seated. Three bursts of eight strokes; safe GETUP at the end.
// Same keyframe durations drive the scrape sound, without a browser timer.
#define GC_SCR_A {{0,0,68,60}, 140.0f, 0.04f}
#define GC_SCR_B {{0,0,80,60}, 140.0f, 0.04f}
#define GC_SCR_BURST GC_SCR_A, GC_SCR_B, GC_SCR_A, GC_SCR_B, GC_SCR_A, GC_SCR_B, GC_SCR_A, GC_SCR_B, \
                     GC_SCR_A, GC_SCR_B, GC_SCR_A, GC_SCR_B, GC_SCR_A, GC_SCR_B, GC_SCR_A, GC_SCR_B
static const gc_kf GC_KF_SCRATCH[] = {
  {{0,0,60,60},60.0f,1.0f},
  {{0,0,80,60},40.0f,0.3f},
  GC_SCR_BURST, {{0,0,80,60},140.0f,0.4f},
  GC_SCR_BURST, {{0,0,80,60},140.0f,0.4f},
  GC_SCR_BURST, {{0,0,60,60},40.0f,0.8f}
};
static inline unsigned short gc_scratch_hz(float t) {
  float begin=0, prev[4]={0};
  for(unsigned i=0;i<sizeof(GC_KF_SCRATCH)/sizeof(GC_KF_SCRATCH[0]);i++) {
    const gc_kf *k=&GC_KF_SCRATCH[i]; float travel=0;
    for(int j=0;j<4;j++) { float d=fabsf(k->t[j]-prev[j]); if(d>travel)travel=d; }
    float duration=travel/k->r+k->h;
    if(t>=begin && t<begin+duration) {
      if(k->t[GC_RL]==68 && k->r==140) return (unsigned short)(2300-900*(t-begin)/duration);
      return 0;
    }
    begin+=duration;
    for(int j=0;j<4;j++)prev[j]=k->t[j];
  }
  return 0;
}

// Time-based keyframe player: finds the keyframe for a->t and slews toward it.
static inline int gc_kf_run_then(const gc_kf* kf, int n, gc_anim_state* a, float dt,
                                 float legDeg[GC_NSERVO], int next);

static inline int gc_kf_run(const gc_kf* kf, int n, gc_anim_state* a, float dt,
                            float legDeg[GC_NSERVO]) {
  return gc_kf_run_then(kf, n, a, dt, legDeg, GC_ANIM_STAND);
}

// Same player; when the keyframes end it starts `next` (STAND for the old moves, GETUP for the belly scratch).
static inline int gc_kf_run_then(const gc_kf* kf, int n, gc_anim_state* a, float dt,
                                 float legDeg[GC_NSERVO], int next) {
  float t0 = 0.0f, prev[GC_NSERVO] = { 0.0f, 0.0f, 0.0f, 0.0f };
  for (int i = 0; i < n; i++) {
    float m = 0.0f;
    for (int k = 0; k < GC_NSERVO; k++) {
      float d = fabsf(kf[i].t[k] - prev[k]);
      if (d > m) m = d;
    }
    float dur = m / kf[i].r + kf[i].h;
    if (a->t < t0 + dur) { gc_slew_to(kf[i].t, kf[i].r, dt, legDeg); return 1; }
    t0 += dur;
    for (int k = 0; k < GC_NSERVO; k++) prev[k] = kf[i].t[k];
  }
  gc_anim_start(a, next);                       // finished: stand back up (slewed, not snapped), or the move named by `next`
  return 1;
}

// "PEDIR" (2026-10-29, v2, from docs/study/BEG-POSE.md): sit RECLINED, trunk ~60 deg from the floor, both FRONT legs up in the air.
// Static model (real body/leg dims, CG assumed): rear legs at ~14 deg put the CG 37 mm inside the tipping-back limit and ~20 mm inside the
// tipping-forward limit; front leg angle hardly matters (<1 mm). There is NO quasi-static path from the plain sit: the CG only gets behind the
// feet when the rear legs pass ~33 deg, so the entry is a THROW: sit (front -20, rear 56), a fast rear-leg sweep to begBurstTo (~200 deg/s per servo),
// a slow descent to q_r, then the front legs up. The burst sums ~400 deg/s (> the 150 budget): watch for BROWNOUT. Held until another command; leaving
// goes through the staged BEGOUT rise. The TAIL (calda) blocks this pose in the model (trunk <= 44 deg): take it off or fold it for the first tests.
// UNTESTED ON THE ROBOT: hand first. Live tuning: UDP "B <front> <rear> [burstDegS burstTo]".
#define GC_BEG_SIT_S       1.6f
#define GC_BEG_PRE_FRONT  -20.0f   // front legs at their tallest (foot lowest), so the front of the body is high while the rear throws back
#define GC_BEG_PRE_REAR    56.0f   // rear legs sat (the mechanism closes at ~56)
#define GC_BEG_SETTLE_DEGS 40.0f   // slow descent of the rear legs to the final angle
#define GC_BEG_RAISE_DEGS  60.0f   // front legs up

#include "personality_motion.h"

// Run the active animation. Returns 1 while it OWNS the legs (overriding gait).
static inline int gc_anim_run(const gc_poses* q, gc_anim_state* a, float dt,
                              float legDeg[GC_NSERVO]) {
  if (a->anim == GC_ANIM_NONE) return 0;
  a->t += dt;
  switch (a->anim) {
    case GC_ANIM_PAUSE: return 1; // freeze current commanded position; no new movement
    case GC_ANIM_WAKE: case GC_ANIM_SLEEP: case GC_ANIM_CURIOUS:
    case GC_ANIM_ANGRY: case GC_ANIM_SHY: case GC_ANIM_CELEBRATE:
    case GC_ANIM_GREET: case GC_ANIM_GLITCH: {
      float target[GC_NSERVO];
      gc_personality_target(a->anim, a->t, target);
      gc_slew_to(target, 35.0f, dt, legDeg);
      if (a->anim != GC_ANIM_SLEEP && a->t >= gc_personality_duration(a->anim))
        gc_anim_start(a, GC_ANIM_STAND);
      return 1;
    }
    case GC_ANIM_STAND:
      if (gc_slew_to(q->stand, 100.0f, dt, legDeg) < 0.5f) a->anim = GC_ANIM_NONE;   // was 150: gentler peak current
      return 1;
    case GC_ANIM_GETUP: {                       // rise from a deep sit without tipping back
      const float noseDown[GC_NSERVO] = { 85, 85, 60, 60 };   // nose to the floor, rear still sat
      const float rearUp  [GC_NSERVO] = { 85, 85, 30, 30 };   // ease the rear up, nose pinned
      if      (a->t < 0.5f)        gc_slew_to(noseDown, 120.0f, dt, legDeg);
      else if (a->t < 0.5f + 1.4f) gc_slew_to(rearUp,    60.0f, dt, legDeg);
      else if (gc_slew_to(q->stand, 90.0f, dt, legDeg) < 0.5f) a->anim = GC_ANIM_NONE;
      return 1;
    }
    case GC_ANIM_LAUGH: {
      if (a->t >= K9_LAUGH_END) { gc_anim_start(a, GC_ANIM_STAND); return 1; }
      float pulse=k9_laugh_pulse(a->t);
      int syllable=k9_laugh_syllable(a->t);
      float sway=(syllable % 2 ? -0.5f : 0.5f)*pulse;
      float target[GC_NSERVO];
      target[GC_FL]=q->stand[GC_FL]+12+2*pulse+sway;
      target[GC_FR]=q->stand[GC_FR]+12+2*pulse-sway;
      target[GC_RL]=q->stand[GC_RL]+6+1*pulse+sway;
      target[GC_RR]=q->stand[GC_RR]+6+1*pulse-sway;
      gc_slew_to(target, 120.0f, dt, legDeg);
      return 1;
    }
    case GC_ANIM_DANCE: {                       // 10 s, on the beat, then stand back up
      if (a->t >= GC_DANCE_LEN) { gc_anim_start(a, GC_ANIM_STAND); return 1; }
      float tgt[GC_NSERVO];
      gc_dance_pose(a->t, tgt);
      gc_slew_to(tgt, GC_DANCE_SLEW, dt, legDeg);
      return 1;
    }
    case GC_ANIM_SIT: gc_slew_to(q->sit, 60.0f, dt, legDeg); return 1;   // hold until changed
    case GC_ANIM_BEG: {                         // see the PEDIR note above: pre-sit, throw back, settle, then lift the front legs and hold
      const float pre[GC_NSERVO] = { GC_BEG_PRE_FRONT, GC_BEG_PRE_FRONT, GC_BEG_PRE_REAR, GC_BEG_PRE_REAR };
      float toBurst = q->begBurstTo, rateB = q->begBurstDegS > 20.0f ? q->begBurstDegS : 20.0f;
      float tBurst  = GC_BEG_SIT_S + (GC_BEG_PRE_REAR - toBurst) / rateB + 0.05f;
      float down    = toBurst - q->beg[GC_RL]; if (down < 0.0f) down = 0.0f;
      float tSettle = tBurst + down / GC_BEG_SETTLE_DEGS + 0.15f;
      if (a->t < GC_BEG_SIT_S) gc_slew_to(pre, 60.0f, dt, legDeg);
      else if (a->t < tBurst) { float t[GC_NSERVO] = { pre[0], pre[1], toBurst, toBurst }; gc_slew_to(t, rateB, dt, legDeg); }
      else if (a->t < tSettle) { float t[GC_NSERVO] = { pre[0], pre[1], q->beg[GC_RL], q->beg[GC_RR] }; gc_slew_to(t, GC_BEG_SETTLE_DEGS, dt, legDeg); }
      else gc_slew_to(q->beg, GC_BEG_RAISE_DEGS, dt, legDeg);                  // front legs up, then hold until changed
      return 1;
    }
    case GC_ANIM_BEGOUT: {
      // Dedicated, slower rise. The old timed GETUP could advance while the
      // external power governor was still stretching the previous movement.
      // At 30 deg/s per leg even four moving legs stay below its 150 deg/s cap.
      // Keep the rear linkage below the near-closed region (model: ~56 deg).
      // Extend the rear pair with the front held down, THEN raise the front.
      // Completion is COMMAND position, not servo feedback; allow 250 ms to settle.
      const float stages[4][GC_NSERVO] = {
        { GC_BEG_PRE_FRONT, GC_BEG_PRE_FRONT, q->beg[GC_RL], q->beg[GC_RR] },
        { GC_BEG_PRE_FRONT, GC_BEG_PRE_FRONT, 48, 48 },
        { 85, 85, 48, 48 },
        { 85, 85, q->stand[GC_RL], q->stand[GC_RR] }
      };
      const float* target = a->exitStage < 4 ? stages[a->exitStage] : q->stand;
      if (gc_slew_to(target, 30.0f, dt, legDeg) < 0.01f) {
        a->exitSettled += dt;
        if (a->exitSettled >= 0.25f) {
          a->exitSettled = 0.0f;
          if (++a->exitStage == 5) a->anim = GC_ANIM_NONE;
        }
      } else a->exitSettled = 0.0f;
      return 1;
    }
    case GC_ANIM_LIE: gc_slew_to(q->lie, 60.0f, dt, legDeg); return 1;   // hold until changed
    case GC_ANIM_WAVE_FR:
    case GC_ANIM_WAVE_FL: {
      int leg = (a->anim == GC_ANIM_WAVE_FR) ? GC_FR : GC_FL;
      float tgt[GC_NSERVO];
      for (int i = 0; i < GC_NSERVO; i++) tgt[i] = q->stand[i];
      tgt[GC_RL] = q->waveLean; tgt[GC_RR] = q->waveLean;   // lean back -> unload the front leg
      if (a->t < 0.6f) {
        gc_slew_to(tgt, 120.0f, dt, legDeg);                // settle the lean, leg still planted
      } else {
        tgt[leg] = q->waveCenter
                 + q->waveAmp * sinf((a->t - 0.6f) * (2.0f * GC_PI * q->waveHz));
        gc_slew_to(tgt, 400.0f, dt, legDeg);
      }
      if (a->t > 3.6f) gc_anim_start(a, GC_ANIM_STAND);
      return 1;
    }
    case GC_ANIM_BOW:     return gc_kf_run(GC_KF_BOW,     (int)(sizeof GC_KF_BOW     / sizeof GC_KF_BOW[0]),     a, dt, legDeg);
    case GC_ANIM_STRETCH: return gc_kf_run(GC_KF_STRETCH, (int)(sizeof GC_KF_STRETCH / sizeof GC_KF_STRETCH[0]), a, dt, legDeg);
    case GC_ANIM_WAG:     return gc_kf_run(GC_KF_WAG,     (int)(sizeof GC_KF_WAG     / sizeof GC_KF_WAG[0]),     a, dt, legDeg);
    case GC_ANIM_DIG:     return gc_kf_run(GC_KF_DIG,     (int)(sizeof GC_KF_DIG     / sizeof GC_KF_DIG[0]),     a, dt, legDeg);
    case GC_ANIM_WIGGLE:  return gc_kf_run(GC_KF_WIGGLE,  (int)(sizeof GC_KF_WIGGLE  / sizeof GC_KF_WIGGLE[0]),  a, dt, legDeg);
    case GC_ANIM_SCRATCH: return gc_kf_run_then(GC_KF_SCRATCH, (int)(sizeof GC_KF_SCRATCH / sizeof GC_KF_SCRATCH[0]), a, dt, legDeg, GC_ANIM_GETUP);
    default: a->anim = GC_ANIM_NONE; return 0;
  }
}

// ---------------------------------------------------------------------------
// The single-leg bench reel (telnet `s 3`, plan §9 phase 1b). One leg, robot
// held in the air, FX30 rolling. A PURE function of time so the servo fit in
// sim/analysis runs this exact function, never a transcription of it:
//   lead-in  10 s   every leg at 0 (the user asked for a long straight hold)
//   steps    ±10 ±30 ±60 ±80 deg, twice each        no-load speed, overshoot
//   stairs   1 2 3 5 8 deg and back down            deadband / resolution
//   ramps    ±45 deg at 100..700 deg/s              where tracking breaks
//   sines    26 deg at 1 1.4 2 3 4 5 Hz, 4 cycles   gain + lag over the gait band
//   gait     the real default waveform at 1.4 then 2.5 Hz, on this leg only
// Returns 1 while running (deg = commanded angle, on = eye LED), 0 when done.
// ---------------------------------------------------------------------------
#define GC_REEL_LEADIN_S 10.0f
typedef struct { float t; float deg; int hit; } gc_reel_cur;
static inline int gc_rs_hold(gc_reel_cur* c, float d, float dur) {
  if (c->hit) return 1;
  if (c->t < dur) { c->deg = d; c->hit = 1; return 1; }
  c->t -= dur; return 0;
}
static inline int gc_rs_ramp(gc_reel_cur* c, float a, float b, float dur) {
  if (c->hit) return 1;
  if (c->t < dur) { c->deg = a + (b - a) * (c->t / dur); c->hit = 1; return 1; }
  c->t -= dur; return 0;
}
static inline int gc_rs_sine(gc_reel_cur* c, float amp, float hz, float cycles) {
  float dur = cycles / hz;
  if (c->hit) return 1;
  if (c->t < dur) { c->deg = amp * sinf(2.0f * GC_PI * hz * c->t); c->hit = 1; return 1; }
  c->t -= dur; return 0;
}
static inline int gc_rs_gait(gc_reel_cur* c, const gc_params* p, float hz, float dur) {
  if (c->hit) return 1;
  if (c->t < dur) {                       // gc_update at full forward drive, FL,
    float w = p->ampSlew * c->t;          //   steady state: w slews 0->1, phase runs
    if (w > 1.0f) w = 1.0f;
    float ph = 2.0f * GC_PI * hz * c->t + p->legPhaseDeg[GC_FL] * GC_DEG2RAD;
    c->deg = p->strideDeg * w * gc_wave(ph, p->strokeDuty) + p->postureDeg;
    c->hit = 1; return 1;
  }
  c->t -= dur; return 0;
}
static inline int gc_reel_single(float t, float* deg, int* on) {
  static const float STEP_AMP[]  = { 10, 30, 60, 80 };
  static const float STAIR[]     = { 1, 2, 3, 5, 8, 5, 3, 2, 1, 0 };
  static const float RAMP_DPS[]  = { 100, 200, 300, 400, 500, 700 };
  static const float SINE_HZ[]   = { 1.0f, 1.4f, 2.0f, 3.0f, 4.0f, 5.0f };
  const float HOLD = 0.7f, STAIR_HOLD = 0.5f, GAP = 0.5f, RAMP_A = 45.0f;
  gc_params p; gc_params_defaults(&p);
  gc_reel_cur c = { t, 0.0f, 0 };
  gc_rs_hold(&c, 0, GC_REEL_LEADIN_S);
  for (int i = 0; i < 4; i++) for (int r = 0; r < 2; r++) {
    gc_rs_hold(&c,  STEP_AMP[i], HOLD); gc_rs_hold(&c, 0, HOLD);
    gc_rs_hold(&c, -STEP_AMP[i], HOLD); gc_rs_hold(&c, 0, HOLD);
  }
  for (int i = 0; i < 10; i++) gc_rs_hold(&c, STAIR[i], STAIR_HOLD);
  gc_rs_hold(&c, 0, GAP);
  for (int i = 0; i < 6; i++) {
    float d = 2.0f * RAMP_A / RAMP_DPS[i];
    gc_rs_ramp(&c, 0, -RAMP_A, RAMP_A / 200.0f); gc_rs_hold(&c, -RAMP_A, 0.4f);
    gc_rs_ramp(&c, -RAMP_A, RAMP_A, d);          gc_rs_hold(&c,  RAMP_A, 0.4f);
    gc_rs_ramp(&c,  RAMP_A, -RAMP_A, d);         gc_rs_hold(&c, -RAMP_A, 0.4f);
    gc_rs_ramp(&c, -RAMP_A, 0, RAMP_A / 200.0f); gc_rs_hold(&c, 0, GAP);
  }
  for (int i = 0; i < 6; i++) { gc_rs_sine(&c, p.strideDeg, SINE_HZ[i], 4.0f); gc_rs_hold(&c, 0, GAP); }
  gc_rs_gait(&c, &p, 1.4f, 5.0f); gc_rs_hold(&c, 0, GAP);
  gc_rs_gait(&c, &p, 2.5f, 5.0f); gc_rs_hold(&c, 0, 1.0f);
  if (!c.hit) { *deg = 0.0f; *on = 0; return 0; }
  *deg = c.deg; *on = (c.deg != 0.0f); return 1;
}

#endif  // GAIT_CORE_H
