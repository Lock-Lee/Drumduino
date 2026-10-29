#!/usr/bin/env python3
"""Generate the DrumDuino carrier board (KiCad 7): schematic + PCB for a Mega 2560 PRO (Embed) module.

16 analog inputs. Each input: screw terminal (tip / sleeve of a 6.35 mm jack wired to it),
1 MΩ to GND, 5.1 V zener to GND. A15 is the hi-hat pedal input and also gets VCC on its terminal.
Run:  python3 gen_carrier.py   (writes into ./drumduino-carrier/)
"""
import os, re, uuid, json
import pcbnew
from pcbnew import VECTOR2I, FromMM

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'drumduino-carrier')
NAME = 'drumduino-carrier'
os.makedirs(OUT, exist_ok=True)
KSYM = '/usr/share/kicad/symbols'
KFP = '/usr/share/kicad/footprints'

W, H = 100.0, 100.0          # board size (mm), fits the cheapest JLCPCB size
SIG_W, PWR_W = 0.4, 0.6      # track widths

# ---------- Mega 2560 PRO pad map (RobotDyn, from the mikroavr Eagle library; module coords, y up) ----------
MOD_X, MOD_Y = 36.56, 46.51  # board position of the module origin: left edge at x=1, top edge at y=30
def mod_pt(X, Y):
    return (MOD_X + X, MOD_Y - Y)
TOP = []  # (pad name, X, Y)
for c in range(16):
    X = -21.59 + 2.54 * c
    TOP.append(('A%d' % (2 * c) if c < 8 else 'D%d' % (32 + 2 * (c - 8)), X, 15.24))
    TOP.append(('A%d' % (2 * c + 1) if c < 8 else 'D%d' % (33 + 2 * (c - 8)), X, 12.70))
BOT = []  # only the first 3 columns get a 2x3 socket: VIN / GND / VCC (5V)
for X, n in [(-34.29, 'VIN'), (-31.75, 'GND'), (-29.21, 'VCC')]:
    BOT += [(n, X, -17.78), (n, X, -20.32)]

