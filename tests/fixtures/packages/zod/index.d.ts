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

/**
 * Create an enum schema.
 */
export declare function enum_<Values extends readonly [string, ...string[]]>(
  values: Values,
): EnumSchema<Values[number]>;

/**
 * Create an object schema.
 */
export declare function object<Shape extends Record<string, Schema<unknown>>>(
  shape: Shape,
): ObjectSchema<Shape>;

export declare interface Schema<T> {
  parse(input: unknown): T;
  optional(): Schema<T | undefined>;
}

export declare class StringSchema {
  parse(input: unknown): string;
  optional(): Schema<string | undefined>;
}

export declare class EnumSchema<T extends string> {
  parse(input: unknown): T;
  optional(): Schema<T | undefined>;
}

export declare class ObjectSchema<Shape extends Record<string, Schema<unknown>>> {
  parse(input: unknown): {
    [Key in keyof Shape]: Shape[Key] extends Schema<infer Value> ? Value : never;
  };
  optional(): Schema<
    | {
        [Key in keyof Shape]: Shape[Key] extends Schema<infer Value> ? Value : never;
      }
    | undefined
  >;
}

export declare namespace z {
  export { parse, string, enum_ as enum, object, StringSchema, EnumSchema, ObjectSchema };
}

export declare const z: {
  string: typeof string;
  enum: typeof enum_;
  object: typeof object;
  parse: typeof parse;
};
