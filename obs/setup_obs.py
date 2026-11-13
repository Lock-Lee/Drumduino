#!/usr/bin/env python3
"""Create OBS Studio scene collections + profiles for recording DrumDuino clips on macOS (no camera).

  "DrumDuino Reels"  1080×1920 (9:16) — Reels / TikTok / Shorts, from the app's "อัดคลิป แนวตั้ง" window
  "DrumDuino"        1920×1080 (16:9) — YouTube, from the app's "อัดคลิป แนวนอน (เต็มจอ)" window
Audio: the Mac's sound output (drums + backing track) through ScreenCaptureKit desktop audio. DrumDuino's
own process can't be picked as an audio source because Electron plays sound from a helper process, so
turn on Do Not Disturb while recording to keep notification sounds out.

The DrumDuino window is captured with an application capture of the main display and cropped to the
spot where the app puts its recording window (REC below = electron/main.cjs REC).

Run with OBS closed:  python3 obs/setup_obs.py   (--force: OBS may stay open; the DrumDuino
                      collections/profiles are separate files OBS does not overwrite)
Then start OBS:       open -a OBS --args --collection "DrumDuino Reels" --profile "DrumDuino Reels"
"""
import json, os, subprocess, sys, uuid, ctypes, ctypes.util, re, configparser

OBS = os.path.expanduser('~/Library/Application Support/obs-studio')
# points, content area of the recording window (= electron/main.cjs REC)
REC = dict(x=40, y=110, w=468, h=832)     # แนวตั้ง (9:16)
REC_L = dict(x=40, y=110, w=960, h=540)   # แนวนอน (เต็มจอ)
APP_BUNDLE = 'com.github.Electron'      # DrumDuino run with `npx electron .`; the packaged app is com.drumduino.app


def main_display():
    cg = ctypes.CDLL(ctypes.util.find_library('CoreGraphics'))
    cg.CGMainDisplayID.restype = ctypes.c_uint32
    d = cg.CGMainDisplayID()
    for f in ('CGDisplayPixelsWide', 'CGDisplayPixelsHigh'):
        getattr(cg, f).restype = ctypes.c_size_t
    cg.CGDisplayCopyDisplayMode.restype = ctypes.c_void_p
    for f in ('CGDisplayModeGetPixelWidth', 'CGDisplayModeGetPixelHeight'):
        getattr(cg, f).restype = ctypes.c_size_t
        getattr(cg, f).argtypes = [ctypes.c_void_p]
    m = cg.CGDisplayCopyDisplayMode(d)
    pw, ph = cg.CGDisplayModeGetPixelWidth(m), cg.CGDisplayModeGetPixelHeight(m)
    w, h = cg.CGDisplayPixelsWide(d), cg.CGDisplayPixelsHigh(d)
    # display UUID as OBS stores it
    cf = ctypes.CDLL(ctypes.util.find_library('CoreFoundation'))
    cs = ctypes.CDLL('/System/Library/Frameworks/ColorSync.framework/ColorSync')
    cs.CGDisplayCreateUUIDFromDisplayID.restype = ctypes.c_void_p
    cs.CGDisplayCreateUUIDFromDisplayID.argtypes = [ctypes.c_uint32]
    cf.CFUUIDCreateString.restype = ctypes.c_void_p
    cf.CFUUIDCreateString.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    cf.CFStringGetCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]
    s = cf.CFUUIDCreateString(None, cs.CGDisplayCreateUUIDFromDisplayID(d))
    buf = ctypes.create_string_buffer(64)
    cf.CFStringGetCString(s, buf, 64, 0x08000100)
    return dict(w=w, h=h, pw=pw, ph=ph, uuid=buf.value.decode())


def src(name, sid, settings, **extra):
    d = {
        'prev_ver': 553648129, 'name': name, 'uuid': str(uuid.uuid4()), 'id': sid, 'versioned_id': sid,
        'settings': settings, 'mixers': 255, 'sync': 0, 'flags': 0, 'volume': 1.0, 'balance': 0.5,
        'enabled': True, 'muted': False, 'push-to-mute': False, 'push-to-mute-delay': 0, 'push-to-talk': False,
        'push-to-talk-delay': 0, 'hotkeys': {}, 'deinterlace_mode': 0, 'deinterlace_field_order': 0,
        'monitoring_type': 0, 'monitoring_enabled': False, 'private_settings': {}
    }
    d.update(extra)
    return d


def item(source, i, canvas, pos=(0, 0), bounds=None, bounds_type=0, crop=(0, 0, 0, 0), bounds_crop=False, align=5, bounds_align=0, visible=True):
    bx, by = bounds or (0, 0)
    return {
        'name': source['name'], 'source_uuid': source['uuid'], 'visible': visible, 'locked': False, 'rot': 0.0,
        'scale_ref': {'x': float(canvas[0]), 'y': float(canvas[1])}, 'align': align, 'bounds_type': bounds_type,
        'bounds_align': bounds_align, 'bounds_crop': bounds_crop,
        'crop_left': crop[0], 'crop_top': crop[1], 'crop_right': crop[2], 'crop_bottom': crop[3],
        'id': i, 'group_item_backup': False, 'pos': {'x': float(pos[0]), 'y': float(pos[1])},
        'scale': {'x': 1.0, 'y': 1.0}, 'bounds': {'x': float(bx), 'y': float(by)},
        'scale_filter': 'disable', 'blend_method': 'default', 'blend_type': 'normal',
        'show_transition': {'duration': 300}, 'hide_transition': {'duration': 300}, 'private_settings': {}
    }


