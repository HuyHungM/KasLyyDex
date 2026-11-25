// Generation guard behind useRemoteResource. A response from a previous key,
// request or disposed effect is ignored instead of writing stale account data.

export type RemoteResourceSnapshot<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  key: string;
};

type Started<T> = { generation: number; snapshot: RemoteResourceSnapshot<T> };

let nextGeneration = 0;

export class RemoteResourceController<T> {
  private generation = 0;
  private key = "";
  private state: RemoteResourceSnapshot<T> = { data: null, loading: false, error: null, key: "" };

  begin(key: string): Started<T> {
    this.generation = ++nextGeneration;
    this.key = key;
    this.state = { data: null, loading: true, error: null, key };
    return { generation: this.generation, snapshot: this.state };
  }

  resolve(generation: number, data: T): RemoteResourceSnapshot<T> | null {
    if (generation !== this.generation) return null;
    this.state = { data, loading: false, error: null, key: this.key };
    return this.state;
  }

  reject(generation: number, message: string): RemoteResourceSnapshot<T> | null {
    if (generation !== this.generation) return null;
    this.state = { data: null, loading: false, error: message, key: this.key };
    return this.state;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  /// Called from effect cleanup: any in-flight response is now irrelevant.
  dispose(): void {
    this.generation = ++nextGeneration;
  }

  get snapshot(): RemoteResourceSnapshot<T> {
    return this.state;
  }
}
