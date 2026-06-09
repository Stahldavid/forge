export declare function createStreamableValue<T>(initial: T): StreamableValue<T>;

export interface StreamableValue<T> {
  value: T;
  update(value: T): void;
  done(): void;
}
