// Adapted from miniRobo K9V2.1: https://www.minirobo.io/projects/k9v2-1
// Upstream personal/non-commercial terms apply to derived portions.
// These portions are not relicensed under the repository's MIT grant.
// See ../../THIRD_PARTY.md (repository root) for provenance.
#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include <stdarg.h>
#include "gait_core.h"   // the gait/animation MATH, shared verbatim with sim/

#ifdef BOARD_ESP32CAM
#ifdef K9_CAM_ONLY
#include "cam_stable/web_cam_server.h"   // the camera build uses the version that streams reliably (see docs/TROUBLESHOOTING.md)
#else
#include "web_cam_server.h"
#endif
#endif

#ifdef TUNE_MODE
#define OTA_HOST "walker"        // mDNS -> walker.local
#include "net_console.h"          // shared WiFi OTA + telnet console
#else
#include <WiFi.h>                 // ESP-NOW gamepad (minirobo controller/ project)
#include <esp_now.h>
#endif

// ============================================================================
// walker — 4-servo quadruped "horse" firmware  (ESP32-C3 SuperMini)
//   4x MG90S (one hip-pitch DOF/leg) + MPU6050 IMU. Diagonal-pair TROT gait.
// ============================================================================

enum { FL = 0, FR, RL, RR, NSERVO };
#ifdef BOARD_ESP32CAM
static const uint8_t SERVO_PIN[NSERVO] = { 14, 15, 13, 2 };   // FL=14 FR=15 RL=13 RR=2
#define PIN_EYES -1
#define PIN_MOUTH -1
#else
static const uint8_t SERVO_PIN[NSERVO] = { 4, 3, 1, 7 };   // FL=P1 FR=P2 RL=P3 RR=P5
#endif
#if ESP_ARDUINO_VERSION_MAJOR < 3
static const uint8_t SERVO_CH [NSERVO] = { 0, 1, 2, 3 };   // core 2.x: explicit LEDC channels
#endif
// SIDE (+1 LEFT / -1 RIGHT) and the per-leg gait phase offset now live in
// gait_core.h as GC_SIDE and gc_params.legPhaseDeg. The default {0,180,180,0}
// is the diagonal trot (FL,RR vs FR,RL antiphase); set per leg from the console
// ('o' cmd) to try crawl/wave sequences without reflashing.

// Servo calibration lives in a gc_servo_cal so sim/ drives the identical
// microsecond path (trim, direction, us/deg, clamp). center_us = bench trim
// (legs hang vertical at rest); dir makes + degrees FORWARD on every leg.
static gc_servo_cal CAL = {
  { 1500, 1500, 1500, 1500 },   // center_us  FL FR RL RR — NEUTRAL. Yours differ by a
                                //   few degrees per servo: press the cranks on with the
                                //   arrows lined up, then run the `trim` build and the
                                //   diagonal lift test below (README, "Centre the legs").
                                //
                                // SIGN RULE: a leg's `dir` says which way +us moves it.
                                //   dir +1 (FR, RR):  +us = FORWARD,  -us = back
                                //   dir -1 (FL, RL):  -us = FORWARD,  +us = back
                                // This was MEASURED, not assumed: a deliberate 14 deg test
                                // offset on RR moved that leg the OTHER way to the guess, which
                                // is how the rule was settled (two earlier "forward" nudges,
                                // 1403 and 1382, went backwards and were discarded).
                                // us_per_deg = 10.6, so 1 deg ~ 11 us, 3 deg ~ 32, 4 deg ~ 42.
                                //
                                // THE DIAGONAL LIFT TEST (user, 2026-09-18) — the alignment
                                // method that actually works, and it beats trimming by eye:
                                // walk VERY slowly (mode A, ~15 % throttle) and watch which
                                // legs carry. Both diagonal pairs should take the robot's
                                // weight in turn. If one pair rocks and the other waves in
                                // the air, the airborne pair is effectively SHORT.
                                // Trim DOES change reach — support height is L*cos(theta)
                                // and posture holds the stroke around -12 deg, where
                                // d(height)/d(theta) is ~0.23 mm per degree over a 64.85 mm
                                // leg, so forward trim (toward vertical) LENGTHENS a leg.
                                // But do NOT predict the next move from that: it does not
                                // explain the 09-18 reading. Ranked by reach it says
                                // RL shortest (-2.0) then FL, RR, FR longest (+5.0) — yet the
                                // pair in the AIR was FR+RL, one from each end of that order.
                                // Two predictions from this geometry, one right (RL) and one
                                // wrong (FR). Something else is acting on FR: suspect its
                                // crank clocking (one spline tooth is 18 deg), its band
                                // tension, or that knee giving under load.
                                // TRUST THE TEST, NOT THE MODEL: walk slowly, see which pair
                                // carries, adjust, repeat. The geometry is a sanity check on
                                // magnitude, not a direction oracle.
                                //
                                // TRIMS ARE PER-ROBOT: never copy a CAL block between boards
                                // (the other board's robot has its own set — see boards.tsv).
  {   -1,   +1,   -1,   +1 },   // dir
  10.6f,                        // us_per_deg
  600, 2400                     // min_us, max_us
};

#define SERVO_RES_BITS  14
#define SERVO_PERIOD_US 20000
#define SERVO_MIN_US    600
#define SERVO_MAX_US    2400
#define US_PER_DEG      10.6f

// ---- face: 2x RED eye LEDs in parallel on GPIO0 = minicore port P4 (freed by
// removing the IMU's I2C — see setup()). Wired ACTIVE-HIGH off the port's OWN two
// pins: port S -> 220R -> LED anode, cathode -> port G (HIGH = on), each LED its
// own resistor. The port's V pin stays unused — it is the boost's 5V, which is why
// the LEDs run off the pin instead. ~6 mA per LED at 3.3 V through 220R, so the
// two in parallel are well inside the C3's per-pin limit. Nothing goes to J9.
// eyesMode: 0 off, 1 breathe (default), 2 solid on.
#ifndef PIN_EYES
#define PIN_EYES 0
#endif
#ifndef PIN_MOUTH
#define PIN_MOUTH 10
#endif
static int eyesMode = 1;
#ifdef TUNE_MODE
int seqEyesMode();                            // 0 = none, 1 = force off, 2 = force on
#endif
extern unsigned long blinkEndMs;             // set by selectGait(): count = which gait
int danceEyeLevel();                         // -1 = not dancing; else brightness this tick
static void updateEyes() {
  if (PIN_EYES < 0) return;
  if (millis() < blinkEndMs) {                // bench: blink the chosen gait's number
    analogWrite(PIN_EYES, ((millis() / 150) % 2) ? 255 : 0);
    return;
  }
  int dl = danceEyeLevel();                   // the dance flashes the eyes ON THE BEAT
  if (dl >= 0) { analogWrite(PIN_EYES, dl); return; }
  int mode = eyesMode;
#ifdef TUNE_MODE
  int ov = seqEyesMode();                     // a running bench sequence owns the eyes:
  if      (ov == 1) mode = 0;                 // they are the camera's sync track
  else if (ov == 2) mode = 2;
#endif
  int level;                                  // 0..255 brightness, driven straight out
  if      (mode == 0) level = 0;
  else if (mode == 2) level = 255;
  else { float b = 0.5f * (1.0f - cosf(millis() * 0.0018f));   // ~3.5 s breath
         level = (int)(40 + b * 215); }
  analogWrite(PIN_EYES, level);               // active-high: HIGH = brightest
}


// ---- gait gains: DEFAULTS as #defines, live state in the vars below so the
//      telnet console can tweak them at runtime without a reflash ----
// DEFAULTS = the NEW LEGS "robust" gait (2026-09-15, search #2 in
// sim/results/newlegs_gait_search.md). Searched in the FLEXING-leg twin (the first
// search ran on a band estimate so stiff the leg never flexed), worst case over the
// soft AND mid loom-band estimates x mat friction x start jitter, refereed at
// dt 0.1 ms: 131 mm/s worst run, 147 mean, no fall, servo saturation 0.07.
// Picked for its BASIN, not its speed: nudge any one gain (0.15 Hz, 4 deg, 0.05
// duty, 3 deg posture, 0.15 ratio) and the worst run still walks >= 81 mm/s. The
// fastest gait found (2.30 / 44 / 0.55 / -12, 142-174 mm/s) stalls dead if posture
// is 3 deg out. UNTESTED on the robot. For the 70 mm RIGID legs the pick was
// 2.15 Hz / 44 / 0.89 / +1 (251 mm/s measured 2026-09-09); on the new legs that
// one rears up and flips in the twin.
// GAIT PRESET (2026-09-16). The bench said: backward excellent, forward walks in place
// at full throttle with ONE loom band, forward ok at half throttle with TWO. The band
// was then FITTED to those three facts in the twin (sim/newlegs/band_fit.py) and came
// out 4-8x SOFTER than the "mid" this gait was tuned on — so the old numbers were tuned
// for a band the robot does not have, and the two searches below are the answer:
//   1  ONE band  — 3.09 Hz / 49.9 / 0.52 / +12.9 / 0.67. Stops relying on the knee fold:
//                  fast and near-symmetric. Twin 122-147 mm/s, but servos saturate 66 %
//                  of the time and it rocks (tilt 33 deg). Fastest, hardest on the gear.
//   2  TWO bands — 1.75 Hz / 49.7 / 0.82 / -6.8 / 0.84. The fold works again, so the
//                  asymmetric duty comes back. Twin 74-90 mm/s, sat 0.43, tilt 18.5.
//   0  the 2026-09-15 numbers, kept for reference (tuned on the wrong band).
// BENCH RESULT 2026-09-16, with THREE loom bands per leg: preset 2 (= button A) won both
// forward and backward, with the old 09-15 gait (button D) the runner-up each time. So 2
// is the gait, and the buttons go back to the moods.
// RE-SEARCHED 2026-09-18 for the x1.15 LEGS (walker v5.4). Both of the gaits this robot
// has actually driven FALL on the longer legs — the twin flips them over at the referee
// dt, each in one direction: the old preset 2 nose-overs going FORWARD, the v5.2 sweep
// winner pitches over going BACKWARD. Neither could be caught before, because every gait
// search until now scored command=(1,0) only. newlegs/gait_search_v54.py scores the WORST
// of forward and backward over 6 friction/seed variants, and applies the hard reach limit
// |posture| + larger amplitude <= 60 deg (the thigh range the clearance probes sweep — the
// OLD preset 2 sat at 60.8 and the v5.2 winner at 70.1, both over it).
//   preset 2  THE PICK   fwd +97..136  bwd +78..85  sat 0.00  tilt 25.3  reach 57.0
//   preset 3  runner-up  fwd +113..131 bwd +60..78  sat 0.00  tilt 18.9  reach 57.0
// 3 is notably STEADIER (tilt 18.9 vs 25.3) and quicker forward; 2 is the better reverse.
// Preset 1 was the rigid-leg heritage gait (3.09 / 49.9 / +12.9): reach 72.7, i.e. well
// past the 60 deg limit and unusable on these legs. It is now the FAST option, from a
// second search that maximised the FORWARD score with reverse merely LOCKED (no fall,
// >= 50 mm/s):  fwd +108..158  bwd +65..104  tilt 21.7  reach 57.0 — but sat 0.27, the
// servos on their force limit a quarter of the time. That is why 3 is the default and 1
// is the one to A/B: the twin's saturation is a model quantity, the gear wear is not.
//   preset 1  FAST       fwd +108..158 bwd +65..104 sat 0.27 tilt 21.7 reach 57.0
// Every gait in the top ten wanted ampRatio 1.00 — equal front/rear amplitude buys 8 % more
// usable stride inside the reach limit than 0.85 does. UNPROVEN ON THE BENCH: A/B them.
#define GAIT_PRESET 3     // 2026-09-18 bench: flipped to the steadier runner-up
#if   GAIT_PRESET == 1
#define GAIT_FREQ_HZ 1.60f   // x1.15 legs, FAST: top speed at the cost of saturation
#define STRIDE_DEG   45.0f
#define POSTURE_DEG  -12.0f
#elif GAIT_PRESET == 2
#define GAIT_FREQ_HZ 1.00f   // x1.15 legs, both-direction pick
#define STRIDE_DEG   45.0f
#define POSTURE_DEG  -12.0f
#else
#define GAIT_FREQ_HZ 1.60f   // LOCKED 2026-09-18: bench winner, stride at the return-rate ceiling
#define STRIDE_DEG   53.0f
#define POSTURE_DEG  -6.0f
#endif
#define TURN_GAIN    1.0f    // full differential authority for brisker in-place turns
#define KP_PITCH     0.0f    // self-balance OFF by default — it confounds gait tuning; re-enable later
#define AMP_SLEW     3.0f
#define POSTURE_MAX  35.0f   // forward load-bias cap; load-modulated crawl wants posture~=stride
#if   GAIT_PRESET == 1
#define STROKE_DUTY  0.66f    // x1.15 legs, FAST
#elif GAIT_PRESET == 2
#define STROKE_DUTY  0.66f    // x1.15 legs (was 0.60 on the short legs). Fraction of cycle spent
                             // on the SLOW backward power stroke; the rest is the FAST forward
                             // return (stick-slip ratchet). 0.5 = symmetric triangle. 'd' to tune.
