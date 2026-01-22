import type { HeadlessEvent, HeadlessFormatter, HeadlessSummary } from "../cli-output";

type JsonFormatterOptions = {
  timestamps?: boolean;
  write?: (text: string) => void;
};

/**
 * Output structure for JSON formatter.
 * Contains accumulated events and execution summary.
 */
type JsonOutput = {
  events: HeadlessEvent[];
  summary: HeadlessSummary;
};

export function createJsonFormatter(options: JsonFormatterOptions): HeadlessFormatter {
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const events: HeadlessEvent[] = [];

  const emit = (event: HeadlessEvent) => {
    // Strip timestamp if timestamps option is false
    if (options.timestamps === false && "timestamp" in event) {
      const { timestamp: _ignored, ...rest } = event;
      events.push(rest as HeadlessEvent);
      return;
    }
    events.push(event);
  };

  const finalize = (summary: HeadlessSummary) => {
    const output: JsonOutput = {
      events,
      summary,
    };
    write(JSON.stringify(output) + "\n");
  };

  return { emit, finalize };
}
