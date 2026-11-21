// Coordinates authenticated reader restoration. The first progress PUT is
// gated until the server page has been applied, and any response that arrives
// after navigation/account change is discarded.

let nextGeneration = 0;

export class ReaderRestoreCoordinator {
  private generation = 0;
  private key = "";
  private ready = "";

  /// Starts one restore attempt. Returns the generation that must be presented
  /// when the async GET settles.
  begin(key: string): number {
    this.generation = ++nextGeneration;
    this.key = key;
    this.ready = "";
    return this.generation;
  }

  /// Unlocks writes only for the still-current generation and key.
  resolve(generation: number, key: string): string | null {
    if (generation !== this.generation || key !== this.key) return null;
    this.ready = key;
    return key;
  }

  /// A failed restore clears both the in-flight key and the write gate so a
  /// visible retry can start a fresh attempt.
  fail(generation: number, key: string): boolean {
    if (generation !== this.generation || key !== this.key) return false;
    this.key = "";
    this.ready = "";
    return true;
  }

  isReady(key: string): boolean {
    return this.ready === key && this.key === key;
  }

  /// Called on unmount: a late response may never touch a new chapter's WASM.
  dispose(): void {
    this.generation = ++nextGeneration;
    this.key = "";
    this.ready = "";
  }
}
