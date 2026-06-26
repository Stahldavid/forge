// @forge-generated generator=0.1.0-alpha.28 input=e732f729a92a1ffcaf34b4c696c5efcf65cf697fe11fb071ee16145fdd73e88c content=975974dafdbcfed85fb72f86852a6850994277123b5e5be3dee4714e526717d5
/** Forge generated mock testkit for zod. */
import { z } from "zod";

export function createZodMock() {
  return {
    parse: <T>(schema: z.ZodType<T>, value: unknown) => schema.parse(value),
    safeParse: <T>(schema: z.ZodType<T>, value: unknown) => schema.safeParse(value),
  } as const;
}
