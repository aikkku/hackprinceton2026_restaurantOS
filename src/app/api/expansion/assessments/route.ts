import { z } from "zod";
import {
  assessmentSchema,
  candidateSchema,
  evaluateCandidate,
  factSchema,
  groupFor,
  MATCHING_MODEL_VERSION,
} from "../../../../features/expansion/domain/matching.ts";
import { searchRequirementsSchema } from "../../../../features/expansion/domain/requirements.ts";
import { localFailure, localResponse } from "../../../../features/expansion/backend/http.ts";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  candidate: candidateSchema,
  requirements: searchRequirementsSchema,
  facts: z.array(factSchema).max(100).optional(),
});

const responseSchema = z.object({
  modelVersion: z.string().min(1),
  assessments: z.array(assessmentSchema).min(1),
  group: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const assessments = evaluateCandidate(body.candidate, body.requirements, body.facts ?? []);
    return localResponse(
      responseSchema.parse({
        modelVersion: MATCHING_MODEL_VERSION,
        assessments,
        group: groupFor(assessments),
      }),
    );
  } catch (error) {
    return localFailure(error);
  }
}