def scene(name, items):
    return src(name, 'scene', {'id_counter': len(items), 'custom_size': False, 'items': items}, mixers=0,
               canvas_uuid='6c69626f-6273-4c00-9d88-c5136d61696e')


def build(name, canvas, rect, disp):
    W, H = canvas
    sx, sy = disp['pw'] / disp['w'], disp['ph'] / disp['h']  # capture pixels per point
    inset = 2
    crop = (round(rect['x'] * sx) + inset, round(rect['y'] * sy) + inset,
            round((disp['w'] - rect['x'] - rect['w']) * sx) + inset, round((disp['h'] - rect['y'] - rect['h']) * sy) + inset)
    bg = src('พื้นหลัง', 'color_source_v3', {'color': 0xFF141210, 'width': W, 'height': H})
    app = src('DrumDuino (หน้าต่างอัดคลิป)', 'screen_capture',
              {'type': 2, 'display_uuid': disp['uuid'], 'application': APP_BUNDLE, 'show_cursor': False, 'hide_obs': True})
    # desktop audio (type 0): everything the Mac plays — DrumDuino's drums and backing track
    snd = src('เสียงจากเครื่อง (DrumDuino)', 'sck_audio_capture', {'type': 0})
    s1 = scene('แอปเต็มจอ', [item(bg, 1, canvas), item(app, 2, canvas, (0, 0), (W, H), 2, crop), item(snd, 3, canvas)])
    scenes = [s1]
    return {
        'name': name,
        'sources': [bg, app, snd] + scenes,
        'groups': [],
        'scene_order': [{'name': s['name']} for s in scenes],
        'current_scene': s1['name'], 'current_program_scene': s1['name'],
        'canvases': [], 'current_transition': 'Fade', 'transition_duration': 300, 'transitions': [],
        'quick_transitions': [
            {'name': 'Cut', 'duration': 300, 'hotkeys': [], 'id': 1, 'fade_to_black': False},
            {'name': 'Fade', 'duration': 300, 'hotkeys': [], 'id': 2, 'fade_to_black': False}],
        'preview_locked': False, 'scaling_enabled': False, 'scaling_level': 0, 'scaling_off_x': 0.0, 'scaling_off_y': 0.0,
        'modules': {}, 'resolution': {'x': W, 'y': H}, 'version': 2
    }, crop


def profile(name, canvas):
    W, H = canvas
    d = os.path.join(OBS, 'basic', 'profiles', name)
    os.makedirs(d, exist_ok=True)
    movies = os.path.expanduser('~/Movies/DrumDuino')
    os.makedirs(movies, exist_ok=True)
    ini = f"""[General]
Name={name}

[Output]
Mode=Simple
FilenameFormatting={name} %CCYY-%MM-%DD %hh-%mm-%ss

[SimpleOutput]
FilePath={movies}
RecFormat2=hybrid_mp4
VBitrate=8000
ABitrate=192
UseAdvanced=false
RecQuality=HQ
RecEncoder=apple_h264
StreamEncoder=apple_h264
StreamAudioEncoder=aac
RecAudioEncoder=aac
RecTracks=1

[Video]
BaseCX={W}
BaseCY={H}
OutputCX={W}
OutputCY={H}
FPSType=0
FPSCommon=60
ScaleType=lanczos
ColorFormat=NV12
ColorSpace=709
ColorRange=Partial

[Audio]
SampleRate=48000
ChannelSetup=Stereo
"""
    with open(os.path.join(d, 'basic.ini'), 'w') as f:
        f.write(ini)
    return movies


SETUPS = [('DrumDuino Reels', (1080, 1920), REC), ('DrumDuino', (1920, 1080), REC_L)]

if __name__ == '__main__':
    if '--force' not in sys.argv and subprocess.run(['pgrep', '-x', 'OBS'], capture_output=True).returncode == 0:
        sys.exit('ปิด OBS ก่อน แล้วรันใหม่ (OBS จะเขียนทับไฟล์ตอนปิด)')
    disp = main_display()
    for name, canvas, rect in SETUPS:
        coll, crop = build(name, canvas, rect, disp)
        path = os.path.join(OBS, 'basic', 'scenes', name + '.json')
        with open(path, 'w') as f:
            json.dump(coll, f, ensure_ascii=False, indent=4)
        movies = profile(name, canvas)
        print(f'{name}: {canvas[0]}x{canvas[1]}  crop {crop}  ->  {path}')
    print('display:', disp)
    print('recordings go to:', movies)
