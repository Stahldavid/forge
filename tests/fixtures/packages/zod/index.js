function optional(schema) {
  return {
    parse(input) {
      return input === undefined ? undefined : schema.parse(input);
    },
    optional() {
      return optional(this);
    },
  };
}

export function parse(value) {
  return value;
}

export function string() {
  return {
    parse(input) {
      if (typeof input !== "string") {
        throw new Error("Expected string");
      }
      return input;
    },
    optional() {
      return optional(this);
    },
  };
}

export function enum_(values) {
  return {
    parse(input) {
      if (!values.includes(input)) {
        throw new Error(`Expected one of: ${values.join(", ")}`);
      }
      return input;
    },
    optional() {
      return optional(this);
    },
  };
}

export function object(shape) {
  return {
    parse(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("Expected object");
      }
      const output = {};
      for (const [key, schema] of Object.entries(shape)) {
        output[key] = schema.parse(input[key]);
      }
      return output;
    },
    optional() {
      return optional(this);
    },
  };
}

export const z = {
  string,
  enum: enum_,
  object,
  parse,
};
