// @forge-generated generator=0.1.0-alpha.67 input=38da8c5c03d84214b14dc14a394d242e2dd8b8789e72edd7a1b94ea7d1002f19 content=975974dafdbcfed85fb72f86852a6850994277123b5e5be3dee4714e526717d5
/** Forge generated mock testkit for zod. */
import { z } from "zod";

export function createZodMock() {
  return {
    parse: <T>(schema: z.ZodType<T>, value: unknown) => schema.parse(value),
    safeParse: <T>(schema: z.ZodType<T>, value: unknown) => schema.safeParse(value),
  } as const;
}
