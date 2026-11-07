// A person at the keyboard, with a counter. The journeys do everything through this class so that clicks, typed
// fields, chosen options, files and key presses are counted the way a person would count them, each stage is timed,
// and a picture is taken at the end of each stage for the audit to look at.
import fs from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { auditPath } from "./paths";

export type StageRecord = {
  name: string;
  ms: number;
  waitMs: number; // time spent waiting for the app, not acting
  clicks: number;
  fieldsTyped: number;
  optionsChosen: number;
  filesChosen: number;
  keyPresses: number;
  screenshot: string;
};

export class Journey {
  clicks = 0;
  fieldsTyped = 0;
  optionsChosen = 0;
  filesChosen = 0;
  keyPresses = 0;
  readonly stages: StageRecord[] = [];
  readonly notes: string[] = [];
  private readonly startedAt = Date.now();
  private waitMs = 0;
  private readonly typedKeys = new Set<string>();

  constructor(
    readonly page: Page,
    readonly name: string, // "j1"
  ) {}

  async click(locator: Locator): Promise<void> {
    await locator.click();
    this.clicks += 1;
  }

  // A checkbox the person ticks is one click.
  async check(locator: Locator): Promise<void> {
    await locator.check();
    this.clicks += 1;
  }

  // Typing into a box counts once per box, however long the text (retyping the same box is not a new field).
  async fill(locator: Locator, value: string, key?: string): Promise<void> {
    await locator.fill(value);
    this.typedKeys.add(key ?? (await locator.evaluate((element) => (element as HTMLInputElement).id || element.getAttribute("name") || element.outerHTML.slice(0, 80))));
    this.fieldsTyped = this.typedKeys.size;
  }

  // Opening a list and choosing an option is two clicks for a person; counted as one option chosen (and 2 clicks).
  async select(locator: Locator, option: string | { label: string }): Promise<void> {
    await locator.selectOption(option);
    this.optionsChosen += 1;
  }

  async chooseFile(locator: Locator, file: string): Promise<void> {
    await locator.setInputFiles(file);
    this.filesChosen += 1;
  }

  async press(key: string): Promise<void> {
    await this.page.keyboard.press(key);
    this.keyPresses += 1;
  }

  note(text: string): void {
    this.notes.push(text);
  }

  // Runs one stage: times it, counts what the person did in it, and takes a picture at the end.
  async stage(name: string, action: () => Promise<void>): Promise<void> {
    const before = this.snapshot();
    const begun = Date.now();
    const waitedBefore = this.waitMs;
    try {
      await action();
    } finally {
      const index = String(this.stages.length + 1).padStart(2, "0");
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const screenshot = auditPath("screens", this.name, `${index}-${slug}.png`);
      try {
        await this.page.screenshot({ path: screenshot, fullPage: true });
      } catch {
        // The page may be closed when a stage fails; the stage is still recorded.
      }
      const after = this.snapshot();
      this.stages.push({
        name,
        ms: Date.now() - begun,
        waitMs: this.waitMs - waitedBefore,
        clicks: after.clicks - before.clicks,
        fieldsTyped: after.fieldsTyped - before.fieldsTyped,
        optionsChosen: after.optionsChosen - before.optionsChosen,
        filesChosen: after.filesChosen - before.filesChosen,
        keyPresses: after.keyPresses - before.keyPresses,
        screenshot,
      });
      this.save();
    }
  }

  // Time the person spends watching a progress card. Reported separately from acting time.
  async waiting<T>(action: () => Promise<T>): Promise<T> {
    const begun = Date.now();
    try {
      return await action();
    } finally {
      this.waitMs += Date.now() - begun;
    }
  }

  save(): void {
    const body = {
      journey: this.name,
      totalMs: Date.now() - this.startedAt,
      totalWaitMs: this.waitMs,
      clicks: this.clicks,
      fieldsTyped: this.fieldsTyped,
      optionsChosen: this.optionsChosen,
      filesChosen: this.filesChosen,
      keyPresses: this.keyPresses,
      stages: this.stages,
      notes: this.notes,
    };
    fs.writeFileSync(auditPath(`${this.name}-metrics.json`), JSON.stringify(body, null, 2));
  }

  private snapshot() {
    return {
      clicks: this.clicks,
      fieldsTyped: this.fieldsTyped,
      optionsChosen: this.optionsChosen,
      filesChosen: this.filesChosen,
      keyPresses: this.keyPresses,
    };
  }
}
