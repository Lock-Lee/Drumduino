/*
  DrumDuino firmware — reads piezo sensors and sends hits to the DrumDuino app.
  Supports dual-zone pads (head + rim, like Roland V-Drums): two piezos per pad,
  each on its own analog input; the firmware decides per hit whether it was the head or the rim.

  Boards:
    - Arduino Mega 2560                  → 16 channels A0–A15, Serial
    - Arduino Nano / Mini (ATmega328P)   → 8 channels A0–A7, Serial
    - Arduino Uno                        → 6 channels A0–A5, Serial
    - Arduino Leonardo / Pro Micro (32U4)→ 8 channels, Serial + USB MIDI (needs the "MIDIUSB" library)

  Wiring per channel:
    piezo (+) → analog pin, piezo (−) → GND,
    1 MΩ resistor between the analog pin and GND,
    (recommended) 5.1 V zener diode across it for protection.
  Dual-zone pad: head piezo under the drum head (centre), rim piezo on the rim/shell,
  ideally on a bit of foam so the head piezo picks up as little of a rim hit as possible.
  Hi-hat pedal (continuous controller, no 1 MΩ resistor on this input):
    potentiometer: one end → 5V, other end → GND, wiper → analog pin
    or FSR: FSR between 5V and the analog pin, 10 kΩ from the pin to GND

  Serial protocol, 115200 baud, one text line per message:
    board → app:  I DRUMDUINO <version> <channels>
                  H <channel> <velocity 1–127>        head (or single-zone) hit
                  H <channel> <velocity 1–127> R      rim hit on the pad whose head is <channel>
                  C <channel> <raw 0–1023>            pedal position (sent when it moves)
    app → board:  E <channel> <0|1>                   enable / disable a channel (unused inputs float!)
                  T <channel> <threshold 0–1023>
                  S <channel> <scan ms>
                  M <channel> <mask ms>
                  P <head channel> <rim channel|-1>   pair a rim input with a head input
                  X <head channel> <rim ratio %>      rim if rimPeak ≥ headPeak × ratio / 100
                  K <channel> <0|1>                   1 = continuous pedal input instead of a piezo
                  ?
*/

#define FW_VERSION "1.2"

// ---------- board setup ----------
#if defined(__AVR_ATmega2560__) || defined(__AVR_ATmega1280__)
  #define USE_MIDIUSB 0
  const uint8_t PINS[] = { A0, A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13, A14, A15 };
#elif defined(__AVR_ATmega32U4__)
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

const uint8_t N = sizeof(PINS) / sizeof(PINS[0]);
#define MAXCH 16

#if USE_MIDIUSB
  #include <MIDIUSB.h>
  // General MIDI drum notes per head channel (same order as the app's default kit):
  // 0 Crash, 1 Hi-hat, 2 Snare, 3 Kick, 4 Tom 1, 5 Tom 2, 6 Floor Tom, 7 Ride
  const uint8_t NOTES[]     = { 49, 42, 38, 36, 48, 45, 43, 51 };
  const uint8_t RIM_NOTES[] = { 49, 46, 40, 36, 50, 47, 58, 53 }; // snare rim 40, ride bell 53 …
  const uint8_t MIDI_CH = 9; // channel 10 (drums), 0-based
#endif

// ---------- per-channel settings (the app sends these on connect) ----------
uint16_t threshold[MAXCH];
uint8_t  scanMs[MAXCH];
uint8_t  maskMs[MAXCH];
bool     enabled[MAXCH];
int8_t   rimOf[MAXCH];     // head channel → its rim channel, -1 = single zone
bool     isRim[MAXCH];     // this channel is the rim of another pad (scanned with its head)
uint8_t  rimRatio[MAXCH];  // per head channel, %
bool     isPedal[MAXCH];   // continuous controller (hi-hat pedal)
uint16_t pedalSmooth[MAXCH];
uint16_t pedalSent[MAXCH];
uint32_t pedalAt[MAXCH];

// ---------- state ----------
enum State : uint8_t { IDLE, SCAN, MASK };
State    state[MAXCH];
uint16_t peakHead[MAXCH];
uint16_t peakRim[MAXCH];
uint32_t since[MAXCH];

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
  for (uint8_t i = 0; i < MAXCH; i++) {
    threshold[i] = 60; scanMs[i] = 3; maskMs[i] = 35;
    enabled[i] = i < 8 && i < N;   // channels 8+ stay off until the app enables them
    rimOf[i] = -1; isRim[i] = false; rimRatio[i] = 70;
    isPedal[i] = false; pedalSmooth[i] = 0; pedalSent[i] = 0xFFFF; pedalAt[i] = 0;
    state[i] = IDLE; peakHead[i] = 0; peakRim[i] = 0; since[i] = 0;
  }
  sendInfo();
}