#else
#define STROKE_DUTY  0.66f    // LOCKED 2026-09-18
#endif
#if   GAIT_PRESET == 1
#define AMP_RATIO    1.00f   // x1.15 legs, FAST
#elif GAIT_PRESET == 2
#define AMP_RATIO    1.00f   // front/rear stride amplitude ratio, MEAN-PRESERVING; 1.0 = equal.
                             // Every gait in the v54 top ten wanted 1.00: the reach limit costs
                             // stride*max(2r/(1+r), 2/(1+r)), which is 1.081x at 0.85 and 1.0 here,
                             // so equal amplitude buys 8 % more stride for the same thigh range.
#else
#define AMP_RATIO    1.00f   // runner-up, same reason. 'q' to tune.
#endif
// TURN GAIT — blended in as the stick goes from straight to spin (see gc_params).
// LOCKED 2026-09-17 (bench: "mode 3 is the best, lock it in"). The SIGNED turn search's
// direction-safe pick: turns the way the stick says on every floor variant, both directions
// (worst +11 deg/s), tilt 5.6 / 11.8, never saturates. It replaced the calm 2.22 Hz gait,
// which the first search (scoring abs(yaw)) had picked and which spins the WRONG way on a
// slippery floor. The blend is zero when driving straight, so these cannot touch walking.
// TURN GAIT — the CALM, quick-stepping spin, restored 2026-09-17. The bench has now chosen
// it three times: it turns better than either direction-safe gait, and a flash dump of the
// old board proved that is what mode 2 there was running. The twin's objection stands and is
// worth remembering: on a SLIPPERY floor (mu 0.8) it spins the WRONG way (-18 deg/s) —
// direction, not speed, is the thing the twin has been right about. Watch for it on a smooth
// hard floor; the direction-safe alternative is 1.02 / 37.8 / 0.61 / -14.7 / 1.10 (slower) or
// 1.40 / 40.0 / 0.92 / -12.2 / 1.13 (what this replaces).
#define TURN_FREQ    2.22f
#define TURN_STRIDE  26.1f
#define TURN_DUTY    0.69f
#define TURN_POSTURE -18.7f
#define TURN_RATIO   1.00f
// STEERING at speed, LOCKED with it: mode 1's progressive arc to 90 % of the right stick,
// then a quick crossfade into the spin, so full right stick = the spin you get with the
// left stick centred. The crossover sits at the end because wherever the inside legs pass
// through zero on the drive gait, the turn direction depends on the floor.
#define STEER_ARC    0.33f
#define STEER_FLOOR  0.55f
#define SPIN_TAKE    1.0f
#define SPIN_START   0.90f
#define DUTY_SPLIT   0.0f    // left/right power-stroke duty difference (0 = equal):
                             // ratchets one side forward and one back, a turn
                             // authority that costs no amplitude. 'u' to tune.

// Live gait state. The MATH is in gait_core.h — this is just the tunable data,
// so the telnet console can move any of it without a reflash.
static gc_params     G;      // gains (the #defines above are its power-on values)
static gc_state      GS;     // wL / wR / gaitPhase
static gc_poses      GQ;     // stand / sit / lie / wave poses
static gc_anim_state GA;     // active animation + its clock
// the mouth glows while the legs are actually moving — and blinks on every beat
// of the dance, which is free: it is a digitalWrite, not a PWM channel.
static void updateMouth() {
  if (PIN_MOUTH < 0) return;
  if (GA.anim == GC_ANIM_DANCE) { digitalWrite(PIN_MOUTH, gc_dance_beat(GA.t) ? HIGH : LOW); return; }
  bool walking = fabsf(GS.wL) > 0.05f || fabsf(GS.wR) > 0.05f;
  digitalWrite(PIN_MOUTH, walking ? HIGH : LOW);
}
// eyes on the same beat: bright on the downbeat of each beat, dim between.
// Defined here (not up with updateEyes) because it needs GA; declared there.
int danceEyeLevel() {
  if (GA.anim != GC_ANIM_DANCE) return -1;
  return gc_dance_beat(GA.t) ? 255 : 35;
}

static void gaitDefaults() {                 // flash #2 bakes winners into the #defines
  G.gaitFreq   = GAIT_FREQ_HZ;  G.strideDeg = STRIDE_DEG;  G.postureDeg = POSTURE_DEG;
  G.turnGain   = TURN_GAIN;     G.kpPitch   = KP_PITCH;    G.strokeDuty = STROKE_DUTY;
  G.ampRatio   = AMP_RATIO;     G.dutySplit = DUTY_SPLIT;   // = GAITS[0], candidate A
  G.ampSlew    = AMP_SLEW;      G.postureMax = POSTURE_MAX;
  G.retCap     = 500.0f;        // servo return ceiling (~503 deg/s): steering/spin can no longer exceed it
  G.rearDutyAdd = 0.0f;         // rear-return variations (panel buttons 1-5) are OFF at power-up
  G.turnFreq   = TURN_FREQ;     G.turnStride = TURN_STRIDE;  G.turnDuty = TURN_DUTY;
  G.turnPosture = TURN_POSTURE; G.turnRatio  = TURN_RATIO;  G.turnSharp = 1.0f;
  G.steerNorm  = 1.0f;  G.spinOnly = 1.0f;  G.steerFloor = STEER_FLOOR;   // LOCKED: mode 3 of
  G.steerArc   = STEER_ARC; G.steerExpo = 1.0f; G.steerDuty = 0.0f;        //   steering round 2
  G.spinTake   = SPIN_TAKE; G.spinStart = SPIN_START;
  G.legPhaseDeg[FL] = 0;   G.legPhaseDeg[FR] = 180;
  G.legPhaseDeg[RL] = 180; G.legPhaseDeg[RR] = 0;
  gc_poses_defaults(&GQ);
  GS.wL = GS.wR = GS.gaitPhase = 0;
  GA.anim = GC_ANIM_NONE; GA.t = 0;
}


// ---- IMU (NOT INSTALLED — imuInit() is commented out in setup()) ----
// These two pins are no longer free: GPIO0 drives the eyes and GPIO1 is now RL.
// The carrier does expose I2C, but on its OWN pins — J9's `C`/`D` = GPIO 6 / 5 —
// so re-fitting an IMU means moving these to 6/5, not reclaiming 0/1.
#define MPU_SDA_PIN 0
#define MPU_SCL_PIN 1
#define MPU_ADDR    0x68
#define COMP_ALPHA  0.98f
#define FALL_DEG    55.0f

#define STICK_FS    512.0f
#define FLICK_MODES  0       // LOCKED 2026-09-18: the gait is settled (f1.60 a53 d.66 p-6).
                             //   Set to 1 to put the four candidates back on right-stick flicks.
#define FLICK_MODES_DOC 1    // (was: ON, so the RIGHT STICK picks the walk gait
                             //   flick it forward N times, pause, mode N loads; the four
                             //   face buttons stay the emotions either way.)
#define FLICK_ON     0.80f   // right stick past 80 % forward = one flick
#define FLICK_OFF    0.30f   // ... and it must come back inside 30 % before the next
#define FLICK_GAP_MS 700     // pause this long after the last flick and the mode loads
#define DANCE_FLICKS    3    // right stick UP this many times = toggle LIE. Fires on the
                             //   LAST flick, not after a pause. (It was the dance trigger
                             //   for one flash; three flicks cannot be timed to a downbeat,
                             //   so the dance took the D button and lie took this.)
#define DANCE_WINDOW_MS 1200 // ... each flick within this of the one before, or the count
                             //   restarts. A stray shove on its own does nothing.
#define STICK_DZ    0.12f
#define WATCHDOG_MS 400

// ---- ALIGNMENT HOLD (2026-09-15) -------------------------------------------
// The body carries an arrow beside each servo and the crank carries one along its
// arm (the alignment arrows). At the servo's CENTRE the arm points
// straight BACK, which is the pose the gait and the twin assume — so on power-up
// the legs are held at centre, eyes SOLID, while you press each crank on with its
// arrow in line with the body's. When the hold ends the eyes go back to their
// normal breathe and the gamepad takes over. The tune build has telnet 'h' for the
// same job; this is the gamepad build's version of it.
#define ALIGN_HOLD_MS 20000
static bool alignHold = true;

static float driveFwd = 0, driveTurn = 0;
static bool  holdCenter = false;          // 'h': freeze legs at centre — this IS the
                                          //  "center" bench command (replaces -DCALIBRATE)
static float legDeg[NSERVO] = { 0, 0, 0, 0 };  // current commanded leg angle (gait & animations)
static bool  imuOk = false, fallen = false;
static float pitchDeg = 0, rollDeg = 0, gBiasX = 0, gBiasY = 0, gBiasZ = 0;
static float yawDeg = 0;                   // integrated gyro-Z heading (good for turns)
static bool  turning = false;              // closed-loop "turn to angle" ('T' cmd) active
static float turnTarget = 0, turnStartYaw = 0;

// ---- forward-thrust proxy (IMU can't measure distance — drift swamps a 1"/6s
//      crawl — so we score fore-aft "vigor": gravity-removed forward accel,
//      band-passed into a velocity estimate; its RMS over a run is the proxy.
//      Drift-free (no absolute integration). Reset with 'z', report with 'm'. ----
#define ACCEL_LSB_PER_G 16384.0f   // MPU6050 @ ±2g
#define DEG2RAD         0.0174533f
#define VFWD_TAU        0.7f       // leaky-integrator time const -> band-pass ~stride freq
static float aFwdBias = 0;         // rest offset of gravity-removed fwd accel (m/s^2)
static float vFwd = 0;             // band-passed fore-aft velocity estimate (m/s)
static double mVfwdSq = 0, mAfwdSq = 0, mPitchSq = 0, mRollSq = 0, mRollSum = 0;
static uint32_t mN = 0; static uint16_t mFalls = 0; static bool mWasFallen = false;

// ----------------------------------------------------------------------------
// Logging — to USB Serial, and (TUNE_MODE) to the telnet client.
// ----------------------------------------------------------------------------
#ifndef TUNE_MODE                          // TUNE build gets logf() from net_console.h
static void logf(const char* fmt, ...) {
  char buf[180]; va_list ap; va_start(ap, fmt);
  vsnprintf(buf, sizeof buf, fmt, ap); va_end(ap);
  Serial.print(buf);
#ifdef BOARD_ESP32CAM
  k9LogAppend(buf);                          // persistent copy (see k9_log.h)
#endif
}
#endif

