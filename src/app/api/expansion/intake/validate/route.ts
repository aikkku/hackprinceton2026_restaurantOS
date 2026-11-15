import { z } from "zod";
import { intakeSchema } from "../../../../../features/expansion/domain/intake.ts";
import {
  validateIntakeForSearch,
  intakeValidationResponseSchema,
} from "../../../../../features/expansion/backend/runs.ts";
import { localFailure, localResponse } from "../../../../../features/expansion/backend/http.ts";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ intake: intakeSchema });

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    return localResponse(intakeValidationResponseSchema.parse(validateIntakeForSearch(body)));
  } catch (error) {
    return localFailure(error);
  }
}
