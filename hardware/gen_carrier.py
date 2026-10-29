#!/usr/bin/env python3
"""Generate the DrumDuino carrier board v2 (KiCad 7): schematic + PCB + local 3D models.

The board is a base for a RobotDyn Mega 2560 PRO (Embed) module that plugs in on female headers.
- 16 inputs on 6.35 mm stereo PCB jacks (Rean/Neutrik NRJ6HF), 8 on the top edge and 8 on the bottom edge, noses out.
  Each input: TIP -> 1 MΩ to GND + 5.1 V zener to GND -> analog pin. SLEEVE = GND. RING not used
  (a mono guitar cable shorts it to the sleeve, which is fine).
- A15 = hi-hat pedal: TIP = pot wiper, RING = VCC, SLEEVE = GND (use a stereo cable).
- DC-005 barrel jack 5.5x2.1 (9 V recommended) -> 1N5819 reverse-polarity diode -> module VIN.
Run:  python3 gen_carrier.py   (writes into ./drumduino-carrier/)
"""
import os, re, uuid, json, shutil, math
import pcbnew
from pcbnew import VECTOR2I, FromMM

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'drumduino-carrier')
NAME = 'drumduino-carrier'
KSYM = '/usr/share/kicad/symbols'
KFP = '/usr/share/kicad/footprints'
# official KiCad 3D models (kicad-packages3d 7.0.11), copied into the project
P3D = os.environ.get('KICAD_P3D', '/tmp/claude-0/-home-claude/4dd92297-5419-5263-9015-156143e93cb4/scratchpad/p3d/usr/share/kicad/3dmodels')

W, H = 140.0, 120.0
SIG_W, PWR_W = 0.4, 0.6

# ---------- Mega 2560 PRO pad map (RobotDyn; from the mikroavr Eagle library, module coords, y up) ----------
MOD_X, MOD_Y = 36.56, 61.51      # module left edge at x=1 (USB side), top edge at y=45
TOP = []
for c in range(16):
    X = -21.59 + 2.54 * c
    TOP.append(('A%d' % (2 * c) if c < 8 else 'D%d' % (32 + 2 * (c - 8)), X, 15.24))
    TOP.append(('A%d' % (2 * c + 1) if c < 8 else 'D%d' % (33 + 2 * (c - 8)), X, 12.70))
BOT = []
for X, n in [(-34.29, 'VIN'), (-31.75, 'GND'), (-29.21, 'VCC')]:
    BOT += [(n, X, -17.78), (n, X, -20.32)]

SOCKET_H, HEADER_H, PCB_T = 8.5, 2.5, 1.6   # female socket, male header plastic, module PCB thickness

def write_module_fp(path):
    pads = []
    for n, X, Y in TOP + BOT:
        shape = 'rect' if n == 'A0' else 'circle'
        pads.append(f'  (pad "{n}" thru_hole {shape} (at {X:.3f} {-Y:.3f}) (size 1.7 1.7) (drill 1.0) (layers "*.Cu" "*.Mask"))')
    x0, x1, y0, y1 = -35.56, 17.78, -16.51, 21.59
    rect = lambda layer, w: '\n'.join(
        f'  (fp_line (start {a[0]} {a[1]}) (end {b[0]} {b[1]}) (stroke (width {w}) (type solid)) (layer "{layer}"))'
        for a, b in [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))])
    txt = f'''(footprint "MEGA2560_PRO_Socket" (version 20221018) (generator pcbnew)
  (layer "F.Cu")
  (descr "RobotDyn Mega 2560 PRO (Embed) on female headers: 2x16 analog/D32-47 header + 2x3 VIN/GND/VCC. 54x38 mm module")
  (tags "arduino mega 2560 pro embed robotdyn")
  (attr through_hole)
  (fp_text reference "REF**" (at -10 -18.2) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
  (fp_text value "MEGA2560_PRO" (at -10 3) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
  (fp_text user "MEGA 2560 PRO   USB <--" (at -9 6) (layer "F.SilkS") (effects (font (size 1.2 1.2) (thickness 0.18))))
{rect("F.SilkS", 0.15)}
{rect("F.CrtYd", 0.05)}
{rect("F.Fab", 0.1)}
''' + '\n'.join(pads) + '''
  (model "${KIPRJMOD}/3dmodels/MEGA2560_PRO_on_sockets.wrl" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))
)
'''
    open(path, 'w').write(txt)

