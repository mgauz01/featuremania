export type LivePreflight = {
  ready: boolean;
  github: string;
  otari: string;
  github_error: string | null;
  otari_error: string | null;
};

export function preflightBlocksPicker(preflight: LivePreflight): boolean {
  return !preflight.ready;
}
