/* Teste da pose "pedir" v2 (sentado reclinado, patas da frente levantadas). gc_anim_run já soma o tempo em a.t. */
#include <stdio.h>
#include <math.h>
#include "../src/gait_core.h"

static int fails = 0;
#define CHECK(cond, msg) do { if (!(cond)) { printf("FALHOU: %s\n", msg); fails++; } } while (0)

int main(void) {
  gc_poses q; gc_poses_defaults(&q);
  gc_anim_state a; gc_anim_start(&a, GC_ANIM_BEG);
  float leg[GC_NSERVO] = { 0, 0, 0, 0 }, prev[GC_NSERVO] = { 0, 0, 0, 0 };
  const float dt = 0.005f;
  float maxSum = 0, maxRearRate = 0, tBurst0 = -1, tBurst1 = -1, tFront = -1, minRearEarly = 99;
  float rearAtSit = 0;
  int owns = 1;
  for (int i = 0; i < 8000 && owns; i++) {                          /* 40 s */
    owns = gc_anim_run(&q, &a, dt, leg);
    float sum = 0;
    for (int k = 0; k < GC_NSERVO; k++) { sum += fabsf(leg[k] - prev[k]) / dt; prev[k] = leg[k]; }
    float rr = fabsf(leg[GC_RL] - 0) ; (void)rr;
    if (sum > maxSum) maxSum = sum;
    if (a.t > GC_BEG_SIT_S - 0.03f && a.t < GC_BEG_SIT_S - 0.005f) rearAtSit = leg[GC_RL];   /* ainda antes da lançada */
    if (tBurst0 < 0 && a.t > GC_BEG_SIT_S && leg[GC_RL] < GC_BEG_PRE_REAR - 1.0f) tBurst0 = a.t;
    if (tBurst1 < 0 && leg[GC_RL] <= q.begBurstTo + 0.6f && tBurst0 > 0) tBurst1 = a.t;
    if (tFront < 0 && leg[GC_FL] > q.beg[GC_FL] - 0.6f) tFront = a.t;
    if (a.t < GC_BEG_SIT_S && leg[GC_RL] < minRearEarly) minRearEarly = leg[GC_RL];
  }
  (void)maxRearRate; (void)minRearEarly;
  float rate = (tBurst1 > tBurst0) ? (GC_BEG_PRE_REAR - q.begBurstTo) / (tBurst1 - tBurst0) : 0;
  printf("sentado em %.1f | lançada de %.2f s a %.2f s (%.0f graus/s por servo) | patas da frente em %.0f aos %.1f s | soma máx %.0f graus/s | final FL %.1f RL %.1f | anim %d\n",
         rearAtSit, tBurst0, tBurst1, rate, q.beg[GC_FL], tFront, maxSum, leg[GC_FL], leg[GC_RL], a.anim);
  CHECK(owns == 1 && a.anim == GC_ANIM_BEG, "a pose é sustentada (não termina sozinha)");
  CHECK(fabsf(leg[GC_FL] - 40.0f) < 0.8f && fabsf(leg[GC_FR] - 40.0f) < 0.8f, "patas da frente levantadas em 40");
  CHECK(fabsf(leg[GC_RL] - 0.0f) < 0.8f && fabsf(leg[GC_RR] - 0.0f) < 0.8f, "patas de trás no ângulo de projeto, 0 (posição de em pé)");
  CHECK(rearAtSit > 54.0f, "antes da lançada as de trás estão sentadas (~56)");
  CHECK(tBurst1 > tBurst0 && rate > 150.0f && rate < 230.0f, "a lançada das traseiras vai a cerca de 200 graus/s");
  CHECK(tFront > tBurst1 + 0.5f, "as da frente só sobem depois de a traseira descer");
  CHECK(maxSum <= 420.0f, "a rajada soma no máximo ~400 graus/s (acima do orçamento de 150: risco de BROWNOUT, medir no robô)");
  /* Saída com o mesmo limite de potência aplicado pela placa, em vários dt.
     Inclui saída interrompida na entrada e posições inicialmente desiguais. */
  const float ticks[] = { 0.005f, 0.02f, 0.05f };
  const float starts[][4] = { {40,40,0,0}, {-20,-20,45,45}, {40,38,0,8} };
  for (int scenario = 0; scenario < 3; scenario++) for (int tick = 0; tick < 3; tick++) {
    float stepDt = ticks[tick], peak = 0; int steps = 0, reached = 0;
    gc_anim_start(&a, GC_ANIM_BEGOUT); owns = 1;
    for (int k = 0; k < 4; k++) leg[k] = starts[scenario][k];
    while (owns && steps++ < (int)(30 / stepDt)) {
      float before[4]; for (int k = 0; k < 4; k++) before[k] = leg[k];
      int stage = a.exitStage;
      owns = gc_anim_run(&q, &a, stepDt, leg);
      float total = 0;
      for (int k = 0; k < 4; k++) total += fabsf(leg[k] - before[k]);
      if (total / stepDt > peak) peak = total / stepDt;
      if (total > 150 * stepDt)
        for (int k = 0; k < 4; k++) leg[k] = before[k] + (leg[k] - before[k]) * 150 * stepDt / total;
      CHECK(leg[GC_RL] <= 48.01f && leg[GC_RR] <= 48.01f, "saída não dobra traseiras além de 48 graus");
      if (stage == 3) CHECK(fabsf(leg[GC_FL]-85) < 0.02f && fabsf(leg[GC_FR]-85) < 0.02f, "frente permanece baixa durante extensão traseira");
      if (stage == 4) CHECK(fabsf(leg[GC_RL]) < 0.02f && fabsf(leg[GC_RR]) < 0.02f, "traseiras já estendidas antes de levantar a frente");
      if (a.exitStage != stage) {
        const float targets[5][4] = {{-20,-20,0,0},{-20,-20,48,48},{85,85,48,48},{85,85,0,0},{0,0,0,0}};
        for (int k = 0; k < 4; k++) CHECK(fabsf(leg[k] - targets[stage][k]) < 0.02f, "etapa só muda depois de completar os quatro alvos");
        reached++;
      }
      if (scenario < 2) CHECK(fabsf(leg[GC_RL] - leg[GC_RR]) < 0.001f, "traseiras recebem trajetórias iguais durante toda a saída");
    }
    CHECK(peak <= 120.01f, "saída permanece abaixo do limite de potência de 150 graus/s");
    CHECK(reached == 5 && a.anim == GC_ANIM_NONE, "completa as cinco etapas e termina em pé");
    for (int k = 0; k < 4; k++) CHECK(fabsf(leg[k]) < 0.02f, "todas as patas terminam no centro");
  }
  /* ajuste ao vivo muda o alvo e a pose segue */
  gc_anim_start(&a, GC_ANIM_BEG); for (int k = 0; k < GC_NSERVO; k++) leg[k] = 0;
  for (int i = 0; i < 4000; i++) gc_anim_run(&q, &a, dt, leg);
  q.beg[GC_RL] = q.beg[GC_RR] = 22.0f;
  for (int i = 0; i < 2000; i++) gc_anim_run(&q, &a, dt, leg);
  CHECK(fabsf(leg[GC_RL] - 22.0f) < 0.8f, "mudar o ângulo traseiro ao vivo (B) move a pose segurada");
  printf(fails ? "RESULTADO: %d falha(s)\n" : "RESULTADO: tudo certo\n", fails);
  return fails ? 1 : 0;
}