uint8_t toVelocity(uint16_t p, uint16_t thr) {
  if (p <= thr) return 1;
  long v = map(p, thr, 1023, 1, 127);
  return (uint8_t)constrain(v, 1, 127);
}

void sendHit(uint8_t ch, uint8_t vel, bool rim) {
  Serial.print(F("H "));
  Serial.print(ch);
  Serial.print(' ');
  Serial.print(vel);
  if (rim) Serial.print(F(" R"));
  Serial.println();
#if USE_MIDIUSB
  if (ch < sizeof(NOTES)) {
    uint8_t note = rim ? RIM_NOTES[ch] : NOTES[ch];
    midiEventPacket_t on  = { 0x09, (uint8_t)(0x90 | MIDI_CH), note, vel };
    midiEventPacket_t off = { 0x08, (uint8_t)(0x80 | MIDI_CH), note, 0 };
    MidiUSB.sendMIDI(on);
    MidiUSB.sendMIDI(off);
    MidiUSB.flush();
  }
#endif
}

void unpair(uint8_t head) {
  if (rimOf[head] >= 0) isRim[rimOf[head]] = false;
  rimOf[head] = -1;
}

void handleLine() {
  line[lineLen] = 0;
  char cmd = line[0];
  if (cmd == '?') { sendInfo(); return; }
  int ch = -1, val = -1;
  if (sscanf(line + 1, "%d %d", &ch, &val) != 2) return;
  if (ch < 0 || ch >= N) return;
  switch (cmd) {
    case 'T': threshold[ch] = constrain(val, 1, 1000); break;
    case 'S': scanMs[ch]    = constrain(val, 1, 20);   break;
    case 'M': maskMs[ch]    = constrain(val, 5, 250);  break;
    case 'E': enabled[ch]   = val != 0; state[ch] = IDLE; break;
    case 'X': rimRatio[ch]  = constrain(val, 10, 400); break;
    case 'K': isPedal[ch]   = val != 0; pedalSent[ch] = 0xFFFF; state[ch] = IDLE; break;
    case 'P':
      unpair(ch);
      if (val >= 0 && val < N && val != ch) {
        // the rim can only belong to one head
        for (uint8_t h = 0; h < N; h++) if (rimOf[h] == val) rimOf[h] = -1;
        rimOf[ch] = val;
        isRim[val] = true;
        state[val] = IDLE;
      }
      break;
  }
}

// Hi-hat pedal: smooth, then report when it moved (max every 2 ms, and a refresh every 500 ms).
void readPedal(uint8_t i, uint32_t now) {
  uint16_t v = analogRead(PINS[i]);
  pedalSmooth[i] = (pedalSmooth[i] * 3 + v) / 4;
  uint16_t p = pedalSmooth[i];
  int diff = (int)p - (int)pedalSent[i];
  if (diff < 0) diff = -diff;
  if (((pedalSent[i] == 0xFFFF || diff >= 6) && now - pedalAt[i] >= 2) || now - pedalAt[i] >= 500) {
    Serial.print(F("C "));
    Serial.print(i);
    Serial.print(' ');
    Serial.println(p);
    pedalSent[i] = p;
    pedalAt[i] = now;
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
    if (!enabled[i] || isRim[i]) continue;      // rim inputs are read together with their head
    if (isPedal[i]) { readPedal(i, now); continue; }
    int8_t r = rimOf[i];
    bool dual = r >= 0 && enabled[r];
    uint16_t vh = analogRead(PINS[i]);
    uint16_t vr = dual ? analogRead(PINS[r]) : 0;

    switch (state[i]) {
      case IDLE:
        if (vh >= threshold[i] || (dual && vr >= threshold[r])) {
          state[i] = SCAN; peakHead[i] = vh; peakRim[i] = vr; since[i] = now;
        }
        break;
      case SCAN:
        if (vh > peakHead[i]) peakHead[i] = vh;
        if (vr > peakRim[i])  peakRim[i]  = vr;
        if (now - since[i] >= scanMs[i]) {
          bool rimHit = dual && peakRim[i] >= threshold[r] &&
                        (uint32_t)peakRim[i] * 100 >= (uint32_t)peakHead[i] * rimRatio[i];
          if (rimHit) sendHit(i, toVelocity(peakRim[i], threshold[r]), true);
          else        sendHit(i, toVelocity(peakHead[i], threshold[i]), false);
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
