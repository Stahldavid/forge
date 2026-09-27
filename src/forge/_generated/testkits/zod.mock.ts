// @forge-generated generator=0.1.0-alpha.63 input=84e91710081b76fb63c11fe704185090832d0113ff972e147f9de33e12dd16f7 content=975974dafdbcfed85fb72f86852a6850994277123b5e5be3dee4714e526717d5
/** Forge generated mock testkit for zod. */
import { z } from "zod";

export function createZodMock() {
  return {
    parse: <T>(schema: z.ZodType<T>, value: unknown) => schema.parse(value),
    safeParse: <T>(schema: z.ZodType<T>, value: unknown) => schema.safeParse(value),
  } as const;
}
