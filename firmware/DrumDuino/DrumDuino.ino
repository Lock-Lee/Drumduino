/*
  DrumDuino firmware — reads piezo sensors and sends hits to the DrumDuino app.

  Boards:
    - Arduino Nano / Mini (ATmega328P)  → 8 channels A0–A7, Serial only
    - Arduino Uno                        → 6 channels A0–A5, Serial only
    - Arduino Leonardo / Pro Micro (32U4)→ Serial + USB MIDI (needs the "MIDIUSB" library)
    - Arduino Mega                       → 8 channels A0–A7, Serial only

  Wiring per channel:
    piezo (+) → analog pin, piezo (−) → GND,
    1 MΩ resistor between the analog pin and GND,
    (recommended) 5.1 V zener diode across it for protection.

  Serial protocol, 115200 baud, one text line per message:
    board → app:  I DRUMDUINO <version> <channels>
                  H <channel> <velocity 1–127>
    app → board:  T <channel> <threshold 0–1023>
                  S <channel> <scan ms>
                  M <channel> <mask ms>
                  ?
*/

#define FW_VERSION "1.0"

// ---------- board setup ----------
#if defined(__AVR_ATmega32U4__)
  #define USE_MIDIUSB 1          // set to 0 if you don't want USB MIDI
  #if defined(ARDUINO_AVR_LEONARDO)
    const uint8_t PINS[] = { A0, A1, A2, A3, A4, A5, A6, A7 };   // A6 = D4, A7 = D6
  #else // Pro Micro and others
    const uint8_t PINS[] = { A0, A1, A2, A3, A6, A7, A8, A9 };   // A6=D4 A7=D6 A8=D8 A9=D9
  #endif
#elif defined(ARDUINO_AVR_UNO)
  #define USE_MIDIUSB 0
  const uint8_t PINS[] = { A0, A1, A2, A3, A4, A5 };
#else
  #define USE_MIDIUSB 0
  const uint8_t PINS[] = { A0, A1, A2, A3, A4, A5, A6, A7 };
#endif

#if USE_MIDIUSB
  #include <MIDIUSB.h>
  // General MIDI drum notes, same order as the app's default kit channels:
  // 0 Crash, 1 Hi-hat, 2 Snare, 3 Kick, 4 Tom 1, 5 Tom 2, 6 Floor Tom, 7 Ride
  const uint8_t NOTES[] = { 49, 42, 38, 36, 48, 45, 43, 51 };
  const uint8_t MIDI_CH = 9; // channel 10 (drums), 0-based
#endif

const uint8_t N = sizeof(PINS) / sizeof(PINS[0]);

// ---------- per-channel settings (the app sends these on connect) ----------
uint16_t threshold[8] = { 80, 60, 50, 90, 60, 60, 60, 80 };
uint8_t  scanMs[8]    = { 3, 2, 2, 3, 2, 2, 2, 3 };
uint8_t  maskMs[8]    = { 45, 30, 25, 45, 35, 35, 35, 45 };

// ---------- state ----------
enum State : uint8_t { IDLE, SCAN, MASK };
State    state[8];
uint16_t peak[8];
uint32_t since[8];

char     line[24];
uint8_t  lineLen = 0;

void sendInfo() {
  Serial.print(F("I DRUMDUINO "));
  Serial.print(F(FW_VERSION));
  Serial.print(' ');
  Serial.println(N);
}

void setup() {
  Serial.begin(115200);
#if defined(ADCSRA)
  // Faster ADC (prescaler 16 → ~16 µs per read) so short piezo peaks aren't missed.
  ADCSRA = (ADCSRA & ~0x07) | 0x04;
#endif
  for (uint8_t i = 0; i < N; i++) { state[i] = IDLE; peak[i] = 0; since[i] = 0; }
  sendInfo();
}

void sendHit(uint8_t ch, uint8_t vel) {
  Serial.print(F("H "));
  Serial.print(ch);
  Serial.print(' ');
  Serial.println(vel);
#if USE_MIDIUSB
  midiEventPacket_t on  = { 0x09, (uint8_t)(0x90 | MIDI_CH), NOTES[ch], vel };
  midiEventPacket_t off = { 0x08, (uint8_t)(0x80 | MIDI_CH), NOTES[ch], 0 };
  MidiUSB.sendMIDI(on);
  MidiUSB.sendMIDI(off);
  MidiUSB.flush();
#endif
}

uint8_t toVelocity(uint16_t p, uint16_t thr) {
  if (p <= thr) return 1;
  long v = map(p, thr, 1023, 1, 127);
  return (uint8_t)constrain(v, 1, 127);
}

void handleLine() {
  line[lineLen] = 0;
  char cmd = line[0];
  if (cmd == '?') { sendInfo(); return; }
  int ch = -1, val = -1;
  if (sscanf(line + 1, "%d %d", &ch, &val) != 2) return;
  if (ch < 0 || ch >= N || val < 0) return;
  switch (cmd) {
    case 'T': threshold[ch] = constrain(val, 1, 1000); break;
    case 'S': scanMs[ch]    = constrain(val, 1, 20);   break;
    case 'M': maskMs[ch]    = constrain(val, 5, 250);  break;
  }
}

void readSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (lineLen) handleLine();
      lineLen = 0;
    } else if (lineLen < sizeof(line) - 1) {
      line[lineLen++] = c;
    }
  }
}

void loop() {
  uint32_t now = millis();
  for (uint8_t i = 0; i < N; i++) {
    uint16_t v = analogRead(PINS[i]);
    switch (state[i]) {
      case IDLE:
        if (v >= threshold[i]) { state[i] = SCAN; peak[i] = v; since[i] = now; }
        break;
      case SCAN:
        if (v > peak[i]) peak[i] = v;
        if (now - since[i] >= scanMs[i]) {
          sendHit(i, toVelocity(peak[i], threshold[i]));
          state[i] = MASK;
          since[i] = now;
        }
        break;
      case MASK:
        if (now - since[i] >= maskMs[i]) state[i] = IDLE;
        break;
    }
  }
  readSerial();
}
