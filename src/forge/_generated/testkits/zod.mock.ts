// @forge-generated generator=0.1.0-alpha.69 input=a62f6d9631d76e83840b1f77cac5b6c6e1f6da1acab63d41614e2fe47b9d5ca7 content=975974dafdbcfed85fb72f86852a6850994277123b5e5be3dee4714e526717d5
/** Forge generated mock testkit for zod. */
import { z } from "zod";

export function createZodMock() {
  return {
    parse: <T>(schema: z.ZodType<T>, value: unknown) => schema.parse(value),
    safeParse: <T>(schema: z.ZodType<T>, value: unknown) => schema.safeParse(value),
  } as const;
}
