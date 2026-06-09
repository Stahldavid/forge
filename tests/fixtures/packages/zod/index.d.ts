/**
 * Parse a string into a validated value.
 * @example
 * const schema = z.string();
 * schema.parse("hello");
 */
export declare function parse<T>(value: unknown): T;

/**
 * Create a string schema.
 */
export declare function string(): StringSchema;

export declare class StringSchema {
  parse(input: unknown): string;
}

export declare namespace z {
  export { parse, string, StringSchema };
}

export declare const z: {
  string: typeof string;
  parse: typeof parse;
};
