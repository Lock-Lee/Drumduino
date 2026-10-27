# DrumDuino

แอปกลองไฟฟ้าสำหรับ Windows และ macOS ที่ต่อกับ Arduino + เซนเซอร์ piezo
เพิ่มไฟล์เสียงให้กลองแต่ละชิ้นได้หลายไฟล์ (ตามแรงตี / วนตามลำดับ / สุ่ม)

## สิ่งที่ทำได้

- ชุดกลอง 8 ชิ้นพร้อมเสียงกลองอะคูสติกจริง (หลายระดับแรงตี) ใช้งานได้ทันที
- **เพิ่มเสียงให้แต่ละชิ้น**: นำเข้า .wav .mp3 .ogg .flac .aiff (ลากมาวางได้) หรือเลือกจากคลังเสียง
- เล่นหลายไฟล์ต่อชิ้น: ตามแรงตี (velocity layers) · วนตามลำดับ (round robin) · สุ่ม
- ปรับความดัง, pitch, ความไวเซนเซอร์, scan/mask time แยกแต่ละชิ้น — ส่งค่าไปบอร์ดอัตโนมัติ
- เพิ่ม/ลบ/ย้ายตำแหน่งชิ้นกลอง, ตั้งชื่อ, เลือกขา Arduino
- รับสัญญาณผ่าน USB Serial (ทุกบอร์ด) หรือ USB MIDI (Leonardo / Pro Micro)
- ทดสอบด้วยคีย์บอร์ดได้ (Q W E R A S D F, กด Shift = ตีเบา)
- บันทึกอัตโนมัติ ไฟล์เสียงเก็บไว้ในเครื่อง

## ฮาร์ดแวร์

| บอร์ด | ช่อง | วิธีส่ง |
|---|---|---|
| Arduino Nano | 8 (A0–A7) | USB Serial |
| Arduino Uno | 6 (A0–A5) | USB Serial |
| Arduino Mega | 8 (A0–A7) | USB Serial |
| Leonardo / Pro Micro | 8 | USB Serial + USB MIDI |

ต่อสายแต่ละช่อง: piezo (+) → ขาอนาล็อก, piezo (−) → GND, ตัวต้านทาน 1 MΩ คร่อมขาอนาล็อกกับ GND
(แนะนำ) ไดโอดซีเนอร์ 5.1V คร่อมกันแรงดันเกิน

ลงเฟิร์มแวร์: เปิด `firmware/DrumDuino/DrumDuino.ino` ด้วย Arduino IDE → เลือกบอร์ด/พอร์ต → Upload
(Leonardo / Pro Micro ต้องติดตั้งไลบรารี `MIDIUSB` ก่อน)

ค่าเริ่มต้นของขา: A0 Crash · A1 Hi-hat · A2 Snare · A3 Kick · A4 Tom 1 · A5 Tom 2 · A6 Floor Tom · A7 Ride

## รันตอนพัฒนา

ต้องมี [Node.js](https://nodejs.org) 20 ขึ้นไป

```bash
npm install
npm run dev        # เปิดแอปพร้อม hot reload
```

## ทำตัวติดตั้ง

```bash
npm run dist:mac   # ต้องรันบน Mac  → release/DrumDuino-x.y.z-arm64.dmg และ -x64.dmg
npm run dist:win   # ต้องรันบน Windows → release/DrumDuino Setup x.y.z.exe
```

### ให้ GitHub สร้างให้ทั้งสองระบบ (ไม่ต้องมีเครื่อง Mac/Windows)

มี workflow อยู่ที่ `.github/workflows/build.yml` แล้ว

1. push โปรเจกต์นี้ขึ้น GitHub
2. ติด tag เวอร์ชันแล้ว push: `git tag v0.1.0 && git push --tags`
3. รอประมาณ 10 นาที ไฟล์ `.dmg` และ `.exe` จะอยู่ในหน้า **Releases**
   (หรือกด Run workflow ในแท็บ Actions แล้วโหลดจาก Artifacts)

### หมายเหตุตอนติดตั้ง

ตัวติดตั้งยังไม่ได้เซ็นด้วยใบรับรองของ Apple/Microsoft จึงจะมีคำเตือนครั้งแรก:

- **macOS**: ลากแอปไปที่ Applications แล้วคลิกขวาที่แอป → Open → Open
  ถ้าขึ้นว่าแอป “เสียหาย” ให้รันใน Terminal: `xattr -cr /Applications/DrumDuino.app`
- **Windows**: ถ้าขึ้น SmartScreen ให้กด *More info* → *Run anyway*

ถ้าจะแจกให้คนทั่วไป ควรซื้อ Apple Developer ID ($99/ปี) และใบรับรอง code signing ของ Windows แล้วตั้งค่าใน electron-builder

## โปรโตคอล Serial (115200 baud)

```
บอร์ด → แอป   I DRUMDUINO <version> <channels>
              H <channel> <velocity 1–127>
แอป → บอร์ด   T <channel> <threshold 0–1023>
              S <channel> <scan ms>
              M <channel> <mask ms>
              ?
```

## โครงสร้าง

```
electron/        main process (หน้าต่าง, สิทธิ์ Serial/MIDI, ตัวเลือกพอร์ต)
src/audio/       เอนจินเสียง, เสียงกลองในตัว, ที่เก็บไฟล์เสียง (IndexedDB)
src/input/       Serial, MIDI, คีย์บอร์ด
src/pages/       หน้าชุดกลอง / คลังเสียง / ฮาร์ดแวร์
firmware/        โค้ด Arduino
```

## เครดิตเสียง

เสียงกลองในตัวมาจาก [Virtuosity Drums](https://versilian-studios.com/virtuosity-drums/) โดย Versilian Studios
(ไลเซนส์ CC0 — ใช้และแจกต่อได้อิสระ) มิกซ์จากไมค์ kick + snare + overhead แล้วเลือกบางระดับแรงตีมาใช้
ดูไลเซนส์ได้ที่ `public/samples/LICENSE-VirtuosityDrums-CC0.txt`
