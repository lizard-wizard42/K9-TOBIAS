# K9 "Tobias" MK5 — Lista de materiais (BOM)

Gerada em 02/11/2026 a partir do modelo `MK5/Blender/MK5_ATUAL.blend`, do firmware das pernas (1.6.3) e de `docs/AUDIO.md`, `docs/BATTERY.md` e `docs/HARDWARE-LAYOUT.md`. O esquema correspondente está nos 6 idiomas do projeto: [pt](eletrica/ESQUEMA-ELETRICO.pt.svg) · [en](eletrica/ESQUEMA-ELETRICO.en.svg) · [es](eletrica/ESQUEMA-ELETRICO.es.svg) · [fr](eletrica/ESQUEMA-ELETRICO.fr.svg) · [de](eletrica/ESQUEMA-ELETRICO.de.svg) · [zh](eletrica/ESQUEMA-ELETRICO.zh.svg).

**Status** de cada linha: **M** = medido/definido pelo dono ou presente no modelo · **C** = dado de catálogo/datasheet · **P** = premissa ou proposta, **confirmar antes de comprar/ligar**.

## 1. Eletrônica

| # | Qtd | Item | Especificação | Onde no modelo | Status / observação |
|---|---|---|---|---|---|
| E1 | 1 | Pack de baterias 2S 18650 com BMS | 7,4 V nominal (6,0–8,4 V), 2500 mAh, 70 × 38 × ~21 mm, ~95 g, conector JST (variante não informada) | `BAT_reserva_70x38x21` | M. Descarga "2C" (~5 A) não testada; BMS sem limites divulgados; sem fio de balanceamento. |
| E2 | 2 | Conversor DC-DC step-down LM2596 (módulo) | entrada 3–40 V, saída 1,5–35 V ajustável, 3 A máx. (~2 A contínuos sem dissipador), ~43,5 × 21 × 14 mm, ~10 g | `LM1_*` (motores), `LM2_*` (lógica) | C. **Medir o seu módulo.** Nº 1 (motores): ajustar para 5,5–6,0 V; nº 2 (lógica): ~5,0 V (P). Ajustar sem carga, antes de ligar qualquer coisa. Sem proteção contra polaridade invertida. |
| E3 | 4 | Micro servo MG90S | 4,8–6 V, ~0,8 A travado, engrenagem metálica | `servo_FL/FR/RL/RR` | M. Vêm com braços e parafusos. Sinais: FL=GPIO14, FR=GPIO15, RL=GPIO13, RR=GPIO2. |
| E4 | 1 | Placa ESP32 DevKit (30 pinos, micro-USB) | alimentação 5 V no pino VIN, 54 × 29 mm | `CAD_ESP32_DEVKIT_*` | M. Cérebro das pernas (firmware 1.6.3). |
| E5 | 1 | Placa ESP32-CAM AI-Thinker com câmera OV3660 | 5 V / pico ~2 A, 40,5 × 27 mm | `CAD_ESP32_CAM_*`, `REF_modulo_OV3660` | M. Só se comunica com o ESP das pernas por Wi-Fi (sem fios entre as placas). Lanterna branca no GPIO4. |
| E6 | 1 | Transistor TIP41C (NPN, TO-220) | ordem dos terminais de frente: 1 = Base, 2 = Coletor, 3 = Emissor; aba = coletor | `Q1_TIP41C` | M (montagem informada em 02/11). Substitui o BC547 + 1 kΩ. Posição no robô provisória. |
| E7 | 1 | Resistor 220 Ω, 1/4 W | limita a corrente de base (≈12 mA a partir do GPIO25) | `R1_base_220R` | M. |
| E8 | 1 | Diodo 1N4007 | roda-livre em paralelo com o alto-falante, **catodo (faixa) no +** | `D1_1N4007_catodo_no_mais` | M. |
| E9 | 1 | Speaker de PC (o pequeno speaker de gabinete/placa-mãe) | ~12 × 8 mm no modelo, ligado a 5 V regulados | `ALTO_FALANTE_12x8_referencia` | M (definido pelo dono). Impedância e dimensões reais **não medidas**; faixa de som 500–3000 Hz. |
| E10 | 1 | Capacitor eletrolítico 1000 µF | ≥ 16 V, baixo ESR; Ø10 × 20 mm; nos trilhos dos servos | `CAP_1000uF_DISTRIBUICAO_*` | M. |
| E11 | 2 | Capacitor eletrolítico 470 µF | ≥ 10 V (16 V ok), Ø10 × 12,5 mm; um na ESP32, outro na ESP32-CAM | `CAP_470uF_ESP_*`, `CAP_470uF_CAM_*` | M. |
| E12 | 1 | Jack DC | 9 × 11 × 15,6 mm, para carga do pack | `JACK_CORPO_REFERENCIA`, `RESERVA_JACK_9x11x15p6` | **P.** Ligação dos terminais e carregador não confirmados; o BMS não é carregador. |
| E13 | 1 | Mini jumper (passo 1,27 mm) como chave liga/desliga | no positivo, entre o pack e os conversores | `JUMPER_*` | **P.** Conferir a corrente suportada (a entrada de 7,4 V puxa ~2 A com 3 A em 5 V). |
| E14 | 1 | Fusível ~5 A | no positivo do pack | — (não modelado) | **P**, recomendado em `docs/BATTERY.md`. |
| E15 | 7 | Conector Dupont fêmea | 4 sinais dos servos, 2 de alimentação (VIN/GND da ESP) e 1 do GPIO25 | `DUPONT_F_*` | M. |
| E16 | ~2 m | Fio de silicone flexível | 22–24 AWG para sinais; 20–22 AWG para o chicote de potência | curvas `SERVO_*`, `ENTRADA_LM_*`, `LM_*_SAIDA_*`, `SOM_*` etc. | M quanto às rotas; bitola é recomendação (P). |
| E17 | 10 | Abraçadeira de nylon | ~3 × 1,5 mm (rasgos de 3,5 × 2 mm na peça) | `ABRACADEIRA_01…10` | M. |