# ---------- 3D models we have to draw ourselves (VRML, KiCad unit = 0.1 inch) ----------
def vrml(shapes):
    u = 1 / 2.54
    out = ['#VRML V2.0 utf8', '# DrumDuino: simplified model for placement / height checks']
    for s in shapes:
        col = ' '.join('%.3f' % c for c in s['color'])
        mat = f'material Material {{ diffuseColor {col} specularColor 0.2 0.2 0.2 shininess 0.3 }}'
        if s['kind'] == 'box':
            (xa, xb), (ya, yb), (za, zb) = s['x'], s['y'], s['z']
            cx, cy, cz = (xa + xb) / 2, -(ya + yb) / 2, (za + zb) / 2
            out.append(f'Transform {{ translation {cx*u:.4f} {cy*u:.4f} {cz*u:.4f} children Shape {{ appearance Appearance {{ {mat} }} '
                       f'geometry Box {{ size {abs(xb-xa)*u:.4f} {abs(yb-ya)*u:.4f} {abs(zb-za)*u:.4f} }} }} }}')
        else:  # cylinder along +x
            (xa, xb), cy, cz, r = s['x'], s['y'], s['z'], s['r']
            cx = (xa + xb) / 2
            out.append(f'Transform {{ translation {cx*u:.4f} {-cy*u:.4f} {cz*u:.4f} rotation 0 0 1 1.5708 children Shape {{ appearance Appearance {{ {mat} }} '
                       f'geometry Cylinder {{ radius {r*u:.4f} height {abs(xb-xa)*u:.4f} }} }} }}')
    return '\n'.join(out) + '\n'

BLACK, DARK, GREY, SILVER, GOLD = (0.08, 0.08, 0.09), (0.12, 0.13, 0.16), (0.35, 0.35, 0.37), (0.75, 0.75, 0.78), (0.85, 0.7, 0.3)

def write_models(d):
    os.makedirs(d, exist_ok=True)
    # Rean / Neutrik NRJ6HF, footprint frame: T pad at origin, body x -7.35..16.95, nose 16.95..25.85
    jack = [dict(kind='box', x=(-7.35, 16.95), y=(-2.09, 13.66), z=(0, 12.4), color=BLACK),
            dict(kind='cyl', x=(16.95, 25.85), y=7.23, z=6.3, r=4.75, color=SILVER)]
    open(os.path.join(d, 'Jack_6.35mm_Rean_NRJ6HF_simplified.wrl'), 'w').write(vrml(jack))
    # Mega 2560 PRO on female sockets, footprint frame (y down)
    zb = SOCKET_H + HEADER_H
    zt = zb + PCB_T
    m = [
        dict(kind='box', x=(-22.86, 17.78), y=(-16.51, -11.43), z=(0, SOCKET_H), color=BLACK),           # 2x16 socket
        dict(kind='box', x=(-35.56, -27.94), y=(16.51, 21.59), z=(0, SOCKET_H), color=BLACK),            # 2x3 socket
        dict(kind='box', x=(-22.86, 17.78), y=(-16.51, -11.43), z=(SOCKET_H, zb), color=DARK),           # male header plastic
        dict(kind='box', x=(-35.56, 17.78), y=(16.51, 21.59), z=(SOCKET_H, zb), color=DARK),             # 2x21 header row
        dict(kind='box', x=(-35.56, 17.78), y=(-16.51, 21.59), z=(zb, zt), color=(0.06, 0.06, 0.07)),    # module PCB
        dict(kind='box', x=(-12.0, 2.0), y=(-4.5, 9.5), z=(zt, zt + 1.4), color=BLACK),                 # ATmega2560 TQFP-100
        dict(kind='box', x=(2.0, 13.0), y=(12.0, 16.5), z=(zt, zt + 3.5), color=SILVER),                 # 16 MHz crystal
        dict(kind='box', x=(-33.5, -27.5), y=(-14.5, -8.5), z=(zt, zt + 3.5), color=GREY),               # reset button
        dict(kind='cyl', x=(-31.5, -29.5), y=-11.5, z=zt + 4.0, r=1.3, color=(0.8, 0.1, 0.1)),           # button cap
        dict(kind='box', x=(-29.0, -23.0), y=(-6.0, 4.0), z=(zt, zt + 1.6), color=BLACK),                # CH340G
        dict(kind='box', x=(-34.0, -27.5), y=(10.0, 16.0), z=(zt, zt + 1.8), color=BLACK),               # regulator
        dict(kind='box', x=(-36.3, -30.5), y=(-1.25, 6.25), z=(zb - 2.8, zb), color=SILVER),             # micro USB (underside, left edge)
    ]
    for n, X, Y in TOP + [(n, X, Y) for n, X, Y in BOT]:
        m.append(dict(kind='box', x=(X - 0.32, X + 0.32), y=(-Y - 0.32, -Y + 0.32), z=(SOCKET_H - 6.0, zb), color=GOLD))
    open(os.path.join(d, 'MEGA2560_PRO_on_sockets.wrl'), 'w').write(vrml(m))
    # official models used by the library footprints
    for rel in ['Resistor_THT.3dshapes/R_Axial_DIN0207_L6.3mm_D2.5mm_P2.54mm_Vertical',
                'Diode_THT.3dshapes/D_DO-41_SOD81_P2.54mm_Vertical_AnodeUp',
                'Diode_THT.3dshapes/D_DO-41_SOD81_P10.16mm_Horizontal',
                'Connector_BarrelJack.3dshapes/BarrelJack_Horizontal']:
        for ext in ('.wrl', '.step'):
            src = os.path.join(P3D, rel + ext)
            if os.path.exists(src):
                shutil.copy(src, os.path.join(d, os.path.basename(rel) + ext))