// ---- BENCH: the four face buttons pick a GAIT (2026-09-16, "put 4 candidates on and
// I can switch between them with the four buttons. We will put them back to emotions
// later"). Set GAIT_BUTTONS 0 to hand A/B/C/D back to sit / wave FR / wave FL / lie.
// GAIT: LOCKED 2026-09-17 — "I like 1 better for walking and turning, from an animation
// perspective. Let's lock it in." = 1.75 Hz / 49.7 / duty 0.60 / -6.8 / 0.84, linear blend.
//
// The right-stick flicks are back, for the SPIN only — the steering curve is settled
// (mode 3 of round 2: mode 1's arc to 90 % of the stick, then the crossfade into the spin).
// Bench 2026-09-17: "why is turning slow now?" Twin, signed yaw, worst case over floors x
// both directions (newlegs/fast_spin_check.py):
//   1  FAST SAFE   1.04 / 40.0 / 0.92 / -12.2 / 1.13   worst +14.8, mean +19   <- power-up
//   2  QUICK, RISKY 2.22 / 26.1 / 0.69 / -18.7 / 1.00  worst -18.6: it REVERSES on a
//      slippery floor. It is the one that felt quick; drive it and see if you can provoke it
//   3  CALM SAFE   1.02 / 37.8 / 0.61 / -14.7 / 1.10   worst +11.5 — what you just drove
//   4  MID SAFE    1.40 / 40.0 / 0.92 / -12.2 / 1.13   worst  +4.5 — a faster step rate,
//      but most of the turn is gone: the frequency/safety trade, in one mode
// Each change blinks the eyes 1..4 times.
struct GaitPreset { const char* name; float wFreq, wStride, wDuty, wPosture, wRatio, wSlew; };
// THE SERVO RETURN-RATE CEILING — CONFIRMED, and now a design rule (2026-09-18).
// The fast return stroke must cover the whole peak-to-peak sweep in (1 - duty) of a cycle:
//
//     return rate = 2 * strideDeg * gaitFreq / (1 - strokeDuty)   <=  503 deg/s
//
// 503 is the MG90S no-load speed (masses.json servo_model, off the phase-1 reel). Ask for
// more and the return never completes, the stroke stops being asymmetric, and the stick-slip
// ratchet — the entire propulsion mechanism — stops ratcheting. Forward limps on posture
// bias; REVERSE DIES COMPLETELY, and by hand it feels "clunky".
//
// Evidence: stride 60 at f1.60/d.66 wants 565 deg/s (12 % over) — fastest forward the robot
// has ever gone, beat walker v1, and could not reverse at all. Offered four gaits at 536
// (over) / 499 / 480 / 486, the bench picked the 499 one "all around": hard against the
// ceiling, not past it. The two that went further under (480, 486) lost, so being under is
// necessary and being close is better.
//
// THE COROLLARY THAT WAS WRONG. On the ceiling, stride * freq = 503 * (1 - duty) / 2, and
// if forward speed went as stride * freq then speed would depend ONLY on duty and lower duty
// would be strictly faster. Predicted 3 > 2 > 1 > 4 for the set below. The bench said
// "1 is the winner" — the HIGHEST duty of the three fast cells, and the shortest stride.
// So the derivation is incomplete: duty does not only buy return time, it also sets the
// RATCHET's grip fraction. Drop it and the power stroke spends less of the cycle gripping,
// which costs more than the extra sweep gains. d 0.66 is near the ratchet's own optimum and
// stride follows from it, not the other way round.
// KEEP: the ceiling (a hard servo limit, confirmed twice). DISCARD: speed ~ (1 - duty).
//
// FINAL GAIT (bench, 2026-09-18): f1.60 / a53 / d0.66 / p-6 / q1.00, return rate 499 of 503.
#define GAIT_COUNT 6
static const GaitPreset GAITS[GAIT_COUNT] = {
  //        name              freq  stride  duty  posture ratio  slew   return rate
  { "1 FINAL a53 d.66",     1.60f, 53.0f, 0.66f, -6.0f, 1.00f, 3.00f },   // 499 deg/s  <- the gait
  { "2 a59 d.62 (lost)",    1.60f, 59.0f, 0.62f, -6.0f, 1.00f, 3.00f },   // 497
  { "3 a65 d.58 (lost)",    1.60f, 65.0f, 0.58f, -6.0f, 1.00f, 3.00f },   // 495
  { "4 a47 d.70 (lost)",    1.60f, 47.0f, 0.70f, -6.0f, 1.00f, 3.00f },   // 501
  // 5: MK3 (2026-10-27). The MK3 body weighs ~280 g (the K9V2.1 plastic was ~140 g) and the four
  // MG90S run saturated at 99% of the return ceiling. This keeps duty .66 (the ratchet's grip optimum
  // from the bench above) and trades speed for margin: return stroke 375 deg/s = 75% of the ceiling,
  // sum of the four leg speeds -25%, fewer reversals per second (the BROWNOUT trigger), slower
  // start ramp. Sweep A*f is 25% lower, so expect ~25% less forward speed. Reach 57 (<= 60).
  { "5 MK3 a51 f1.25",      1.25f, 51.0f, 0.66f, -6.0f, 1.00f, 2.00f },   // 375
  // 6: MK3 with the legs of one side moving together (2026-10-29, bench on the real robot). Every diagonal-trot
  // variant (presets 1-5 and the panel's tests) stood still or went BACKWARD; legs 0/180/0/180 was the first
  // pattern that walked forward (a little), and f1.50 was better than 1.25. Return stroke 450 deg/s = 89% of the
  // ceiling: closer than preset 5, so watch for BROWNOUT. See docs/GAIT-TESTS-MK3.md.
  { "6 MK3 lado a51 f1.50", 1.50f, 51.0f, 0.66f, -6.0f, 1.00f, 2.00f },   // 450
};
// Leg phase per preset {FL, FR, RL, RR}: 0/180/180/0 = diagonal trot, 0/180/0/180 = each side moves together.
static const float GAIT_PHASE[GAIT_COUNT][4] = {
  { 0, 180, 180, 0 }, { 0, 180, 180, 0 }, { 0, 180, 180, 0 }, { 0, 180, 180, 0 }, { 0, 180, 180, 0 },
  { 0, 180, 0, 180 },
};
#define GAIT_BOOT 4   // power-up gait: 4 = preset 5 (MK3 diagonal, 1.25 Hz: walked the room with the rear +8 mm feet, owner report 2026-10-29), 5 = preset 6 (MK3, sides together); set to 0 for the creator's FINAL gait
#define GAIT_BUTTONS 0   // 0 = A/B/C/D are the emotions (sit / wave FR / wave FL / lie);
                         //   the walk gait is picked by RIGHT-STICK FLICKS instead
                         //   (FLICK_MODES 1). Set to 1 to put the gaits back on buttons.

static uint8_t gaitSel = 0;
unsigned long blinkEndMs = 0;                // eyes blink (gaitSel+1) times on a change
                                             //   (declared extern above updateEyes)
static void selectGait(uint8_t i) {
  gaitSel = (i < GAIT_COUNT) ? i : 0;
  const GaitPreset& g = GAITS[gaitSel];
  G.gaitFreq  = g.wFreq;     G.strideDeg = g.wStride;  G.strokeDuty = g.wDuty;
  G.postureDeg = g.wPosture; G.ampRatio  = g.wRatio;   G.ampSlew    = g.wSlew;
  G.legPhaseDeg[FL] = GAIT_PHASE[gaitSel][0]; G.legPhaseDeg[FR] = GAIT_PHASE[gaitSel][1];
  G.legPhaseDeg[RL] = GAIT_PHASE[gaitSel][2]; G.legPhaseDeg[RR] = GAIT_PHASE[gaitSel][3];
  G.rearDutyAdd = 0.0f;                        // a preset is always the preset: no rear-return variation
  blinkEndMs = millis() + 300UL * (gaitSel + 1);
  logf("mode %s: walk f %.2f a %.1f d %.2f p %.1f q %.2f slew %.2f\n",
       g.name, g.wFreq, g.wStride, g.wDuty, g.wPosture, g.wRatio, g.wSlew);
}

// ----------------------------------------------------------------------------
// Servos (raw LEDC at 50 Hz)
// ----------------------------------------------------------------------------
static int lastUs[NSERVO];
// LEDC API differs by Arduino core. ALL envs are on the modern core now (3.x,
// pin-based ledcAttach/ledcWrite(pin,..) — the tune build needs it for WPA3), so
// the core-2.x branch below (channel-based ledcSetup/ledcAttachPin/ledcWrite(ch,..),
// left from the dropped Bluepad32 fork) is dead unless a build goes back to 2.x.
// Picked by ESP_ARDUINO_VERSION_MAJOR.
static void writeServo(int idx, int us) {
  us = constrain(us, SERVO_MIN_US, SERVO_MAX_US);
  if (us == lastUs[idx]) return;            // re-latching mid-pulse -> jitter
  lastUs[idx] = us;
  uint32_t maxDuty = (1UL << SERVO_RES_BITS) - 1;
  uint32_t duty = (uint32_t)(((uint64_t)us * maxDuty) / SERVO_PERIOD_US);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(SERVO_PIN[idx], duty);
#else
  ledcWrite(SERVO_CH[idx], duty);
#endif
}
static void writeLeg(int idx, float deg) {
  writeServo(idx, gc_leg_us(&CAL, idx, deg));   // gait_core.h — same path the sim uses
}
static void setupServos() {
  for (int i = 0; i < NSERVO; i++) {
    lastUs[i] = -1;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttach(SERVO_PIN[i], 50, SERVO_RES_BITS);     // auto-assigns a channel
#else
    ledcSetup(SERVO_CH[i], 50, SERVO_RES_BITS);
    ledcAttachPin(SERVO_PIN[i], SERVO_CH[i]);
#endif
    writeLeg(i, 0.0f);
#ifdef BOARD_ESP32CAM
    delay(180);        // power up the servos ONE AT A TIME: four snapping to centre together
                       // sag the 5 V rail and brown the board out at boot
#endif
  }
}
static void standPose() { for (int i = 0; i < NSERVO; i++) { legDeg[i] = 0.0f; writeLeg(i, 0.0f); } }   // legDeg too: the next animation starts from here, not from a stale angle
static void commandStand() { driveFwd = 0; driveTurn = 0; turning = false; }