def write_module_fp(path):
    pads = []
    for i, (n, X, Y) in enumerate(TOP + BOT):
        shape = 'rect' if n == 'A0' else 'circle'
        pads.append(f'  (pad "{n}" thru_hole {shape} (at {X:.3f} {-Y:.3f}) (size 1.7 1.7) (drill 1.0) (layers "*.Cu" "*.Mask"))')
    x0, x1, y0, y1 = -35.56, 17.78, -16.51, 21.59  # module outline in footprint coords (y down)
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
  (fp_text user "MEGA 2560 PRO  (USB <-- left edge)" (at -9 6) (layer "F.SilkS") (effects (font (size 1.2 1.2) (thickness 0.18))))
{rect("F.SilkS", 0.15)}
{rect("F.CrtYd", 0.05)}
{rect("F.Fab", 0.1)}
''' + '\n'.join(pads) + '\n)\n'
    open(path, 'w').write(txt)

# ---------- channels ----------
SUGGEST = {0: 'CRASH', 1: 'HIHAT', 2: 'SNARE', 3: 'KICK', 4: 'TOM1', 5: 'TOM2', 6: 'FLOOR', 7: 'RIDE',
           8: 'SN RIM', 9: 'RIDE BELL', 10: 'AUX', 11: 'AUX', 12: 'AUX', 13: 'AUX', 14: 'AUX', 15: 'HH PEDAL'}
PEDAL = 15
# even A on the top edge (they sit on the outer header row), odd A on the bottom edge (inner row)
TOP_CH = [0, 2, 4, 6, 8, 10, 12, 14]
BOT_CH = [1, 3, 5, 7, 9, 11, 13, 15]
TOP_X = [9.5 + 11.3 * i for i in range(8)]
BOT_X = [4.5 + 11.3 * i for i in range(7)] + [83.8]
TOP_TY, BOT_TY = 6.0, 94.0          # terminal pad row
CH = {}                              # ch -> dict(ref numbers, terminal x, side)
for i, c in enumerate(TOP_CH):
    CH[c] = dict(side='top', idx=i, X=TOP_X[i])
for i, c in enumerate(BOT_CH):
    CH[c] = dict(side='bot', idx=i, X=BOT_X[i])

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
MOD_PINS_R = ['VCC', 'GND']
def module_symbol():
    h = 2.54 * 17
    pins = []
    for k, n in enumerate(MOD_PINS_L):
        y = h / 2 - 2.54 * (k + 1)
        pins.append(f'(pin passive line (at -15.24 {y:.2f} 0) (length 2.54) (name "{n}" (effects (font (size 1.27 1.27)))) (number "{n}" (effects (font (size 1.27 1.27)))))')
    for k, n in enumerate(MOD_PINS_R):
        y = h / 2 - 2.54 * (k + 1)
        pins.append(f'(pin passive line (at 15.24 {y:.2f} 180) (length 2.54) (name "{n}" (effects (font (size 1.27 1.27)))) (number "{n}" (effects (font (size 1.27 1.27)))))')
    return f'''(symbol "drumduino:MEGA2560_PRO" (in_bom yes) (on_board yes)
      (property "Reference" "U" (at 0 {h/2+2.54:.2f} 0) (effects (font (size 1.27 1.27))))
      (property "Value" "MEGA2560_PRO" (at 0 {-h/2-2.54:.2f} 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "drumduino:MEGA2560_PRO_Socket" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
      (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
      (symbol "MEGA2560_PRO_0_1" (rectangle (start -12.7 {h/2:.2f}) (end 12.7 {-h/2:.2f}) (stroke (width 0.254) (type default)) (fill (type background))))
      (symbol "MEGA2560_PRO_1_1" {" ".join(pins)}))'''

LIB = {
    'R': sym_block('Device', 'R'),
    'D': sym_block('Device', 'D_Zener'),
    'T2': sym_block('Connector', 'Screw_Terminal_01x02'),
    'T3': sym_block('Connector', 'Screw_Terminal_01x03'),
    'U': module_symbol(),
}
LIBID = {'R': 'Device:R', 'D': 'Device:D_Zener', 'T2': 'Connector:Screw_Terminal_01x02',
         'T3': 'Connector:Screw_Terminal_01x03', 'U': 'drumduino:MEGA2560_PRO'}
PINS = {k: pins_of(v) for k, v in LIB.items()}
PINS['U'] = {**{n: (-15.24, 2.54 * 17 / 2 - 2.54 * (k + 1)) for k, n in enumerate(MOD_PINS_L)},
             **{n: (15.24, 2.54 * 17 / 2 - 2.54 * (k + 1)) for k, n in enumerate(MOD_PINS_R)}}

# components: ref -> dict(kind, value, footprint, nets{pin:net}, sch pos, uuid)
COMP = {}
def comp(ref, kind, value, fp, nets, pos):
    COMP[ref] = dict(kind=kind, value=value, fp=fp, nets=nets, pos=pos, uuid=uid())

comp('U1', 'U', 'MEGA2560_PRO', 'drumduino:MEGA2560_PRO_Socket',
     {**{'A%d' % i: 'A%d' % i for i in range(16)}, 'VCC': 'VCC', 'GND': 'GND'}, (60.96, 101.6))
T2FP = 'TerminalBlock_Phoenix:TerminalBlock_Phoenix_MKDS-1,5-2-5.08_1x02_P5.08mm_Horizontal'
T3FP = 'TerminalBlock_Phoenix:TerminalBlock_Phoenix_MKDS-1,5-3-5.08_1x03_P5.08mm_Horizontal'
RFP = 'Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P2.54mm_Vertical'
DFP = 'Diode_THT:D_DO-41_SOD81_P3.81mm_Vertical_AnodeUp'
for c in range(16):
    col, row = c % 4, c // 4
    bx, by = 116.84 + col * 66.04, 50.8 + row * 30.48
    n = 'A%d' % c
    if c == PEDAL:
        comp('J%d' % (c + 1), 'T3', 'HH PEDAL (wiper/VCC/GND)', T3FP, {'1': n, '2': 'VCC', '3': 'GND'}, (bx, by))
    else:
        comp('J%d' % (c + 1), 'T2', 'IN %s %s' % (n, SUGGEST[c]), T2FP, {'1': n, '2': 'GND'}, (bx, by))
    comp('R%d' % (c + 1), 'R', '1M', RFP, {'1': n, '2': 'GND'}, (bx + 20.32, by))
    comp('D%d' % (c + 1), 'D', '1N4733A 5V1', DFP, {'1': n, '2': 'GND'}, (bx + 38.1, by))  # pin1 = K

def write_schematic(path):
    root = uid()
    out = [f'(kicad_sch (version 20230121) (generator eeschema)\n  (uuid {root})\n  (paper "A3")',
           '  (title_block (title "DrumDuino carrier for Mega 2560 PRO") (rev "1.0") (comment 1 "16 piezo inputs: 1M + 5V1 zener each. A15 = hi-hat pedal (pot: wiper/VCC/GND)"))',
           '  (lib_symbols\n    ' + '\n    '.join(LIB.values()) + '\n  )']
    for ref, c in COMP.items():
        sx, sy = c['pos']
        k = c['kind']
        fp = c['fp']
        pins = ' '.join(f'(pin "{p}" (uuid {uid()}))' for p in PINS[k])
        out.append(f'''  (symbol (lib_id "{LIBID[k]}") (at {sx} {sy} 0) (unit 1) (in_bom yes) (on_board yes) (dnp no) (uuid {c["uuid"]})
    (property "Reference" "{ref}" (at {sx + (0 if k != 'U' else 0)} {sy - (25 if k == 'U' else 6.35)} 0) (effects (font (size 1.27 1.27))))
    (property "Value" "{c["value"]}" (at {sx} {sy + (25 if k == 'U' else 6.35)} 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "{fp}" (at {sx} {sy} 0) (effects (font (size 1.27 1.27)) hide))
    (property "Datasheet" "~" (at {sx} {sy} 0) (effects (font (size 1.27 1.27)) hide))
    {pins}
    (instances (project "{NAME}" (path "/{root}" (reference "{ref}") (unit 1)))))''')
        for p, net in c['nets'].items():
            px, py = PINS[k][p]
            x, y = round(sx + px, 2), round(sy - py, 2)
            ang = 180 if px < 0 or (k == 'R' and False) else 0
            just = 'right bottom' if ang == 180 else 'left bottom'
            out.append(f'  (label "{net}" (at {x} {y} {ang}) (fields_autoplaced) (effects (font (size 1.27 1.27)) (justify {just})) (uuid {uid()}))')
    out.append(f'''  (text "Wire each 6.35 mm jack: TIP -> terminal pin 1, SLEEVE -> pin 2 (GND).\\nHi-hat pedal (10k pot, TRS jack): TIP = wiper -> J16 pin 1, RING -> pin 2 (VCC), SLEEVE -> pin 3 (GND).\\nIn the app: rim / pedal inputs are set per pad on the Hardware page." (at 116.84 20.32 0) (effects (font (size 1.8 1.8)) (justify left bottom)) (uuid {uid()}))''')
    out.append(f'  (sheet_instances (path "/" (page "1")))\n)\n')
    open(path, 'w').write('\n'.join(out))
    return root

# ================= PCB =================
def mm(v):
    return FromMM(v)

def build_pcb(path):
    board = pcbnew.CreateEmptyBoard()
    ds = board.GetDesignSettings()
    ds.SetCopperLayerCount(2)
    ds.m_TrackMinWidth = mm(0.2)
    ds.m_MinClearance = mm(0.2)
    ds.m_ViasMinSize = mm(0.6)
    nc = ds.m_NetSettings.m_DefaultNetClass
    nc.SetClearance(mm(0.25)); nc.SetTrackWidth(mm(SIG_W)); nc.SetViaDiameter(mm(0.8)); nc.SetViaDrill(mm(0.4))

    nets = {}
    def net(n):
        if n not in nets:
            ni = pcbnew.NETINFO_ITEM(board, n)
            board.Add(ni)
            nets[n] = ni
        return nets[n]
    for n in ['GND', 'VCC'] + ['A%d' % i for i in range(16)]:
        net(n)

    # outline
    def seg(a, b, layer=pcbnew.Edge_Cuts, w=0.1):
        s = pcbnew.PCB_SHAPE(board)
        s.SetShape(pcbnew.SHAPE_T_SEGMENT)
        s.SetStart(VECTOR2I(mm(a[0]), mm(a[1]))); s.SetEnd(VECTOR2I(mm(b[0]), mm(b[1])))
        s.SetLayer(layer); s.SetWidth(mm(w))
        board.Add(s)
    for a, b in [((0, 0), (W, 0)), ((W, 0), (W, H)), ((W, H), (0, H)), ((0, H), (0, 0))]:
        seg(a, b)

    fps = {}
    def place(ref, libfp, x, y, rot=0):
        lib, name = libfp.split(':')
        libpath = os.path.join(OUT, 'drumduino.pretty') if lib == 'drumduino' else os.path.join(KFP, lib + '.pretty')
        fp = pcbnew.FootprintLoad(libpath, name)
        fp.SetFPID(pcbnew.LIB_ID(lib, name))
        fp.SetReference(ref)
        c = COMP.get(ref)
        if c:
            fp.SetValue(c['value'])
            fp.SetPath(pcbnew.KIID_PATH('/' + c['uuid']))
        fp.SetPosition(VECTOR2I(mm(x), mm(y)))
        if rot:
            fp.SetOrientationDegrees(rot)
        board.Add(fp)
        if c:
            for pad in fp.Pads():
                pn = pad.GetNumber()
                if pn in c['nets']:
                    pad.SetNet(net(c['nets'][pn]))
        if ref[0] in 'RDJ':
            fp.Reference().SetVisible(False)   # the channel labels on the silkscreen say what each part is for
        fps[ref] = fp
        return fp
    def padpos(ref, num):
        for p in fps[ref].Pads():
            if p.GetNumber() == num:
                v = p.GetPosition()
                return (pcbnew.ToMM(v.x), pcbnew.ToMM(v.y))
        raise KeyError((ref, num))

    def track(pts, n, layer=pcbnew.F_Cu, w=SIG_W):
        for a, b in zip(pts, pts[1:]):
            if a == b:
                continue
            t = pcbnew.PCB_TRACK(board)
            t.SetStart(VECTOR2I(mm(a[0]), mm(a[1]))); t.SetEnd(VECTOR2I(mm(b[0]), mm(b[1])))
            t.SetWidth(mm(w)); t.SetLayer(layer); t.SetNet(net(n))
            board.Add(t)

    # module
    place('U1', 'drumduino:MEGA2560_PRO_Socket', MOD_X, MOD_Y)

    # channels
    for c in range(16):
        info = CH[c]
        n = 'A%d' % c
        X = info['X']
        top = info['side'] == 'top'
        jref, rref, dref = 'J%d' % (c + 1), 'R%d' % (c + 1), 'D%d' % (c + 1)
        if top:
            place(jref, COMP[jref]['fp'], X, TOP_TY, 180)   # wire entry faces the top edge
        else:
            place(jref, COMP[jref]['fp'], X, BOT_TY, 0)     # wire entry faces the bottom edge
        tip = padpos(jref, '1')
        # R and D sit in line with the tip, their GND ends point toward the terminal's GND side
        if c == PEDAL:
            d = -1                                           # keep clear of the VCC pin on the right
        else:
            g = padpos(jref, '2')
            d = 1 if g[0] > tip[0] else -1
        ry = tip[1] + (8.5 if top else -8.7)
        dy = tip[1] + (13.5 if top else -13.7)
        place(rref, RFP, tip[0], ry, 0 if d > 0 else 180)
        place(dref, DFP, tip[0], dy, 0 if d > 0 else 180)
        # header pad for this channel
        hp = padpos('U1', n)
        if top:
            lvl = 21.5 + 1.1 * info['idx']
        else:
            lvl = 78.0 - 1.1 * info['idx']
        track([tip, (tip[0], ry), (tip[0], dy), (tip[0], lvl), (hp[0], lvl), hp], n)

    # VCC to the hi-hat pedal terminal, on the bottom layer
    v = padpos('U1', 'VCC')  # first matching pad
    vpads = [p for p in fps['U1'].Pads() if p.GetNumber() == 'VCC']
    vtop = min(vpads, key=lambda p: -p.GetPosition().y)  # the lower (outer) one
    vx, vy = pcbnew.ToMM(vtop.GetPosition().x), pcbnew.ToMM(vtop.GetPosition().y)
    jp = padpos('J%d' % (PEDAL + 1), '2')
    vy2 = min(pcbnew.ToMM(p.GetPosition().y) for p in vpads)
    track([(vx, vy2), (vx, vy), (vx, 75.6), (jp[0], 75.6), jp], 'VCC', pcbnew.B_Cu, PWR_W)  # also joins both VCC pads
    gpads = [p for p in fps['U1'].Pads() if p.GetNumber() == 'GND']
    track([(pcbnew.ToMM(p.GetPosition().x), pcbnew.ToMM(p.GetPosition().y)) for p in gpads], 'GND', pcbnew.F_Cu, PWR_W)

    # mounting holes (M3)
    for i, (x, y) in enumerate([(62, 40), (62, 60), (96.5, 25), (96.5, 72)]):
        h = pcbnew.FootprintLoad(os.path.join(KFP, 'MountingHole.pretty'), 'MountingHole_3.2mm_M3')
        h.SetFPID(pcbnew.LIB_ID('MountingHole', 'MountingHole_3.2mm_M3'))
        h.SetReference('H%d' % (i + 1)); h.SetPosition(VECTOR2I(mm(x), mm(y)))
        board.Add(h)

    # silkscreen labels
    def text(s, x, y, size=1.0, layer=pcbnew.F_SilkS, bold=False, angle=0):
        t = pcbnew.PCB_TEXT(board)
        t.SetText(s); t.SetPosition(VECTOR2I(mm(x), mm(y))); t.SetLayer(layer)
        if angle:
            t.SetTextAngleDegrees(angle)
        t.SetTextSize(VECTOR2I(mm(size), mm(size))); t.SetTextThickness(mm(size * (0.2 if bold else 0.15)))
        board.Add(t)
    for c in range(16):
        info = CH[c]
        tip = padpos('J%d' % (c + 1), '1')
        g = padpos('J%d' % (c + 1), '3' if c == PEDAL else '2')
        label = 'A%d %s' % (c, SUGGEST[c])
        if info['side'] == 'top':
            text(label, tip[0] + 3.3, 16.8, 0.85, angle=90)
        elif c == PEDAL:
            text(label, tip[0] + 2.6, 82.6, 0.8, angle=90)
        else:
            text(label, tip[0] - 3.3, 82.6, 0.85, angle=90)
    text('DrumDuino carrier v1.0  -  Mega 2560 PRO', 78, 46, 1.2, bold=True)
    text('pin1=TIP  pin2=GND(sleeve)', 78, 49.5, 0.9)
    text('A15 pedal: 1=wiper 2=VCC 3=GND', 78, 52.5, 0.9)
    text('R=1M  D=1N4733A 5V1 (band to signal)', 78, 55.5, 0.9)

    # GND pours on both layers
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
    # stitching vias in open areas
    def clear_of_copper(x, y, need=1.2):
        p = VECTOR2I(mm(x), mm(y))
        for t in board.GetTracks():
            if t.HitTest(p, mm(need)):
                return False
        for fp in board.GetFootprints():
            for pad in fp.Pads():
                if pad.HitTest(p, mm(need)):
                    return False
        return True
    cand = [(x, y) for x in range(6, 96, 6) for y in range(34, 70, 6)] + [(x, 46) for x in (70, 80, 90)]
    for x, y in cand:
        if not clear_of_copper(x, y) or any(abs(x - hx) < 4 and abs(y - hy) < 4 for hx, hy in [(62, 40), (62, 60), (96.5, 25), (96.5, 72)]):
            continue
        if 74 <= x and 44 <= y <= 57:   # keep the text block clear
            continue
        vi = pcbnew.PCB_VIA(board)
        vi.SetPosition(VECTOR2I(mm(x), mm(y))); vi.SetWidth(mm(0.8)); vi.SetDrill(mm(0.4)); vi.SetNet(net('GND'))
        board.Add(vi)

    board.SetFileName(path)
    pcbnew.SaveBoard(path, board)
    # fill zones on a freshly loaded board (filling a board built in memory crashes KiCad 7)
    board = pcbnew.LoadBoard(path)
    board.BuildConnectivity()
    pcbnew.ZONE_FILLER(board).Fill(board.Zones())
    pcbnew.SaveBoard(path, board)
    return board

def write_project():
    pro = {"meta": {"filename": NAME + ".kicad_pro", "version": 1}, "board": {}, "schematic": {}, "sheets": [], "boards": [], "libraries": {}}
    json.dump(pro, open(os.path.join(OUT, NAME + '.kicad_pro'), 'w'), indent=2)
    open(os.path.join(OUT, 'fp-lib-table'), 'w').write('(fp_lib_table\n  (lib (name "drumduino")(type "KiCad")(uri "${KIPRJMOD}/drumduino.pretty")(options "")(descr "DrumDuino"))\n)\n')
    open(os.path.join(OUT, 'sym-lib-table'), 'w').write('(sym_lib_table\n  (lib (name "drumduino")(type "KiCad")(uri "${KIPRJMOD}/drumduino.kicad_sym")(options "")(descr "DrumDuino"))\n)\n')
    open(os.path.join(OUT, 'drumduino.kicad_sym'), 'w').write('(kicad_symbol_lib (version 20220914) (generator kicad_symbol_editor)\n  ' + LIB['U'].replace('"drumduino:MEGA2560_PRO"', '"MEGA2560_PRO"') + '\n)\n')

if __name__ == '__main__':
    os.makedirs(os.path.join(OUT, 'drumduino.pretty'), exist_ok=True)
    write_module_fp(os.path.join(OUT, 'drumduino.pretty', 'MEGA2560_PRO_Socket.kicad_mod'))
    write_project()
    write_schematic(os.path.join(OUT, NAME + '.kicad_sch'))
    b = build_pcb(os.path.join(OUT, NAME + '.kicad_pcb'))
    print('ok', len(list(b.GetFootprints())), 'footprints', len(list(b.GetTracks())), 'tracks')