# ---------- channels ----------
SUGGEST = {0: 'CRASH', 1: 'HIHAT', 2: 'SNARE', 3: 'KICK', 4: 'TOM1', 5: 'TOM2', 6: 'FLOOR', 7: 'RIDE',
           8: 'SN RIM', 9: 'BELL', 10: 'AUX', 11: 'AUX', 12: 'AUX', 13: 'AUX', 14: 'AUX', 15: 'HH PEDAL'}
PEDAL = 15
TOP_CH = [0, 2, 4, 6, 8, 10, 12, 14]     # outer header row
BOT_CH = [1, 3, 5, 7, 9, 11, 13, 15]     # inner header row
PITCH = 17.0
MARGIN = (W - (PITCH * 7 + 16.75)) / 2   # jack courtyard is 16.75 mm wide
JACK_DEPTH_T = 16.95                     # T pad distance from the jack's front face (= board edge)
CH = {}
for i, c in enumerate(TOP_CH):
    CH[c] = dict(side='top', idx=i, tx=MARGIN + 2.59 + PITCH * i, ty=JACK_DEPTH_T)
for i, c in enumerate(BOT_CH):
    CH[c] = dict(side='bot', idx=i, tx=MARGIN + 14.16 + PITCH * i, ty=H - JACK_DEPTH_T)

def uid():
    return str(uuid.uuid4())

# ================= schematic =================
def sym_block(lib, name):
    t = open(os.path.join(KSYM, lib + '.kicad_sym')).read()
    i = t.index('(symbol "%s"' % name)
    d = 0
    for j in range(i, len(t)):
        if t[j] == '(':
            d += 1
        elif t[j] == ')':
            d -= 1
            if d == 0:
                return t[i:j + 1].replace('(symbol "%s"' % name, '(symbol "%s:%s"' % (lib, name), 1)

def pins_of(block):
    return {m.group(4): (float(m.group(1)), float(m.group(2)))
            for m in re.finditer(r'\(pin \w+ \w+ \(at ([-\d.]+) ([-\d.]+) (\d+)\).*?\(number "(\w+)"', block, re.S)}

