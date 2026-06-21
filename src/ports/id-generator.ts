export interface IdGenerator {
  next(prefix?: string): string;
}

export const cryptoIdGenerator: IdGenerator = {
  next: (prefix = "") => `${prefix}${crypto.randomUUID()}`
};

export function deterministicIds(values: readonly string[]): IdGenerator {
  let index = 0;
  return {
    next(prefix = "") {
      const value = values[index++];
      if (value === undefined) {
        throw new Error("No deterministic id left");
      }
      return `${prefix}${value}`;
    }
  };
}
