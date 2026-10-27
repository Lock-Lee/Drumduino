// Web Serial link to the DrumDuino firmware.
// Protocol (text lines, 115200 baud):
//   board → app:  "I DRUMDUINO <version> <channels>"   (hello / info)
//                 "H <channel> <velocity> [R]"          (a hit, velocity 1–127; R = rim zone)
//                 "C <channel> <raw 0-1023>"            (hi-hat pedal position)
//   app → board:  "T <channel> <threshold 0-1023>"
//                 "S <channel> <scan ms>"
//                 "M <channel> <mask ms>"
//                 "E <channel> <0|1>"                    (enable input)
//                 "P <head> <rim|-1>"                    (pair rim input with head)
//                 "X <head> <ratio %>"                   (rim decision ratio)
//                 "K <channel> <0|1>"                    (1 = pedal input)
//                 "?"                                    (ask for info line)

export interface SerialEvents {
  onHit(channel: number, velocity: number, rim: boolean): void;
  onInfo(info: string): void;
  onPedal(channel: number, raw: number): void;
  onClose(error?: string): void;
}

export class SerialLink {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private pipe: Promise<void> | null = null;
  private closing = false;

  constructor(private events: SerialEvents) {}

  static supported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  get connected(): boolean {
    return this.port !== null;
  }

  /** Ask the user to pick a port (Electron shows our in-app picker) and open it. */
  async connect(): Promise<void> {
    const port = await navigator.serial.requestPort();
    await this.open(port);
  }

  async open(port: SerialPort): Promise<void> {
    await port.open({ baudRate: 115200 });
    this.port = port;
    this.closing = false;
    void this.readLoop(port);
    // Boards with auto-reset (Uno/Nano) need ~1.5 s after opening before they talk.
    setTimeout(() => this.send('?'), 1600);
  }

  private async readLoop(port: SerialPort) {
    if (!port.readable) return;
    const decoder = new TextDecoderStream();
    this.pipe = port.readable.pipeTo(decoder.writable as WritableStream<Uint8Array>).catch(() => undefined);
    this.reader = decoder.readable.getReader();
    let buf = '';
    let error: string | undefined;
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) this.handle(line);
        }
        if (buf.length > 512) buf = ''; // garbage protection
      }
    } catch (e) {
      error = this.closing ? undefined : String((e as Error)?.message || e);
    } finally {
      this.reader?.releaseLock();
      this.reader = null;
    }
    await this.pipe;
    try {
      await port.close();
    } catch {
      /* already closed / unplugged */
    }
    this.port = null;
    this.events.onClose(error);
  }

  private handle(line: string) {
    const parts = line.split(/\s+/);
    if (parts[0] === 'H' && parts.length >= 3) {
      const ch = parseInt(parts[1], 10);
      const v = parseInt(parts[2], 10);
      if (Number.isFinite(ch) && Number.isFinite(v)) this.events.onHit(ch, v, parts[3] === 'R');
    } else if (parts[0] === 'C' && parts.length >= 3) {
      const ch = parseInt(parts[1], 10);
      const raw = parseInt(parts[2], 10);
      if (Number.isFinite(ch) && Number.isFinite(raw)) this.events.onPedal(ch, raw);
    } else if (parts[0] === 'I') {
      this.events.onInfo(parts.slice(1).join(' '));
    }
  }

  async send(line: string): Promise<void> {
    const w = this.port?.writable;
    if (!w || w.locked) return;
    const writer = w.getWriter();
    try {
      await writer.write(new TextEncoder().encode(line + '\n'));
    } catch {
      /* ignore write errors; read loop reports disconnects */
    } finally {
      writer.releaseLock();
    }
  }

  async sendMany(lines: string[]): Promise<void> {
    for (const l of lines) await this.send(l);
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    try {
      await this.reader?.cancel();
    } catch {
      /* ignore */
    }
  }
}