MOD_PINS_L = ['A%d' % i for i in range(16)]
MOD_PINS_R = ['VIN', 'VCC', 'GND']
MOD_H = 2.54 * 17
def module_symbol():
    pins = []
    for k, n in enumerate(MOD_PINS_L):
        y = MOD_H / 2 - 2.54 * (k + 1)
        pins.append(f'(pin passive line (at -15.24 {y:.2f} 0) (length 2.54) (name "{n}" (effects (font (size 1.27 1.27)))) (number "{n}" (effects (font (size 1.27 1.27)))))')
    for k, n in enumerate(MOD_PINS_R):
        y = MOD_H / 2 - 2.54 * (k + 1)
        pins.append(f'(pin passive line (at 15.24 {y:.2f} 180) (length 2.54) (name "{n}" (effects (font (size 1.27 1.27)))) (number "{n}" (effects (font (size 1.27 1.27)))))')
    return f'''(symbol "drumduino:MEGA2560_PRO" (in_bom yes) (on_board yes)
      (property "Reference" "U" (at 0 {MOD_H/2+2.54:.2f} 0) (effects (font (size 1.27 1.27))))
      (property "Value" "MEGA2560_PRO" (at 0 {-MOD_H/2-2.54:.2f} 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "drumduino:MEGA2560_PRO_Socket" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
      (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
      (symbol "MEGA2560_PRO_0_1" (rectangle (start -12.7 {MOD_H/2:.2f}) (end 12.7 {-MOD_H/2:.2f}) (stroke (width 0.254) (type default)) (fill (type background))))
      (symbol "MEGA2560_PRO_1_1" {" ".join(pins)}))'''

LIB = {
    'R': sym_block('Device', 'R'),
    'D': sym_block('Device', 'D_Zener'),
    'DS': sym_block('Device', 'D_Schottky'),
    'JK': sym_block('Connector_Audio', 'AudioJack3'),
    'BJ': sym_block('Connector', 'Barrel_Jack_Switch'),
    'U': module_symbol(),
}
LIBID = {'R': 'Device:R', 'D': 'Device:D_Zener', 'DS': 'Device:D_Schottky', 'JK': 'Connector_Audio:AudioJack3',
         'BJ': 'Connector:Barrel_Jack_Switch', 'U': 'drumduino:MEGA2560_PRO'}
PINS = {k: pins_of(v) for k, v in LIB.items()}
PINS['U'] = {**{n: (-15.24, MOD_H / 2 - 2.54 * (k + 1)) for k, n in enumerate(MOD_PINS_L)},
             **{n: (15.24, MOD_H / 2 - 2.54 * (k + 1)) for k, n in enumerate(MOD_PINS_R)}}

JACK_FP = 'Connector_Audio:Jack_6.35mm_Neutrik_NRJ6HF_Horizontal'
RFP = 'Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P2.54mm_Vertical'
DFP = 'Diode_THT:D_DO-41_SOD81_P2.54mm_Vertical_AnodeUp'
DPFP = 'Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal'
BJFP = 'Connector_BarrelJack:BarrelJack_Horizontal'

COMP = {}
def comp(ref, kind, value, fp, nets, pos):
    COMP[ref] = dict(kind=kind, value=value, fp=fp, nets=nets, pos=pos, uuid=uid())

comp('U1', 'U', 'MEGA2560_PRO', 'drumduino:MEGA2560_PRO_Socket',
     {**{'A%d' % i: 'A%d' % i for i in range(16)}, 'VIN': 'VIN', 'VCC': 'VCC', 'GND': 'GND'}, (60.96, 116.84))
for c in range(16):
    col, row = c % 4, c // 4
    bx, by = 116.84 + col * 66.04, 55.88 + row * 30.48
    n = 'A%d' % c
    if c == PEDAL:
        comp('J%d' % (c + 1), 'JK', 'HH PEDAL (T=wiper R=VCC S=GND)', JACK_FP, {'T': n, 'R': 'VCC', 'S': 'GND'}, (bx, by))
    else:
        comp('J%d' % (c + 1), 'JK', 'IN %s %s' % (n, SUGGEST[c]), JACK_FP, {'T': n, 'S': 'GND'}, (bx, by))
    comp('R%d' % (c + 1), 'R', '1M', RFP, {'1': n, '2': 'GND'}, (bx + 20.32, by))
    comp('D%d' % (c + 1), 'D', '1N4733A 5V1', DFP, {'1': n, '2': 'GND'}, (bx + 38.1, by))