// ----------------------------------------------------------------------------
// MPU6050 — minimal raw-I2C driver
// ----------------------------------------------------------------------------
static bool mpuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR); Wire.write(reg); Wire.write(val);
  return Wire.endTransmission() == 0;
}
static bool mpuReadRaw(int16_t v[6]) {
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDR, 14) != 14) return false;
  int16_t raw[7];
  for (int i = 0; i < 7; i++) raw[i] = (Wire.read() << 8) | Wire.read();
  v[0]=raw[0]; v[1]=raw[1]; v[2]=raw[2]; v[3]=raw[4]; v[4]=raw[5]; v[5]=raw[6];
  return true;
}
static void imuInit() {
  Wire.begin(MPU_SDA_PIN, MPU_SCL_PIN); Wire.setClock(400000);
  if (!mpuWrite(0x6B, 0x00)) { imuOk = false; logf("[imu] not found\n"); return; }
  mpuWrite(0x1A, 0x03); mpuWrite(0x1B, 0x00); mpuWrite(0x1C, 0x00); delay(50);
  int16_t v[6]; long sx = 0, sy = 0, sz = 0; int n = 0; double saf = 0;  // keep STILL: zero-cal
  for (int i = 0; i < 200; i++) if (mpuReadRaw(v)) {
    sx += v[3]; sy += v[4]; sz += v[5]; n++;
    // rest offset of gravity-removed forward accel (uses instantaneous accel pitch)
    float ax = v[0], ay = v[1], az = v[2];
    float pr = atan2f(-ax, sqrtf(ay*ay + az*az));
    saf += (double)(ax / ACCEL_LSB_PER_G + sinf(pr));
    delay(3);
  }
  if (n) { gBiasX = (float)sx / n; gBiasY = (float)sy / n; gBiasZ = (float)sz / n;
           aFwdBias = (float)(saf / n) * 9.81f; }
  imuOk = true; logf("[imu] MPU6050 ready (aFwdBias=%.3f)\n", aFwdBias);
}
static void imuUpdate(float dt) {
  if (!imuOk) { pitchDeg = rollDeg = 0; return; }
  int16_t v[6]; if (!mpuReadRaw(v)) return;
  float ax = v[0], ay = v[1], az = v[2];
  float gyX = (v[3] - gBiasX) / 131.0f, gyY = (v[4] - gBiasY) / 131.0f;
  float aPitch = atan2f(-ax, sqrtf(ay*ay + az*az)) * 57.2958f;
  float aRoll  = atan2f( ay, az)                   * 57.2958f;
  pitchDeg = COMP_ALPHA * (pitchDeg + gyY * dt) + (1 - COMP_ALPHA) * aPitch;
  rollDeg  = COMP_ALPHA * (rollDeg  + gyX * dt) + (1 - COMP_ALPHA) * aRoll;
  yawDeg  += ((v[5] - gBiasZ) / 131.0f) * dt;        // integrate gyro-Z for heading
  fallen = (fabsf(pitchDeg) > FALL_DEG) || (fabsf(rollDeg) > FALL_DEG);

  // forward-thrust proxy: gravity-removed fore-aft accel -> band-passed velocity
  float aFwd = (ax / ACCEL_LSB_PER_G + sinf(pitchDeg * DEG2RAD)) * 9.81f - aFwdBias;
  vFwd += aFwd * dt;
  vFwd -= vFwd * (dt / VFWD_TAU);          // leaky -> rejects DC drift, keeps stride band
  mVfwdSq  += (double)vFwd * vFwd;
  mAfwdSq  += (double)aFwd * aFwd;
  mPitchSq += (double)pitchDeg * pitchDeg;
  mRollSq  += (double)rollDeg * rollDeg;
  mRollSum += rollDeg;
  mN++;
  if (fallen && !mWasFallen) mFalls++;
  mWasFallen = fallen;
}

// ----------------------------------------------------------------------------
// Gait engine
// ----------------------------------------------------------------------------
// The waveform and the gait tick are gc_wave() / gc_update() in gait_core.h —
// the SAME code the MuJoCo twin runs (sim/tests/golden_trace.c proves this
// refactor is microsecond-identical to the hand-written version it replaced).
// All that is left here is handing the result to the servos.
#define TURN_DUTY_GAIN 0.30f   // turn stick -> left/right power-stroke duty split (the twin's
                               //   working turn authority; amplitude differencing alone barely yaws)
static void updateGait(float dt) {
  G.dutySplit = DUTY_SPLIT + TURN_DUTY_GAIN * driveTurn;
  gc_update(&G, &GS, driveFwd, driveTurn, pitchDeg, fallen ? 1 : 0, dt, legDeg);
  for (int i = 0; i < NSERVO; i++) writeLeg(i, legDeg[i]);
}

// ----------------------------------------------------------------------------
// Canned animations (shared) — gamepad buttons (default build) or 'A <n>' console
// command (tune build). An active animation OWNS the legs, overriding the gait.
// Poses are leg angles in writeLeg() degrees; first guesses, tune over telnet.
// ----------------------------------------------------------------------------
// The poses and the state machine are gc_poses / gc_anim_run() in gait_core.h,
// so the twin can replay them too — the get-up move especially, which the real
// robot already proved is CoM-sensitive (it needs the battery in the right place).
static int testIdx = -1;
static bool sitting = false, lying = false;                   // A toggles sit, D toggles lie
static void animStart(int a) { GS.wL = GS.wR = 0.0f; gc_anim_start(&GA, a); }   // gait loop is frozen during an animation: forget the old drive amplitude

// run the active animation; returns true while it controls the legs
// POWER GOVERNOR (2026-10-25): sit/lie/get-up/wave/dance move all four servos at once and the
// stall/inrush current browned the board out on the robot's supply (log: "cmd sit" -> BROWNOUT
// 2 s later, twice). Cap the TOTAL angular speed of an animation; all legs are scaled by the
// same factor, so the pose stays coordinated, it just takes longer. Walking is not governed.
#ifdef BOARD_ESP32CAM
#define ANIM_BUDGET_DEG_S  150.0f    // sum over the 4 legs (~37 deg/s each when all move)
#define DANCE_BUDGET_DEG_S 320.0f    // the choreography needs more; still trims the peaks
#else
#define ANIM_BUDGET_DEG_S  1e9f
#define DANCE_BUDGET_DEG_S 1e9f
#endif
static bool animRun(float dt) {
  float before[NSERVO];
  for (int i = 0; i < NSERVO; i++) before[i] = legDeg[i];
  int previousAnim = GA.anim, previousExitStage = GA.exitStage;
  if (!gc_anim_run(&GQ, &GA, dt, legDeg)) return false;
  float total = 0;
  for (int i = 0; i < NSERVO; i++) total += fabsf(legDeg[i] - before[i]);
  float budget = (GA.anim == GC_ANIM_DANCE ? DANCE_BUDGET_DEG_S : ANIM_BUDGET_DEG_S) * dt;
  if (total > budget && total > 0.0f) {
    float k = budget / total;
    for (int i = 0; i < NSERVO; i++) legDeg[i] = before[i] + (legDeg[i] - before[i]) * k;
  }
  for (int i = 0; i < NSERVO; i++) writeLeg(i, legDeg[i]);
  if (previousAnim == GC_ANIM_BEGOUT && GA.exitStage != previousExitStage)
    logf("begout stage %d complete: commanded FL %.1f FR %.1f RL %.1f RR %.1f us %d %d %d %d\n",
         previousExitStage + 1, legDeg[FL], legDeg[FR], legDeg[RL], legDeg[RR],
         lastUs[FL], lastUs[FR], lastUs[RL], lastUs[RR]);
  return true;
}

// ----------------------------------------------------------------------------
// ESP-NOW gamepad (default mode) — minirobo controller/, broadcast, no pairing
// ----------------------------------------------------------------------------
#ifndef TUNE_MODE
static unsigned long lastInputMs = 0;

#ifdef BOARD_ESP32CAM
// After a BROWNOUT/panic/watchdog reset the hub may still be streaming "walk" because the key is
// still held; obeying it would walk straight into the next reset. So after an unexpected reset the
// board stands still until it receives one neutral command (the key was released). Normal boots and
// the 1 s failsafe do not arm this: a fresh key press must always work.
static bool neutralLockChecked = false, neutralLock = false;
void webOnDrive(float fwd, float turn) {
  testIdx = -1;
  if (!isfinite(fwd) || !isfinite(turn)) fwd = turn = 0.0f;   // NaN would reach the servo math
  if (!neutralLockChecked) {
    neutralLockChecked = true;
    esp_reset_reason_t rr = esp_reset_reason();
    neutralLock = (rr == ESP_RST_BROWNOUT || rr == ESP_RST_PANIC || rr == ESP_RST_INT_WDT || rr == ESP_RST_TASK_WDT);
    if (neutralLock) logf("neutral lock armed (unexpected reset): ignoring drive until it is released\n");
  }
  if (neutralLock) {
    if (fabsf(fwd) > 0.05f || fabsf(turn) > 0.05f) { lastInputMs = millis(); return; }   // still held: stay put
    neutralLock = false;
    logf("neutral lock released\n");
  }
  driveFwd = fwd;
  driveTurn = turn;
  turning = false;
  holdCenter = false;
  alignHold = false;
  if (fabsf(fwd) > 0.1f || fabsf(turn) > 0.1f) {
    // same safe transitions as the gamepad: rise from sit/lie before walking
    if (GA.anim == GC_ANIM_BEG) animStart(GC_ANIM_BEGOUT);
    else if (GA.anim == GC_ANIM_SIT) animStart(GC_ANIM_GETUP);
    else if (GA.anim == GC_ANIM_LIE || GA.anim == GC_ANIM_DANCE || GA.anim == GC_ANIM_LAUGH || GA.anim >= GC_ANIM_WAKE) animStart(GC_ANIM_STAND);
    sitting = false;
    lying = false;
  }
  lastInputMs = millis();
}
void webOnHalt() {
  testIdx=-1; commandStand(); holdCenter=false; alignHold=false;
  animStart(GC_ANIM_PAUSE);
}
void webOnAnim(int animCode) {
  testIdx = -1;
  if (GA.anim == GC_ANIM_BEG && animCode == GC_ANIM_STAND) animCode = GC_ANIM_BEGOUT;   // from the reclined pose: staged, slow rise with front legs down first
  driveFwd = 0;
  driveTurn = 0;
  holdCenter = false;
  alignHold = false;
  lastInputMs = millis();
  animStart(animCode);
}
void webOnCalibrate(bool hold) {
  testIdx = -1;
  holdCenter = hold;
  commandStand();
  standPose();
}
void webOnGait(int gaitIdx) {
  if (gaitIdx < 0 || gaitIdx >= GAIT_COUNT) return;
  // Selecting a preset never starts walking; keep the current resting pose.
  driveFwd = driveTurn = 0.0f;
  turning = false;
  lastInputMs = millis();
  selectGait(gaitIdx);
}
// Leg phase offsets for gait experiments (RAM only; selecting any gait restores that preset's phase).
bool webOnPhase(float fl, float fr, float rl, float rr) {
  const float v[4] = { fl, fr, rl, rr };
  for (int i = 0; i < 4; i++) if (!isfinite(v[i]) || v[i] < 0 || v[i] > 360) return false;
  driveFwd = driveTurn = 0;
  turning = false;
  lastInputMs = millis();
  G.legPhaseDeg[FL] = fl; G.legPhaseDeg[FR] = fr; G.legPhaseDeg[RL] = rl; G.legPhaseDeg[RR] = rr;
  return true;
}
// Live tuning of the "Pedir" (beg) pose over UDP "B <front> <rear> [burstDegS burstTo]": front legs -80..90 deg (up and forward), rear legs 0..62 deg,
// optional entry throw: sweep rate 20..400 deg/s and its target angle 0..56. RAM only (a reboot restores the defaults); the held pose follows the new targets.
bool webOnBegTune(float front, float rear, float burstDegS, float burstTo) {
  if (!isfinite(front) || !isfinite(rear) || front < -80.0f || front > 90.0f || rear < 0.0f || rear > 62.0f) return false;
  if (isfinite(burstDegS) && isfinite(burstTo) && (burstDegS < 20.0f || burstDegS > 400.0f || burstTo < 0.0f || burstTo > 56.0f)) return false;
  GQ.beg[GC_FL] = GQ.beg[GC_FR] = front;
  GQ.beg[GC_RL] = GQ.beg[GC_RR] = rear;
  if (isfinite(burstDegS) && isfinite(burstTo)) { GQ.begBurstDegS = burstDegS; GQ.begBurstTo = burstTo; }
  lastInputMs = millis();
  logf("beg pose tuned: front %.1f rear %.1f burst %.0f deg/s to %.1f\n", front, rear, GQ.begBurstDegS, GQ.begBurstTo);
  return true;
}
// Live gait adjustment, adapted from the creator's tune console. No drive is started.
bool webOnTune(float freq, float stride, float duty, float posture, float ratio) {
  if (!isfinite(freq) || !isfinite(stride) || !isfinite(duty) || !isfinite(posture) || !isfinite(ratio)) return false;
  if (freq < .2f || freq > 3 || stride < 5 || stride > 65 || duty < .1f || duty > .9f || posture < -20 || posture > 20 || ratio < .6f || ratio > 1.4f) return false;
  if (2 * stride * freq * fmaxf(1, ratio) / (1 - duty) > 503.01f) return false;
  {                                                      // reach limit from the creator's search: |posture| + larger amplitude <= 60 deg
    const float r = fmaxf(ratio, 0.05f);
    if (fabsf(posture) + stride * 2.0f * fmaxf(r, 1.0f) / (1.0f + r) > 60.01f) return false;
  }
  driveFwd = driveTurn = 0;
  turning = false;
  lastInputMs = millis();
  G.gaitFreq = freq; G.strideDeg = stride; G.strokeDuty = duty;
  G.postureDeg = posture; G.ampRatio = ratio; gaitSel = GAIT_COUNT; // telemetry GAIT_COUNT+1 = custom
  G.rearDutyAdd = 0.0f;   // a plain "G" is the old adjustment: rear legs back to the common duty
  return true;
}
// Rear-return variation (panel buttons 1-5, 2026-10-30): UDP "R <add>", sent by the hub AFTER "G" (which zeroes it).
// The rear legs get duty + add, so their fast return is shorter/faster than the front's. RAM only.
// Limits: 0..0.15, rear duty <= 0.85 and the rear return stroke <= 503 deg/s (same servo ceiling as webOnTune).
bool webOnRearDuty(float add) {
  if (!isfinite(add) || add < 0.0f || add > 0.15f) return false;
  const float dr = G.strokeDuty + add;
  if (dr > 0.85f) return false;
  const float r = fmaxf(G.ampRatio, 0.05f), ampRear = G.strideDeg * 2.0f / (1.0f + r);
  if (2.0f * ampRear * G.gaitFreq / (1.0f - dr) > 503.01f) return false;
  driveFwd = driveTurn = 0;
  turning = false;
  lastInputMs = millis();
  G.rearDutyAdd = add;
  logf("rear return: duty front %.2f rear %.2f (rear return %.0f deg/s)\n", G.strokeDuty, dr, 2.0f * ampRear * G.gaitFreq / (1.0f - dr));
  return true;
}
float webGetRearDuty() { return G.rearDutyAdd; }
float webGetLegPhase(int i) { return (i >= 0 && i < NSERVO) ? G.legPhaseDeg[i] : 0.0f; }
float webGetGaitParam(int i) {
  switch (i) { case 0: return G.gaitFreq; case 1: return G.strideDeg;
    case 2: return G.strokeDuty; case 3: return G.postureDeg; default: return G.ampRatio; }
}
// Leg wiggle (-300 us, +300 us, centre) advanced from loop() so Wi-Fi, UDP and the
// failsafe keep running during the test (it used to block with delay()).

