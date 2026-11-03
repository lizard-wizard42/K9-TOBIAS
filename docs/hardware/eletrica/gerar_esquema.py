"""Gera ESQUEMA-ELETRICO.<idioma>.svg (pt, en, es, fr, de, zh) do K9 MK5. Rodar: python3 gerar_esquema.py (sem dependencias)."""
import os
from textos_esquema import TR,NOTES,SERVO_POS,SERVO_WORD,LANGS
HERE=os.path.dirname(os.path.abspath(__file__))
C=dict(bat='#c1121f',mot='#e36414',log='#1b7f6b',sig='#2b6cb0',gnd='#2d2d2d',txt='#1a1a1a',box='#f4f6f8',edge='#4a4f57',warn='#8a5a00')
L=0
def tr(x):
    return x if L==0 else TR.get(x,[None]*5)[L-1] or x
o=[]
try:
    from PIL import ImageFont
    _F={}
    def _chk(t,sz,bold,w):
        k=(sz,bold)
        if k not in _F:_F[k]=(ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',int(sz*4)),ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc' if bold else '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',int(sz*4)))
        f=_F[k][1] if any(ord(ch)>0x2e80 for ch in t) else _F[k][0]
        if f.getlength(t)/4>w-18:print('  ESTOURA',LANGS[L][0],round(f.getlength(t)/4),'>',w-18,t)
except Exception:
    def _chk(*a):pass
def a(s):o.append(s)
def line(pts,col,dash=False,w=2.2):
    d=' stroke-dasharray="7 5"' if dash else ''
    a(f'<polyline points="{" ".join(f"{x},{y}" for x,y in pts)}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linejoin="round"{d}/>')
def dot(x,y,col):a(f'<circle cx="{x}" cy="{y}" r="3.6" fill="{col}"/>')
def text(x,y,s,sz=13,col=None,w='400',anchor='start',style=''):
    s=tr(s)
    a(f'<text x="{x}" y="{y}" font-size="{sz}" fill="{col or C["txt"]}" font-weight="{w}" text-anchor="{anchor}" {style}>{s}</text>')