comp('J17', 'BJ', 'DC 5.5x2.1 9V', BJFP, {'1': 'VRAW', '2': 'GND', '3': 'GND'}, (35.56, 190.5))
comp('D17', 'DS', '1N5819', DPFP, {'1': 'VIN', '2': 'VRAW'}, (63.5, 187.96))

def write_schematic(path):
    root = uid()
    out = [f'(kicad_sch (version 20230121) (generator eeschema)\n  (uuid {root})\n  (paper "A3")',
           '  (title_block (title "DrumDuino carrier v2 for Mega 2560 PRO") (rev "2.0") (comment 1 "16 jack inputs: 1M + 5V1 zener each. A15 = hi-hat pedal (T=wiper R=VCC S=GND). DC 9V -> 1N5819 -> VIN"))',
           '  (lib_symbols\n    ' + '\n    '.join(LIB.values()) + '\n  )']
    for ref, c in COMP.items():
        sx, sy = c['pos']
        k = c['kind']
        pins = ' '.join(f'(pin "{p}" (uuid {uid()}))' for p in PINS[k])
        dy = 25 if k == 'U' else 7.62
        out.append(f'''  (symbol (lib_id "{LIBID[k]}") (at {sx} {sy} 0) (unit 1) (in_bom yes) (on_board yes) (dnp no) (uuid {c["uuid"]})
    (property "Reference" "{ref}" (at {sx} {sy - dy} 0) (effects (font (size 1.27 1.27))))
    (property "Value" "{c["value"]}" (at {sx} {sy + dy} 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "{c["fp"]}" (at {sx} {sy} 0) (effects (font (size 1.27 1.27)) hide))
    (property "Datasheet" "~" (at {sx} {sy} 0) (effects (font (size 1.27 1.27)) hide))
    {pins}
    (instances (project "{NAME}" (path "/{root}" (reference "{ref}") (unit 1)))))''')
        for p, net in c['nets'].items():
            px, py = PINS[k][p]
            x, y = round(sx + px, 2), round(sy - py, 2)
            ang = 180 if px < 0 else 0
            just = 'right bottom' if ang == 180 else 'left bottom'
            out.append(f'  (label "{net}" (at {x} {y} {ang}) (fields_autoplaced) (effects (font (size 1.27 1.27)) (justify {just})) (uuid {uid()}))')
        if k == 'JK' and 'R' not in c['nets']:
            px, py = PINS[k]['R']
            out.append(f'  (no_connect (at {round(sx + px, 2)} {round(sy - py, 2)}) (uuid {uid()}))')
    out.append(f'''  (text "Jacks: Rean/Neutrik NRJ6HF stereo 6.35 mm PCB jacks, mounted on the board edges (noses out).\\nPiezo: mono guitar cable (TIP = signal, SLEEVE = GND).  Hi-hat pedal: stereo cable, TIP = pot wiper, RING = VCC.\\nPower: 9 V DC (center +) -> 1N5819 -> VIN, or USB only." (at 116.84 22.86 0) (effects (font (size 1.8 1.8)) (justify left bottom)) (uuid {uid()}))''')
    out.append('  (sheet_instances (path "/" (page "1")))\n)\n')
    open(path, 'w').write('\n'.join(out))

# ================= PCB =================
def mm(v):
    return FromMM(v)