static unsigned long testT0 = 0;
static bool manualTest = false;
static float manualTestDeg[NSERVO] = {0};
void webOnManualServo(int idx, int step) {
  if (idx < 0 || idx >= NSERVO || (step != -5 && step != 5)) return;
  webOnCalibrate(true);
  alignHold = false;
  manualTestDeg[idx] = constrain(manualTestDeg[idx] + step, -85.0f, 85.0f);
  testIdx = idx; testT0 = millis(); manualTest = true;
}
void webOnTestServo(int idx) {
  manualTest = false;
  if (idx < 0 || idx >= NSERVO) return;
  driveFwd = 0;
  driveTurn = 0;
  GA.anim = GC_ANIM_NONE;
  holdCenter = true;
  testIdx = idx;
  testT0 = millis();
}
static bool testServoTask() {
  if (testIdx < 0) return false;
  unsigned long e = millis() - testT0;
  int c = CAL.center_us[testIdx];
  if (manualTest) {
    // One-second bounded test, then neutral even if browser/network disappears.
    if (e < 1000) writeLeg(testIdx, manualTestDeg[testIdx]);
    else { writeServo(testIdx, c); testIdx = -1; manualTest = false; }
    return true;
  }
  if (e < 250)      writeServo(testIdx, c - 300);
  else if (e < 500) writeServo(testIdx, c + 300);
  else { writeServo(testIdx, c); testIdx = -1; }
  return true;
}
void webOnNudgeTrim(int idx, int deltaUs) {
  if (idx < 0 || idx >= NSERVO) return;
  CAL.center_us[idx] = constrain(CAL.center_us[idx] + deltaUs, 1000, 2000);
  lastUs[idx] = -1;
  holdCenter = true;
  writeServo(idx, CAL.center_us[idx]);
}
int webGetTrimUs(int idx) {
  if (idx < 0 || idx >= NSERVO) return 1500;
  return CAL.center_us[idx];
}
void webSetTrimUs(int idx, int us) {
  if (idx < 0 || idx >= NSERVO) return;
  CAL.center_us[idx] = constrain(us, 1000, 2000);
  lastUs[idx] = -1;
}
int webGetLastUs(int idx) {
  if (idx < 0 || idx >= NSERVO) return 1500;
  return lastUs[idx];
}
float webGetLegDeg(int idx) {
  if (idx < 0 || idx >= NSERVO) return 0.0f;
  return legDeg[idx];
}
int webGetGaitSel() { return gaitSel; }
float webGetDriveFwd() { return driveFwd; }
float webGetDriveTurn() { return driveTurn; }
#ifdef K9_SPEAKER_GPIO
unsigned short webScratchHz() { return GA.anim==GC_ANIM_SCRATCH ? gc_scratch_hz(GA.t) : 0; }
int webActivity() { return holdCenter ? -1 : GA.anim; }
float webActivityTime() { return GA.t; }
float webLaughTime() { return GA.anim == GC_ANIM_LAUGH && !holdCenter && !alignHold ? GA.t : -1.0f; }
bool webDanceActive() { return GA.anim == GC_ANIM_DANCE && !holdCenter && !alignHold; }
#endif
bool webGetHoldCenter() { return holdCenter; }
#endif

// wire protocol — must match controller/firmware/src/main.cpp
#define GP_MAGIC 0xC3
enum : uint8_t { BTN_A=1<<0, BTN_B=1<<1, BTN_C=1<<2, BTN_D=1<<3, BTN_L=1<<4, BTN_R=1<<5 };
typedef struct __attribute__((packed)) {
  uint8_t magic;        // GP_MAGIC — filter on this
  uint8_t seq;
  uint8_t buttons;      // bitfield (BTN_*)
  int16_t lx, ly;       // -512..511, centered, deadbanded (+y = stick up)
  int16_t rx, ry;
} gamepad_packet_t;

// Latest frame, written by the ESP-NOW callback (WiFi task), read by loop().
static portMUX_TYPE pktMux = portMUX_INITIALIZER_UNLOCKED;
static gamepad_packet_t rxPkt;
static volatile bool rxFresh = false;