Não existe no firmware leitura da tensão do pack; um divisor de tensão em ADC1 é uma decisão futura.

## 2. Fixação e mecânica (não impressa)

| # | Qtd | Item | Observação |
|---|---|---|---|
| F1 | 32 | Parafuso M2, cabeça **Allen (sextavado interno) ou Phillips** (escolha do dono), comprimento **a definir** | Distribuição no modelo: 4 no eixo dos servos (usar os parafusos de braço que acompanham o MG90S), 8 nas abas dos servos (2 por servo), 2 aba da frente, 2 aba da traseira, 4 inferiores da bateria, 4 do berço, 8 da tampa. Escolher um único tipo de cabeça para o robô todo (uma só chave). **Falta definir autoatarraxante × métrico e o comprimento**; furos pilotos Ø1,7 mm e passantes Ø2,4 mm, assento da cabeça Ø4,2 mm nas laterais (conferir se cabe a cabeça Allen ou Phillips escolhida). |
| F2 | 8 | Porca M2 | 4 da bandeja da bateria (`PORCA_BATERIA_M2_*`) e 4 do porta-capacitores (`PORCA_M2_PORTA_CAP_*`). |
| F3 | 12 (+ reserva) | Elástico de cabelo pequeno | Mola passiva do joelho: **3 por perna** × 4 pernas, ver `MK5/Montagem/MK5_montagem_3_elastico_perna.mp4`. A quantidade pode variar conforme a carga/peso do robô; comprar reserva. |
| F4 | 1 | Fita dupla-face / espuma (opcional) | Fixar o pack e os módulos, se necessário. |

## 3. Peças impressas em 3D (FDM, bico 0,4 mm, camada 0,2 mm)

Arquivos em `Impressao 3D/STL/` (projetos para Ender 3 V3 SE e Bambu Lab em `Impressao 3D/`). Material e cores finais ainda a definir; no modelo, tampa verde, corpo e pernas pretos, braços laranja e hastes em preto/branco.

| Pasta | Peça | Qtd |
|---|---|---|
| `01_CORPO` | Base/piso | 1 |
| | Tampa do topo | 1 |
| | Lateral esquerda · Lateral direita | 1 + 1 |
| | Frente com câmera | 1 |
| | Traseira | 1 |
| | Bandeja da bateria | 1 |
| | Berço | 1 |
| | Porta-capacitores (PLA separado) | 1 |
| `02_PERNAS/FL, FR, RL, RR` | Ombro · braço (manivela) · haste monocor · pata lisa | 4 por perna = 16 |

Total: 9 peças do corpo + 16 das pernas = **25 peças**.

## 4. Ferramentas e consumíveis

Multímetro (ajuste dos LM2596 e conferência de polaridade), ferro de solda e solda, alicate, chave Allen ou Phillips pequena (conforme o parafuso), cabo micro-USB (primeira gravação do firmware por USB), carregador 2S 8,4 V CC/CV ou fonte de bancada com limite de corrente (`docs/BATTERY.md`), filamento PLA/PETG.

## 5. O que ainda precisa ser confirmado

1. Tensão de saída da lógica (premissa de 5,0 V) e se o LM2596 dos motores dá conta do pico dos 4 servos (limite de ~3 A).
2. Ligação do jack de carga, da chave (mini jumper) e do carregador; fusível.
3. Impedância do speaker de PC; posição final do TIP41C (hoje no ar no modelo).
4. Comprimento (e rosca) dos parafusos M2 e escolha Allen × Phillips; material de impressão.
5. Dimensões reais dos módulos (LM2596, ESP32 DevKit, ESP32-CAM): vieram de catálogo.

## 6. Itens marcados no modelo que não aparecem aqui

O objeto `ground`, as referências (`REF_*`) e os modelos de apoio são só visuais e não são comprados.