def build_pcb(path):
    board = pcbnew.CreateEmptyBoard()
    ds = board.GetDesignSettings()
    ds.SetCopperLayerCount(2)
    ds.m_TrackMinWidth = mm(0.2); ds.m_MinClearance = mm(0.2); ds.m_ViasMinSize = mm(0.6)
    nc = ds.m_NetSettings.m_DefaultNetClass
    nc.SetClearance(mm(0.25)); nc.SetTrackWidth(mm(SIG_W)); nc.SetViaDiameter(mm(0.8)); nc.SetViaDrill(mm(0.4))

    nets = {}
    def net(n):
        if n not in nets:
            ni = pcbnew.NETINFO_ITEM(board, n); board.Add(ni); nets[n] = ni
        return nets[n]
    for n in ['GND', 'VCC', 'VIN', 'VRAW'] + ['A%d' % i for i in range(16)]:
        net(n)

    def seg(a, b, layer=pcbnew.Edge_Cuts, w=0.1):
        s = pcbnew.PCB_SHAPE(board); s.SetShape(pcbnew.SHAPE_T_SEGMENT)
        s.SetStart(VECTOR2I(mm(a[0]), mm(a[1]))); s.SetEnd(VECTOR2I(mm(b[0]), mm(b[1])))
        s.SetLayer(layer); s.SetWidth(mm(w)); board.Add(s)
    for a, b in [((0, 0), (W, 0)), ((W, 0), (W, H)), ((W, H), (0, H)), ((0, H), (0, 0))]:
        seg(a, b)

    fps = {}
    def place(ref, libfp, x, y, rot=0, model=None):
        lib, name = libfp.split(':')
        libpath = os.path.join(OUT, 'drumduino.pretty') if lib == 'drumduino' else os.path.join(KFP, lib + '.pretty')
        fp = pcbnew.FootprintLoad(libpath, name)
        fp.SetFPID(pcbnew.LIB_ID(lib, name))
        fp.SetReference(ref)
        c = COMP.get(ref)
        if c:
            fp.SetValue(c['value']); fp.SetPath(pcbnew.KIID_PATH('/' + c['uuid']))
        fp.SetPosition(VECTOR2I(mm(x), mm(y)))
        if rot:
            fp.SetOrientationDegrees(rot)
        board.Add(fp)
        if c:
            for pad in fp.Pads():
                if pad.GetNumber() in c['nets']:
                    pad.SetNet(net(c['nets'][pad.GetNumber()]))
        if (ref[0] in 'RD' and ref != 'D17') or (ref[0] == 'J' and ref != 'J17'):
            fp.Reference().SetVisible(False)
        fps[ref] = fp
        return fp
    def padpos(ref, num, which=0):
        ps = [p for p in fps[ref].Pads() if p.GetNumber() == num]
        v = ps[which].GetPosition()
        return (round(pcbnew.ToMM(v.x), 4), round(pcbnew.ToMM(v.y), 4))
    def track(pts, n, layer=pcbnew.F_Cu, w=SIG_W):
        for a, b in zip(pts, pts[1:]):
            if a == b:
                continue
            t = pcbnew.PCB_TRACK(board)
            t.SetStart(VECTOR2I(mm(a[0]), mm(a[1]))); t.SetEnd(VECTOR2I(mm(b[0]), mm(b[1])))
            t.SetWidth(mm(w)); t.SetLayer(layer); t.SetNet(net(n)); board.Add(t)

    place('U1', 'drumduino:MEGA2560_PRO_Socket', MOD_X, MOD_Y)

    for c in range(16):
        info = CH[c]
        n = 'A%d' % c
        top = info['side'] == 'top'
        jref, rref, dref = 'J%d' % (c + 1), 'R%d' % (c + 1), 'D%d' % (c + 1)
        place(jref, JACK_FP, info['tx'], info['ty'], 90 if top else 270, model='Jack_6.35mm_Rean_NRJ6HF_simplified.wrl')
        tip = padpos(jref, 'T')
        assert abs(tip[0] - info['tx']) < 1e-3 and abs(tip[1] - info['ty']) < 1e-3, (jref, tip)
        ry = tip[1] + (10.55 if top else -10.55)
        dy = tip[1] + (14.55 if top else -14.55)
        place(rref, RFP, tip[0], ry, 180)        # GND end 2.54 mm to the left of the signal column
        place(dref, DFP, tip[0], dy, 180)
        hp = padpos('U1', n)
        lvl = (34.5 + 1.1 * info['idx']) if top else (86.0 - 1.1 * info['idx'])
        track([tip, (tip[0], ry), (tip[0], dy), (tip[0], lvl), (hp[0], lvl), hp], n)

    # VCC: join both module VCC pads, then on the bottom layer to the RING of the hi-hat pedal jack
    v_in, v_out = padpos('U1', 'VCC', 0), padpos('U1', 'VCC', 1)
    vlow = max(v_in, v_out, key=lambda p: p[1])
    ring = padpos('J%d' % (PEDAL + 1), 'R')
    side = ring[0] - 8.3   # between the jack's switch-contact column and its T/R/S column
    track([v_in, v_out, (vlow[0], 85.3), (side, 85.3), (side, ring[1]), ring], 'VCC', pcbnew.B_Cu, PWR_W)
    g = [padpos('U1', 'GND', 0), padpos('U1', 'GND', 1)]
    track(g, 'GND', pcbnew.F_Cu, PWR_W)

    # power: DC jack on the right edge (opening faces out) -> 1N5819 -> VIN
    place('J17', BJFP, W - 14.0, 63.0, 180)
    p1 = padpos('J17', '1')
    place('D17', DPFP, p1[0] - 22.0, p1[1], 0)
    dk, da = padpos('D17', '1'), padpos('D17', '2')
    track([p1, da], 'VRAW', pcbnew.F_Cu, 0.8)
    vin_a, vin_b = padpos('U1', 'VIN', 0), padpos('U1', 'VIN', 1)
    track([dk, (dk[0] - 4, dk[1]), (dk[0] - 4, 63.0), (vin_a[0], 63.0), vin_a, vin_b], 'VIN', pcbnew.B_Cu, 0.8)

    # mounting holes (M3)
    HOLES = [(62, 52), (100, 52), (62, 75), (100, 75)]
    for i, (x, y) in enumerate(HOLES):
        h = pcbnew.FootprintLoad(os.path.join(KFP, 'MountingHole.pretty'), 'MountingHole_3.2mm_M3')
        h.SetFPID(pcbnew.LIB_ID('MountingHole', 'MountingHole_3.2mm_M3'))
        h.SetReference('H%d' % (i + 1)); h.SetPosition(VECTOR2I(mm(x), mm(y))); board.Add(h)

    def text(s, x, y, size=1.0, layer=pcbnew.F_SilkS, bold=False, angle=0):
        t = pcbnew.PCB_TEXT(board)
        t.SetText(s); t.SetPosition(VECTOR2I(mm(x), mm(y))); t.SetLayer(layer)
        if angle:
            t.SetTextAngleDegrees(angle)
        t.SetTextSize(VECTOR2I(mm(size), mm(size))); t.SetTextThickness(mm(size * (0.2 if bold else 0.15)))
        board.Add(t)
    for c in range(16):
        info = CH[c]
        top = info['side'] == 'top'
        if c == PEDAL:
            text('A15 PEDAL', info['tx'] - 5.0, H - 29.0, 0.8, angle=90)
        else:
            text('A%d %s' % (c, SUGGEST[c]), info['tx'] + 2.6, 29.0 if top else H - 29.0, 0.9, angle=90)
    text('DrumDuino carrier v2.0 - Mega 2560 PRO', 81, 58, 1.2, bold=True)
    text('Piezo: mono cable  T=signal S=GND', 81, 61.5, 0.9)
    text('A15 HH pedal: T=wiper R=VCC S=GND', 81, 64.5, 0.9)
    text('R=1M  D=1N4733A 5V1  D17=1N5819', 81, 67.5, 0.9)
    text('DC 9V  center +', W - 14, 70.5, 1.0, bold=True)

    for layer in (pcbnew.F_Cu, pcbnew.B_Cu):
        z = pcbnew.ZONE(board)
        z.SetLayer(layer); z.SetNet(net('GND'))
        z.SetLocalClearance(mm(0.4)); z.SetMinThickness(mm(0.25))
        z.SetPadConnection(pcbnew.ZONE_CONNECTION_THERMAL)
        z.SetThermalReliefGap(mm(0.4)); z.SetThermalReliefSpokeWidth(mm(0.5))
        z.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_ALWAYS)
        ol = z.Outline(); ol.NewOutline()
        for x, y in [(0.5, 0.5), (W - 0.5, 0.5), (W - 0.5, H - 0.5), (0.5, H - 0.5)]:
            ol.Append(mm(x), mm(y))
        board.Add(z)

    def clear_of(x, y, need=1.3):
        p = VECTOR2I(mm(x), mm(y))
        for t in board.GetTracks():
            if t.HitTest(p, mm(need)):
                return False
        for fp in board.GetFootprints():
            for pad in fp.Pads():
                if pad.HitTest(p, mm(need + 0.5)):
                    return False
            if fp.GetReference().startswith(('J', 'H')) and fp.GetBoundingBox(False, False).Contains(p):
                return False
        return True
    for x in range(6, int(W) - 3, 7):
        for y in range(44, 86, 7):
            if any(abs(x - hx) < 5 and abs(y - hy) < 5 for hx, hy in HOLES):
                continue
            if 78 <= x <= 128 and 55 <= y <= 70:
                continue
            if clear_of(x, y):
                vi = pcbnew.PCB_VIA(board)
                vi.SetPosition(VECTOR2I(mm(x), mm(y))); vi.SetWidth(mm(0.8)); vi.SetDrill(mm(0.4)); vi.SetNet(net('GND'))
                board.Add(vi)

    board.SetFileName(path)
    pcbnew.SaveBoard(path, board)
    board = pcbnew.LoadBoard(path)          # zone fill is reliable only on a loaded board in KiCad 7
    board.BuildConnectivity()
    pcbnew.ZONE_FILLER(board).Fill(board.Zones())
    pcbnew.SaveBoard(path, board)
    # point every 3D model at the copies inside the project (the Python API returns copies of model entries)
    txt = open(path).read()
    txt = txt.replace('${KICAD6_3DMODEL_DIR}/Connector_Audio.3dshapes/Jack_6.35mm_Neutrik_NRJ6HF_Horizontal.wrl',
                      '${KIPRJMOD}/3dmodels/Jack_6.35mm_Rean_NRJ6HF_simplified.wrl')
    txt = re.sub(r'\$\{KICAD6_3DMODEL_DIR\}/[^/"]+\.3dshapes/', '${KIPRJMOD}/3dmodels/', txt)
    open(path, 'w').write(txt)
    return pcbnew.LoadBoard(path)