#if ESP_ARDUINO_VERSION_MAJOR >= 3
static void onEspNowRecv(const esp_now_recv_info_t*, const uint8_t* data, int len) {
#else
static void onEspNowRecv(const uint8_t*, const uint8_t* data, int len) {
#endif
  if (len != sizeof(gamepad_packet_t)) return;
  const gamepad_packet_t* p = (const gamepad_packet_t*)data;
  if (p->magic != GP_MAGIC) return;
  portENTER_CRITICAL(&pktMux);
  rxPkt = *p;
  rxFresh = true;
  portEXIT_CRITICAL(&pktMux);
}

static float deadzone(float v) { return (fabsf(v) < STICK_DZ) ? 0.0f : v; }
static void readGamepad(const gamepad_packet_t& gp) {
  // LEFT stick Y = forward/back, RIGHT stick X = turn (same layout as car3;
  // the gamepad already sends +y = stick up)
  driveFwd  = constrain(-deadzone(gp.ly / STICK_FS), -1.0f, 1.0f);   // stick forward = walk forward (was inverted)
  driveTurn = constrain(deadzone(gp.rx / STICK_FS), -1.0f, 1.0f);

  // GAIT MODE by RIGHT-STICK FLICKS (2026-09-16): "accept obvious forward commands on the
  // right stick to switch modes. 4 up is mode 4 and so on." The right stick's Y does
  // nothing else, so: push it firmly FORWARD and let it return N times, pause, and mode N
  // loads (the eyes blink N times to confirm). "Obvious" = past FLICK_ON, and a flick only
  // counts again once the stick has come back inside FLICK_OFF, so holding it up or
  // wobbling near the threshold counts once. Forward is the SAME sign as the drive stick.
  // LIE/STAND by RIGHT-STICK UP x3. This gesture WAS the dance (2026-09-19), but
  // starting a 10 s track on the third flick of three is not something a human can
  // time — "I'm finding it difficult to time it right" — so the dance moved to the
  // D button, which is exact, and lie moved here off D rather than be lost.
  // Same gesture as the gait flicks below, so only one of the two can be built at a
  // time; the gait is locked, so this has it.
#if !FLICK_MODES
  {
    static int  dflicks = 0;
    static bool darmed  = true;
    static unsigned long lastDanceFlickMs = 0;
    float up = -gp.ry / STICK_FS;
    if (dflicks > 0 && millis() - lastDanceFlickMs > DANCE_WINDOW_MS) dflicks = 0;
    if (darmed && up > FLICK_ON) {
      darmed = false; lastDanceFlickMs = millis();
      if (++dflicks >= DANCE_FLICKS) {
        dflicks = 0;
        if (lying) { animStart(GC_ANIM_STAND); lying = false; }
        else { animStart(GC_ANIM_LIE); lying = true; sitting = false; }
        logf("lie %s (right stick up x3)\n", lying ? "down" : "-> stand");
      }
    } else if (!darmed && up < FLICK_OFF) { darmed = true; }
  }
#endif

#if FLICK_MODES
  {
    static int  flicks = 0;
    static bool armed  = true;
    static unsigned long lastFlickMs = 0;
    float up = -gp.ry / STICK_FS;
    if (armed && up > FLICK_ON)        { flicks++; armed = false; lastFlickMs = millis(); }
    else if (!armed && up < FLICK_OFF) { armed = true; }
    if (flicks > 0 && armed && millis() - lastFlickMs > FLICK_GAP_MS) {
      selectGait((uint8_t)(constrain(flicks, 1, 4) - 1));
      flicks = 0;
    }
  }
#endif

  // moving the stick cancels a held pose (sit/lie) and stands back up to walk
  if (fabsf(driveFwd) > 0.25f || fabsf(driveTurn) > 0.25f) {
    if (GA.anim == GC_ANIM_BEG) { animStart(GC_ANIM_BEGOUT); sitting = false; }
    else if (GA.anim == GC_ANIM_SIT) { animStart(GC_ANIM_GETUP); sitting = false; }   // deep sit -> safe rise
    else if (GA.anim == GC_ANIM_LIE) { animStart(GC_ANIM_STAND); lying = false; }
    else if (GA.anim == GC_ANIM_DANCE || GA.anim == GC_ANIM_LAUGH || GA.anim >= GC_ANIM_WAKE) animStart(GC_ANIM_STAND);   // drive = cut the music short
  }

  // face buttons (rising-edge). GAIT_BUTTONS 1: A/B/C/D = the four gait candidates.
  //   GAIT_BUTTONS 0: A toggle sit/stand, B wave FR, C wave FL, D DANCE
  //   (lie/stand moved to the right-stick flicks above when D became the dance)
  static uint8_t prevBtn = 0;
  uint8_t edge = gp.buttons & ~prevBtn;
#if GAIT_BUTTONS                 // BENCH: the buttons pick a gait, not a mood
  if (edge & BTN_A) selectGait(0);
  if (edge & BTN_B) selectGait(1);
  if (edge & BTN_C) selectGait(2);
  if (edge & BTN_D) selectGait(3);
#else
  if (edge & BTN_A) { if (sitting) { animStart(GC_ANIM_GETUP); sitting = false; }
                      else { animStart(GC_ANIM_SIT); sitting = true; lying = false; } }
  if (edge & BTN_D) {                       // DANCE — press it ON the downbeat
    sitting = false; lying = false;
    animStart(GC_ANIM_DANCE);
    logf("DANCE: 120 BPM, 5 bars, 10.0 s\n");
  }
  if (edge & BTN_B) animStart(GC_ANIM_WAVE_FR);
  if (edge & BTN_C) animStart(GC_ANIM_WAVE_FL);
#endif
  prevBtn = gp.buttons;

  lastInputMs = millis();
}
#endif

// ----------------------------------------------------------------------------
// TUNE_MODE hooks — net_console.h (the shared module) drives WiFi/OTA/
// telnet and calls these; we supply the robot's command set + telemetry line.
// ----------------------------------------------------------------------------
#ifdef TUNE_MODE
#ifdef AUTO_TRIM
static const char* BANNER =
  "\r\nwalker TRIM console — legs hang straight at their centres.\r\n"
  "  f <deg>  front-left    g <deg>  front-right\r\n"
  "  b <deg>  back-left     n <deg>  back-right     (+ = toward the nose)\r\n"
  "  z        all to 0      ?        show offsets\r\n";
#else
static const char* BANNER_UNUSED_IN_TRIM =
  "\r\nwalker tune console — commands:\r\n"
  "  w <-1..1> forward   r <-1..1> turn   x stop/abort   T <deg> turn-to-angle (gyro)\r\n"
  "  f <Hz> freq   a <deg> stride   p <deg> posture   k <gain> pitch   g <gain> turn\r\n"
  "  d <.05-.95> power-stroke duty (slow push/fast return)\r\n"
  "  q <.6-1.4> front/rear amp ratio   u <-.4-.4> L/R duty split\r\n"
  "  o <leg*1000+deg> set leg phase (0FL 1FR 2RL 3RR)   j <0-3> jog one servo\r\n"
  "  h CENTER: hold every leg at 0 deg (leg mounting / trim)\r\n"
  "  c <leg*10000+us> set leg center us\r\n"
  "  A <1-7> anim (1stand 2sit 3lie 4waveFR 5waveFL 6getup 7DANCE)  P <leg*1000+deg+500> pose\r\n"
  "  E <0-2> eyes (0 off 1 breathe 2 on)\r\n"
  "  --- bench sequences (they drive themselves; x aborts) ---\r\n"
  "  s <1|2|0|3> STEP reel: 1 unloaded, 2 loaded, 0 both, 3 single-leg reel (held in the air)\r\n"
  "  K <slot 1-8> store current params+drive into a slot   L list slots\r\n"
  "  N <sec> per-slot run length     R <0|1-8> SCRIPT: 0 = play every slot\r\n";
#define BANNER BANNER_UNUSED_IN_TRIM
#endif

// ===========================================================================
// Canned bench sequences — everything the sim project will ever ask the robot
// to do, so the whole calibration + round-trip programme costs ZERO reflashes
// after this build goes on once over USB.
//
// THE EYES ARE THE SYNC TRACK. Both sequences drive the eye LEDs as an optical
// timecode straight into the camera: during the step reel the eyes are ON for
// every non-zero commanded angle and OFF at zero, so the footage carries a
// square wave frame-aligned to the commands; the script blinks the slot number
// before each run, so an overhead take self-labels which parameter set is in
// frame. Keep the eyes in shot.
// ===========================================================================
enum { SEQ_NONE = 0, SEQ_STEP_UNLOADED, SEQ_STEP_LOADED, SEQ_STEP_BOTH, SEQ_SCRIPT, SEQ_REEL_SINGLE };
static int      seqKind = SEQ_NONE;
static float    seqT    = 0;        // seconds since the sequence started
static int      seqIdx  = -1;       // index of the event currently applied
static int      seqEyes = 0;        // eye override while a sequence runs
static int      seqBlinks = 0;      // remaining blinks in a slot marker

#define STEP_SETTLE_S 1.0f          // quiet lead-in, so the fit has a zero baseline
#define STEP_HOLD_S   0.7f          // > 5x an MG90S 30 deg transit: full settle each way
#define STEP_REPS     2
static const float STEP_AMP_UNLOADED[] = { 10, 30, 60 };   // 60 deg catches the velocity limit
static const float STEP_AMP_LOADED  [] = { 10, 30 };       // loaded steps catch torque-limited slew
#define N_AMP_UNLOADED 3
#define N_AMP_LOADED   2
#define EVENTS_PER_AMP (STEP_REPS * 4)                     // +a, 0, -a, 0

// Decode event i of a reel into (which legs move, to what angle).
// Unloaded: FL alone, robot propped so the legs hang free.
// Loaded:   phase 1 = FL alone while the other three hold the body up (a real
//           but survivable load); phase 2 = both front legs together (more load).
static bool stepEvent(int kind, int i, uint8_t* mask, float* deg) {
  const float* amps; int namp;
  if (kind == SEQ_STEP_UNLOADED) { amps = STEP_AMP_UNLOADED; namp = N_AMP_UNLOADED; }
  else                           { amps = STEP_AMP_LOADED;   namp = N_AMP_LOADED;   }
  int perPhase = namp * EVENTS_PER_AMP;
  int nphase   = (kind == SEQ_STEP_UNLOADED) ? 1 : 2;
  if (i >= perPhase * nphase) return false;
  int phase = i / perPhase;  int j = i % perPhase;
  float a = amps[j / EVENTS_PER_AMP];
  switch (j % 4) { case 0: *deg =  a; break;  case 2: *deg = -a; break;
                   default: *deg = 0; }
  *mask = (kind == SEQ_STEP_UNLOADED || phase == 0) ? (1 << FL) : ((1 << FL) | (1 << FR));
  return true;
}

// ---- parameter slots: a whole candidate slate, pushed over telnet ---------
#define NSLOT 8
typedef struct {
  uint8_t used;
  float freq, stride, posture, duty, ratio, split, gain;
  float phase[NSERVO];
  float fwd, turn;
} gait_slot;
static gait_slot SLOT[NSLOT + 1];      // 1-based
static float slotRunS  = 10.0f;        // seconds of walking per slot ('N')
#define SLOT_SETTLE_S 3.0f             // stand + eye marker between runs
#define SCRIPT_LEADIN_S 10.0f          // legs straight, eyes off, before the first slot

static void slotStore(int i) {
  gait_slot* q = &SLOT[i];
  q->used = 1;
  q->freq = G.gaitFreq; q->stride = G.strideDeg; q->posture = G.postureDeg;
  q->duty = G.strokeDuty; q->ratio = G.ampRatio; q->split = G.dutySplit;
  q->gain = G.turnGain;
  for (int k = 0; k < NSERVO; k++) q->phase[k] = G.legPhaseDeg[k];
  q->fwd = driveFwd; q->turn = driveTurn;
}
static void slotApply(int i) {
  const gait_slot* q = &SLOT[i];
  G.gaitFreq = q->freq; G.strideDeg = q->stride; G.postureDeg = q->posture;
  G.strokeDuty = q->duty; G.ampRatio = q->ratio; G.dutySplit = q->split;
  G.turnGain = q->gain;
  for (int k = 0; k < NSERVO; k++) G.legPhaseDeg[k] = q->phase[k];
}
// The C6 validation slate, preloaded so `R 0` plays the whole acceptance run
// straight out of the box (plan section 3, rung C6).
//
// Slot 5 is a TURN, and it uses the new dutySplit knob rather than the
// amplitude-differencing turn the robot has always had. That is not a
// preference, it is a measurement: in the twin, a turnGain turn yaws at
// 1.2 +- 7.9 deg/s (i.e. it does not really turn, and does not repeat) while
// splitting the power-stroke duty left/right yaws at ~5.7 deg/s with a spread
// near zero and a third of the drift off the spot. Calibrating against a
// quantity the robot cannot repeat would just be fitting noise. Note also that
// turnGain above 1.0 does nothing at full stick — tL = clamp(fwd + gain*turn)
// is already saturated — which is why slot 5 turns the gain DOWN and lets the
// duty split do the work.
static void slotPreload() {
  // PHASE-3 SLATE (sim/results/slate_firmware.json, predictions in
  // sim/results/predictions.md). Every gait here was searched by the twin;
  // the numbers are the twin's, pasted, so the bench tests the sheet.
  gaitDefaults();
  driveFwd = 1.0f; driveTurn = 0.0f;
  slotStore(1);                                   // 1: current leg, firmware defaults
  G.gaitFreq = 2.296f; G.strideDeg = 22.36f; G.strokeDuty = 0.759f; G.postureDeg = -2.95f; G.ampRatio = 1.176f;
  G.legPhaseDeg[FL] = 0; G.legPhaseDeg[FR] = 188.8f; G.legPhaseDeg[RL] = 188.8f; G.legPhaseDeg[RR] = 0;
  slotStore(2);                                   // 2: current leg, searched robust gait
  G.gaitFreq = 2.153f; G.strideDeg = 43.63f; G.strokeDuty = 0.891f; G.postureDeg = 0.68f; G.ampRatio = 0.980f;
  G.legPhaseDeg[FL] = 0; G.legPhaseDeg[FR] = 182.3f; G.legPhaseDeg[RL] = 182.3f; G.legPhaseDeg[RR] = 0;
  slotStore(3);                                   // 3: NEW 70 mm leg, speed gait (the pick)
  G.gaitFreq = 1.389f; G.strideDeg = 23.37f; G.strokeDuty = 0.851f; G.postureDeg = -1.36f; G.ampRatio = 1.026f;
  G.legPhaseDeg[FL] = 0; G.legPhaseDeg[FR] = 183.5f; G.legPhaseDeg[RL] = 183.5f; G.legPhaseDeg[RR] = 0;
  slotStore(4);                                   // 4: new leg, efficiency gait
  G.gaitFreq = 2.153f; G.strideDeg = 43.63f; G.strokeDuty = 0.891f; G.postureDeg = 0.68f; G.ampRatio = 0.980f;
  G.legPhaseDeg[FL] = 0; G.legPhaseDeg[FR] = 182.3f; G.legPhaseDeg[RL] = 182.3f; G.legPhaseDeg[RR] = 0;
  driveFwd = -1.0f;
  slotStore(5);                                   // 5: new leg, speed gait, REVERSE
  gaitDefaults(); driveFwd = driveTurn = 0;
}
static int slotCount() { int n = 0; for (int i = 1; i <= NSLOT; i++) n += SLOT[i].used; return n; }

static void seqStop(const char* why) {
  if (seqKind == SEQ_NONE) return;
  seqKind = SEQ_NONE; seqIdx = -1; seqEyes = 0; seqBlinks = 0;
  driveFwd = driveTurn = 0;
  animStart(GC_ANIM_STAND);
  logf("seq: %s\n", why);
}
static void seqStart(int kind) {
  if (kind == SEQ_SCRIPT && slotCount() == 0) { logf("R: no slots stored (K 1..8)\n"); return; }
  seqKind = kind; seqT = 0; seqIdx = -1; seqEyes = 0; seqBlinks = 0;
  driveFwd = driveTurn = 0;
  GA.anim = GC_ANIM_NONE;
  for (int i = 0; i < NSERVO; i++) legDeg[i] = 0;
  logf("seq %d start\n", kind);
}

// Advance a sequence. Returns true if it wrote the legs itself (step reels);
// the script returns false and lets the ordinary gait path run underneath.
int seqEyesMode() { return seqEyes; }

static bool seqTask(float dt) {
  if (seqKind == SEQ_NONE) return false;
  seqT += dt;

  if (seqKind == SEQ_SCRIPT) {
    // every bench sequence opens with the legs held STRAIGHT for 10 s
    if (seqT < SCRIPT_LEADIN_S) {
      for (int i = 0; i < NSERVO; i++) { legDeg[i] = 0; writeLeg(i, 0); }
      driveFwd = driveTurn = 0; seqEyes = 1; return true;
    }
    // slot i occupies [i*(SETTLE+run), ...): SETTLE seconds standing (with an
    // i-blink marker), then `slotRunS` seconds driving that slot's command.
    float period = SLOT_SETTLE_S + slotRunS;
    int   order[NSLOT]; int n = 0;
    for (int i = 1; i <= NSLOT; i++) if (SLOT[i].used) order[n++] = i;
    int k = (int)((seqT - SCRIPT_LEADIN_S) / period);
    if (k >= n) { seqStop("script done"); return false; }
    float u = (seqT - SCRIPT_LEADIN_S) - k * period;
    int slot = order[k];
    if (k != seqIdx) {                       // entering a new slot
      seqIdx = k; slotApply(slot);
      GS.gaitPhase = 0;                      // every run starts at a KNOWN phase,
                                             //  so sim and reality begin in step
      logf("seq slot %d: f=%.2f a=%.1f d=%.2f q=%.2f u=%.2f fwd=%.2f turn=%.2f\n",
           slot, G.gaitFreq, G.strideDeg, G.strokeDuty, G.ampRatio, G.dutySplit,
           SLOT[slot].fwd, SLOT[slot].turn);
      seqBlinks = slot;                      // eye marker = the slot number
    }
    if (u < SLOT_SETTLE_S) {                 // stand still, blink the marker
      driveFwd = driveTurn = 0;
      float bt = u * 4.0f;                   // 4 blink slots per second
      int   bi = (int)bt;
      seqEyes = (bi < seqBlinks * 2 && (bi & 1) == 0) ? 2 : 1;
    } else {                                 // drive this slot's command
      driveFwd = SLOT[slot].fwd; driveTurn = SLOT[slot].turn;
      seqEyes = 1;                           // steady off while walking
    }
    return false;                            // let updateGait() do the work
  }

  // ---- single-leg reel: gc_reel_single() in gait_core.h IS the waveform ----
  if (seqKind == SEQ_REEL_SINGLE) {
    float deg; int on;
    if (!gc_reel_single(seqT, &deg, &on)) { seqStop("single-leg reel done"); return false; }
    int sec = (int)seqT;
    if (sec != seqIdx) { seqIdx = sec; logf("reel t=%d deg=%.1f\n", sec, deg); }
    for (int k = 0; k < NSERVO; k++) {            // FL follows the reel, the
      legDeg[k] = (k == FL) ? deg : 0.0f;         //  other three stay straight
      writeLeg(k, legDeg[k]);
    }
    seqEyes = on ? 2 : 1;                         // the sync track
    return true;
  }

  // ---- step reels: we own the legs outright -------------------------------
  int kind = seqKind;
  float t = seqT - STEP_SETTLE_S;
  if (kind == SEQ_STEP_BOTH) {
    // reel 1, a 5 s gap to reposition the robot, then reel 2
    int n1 = N_AMP_UNLOADED * EVENTS_PER_AMP;
    float end1 = STEP_SETTLE_S + n1 * STEP_HOLD_S;
    if (seqT < end1) kind = SEQ_STEP_UNLOADED;
    else if (seqT < end1 + 5.0f) {           // gap: legs at zero, eyes breathing
      for (int i = 0; i < NSERVO; i++) { legDeg[i] = 0; writeLeg(i, 0); }
      seqEyes = 0; return true;
    } else { kind = SEQ_STEP_LOADED; t = seqT - end1 - 5.0f - STEP_SETTLE_S; }
  }
  if (t < 0) {                               // settle: zero baseline for the fit
    for (int i = 0; i < NSERVO; i++) { legDeg[i] = 0; writeLeg(i, 0); }
    seqEyes = 1; return true;
  }
  int i = (int)(t / STEP_HOLD_S);
  uint8_t mask; float deg;
  if (!stepEvent(kind, i, &mask, &deg)) { seqStop("step reel done"); return false; }
  if (i != seqIdx) {
    seqIdx = i;
    logf("step %d: mask=%u deg=%.0f t=%.3f\n", i, (unsigned)mask, deg, seqT);
  }
  for (int k = 0; k < NSERVO; k++) {
    legDeg[k] = (mask & (1 << k)) ? deg : 0.0f;
    writeLeg(k, legDeg[k]);
  }
  seqEyes = (deg != 0.0f) ? 2 : 1;           // ON at every non-zero step: the sync track
  return true;
}

static void printState() {
  logf("state: fwd=%.2f turn=%.2f | freq=%.2f stride=%.1f post=%.1f kp=%.2f g=%.2f duty=%.2f | "
       "imu=%d pitch=%.1f roll=%.1f fall=%d\n",
       driveFwd, driveTurn, G.gaitFreq, G.strideDeg, G.postureDeg, G.kpPitch, G.turnGain, G.strokeDuty,
       imuOk, pitchDeg, rollDeg, fallen);
  logf("phase off (deg): FL=%.0f FR=%.0f RL=%.0f RR=%.0f\n",
       G.legPhaseDeg[FL], G.legPhaseDeg[FR], G.legPhaseDeg[RL], G.legPhaseDeg[RR]);
  logf("center us: FL=%d FR=%d RL=%d RR=%d  hold=%d\n",
       CAL.center_us[FL], CAL.center_us[FR], CAL.center_us[RL], CAL.center_us[RR], holdCenter);
  logf("ampRatio=%.2f dutySplit=%.2f | seq=%d t=%.1f slots=%d runS=%.0f\n",
       G.ampRatio, G.dutySplit, seqKind, seqT, slotCount(), slotRunS);
}

#ifdef AUTO_TRIM
// -e trim: the legs hang straight at their centres and stay there; four
// letters nudge one leg each, in DEGREES, + toward the nose:
//   f <deg>  front-left     g <deg>  front-right
//   b <deg>  back-left      n <deg>  back-right
//   z        all back to 0  ?        show the four offsets and the us they make
static float trimDeg[NSERVO] = { 0, 0, 0, 0 };
static bool trimCmd(char c, float v) {
  int leg = (c == 'f') ? FL : (c == 'g') ? FR : (c == 'b') ? RL : (c == 'n') ? RR : -1;
  if (leg >= 0) { trimDeg[leg] = constrain(v, -45.0f, 45.0f); }
  else if (c == 'z') { for (int i = 0; i < NSERVO; i++) trimDeg[i] = 0; }
  else if (c == '?') {}
  else return false;
  logf("trim deg  FL %+.1f  FR %+.1f  RL %+.1f  RR %+.1f   (us %d %d %d %d)\n",
       trimDeg[FL], trimDeg[FR], trimDeg[RL], trimDeg[RR],
       gc_leg_us(&CAL, FL, trimDeg[FL]), gc_leg_us(&CAL, FR, trimDeg[FR]),
       gc_leg_us(&CAL, RL, trimDeg[RL]), gc_leg_us(&CAL, RR, trimDeg[RR]));
  return true;
}
#endif

void onConsoleCmd(char c, float v) {           // called by net_console.h
#ifdef AUTO_TRIM
  if (trimCmd(c, v)) return;
#endif
  switch (c) {
    case 'w': driveFwd  = constrain(v, -1.0f, 1.0f); break;   // forward drive
    case 'r': driveTurn = constrain(v, -1.0f, 1.0f); break;   // turn (rotate)
    case 'x': driveFwd = 0; driveTurn = 0;                    // stop
              seqStop("aborted"); break;                       //   + abort any sequence
    case 'f': G.gaitFreq   = v; break;                          // gait frequency Hz
    case 'a': G.strideDeg  = v; break;                          // stride amplitude deg
    case 'p': G.postureDeg = v; break;                          // forward posture deg
    case 'k': G.kpPitch    = v; break;                          // pitch-stabilise gain
    case 'g': G.turnGain   = v; break;                          // turn mix gain
    case 'd': G.strokeDuty = constrain(v, 0.05f, 0.95f); break; // power-stroke duty (asymmetry)
    case 'q': G.ampRatio  = constrain(v, 0.4f, 2.5f);   break;  // front/rear amplitude ratio
    case 'u': G.dutySplit = constrain(v, -0.4f, 0.4f);  break;  // left/right duty split
    case 's': {                                                 // STEP reel (C5 servo fit)
      int n = (int)(v + 0.5f);
      if (n < 0 || n > 3) { logf("s: 1 unloaded (prop the robot up), 2 loaded (on the mat), 0 both, 3 single-leg reel (hold it up)\n"); return; }
      seqStart(n == 1 ? SEQ_STEP_UNLOADED : n == 2 ? SEQ_STEP_LOADED :
               n == 3 ? SEQ_REEL_SINGLE   : SEQ_STEP_BOTH);
      return;
    }
    case 'K': {                                                 // store params+drive in a slot
      int i = (int)(v + 0.5f);
      if (i < 1 || i > NSLOT) { logf("K: slot 1..%d\n", NSLOT); return; }
      slotStore(i);
      logf("slot %d <- f=%.2f a=%.1f p=%.1f d=%.2f q=%.2f u=%.2f g=%.2f fwd=%.2f turn=%.2f\n",
           i, G.gaitFreq, G.strideDeg, G.postureDeg, G.strokeDuty, G.ampRatio,
           G.dutySplit, G.turnGain, driveFwd, driveTurn);
      return;
    }
    case 'L': {                                                 // list slots
      for (int i = 1; i <= NSLOT; i++) {
        if (!SLOT[i].used) continue;
        logf("slot %d: f=%.2f a=%.1f p=%.1f d=%.2f q=%.2f u=%.2f g=%.2f fwd=%.2f turn=%.2f\n",
             i, SLOT[i].freq, SLOT[i].stride, SLOT[i].posture, SLOT[i].duty,
             SLOT[i].ratio, SLOT[i].split, SLOT[i].gain, SLOT[i].fwd, SLOT[i].turn);
      }
      logf("run length %.0f s/slot ('N'), %d slots stored\n", slotRunS, slotCount());
      return;
    }
    case 'N': slotRunS = constrain(v, 2.0f, 60.0f);
              logf("run length %.0f s/slot\n", slotRunS); return;
    case 'R': {                                                 // SCRIPT: play slots
      int i = (int)(v + 0.5f);
      if (i == 0) { seqStart(SEQ_SCRIPT); return; }
      if (i < 1 || i > NSLOT || !SLOT[i].used) { logf("R: 0 = all, or a stored slot 1..%d\n", NSLOT); return; }
      slotApply(i); driveFwd = SLOT[i].fwd; driveTurn = SLOT[i].turn;
      logf("slot %d applied live\n", i); break;
    }
    case 'z':                                                 // zero thrust-proxy stats
      mVfwdSq = mAfwdSq = mPitchSq = mRollSq = mRollSum = 0;
      mN = 0; mFalls = 0; vFwd = 0; break;
    case 'm': {                                               // report thrust-proxy
      float n = mN ? (float)mN : 1.0f;
      logf("meas: vfwdRms=%.4f afwdRms=%.3f pitchRms=%.2f rollRms=%.2f rollMean=%.2f falls=%d n=%lu\n",
           sqrtf(mVfwdSq / n), sqrtf(mAfwdSq / n), sqrtf(mPitchSq / n), sqrtf(mRollSq / n),
           mRollSum / n, mFalls, (unsigned long)mN);
      return;                                                 // skip the state line
    }
    case 'o': {                                               // set leg phase: v=leg*1000+deg
      int leg = (int)(v / 1000.0f); float deg = v - leg * 1000.0f;
      if (leg < 0 || leg >= NSERVO) { logf("o: v=leg*1000+deg (0FL 1FR 2RL 3RR), e.g. o3270\n"); return; }
      G.legPhaseDeg[leg] = deg; break;
    }
    case 'A': {                                               // trigger animation: 1 stand 2 sit 3 lie 4 waveFR 5 waveFL 6 getup 7 dance
      int n = (int)(v + 0.5f);
      animStart((int)constrain(n, 0, 15));
      logf("anim %d\n", n); return;
    }
    case 'P': {                                               // tune ACTIVE hold pose: v=leg*1000+(deg+500)
      float* pose = (GA.anim == GC_ANIM_SIT) ? GQ.sit : (GA.anim == GC_ANIM_LIE) ? GQ.lie : (GA.anim == GC_ANIM_BEG) ? GQ.beg : nullptr;
      if (!pose) { logf("P: start sit (A2), lie (A3) or beg (A14) first; then P leg*1000+(deg+500)\n"); return; }
      int leg = (int)(v / 1000.0f); float deg = (v - leg * 1000.0f) - 500.0f;
      if (leg < 0 || leg >= NSERVO) { logf("P: leg 0-3\n"); return; }
      pose[leg] = deg; logf("pose leg%d = %.0f deg\n", leg, deg); return;
    }
    case 'T': {                                               // closed-loop turn: spin <deg> by gyro then stop
      driveFwd = 0; turnTarget = v; turnStartYaw = yawDeg;
      turning = (fabsf(v) > 1.0f);
      G.turnGain = 1.0f; driveTurn = (v >= 0) ? 1.0f : -1.0f;
      logf("turn start: target %.0f deg (yaw0=%.1f)\n", v, yawDeg);
      return;
    }
    case 'E': eyesMode = (int)constrain(v, 0.0f, 2.0f); break; // eyes: 0 off 1 breathe 2 on
    case 'h': holdCenter = !holdCenter; break;                // toggle freeze-at-center (trim mode)
    case 'c': {                                               // set leg center us: v=leg*10000+us
      int leg = (int)(v / 10000.0f); int us = (int)(v - leg * 10000.0f);
      if (leg < 0 || leg >= NSERVO || us < 1000 || us > 2000) {
        logf("c: v=leg*10000+us (us 1000-2000), e.g. c31460 = RR center 1460\n"); return; }
      CAL.center_us[leg] = us; lastUs[leg] = -1;
      driveFwd = driveTurn = 0; holdCenter = true;            // freeze so the new center sticks & shows
      writeServo(leg, us);                                    // apply immediately
      logf("center leg %d (GPIO%d) = %d us  [hold on]\n", leg, SERVO_PIN[leg], us);
      return;
    }
    case 'j': {                                               // jog ONE servo (diag)
      int idx = (int)(v + 0.5f);
      if (idx < 0 || idx >= NSERVO) { logf("jog: idx 0..3 (0=FL 1=FR 2=RL 3=RR)\n"); return; }
      driveFwd = driveTurn = 0;                               // stop the gait first
      int lo = CAL.center_us[idx] - 400, hi = CAL.center_us[idx] + 400;
      logf("jog servo %d (GPIO%d): sweeping %d..%d us\n", idx, SERVO_PIN[idx], lo, hi);
      for (int rep = 0; rep < 3; rep++) {                     // ~3.6s blocking sweep
        for (int us = lo; us <= hi; us += 20) { writeServo(idx, us); delay(15); }
        for (int us = hi; us >= lo; us -= 20) { writeServo(idx, us); delay(15); }
      }
      writeServo(idx, CAL.center_us[idx]);
      logf("jog servo %d done\n", idx);
      return;
    }
    default: break;                                           // '?'/'h' -> just echo
  }
  printState();
}

// Called by net_console.h (~5 Hz). This line is the sim project's ground truth
// for what the robot was ACTUALLY commanded during a filmed run, so it carries
// the gait phase, the four leg angles and the four servo microseconds — enough
// to align footage to commands and to replay the run in MuJoCo. The old
// pitch/roll/yaw fields are gone: no IMU is fitted, they only ever printed zeros.
// (Log a session with:  telnet walker.local 23 | tee run.log)
void consoleTelemetry() {
#ifdef AUTO_TRIM
  return;                                     // the trim console is quiet: only replies to what you type
#endif
  logf("t=%lu seq=%d slot=%d phase=%.0f fwd=%.2f turn=%.2f "
       "deg=%.1f,%.1f,%.1f,%.1f us=%d,%d,%d,%d\n",
       millis(), seqKind, seqIdx, GS.gaitPhase * 57.2958f, driveFwd, driveTurn,
       legDeg[FL], legDeg[FR], legDeg[RL], legDeg[RR],
       lastUs[FL], lastUs[FR], lastUs[RL], lastUs[RR]);
}

static void onOtaStart() {                     // park the legs during an OTA write
  commandStand(); for (int i = 0; i < NSERVO; i++) writeLeg(i, 0.0f);
}
#endif  // TUNE_MODE

// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  // NEVER let a log line block the gait. Serial here is the C3's NATIVE USB CDC
  // (ARDUINO_USB_CDC_ON_BOOT), and a CDC write blocks until the HOST drains the buffer —
  // so with the robot plugged in for power and no monitor open, every Serial.print()
  // stalls for the TX timeout. `if (Serial)` is NOT a guard against this. Symptom
  // (2026-09-18): "it keeps freezing randomly, like something is taking cpu" while
  // driving — it was loop()'s own logf("turn done") on each completed turn.
#if defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT
  Serial.setTxTimeoutMs(0);
#endif
  delay(150);
  logf("\nwalker firmware\n");
  gaitDefaults();
#ifdef BOARD_ESP32CAM
  loadNvsTrim();
#endif
#ifndef K9_CAM_ONLY
  setupServos();               // camera board: no servos wired, GPIO 2/13/14/15 stay untouched
#endif
  if (PIN_EYES >= 0) { pinMode(PIN_EYES, OUTPUT); digitalWrite(PIN_EYES, LOW); }
  if (PIN_MOUTH >= 0) { pinMode(PIN_MOUTH, OUTPUT); digitalWrite(PIN_MOUTH, LOW); }
  selectGait(GAIT_BOOT);   // power-up gait; the table is the single source of truth
                        //   for the walk gait (the GAIT_PRESET #defines only seed the rest)
#ifndef K9_CAM_ONLY
  standPose();
#endif
  // imuInit();   // IMU REMOVED — its Wire.begin(0,1) would seize GPIO0 (now the eye
                  // LEDs). IMU code is kept but uninitialized (imuOk stays false,
                  // imuUpdate() no-ops). Re-enable this if an IMU is ever refitted.
#ifdef BOARD_ESP32CAM
  initWebServer();
#elif defined(TUNE_MODE)
  slotPreload();                           // slots 1-4 = the C6 validation slate
  netBegin(BANNER, onOtaStart);            // WiFi + OTA + telnet (net_console.h)
#ifdef AUTO_REEL
  seqStart(SEQ_REEL_SINGLE);
#endif
#ifdef AUTO_SLATE
  seqStart(SEQ_SCRIPT);
#endif
#else
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  WiFi.setSleep(false);   // idle-STA modem-sleep naps through ESP-NOW broadcasts
  if (esp_now_init() != ESP_OK) { logf("esp_now_init failed\n"); ESP.restart(); }
  esp_now_register_recv_cb(onEspNowRecv);
  Serial.println(F("ready — listening for gamepad frames"));
#endif
}

