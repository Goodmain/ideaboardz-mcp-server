export type SolveRecaptchaParams = {
  siteKey: string;
  pageUrl: string;
};

export interface CaptchaSolver {
  solveRecaptchaV2(params: SolveRecaptchaParams): Promise<string>;
}

type TwoCaptchaOptions = {
  apiKey: string;
  baseUrl?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_BASE_URL = "https://2captcha.com";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 180_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type InResponse = { status: number; request: string };
type ResResponse = { status: number; request: string };

/**
 * Solves Google reCAPTCHA v2 via the 2captcha API.
 * Docs: https://2captcha.com/2captcha-api#solving_recaptchav2_new
 */
export class TwoCaptchaSolver implements CaptchaSolver {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: TwoCaptchaOptions) {
    if (!options.apiKey) {
      throw new Error("2captcha API key is required");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async solveRecaptchaV2({ siteKey, pageUrl }: SolveRecaptchaParams): Promise<string> {
    const id = await this.submit(siteKey, pageUrl);
    return this.poll(id);
  }

  private async submit(siteKey: string, pageUrl: string): Promise<string> {
    const form = new URLSearchParams({
      key: this.apiKey,
      method: "userrecaptcha",
      googlekey: siteKey,
      pageurl: pageUrl,
      json: "1",
    });

    const response = await fetch(`${this.baseUrl}/in.php`, { method: "POST", body: form });
    const data = (await response.json()) as InResponse;

    if (data.status !== 1) {
      throw new Error(`2captcha rejected the task: ${data.request}`);
    }
    return data.request;
  }

  private async poll(id: string): Promise<string> {
    const deadline = Date.now() + this.timeoutMs;

    while (Date.now() < deadline) {
      await this.sleep(this.pollIntervalMs);

      const url = `${this.baseUrl}/res.php?key=${encodeURIComponent(this.apiKey)}&action=get&id=${encodeURIComponent(id)}&json=1`;
      const response = await fetch(url);
      const data = (await response.json()) as ResResponse;

      if (data.status === 1) {
        return data.request;
      }
      if (data.request !== "CAPCHA_NOT_READY") {
        throw new Error(`2captcha failed to solve: ${data.request}`);
      }
    }

    throw new Error(`2captcha timed out after ${this.timeoutMs}ms`);
  }
}