def box(x,y,w,h,title,sub=(),dash=False,fill=None,tsz=14):
    title=tr(title);sub=[tr(t) for t in sub]
    _chk(title,tsz,True,w);[_chk(t,11.5,False,w) for t in sub]
    d=' stroke-dasharray="8 5"' if dash else ''
    a(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{fill or C["box"]}" stroke="{C["edge"]}" stroke-width="1.8"{d}/>')
    a(f'<text x="{x+10}" y="{y+20}" font-size="{tsz}" fill="{C["txt"]}" font-weight="700">{title}</text>')
    for i,s in enumerate(sub):text(x+10,y+38+i*16,s,11.5,'#444')
def gnd(x,y):
    line([(x,y),(x,y+8)],C['gnd']);
    for i,wd in enumerate((14,9,4)):line([(x-wd,y+8+i*4),(x+wd,y+8+i*4)],C['gnd'],w=2)
def net(x,y,name,col,side='r'):
    if side=='r':text(x+5,y+4,name,12,col,'700')
    else:text(x-5,y+4,name,12,col,'700','end')
def res(x,y,col,label):  # horizontal, from x to x+60
    line([(x,y),(x+12,y)],col);line([(x+48,y),(x+60,y)],col)
    a(f'<rect x="{x+12}" y="{y-8}" width="36" height="16" fill="#fff" stroke="{col}" stroke-width="2"/>');text(x+30,y-13,label,12,w='700',anchor='middle')
def cap(x,y,col,label,sub):  # vertical, top at y, bottom y+30 ; polarised
    line([(x,y),(x,y+12)],col);line([(x,y+20),(x,y+34)],col)
    line([(x-11,y+12),(x+11,y+12)],col,w=2.4);a(f'<path d="M{x-11},{y+20} Q{x},{y+14} {x+11},{y+20}" fill="none" stroke="{col}" stroke-width="2.4"/>')
    text(x-8,y+8,'+',11,col,'700','end');text(x+18,y+19,label,12,w='700');text(x+18,y+33,sub,10.5,'#555');gnd(x,y+34)
def build():
    global o
    o.clear()
    W,H=1580,1010
    a(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="DejaVu Sans, Arial, sans-serif">')
    a(f'<rect width="{W}" height="{H}" fill="#ffffff"/>')
    text(30,38,'K9 "Tobias" MK5 — Esquema elétrico',24,w='700')
    text(30,60,'Pack 2S 18650 → 2 conversores LM2596 (motores e lógica) → 4 × MG90S, ESP32 DevKit (pernas), ESP32-CAM e circuito do alto-falante (GPIO25)',12.5,'#444')
    text(30,78,'Todos os GND são o mesmo nó (GND comum dos dois conversores). Nomes de rede iguais estão ligados entre si. Linha tracejada = proposta/ligação a confirmar no robô.',12,'#444')
    # ---- entrada de energia
    box(30,120,170,100,'BATERIA 2S',('2 × 18650 · 7,4 V nominal','6,0–8,4 V · 2500 mAh','BMS · conector JST'))
    line([(200,150),(235,150)],C['bat']);text(204,144,'+',13,C['bat'],'700');text(204,196,'−',14,C['gnd'],'700')
    line([(200,200),(215,200)],C['gnd']);gnd(215,200)
    dot(218,150,C['bat'])
    # fusivel proposto
    a(f'<rect x="235" y="140" width="64" height="20" fill="#fff" stroke="{C["bat"]}" stroke-width="2" stroke-dasharray="5 3"/>');line([(299,150),(340,150)],C['bat'],True)
    text(267,134,'F1 ≈5 A',11.5,C['warn'],'700','middle');text(267,176,'(recomendado)',10.5,C['warn'],'400','middle')
    # jumper como chave
    line([(340,150),(352,150)],C['bat']);dot(352,150,C['bat']);dot(398,150,C['bat']);line([(352,150),(396,138)],C['bat'],w=2.6);line([(398,150),(500,150)],C['bat']);line([(450,150),(450,360),(500,360)],C['bat']);dot(450,150,C['bat'])
    text(375,176,'SW1 · mini jumper',11.5,'#333','400','middle');text(375,190,'(liga/desliga)',10.5,'#555','400','middle')
    text(456,143,'VBAT',12,C['bat'],'700')
    # jack
    box(30,250,170,86,'JACK DC 9×11×15,6',('carga do pack','ligação a confirmar'),dash=True,tsz=12)
    line([(200,270),(235,270)],C['bat'],True);text(240,274,'→ BAT+ (antes do SW1)',11,C['warn'])
    line([(200,314),(235,314)],C['gnd'],True);text(240,318,'→ BAT−',11,C['warn'])
    # ---- conversores
    box(500,120,230,130,'LM2596 nº 1 — MOTORES',('entrada 3–40 V','ajustar saída 5,5–6,0 V','no trimmer, SEM carga, antes','de ligar os servos'))
    line([(470,230),(500,230)],C['gnd']);gnd(470,230);text(504,148,'IN+',10.5,'#555');text(504,234,'IN−',10.5,'#555')
    line([(730,150),(870,150)],C['mot']);text(722,146,'OUT+',10.5,'#555','400','end');line([(730,230),(750,230)],C['gnd']);gnd(750,230);text(722,234,'OUT−',10.5,'#555','400','end')
    dot(800,150,C['mot']);cap(800,150,C['mot'],'C1 1000 µF','≥16 V, baixo ESR')
    text(836,141,'V_SERVO',12,C['mot'],'700')
    box(500,330,230,130,'LM2596 nº 2 — LÓGICA',('entrada 3–40 V','ajustar saída ≈5,0 V','(premissa: valor não medido)','alimenta ESP32 + CAM + som'))
    line([(470,440),(500,440)],C['gnd']);gnd(470,440);text(504,358,'IN+',10.5,'#555');text(504,444,'IN−',10.5,'#555')
    line([(730,360),(760,360),(760,600)],C['log']);text(722,356,'OUT+',10.5,'#555','400','end');line([(730,440),(750,440)],C['gnd']);gnd(750,440);text(722,444,'OUT−',10.5,'#555','400','end')
    net(766,350,'V_LOG',C['log'])
    # ---- servos
    text(1010,112,'4 × servo MG90S (4,8–6 V)',13,w='700')
    srv=[('FL','frente esq.','14'),('FR','frente dir.','15'),('RL','traseira esq.','13'),('RR','traseira dir.','2')]
    for i,(n,d,g) in enumerate(srv):
        y=125+i*82
        box(1010,y,230,70,f'{SERVO_WORD[L]} {n} — {SERVO_POS[L][i]}',())
        line([(990,y+30),(1010,y+30)],C['mot']);net(990,y+30,'V_SERVO',C['mot'],'l');text(1016,y+34,'V+ (vermelho)',10.5,'#555')
        line([(990,y+46),(1010,y+46)],C['gnd']);gnd(990,y+46);text(1016,y+50,'GND (marrom)',10.5,'#555')
        line([(1240,y+38),(1270,y+38)],C['sig']);text(1234,y+34,'SIG (laranja)',10.5,'#555','400','end');net(1272,y+38,f'SIG_{n}',C['sig'])
    text(1010,462,'Os 4 servos dividem o trilho V_SERVO e o capacitor C1.',11.5,'#444')
    # ---- ESP32 devkit
    BX=890
    box(BX,500,270,225,'ESP32 DevKit — pernas',('30 pinos · micro-USB','firmware 1.6.3'))
    line([(760,600),(BX,600)],C['log']);text(BX+6,604,'VIN / 5 V',11,'#555')
    dot(795,600,C['log']);cap(795,600,C['log'],'C2 470 µF','≥10 V')
    line([(BX-20,625),(BX,625)],C['gnd']);gnd(BX-20,625);text(BX+6,629,'GND',11,'#555')
    pins=[('GPIO14','SIG_FL'),('GPIO15','SIG_FR'),('GPIO13','SIG_RL'),('GPIO2','SIG_RR'),('GPIO25','AUDIO_GPIO')]
    for i,(p,nn) in enumerate(pins):
        y=600+i*22
        line([(BX+270,y),(BX+305,y)],C['sig']);text(BX+264,y+4,p,11,'#555','400','end');net(BX+307,y,nn,C['sig'])
    text(BX+10,708,'Sinais de servo: PWM 50 Hz (LEDC)',10.5,'#666')
    # ---- ESP32-CAM
    box(BX,770,270,110,'ESP32-CAM AI-Thinker (OV3660)',('câmera MJPEG, lanterna GPIO4','sem fios p/ o ESP das pernas (Wi-Fi)'))
    line([(760,600),(760,845)],C['log']);line([(760,845),(BX,845)],C['log']);dot(795,845,C['log']);cap(795,845,C['log'],'C3 470 µF','≥10 V')
    text(BX+6,849,'5 V',11,'#555');line([(BX-20,865),(BX,865)],C['gnd']);gnd(BX-20,865);text(BX+6,869,'GND',11,'#555')
    dot(760,600,C['log'])
    # ---- circuito do som
    a('<g transform="translate(60,170)">')
    text(1160,340,'Speaker de PC (som, emoções, músicas)',13,w='700')
    box(1250,390,150,50,'SPEAKER DE PC',('12×8 (gabinete/BIOS)',),tsz=12)
    line([(1285,390),(1285,365),(1430,365),(1430,455)],C['log']);net(1292,362,'',C['log']);text(1291,359,'V_LOG',11,C['log'],'700')
    dot(1285,365,C['log'])
    line([(1345,440),(1345,505)],C['sig']);dot(1345,505,C['sig'])
    # diodo D1 em paralelo (catodo no +)
    line([(1430,455),(1430,470)],C['log']);a(f'<polygon points="1420,490 1440,490 1430,472" fill="#fff" stroke="{C["gnd"]}" stroke-width="2"/>')
    line([(1420,472),(1440,472)],C['gnd'],w=2.8);line([(1430,490),(1430,505)],C['gnd']);line([(1345,505),(1430,505)],C['gnd'])
    text(1452,484,'D1',12,w='700');text(1452,498,'1N4007',10.5,'#555');text(1452,470,'(faixa',10,'#555');text(1452,458,'no +)',10,'#555')
    # transistor
    line([(1345,505),(1345,540)],C['gnd']);text(1352,528,'C',11,'#555')
    a(f'<circle cx="1330" cy="565" r="26" fill="#fff" stroke="{C["gnd"]}" stroke-width="2"/>')
    line([(1322,552),(1322,578)],C['gnd'],w=3);line([(1322,558),(1345,540)],C['gnd']);line([(1322,572),(1345,590)],C['gnd']);line([(1345,590),(1345,625)],C['gnd']);gnd(1345,625)
    a(f'<polygon points="1336,583 1341,576 1332,575" fill="{C["gnd"]}"/>')
    text(1358,584,'E',11,'#555')
    line([(1290,565),(1322,565)],C['sig']);text(1296,556,'B',11,'#555')
    res(1210,565,C['sig'],'')
    text(1240,592,'R1 220 Ω',12,w='700',anchor='middle');line([(1270,565),(1290,565)],C['sig'])
    line([(1180,565),(1210,565)],C['sig']);text(1176,556,'AUDIO_GPIO',11.5,C['sig'],'700')
    text(1290,676,'Q1 TIP41C (TO-220)',12.5,w='700');text(1290,692,'inscrições de frente, terminais p/ baixo:',10.5,'#555');text(1290,706,'1 = Base · 2 = Coletor · 3 = Emissor',10.5,'#555');text(1290,720,'(a aba metálica também é o coletor)',10.5,'#555')
    a('</g>')
    # ---- notas
    box(30,420,420,345,'Notas de montagem e segurança',(),fill='#fffaf0')
    notes=NOTES[L]
    for i,s in enumerate(notes):text(42,462+i*19,s,11.2,'#333')
    # legenda
    box(30,785,480,110,'Legenda',(),fill='#fff')
    for i,(c,n) in enumerate([(C['bat'],'VBAT (pack, 6,0–8,4 V)'),(C['mot'],'V_SERVO (≈5,5–6,0 V, motores)'),(C['log'],'V_LOG (≈5 V, lógica e som)'),(C['sig'],'sinais (GPIO)')]):
        line([(42,825+i*17),(78,825+i*17)],c,w=3);text(86,829+i*17,n,11.5)
    line([(290,825),(326,825)],C['gnd'],True);text(334,829,'proposta / a confirmar',11.5);
    text(290,846,'⏚ = GND comum',11.5)
    text(30,925,'Referência: objetos do modelo MK5/Blender/MK5_ATUAL.blend (fios, LM1/LM2, CAP_*, Q1_TIP41C, R1_base_220R, D1_1N4007) e docs/AUDIO.md, docs/BATTERY.md.',11.5,'#555')
    text(30,943,'Pinos do firmware das pernas (k9v2-1_firmware/src/main.cpp): FL=14, FR=15, RL=13, RR=2; som: GPIO25 (LEDC canal 6).',11.5,'#555')
    text(30,961,'Esquema de documentação: não é um projeto de PCB. Confirme valores e ligações no hardware real antes de energizar.',11.5,'#555')
    a('</svg>')
    return '\n'.join(o)


for k,(code,name) in enumerate(LANGS):
    L=k
    svg=build().replace('font-family="DejaVu Sans, Arial, sans-serif"','font-family="DejaVu Sans, Noto Sans CJK SC, Arial, sans-serif"')
    p=os.path.join(HERE,f'ESQUEMA-ELETRICO.{code}.svg');open(p,'w',encoding='utf-8').write(svg);print('OK',p)