def write_project():
    pro = {"meta": {"filename": NAME + ".kicad_pro", "version": 1}, "board": {}, "schematic": {}, "sheets": [], "boards": [], "libraries": {}}
    json.dump(pro, open(os.path.join(OUT, NAME + '.kicad_pro'), 'w'), indent=2)
    open(os.path.join(OUT, 'fp-lib-table'), 'w').write('(fp_lib_table\n  (lib (name "drumduino")(type "KiCad")(uri "${KIPRJMOD}/drumduino.pretty")(options "")(descr "DrumDuino"))\n)\n')
    open(os.path.join(OUT, 'sym-lib-table'), 'w').write('(sym_lib_table\n  (lib (name "drumduino")(type "KiCad")(uri "${KIPRJMOD}/drumduino.kicad_sym")(options "")(descr "DrumDuino"))\n)\n')
    open(os.path.join(OUT, 'drumduino.kicad_sym'), 'w').write('(kicad_symbol_lib (version 20220914) (generator kicad_symbol_editor)\n  ' + LIB['U'].replace('"drumduino:MEGA2560_PRO"', '"MEGA2560_PRO"') + '\n)\n')

if __name__ == '__main__':
    for stale in ['fab', 'drumduino-carrier.kicad_pcb', 'drumduino-carrier.kicad_sch', 'drumduino-carrier.kicad_prl']:
        p = os.path.join(OUT, stale)
        if os.path.isdir(p):
            shutil.rmtree(p)
        elif os.path.exists(p):
            os.remove(p)
    os.makedirs(os.path.join(OUT, 'drumduino.pretty'), exist_ok=True)
    write_module_fp(os.path.join(OUT, 'drumduino.pretty', 'MEGA2560_PRO_Socket.kicad_mod'))
    write_models(os.path.join(OUT, '3dmodels'))
    write_project()
    write_schematic(os.path.join(OUT, NAME + '.kicad_sch'))
    b = build_pcb(os.path.join(OUT, NAME + '.kicad_pcb'))
    print('ok', len(list(b.GetFootprints())), 'footprints', len(list(b.GetTracks())), 'tracks')