void loop() {
  static unsigned long lastMs = millis();
  unsigned long now = millis();
  float dt = (now - lastMs) * 0.001f; lastMs = now;
  if (dt <= 0) dt = 0.001f;
  if (dt > 0.05f) dt = 0.05f;

#ifdef BOARD_ESP32CAM
  updateWebServer();
#endif
#ifdef K9_CAM_ONLY
  delay(2);                    // camera + flashlight only: the legs belong to the other board
  return;
#endif

#ifdef CALIBRATE
  standPose(); delay(20); return;          // hold center for mounting the legs
#endif

  imuUpdate(dt);
  updateEyes();
  updateMouth();

#ifdef TUNE_MODE
  netTask();
#ifdef AUTO_TRIM
  for (int i = 0; i < NSERVO; i++) writeLeg(i, trimDeg[i]);   // hold: centre + the offset you typed
  delay(8); return;
#endif
  if (holdCenter) { standPose(); delay(8); return; }   // trim mode: freeze at center
  // safety: only move while a telnet client is watching (else hold a stand) —
  // except the power-up reel of the -e reel build, which has no client by design.
#ifdef AUTO_SLATE
  const bool autoRun = (seqKind == SEQ_SCRIPT);
#else
  const bool autoRun = false;
#endif
  if (!netClientConnected() && seqKind != SEQ_REEL_SINGLE && !autoRun) { seqStop("client gone"); commandStand(); }
  if (seqTask(dt)) { delay(8); return; }   // a step reel owns the legs outright
                                           // (the script returns false and lets
                                           //  the ordinary gait path run below)
#else
#ifndef BOARD_ESP32CAM
  if (rxFresh) {                // frames arrive at ~50 Hz with held stick state
    gamepad_packet_t gp;
    portENTER_CRITICAL(&pktMux);
    gp = rxPkt;
    rxFresh = false;
    portEXIT_CRITICAL(&pktMux);
    readGamepad(gp);
  }
#endif

  if (testServoTask()) { delay(8); return; }   // single-leg wiggle owns that servo

  if (holdCenter) {
    standPose();
    delay(8);
    return;
  }

  // power-up alignment window: legs at centre, eyes solid — but the LINK stays live
  // (the read above runs first: holding it below swallowed every frame for 20 s and
  // the gamepad looked disconnected). Any real stick input ends the window at once.
  if (alignHold) {
    const bool stickLive = fabsf(driveFwd) > 0.25f || fabsf(driveTurn) > 0.25f;
    if (millis() < ALIGN_HOLD_MS && !stickLive) {
      if (PIN_EYES >= 0) digitalWrite(PIN_EYES, HIGH);
      standPose();
      delay(8);
      return;
    }
    alignHold = false;
    logf("alignment hold over (%s) — gamepad live\n", stickLive ? "stick moved" : "timed out");
  }
#ifdef BOARD_ESP32CAM
  if (millis() - lastInputMs > 1000) commandStand();   // web link: 1 s failsafe
#else
  if (millis() - lastInputMs > WATCHDOG_MS) commandStand();   // link lost -> stand
#endif
#endif

  if (animRun(dt)) { delay(8); return; }     // a canned animation overrides the gait
  if (turning) {                            // closed-loop turn: stop when gyro hits the target angle
    if (fabsf(yawDeg - turnStartYaw) >= fabsf(turnTarget)) {
      driveTurn = 0; turning = false;
      logf("turn done: %.0f deg\n", yawDeg - turnStartYaw);
    }
  }
  updateGait(dt);
  delay(8);
}

// ============================================================================
// TUNING WORKFLOW (network):
//   1. Put your WiFi creds in src/secrets.h.
//   2. USB-flash the WiFi build once:   pio run -e tune -t upload
//      Open the USB monitor to see the assigned IP / "walker.local".
//   3. Connect the console:             telnet walker.local 23
//      It streams: pitch, roll, fall flag, drive, gait phase. Drive & tune live:
//        w 0.5   (trot forward)   r 0.3 (turn)   x (stop)
//        f 1.8   a 26   p 8   k 0.8   (freq / stride / posture / pitch gain)
//   4. Change code, then re-flash OVER WiFi:  pio run -e tune-ota -t upload
//      (the legs park during the OTA write). Repeat 3-4 until the trot is clean.
//   5. Fold the dialed-in gains back into the #define defaults, then build the
//      default (ESP-NOW gamepad) env for normal use.
//
// BRING-UP (servo direction, IMU axes) — see the per-pin notes; with the body
// nose-down the legs should lean BACK (flip KP_PITCH sign if not).
// ============================================================================
