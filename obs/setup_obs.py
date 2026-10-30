#!/usr/bin/env python3
"""Create an OBS Studio scene collection + profile "DrumDuino" for recording drum videos on macOS.

Scenes (1920×1080, 60 fps):
  1. ตีกลอง: กล้อง + แอป   camera as a square on the left, the DrumDuino recording window on the right
  2. กล้องเต็มจอ          camera only
  3. แอปเต็มจอ            the DrumDuino window centred on a dark background
Audio: DrumDuino's own sound (drums + backing track) straight from the app via ScreenCaptureKit,
delayed 100 ms to line up with the camera; the microphone is added but muted.

The DrumDuino window is captured with an application capture of the main display and cropped to the
spot where the app puts its "โหมดอัดคลิป" window (REC below = electron/main.cjs REC).

Run with OBS closed:  python3 obs/setup_obs.py [camera-unique-id]
Then start OBS:       open -a OBS --args --collection DrumDuino --profile DrumDuino
"""
import json, os, subprocess, sys, uuid, ctypes, ctypes.util, re, configparser

OBS = os.path.expanduser('~/Library/Application Support/obs-studio')
NAME = 'DrumDuino'
REC = dict(x=40, y=110, w=560, h=720)  # points, content area of the recording window
APP_BUNDLE = 'com.github.Electron'      # DrumDuino run with `npx electron .`; the packaged app is com.drumduino.app
W, H = 1920, 1080


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
    cg.CGDisplayCreateUUIDFromDisplayID.restype = ctypes.c_void_p
    cg.CGDisplayCreateUUIDFromDisplayID.argtypes = [ctypes.c_uint32]
    cf.CFUUIDCreateString.restype = ctypes.c_void_p
    cf.CFUUIDCreateString.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    cf.CFStringGetCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]
    s = cf.CFUUIDCreateString(None, cg.CGDisplayCreateUUIDFromDisplayID(d))
    buf = ctypes.create_string_buffer(64)
    cf.CFStringGetCString(s, buf, 64, 0x08000100)
    return dict(w=w, h=h, pw=pw, ph=ph, uuid=buf.value.decode())


def cameras():
    out = subprocess.run(['system_profiler', 'SPCameraDataType'], capture_output=True, text=True).stdout
    return re.findall(r'^\s{4}(\S.*?):\s*\n\s+.*?Unique ID: (\S+)', out, re.M | re.S)


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


def item(source, i, pos=(0, 0), bounds=None, bounds_type=0, crop=(0, 0, 0, 0), bounds_crop=False, align=5, bounds_align=0, visible=True):
    bx, by = bounds or (0, 0)
    return {
        'name': source['name'], 'source_uuid': source['uuid'], 'visible': visible, 'locked': False, 'rot': 0.0,
        'scale_ref': {'x': float(W), 'y': float(H)}, 'align': align, 'bounds_type': bounds_type,
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


def build(cam_id, disp):
    sx, sy = disp['pw'] / disp['w'], disp['ph'] / disp['h']  # capture pixels per point
    inset = 2
    crop = (round(REC['x'] * sx) + inset, round(REC['y'] * sy) + inset,
            round((disp['w'] - REC['x'] - REC['w']) * sx) + inset, round((disp['h'] - REC['y'] - REC['h']) * sy) + inset)
    bg = src('พื้นหลัง', 'color_source_v3', {'color': 0xFF141210, 'width': W, 'height': H})
    cam = src('กล้อง', 'macos-avcapture', {'device': cam_id, 'use_preset': True, 'preset': 'AVCaptureSessionPreset1920x1080'})
    app = src('DrumDuino (หน้าต่างอัดคลิป)', 'screen_capture',
              {'type': 2, 'display_uuid': disp['uuid'], 'application': APP_BUNDLE, 'show_cursor': False, 'hide_obs': True})
    # app audio straight from DrumDuino; +100 ms so it lines up with the (later) camera picture
    snd = src('เสียง DrumDuino', 'sck_audio_capture', {'type': 1, 'application': APP_BUNDLE}, sync=100_000_000)
    mic = src('ไมค์', 'coreaudio_input_capture', {'device_id': 'default'}, muted=True)
    side = W - H  # 840 px for the app next to a 1080×1080 camera square
    s1 = scene('ตีกลอง: กล้อง + แอป', [
        item(bg, 1),
        item(cam, 2, (0, 0), (H, H), 3, bounds_crop=True),
        item(app, 3, (H, 0), (side, H), 2, crop),
        item(snd, 4), item(mic, 5)])
    s2 = scene('กล้องเต็มจอ', [item(cam, 1, (0, 0), (W, H), 3, bounds_crop=True), item(snd, 2), item(mic, 3)])
    s3 = scene('แอปเต็มจอ', [item(bg, 1), item(app, 2, (0, 0), (W, H), 2, crop), item(snd, 3), item(mic, 4)])
    scenes = [s1, s2, s3]
    return {
        'name': NAME,
        'sources': [bg, cam, app, snd, mic] + scenes,
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


def profile():
    d = os.path.join(OBS, 'basic', 'profiles', NAME)
    os.makedirs(d, exist_ok=True)
    movies = os.path.expanduser('~/Movies/DrumDuino')
    os.makedirs(movies, exist_ok=True)
    ini = f"""[General]
Name={NAME}

[Output]
Mode=Simple
FilenameFormatting=DrumDuino %CCYY-%MM-%DD %hh-%mm-%ss

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


if __name__ == '__main__':
    if subprocess.run(['pgrep', '-x', 'OBS'], capture_output=True).returncode == 0:
        sys.exit('ปิด OBS ก่อน แล้วรันใหม่ (OBS จะเขียนทับไฟล์ตอนปิด)')
    cams = cameras()
    want = sys.argv[1] if len(sys.argv) > 1 else None
    cam_id = want or next((u for n, u in cams if 'iPhone' in n), cams[0][1] if cams else '')
    disp = main_display()
    coll, crop = build(cam_id, disp)
    path = os.path.join(OBS, 'basic', 'scenes', NAME + '.json')
    with open(path, 'w') as f:
        json.dump(coll, f, ensure_ascii=False, indent=4)
    movies = profile()
    print('scene collection:', path)
    print('camera:', next((n for n, u in cams if u == cam_id), cam_id))
    print('display:', disp, 'crop:', crop)
    print('recordings go to:', movies)
