// @forge-generated generator=0.1.0-alpha.63 input=2f9604dc41facd1ee37603a8e15defa5f5ee82a9dd061b0fe5f7998946250f0b content=975974dafdbcfed85fb72f86852a6850994277123b5e5be3dee4714e526717d5
/** Forge generated mock testkit for zod. */
import { z } from "zod";

export function createZodMock() {
  return {
    parse: <T>(schema: z.ZodType<T>, value: unknown) => schema.parse(value),
    safeParse: <T>(schema: z.ZodType<T>, value: unknown) => schema.safeParse(value),
  } as const;
}
