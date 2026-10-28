import type { Handler } from '../../_lib/env';
import { json } from '../../_lib/http';
import { LrsClient, type Actor } from '../../_lib/lrs/client';
import { recordRoute } from '../../_lib/record/guard';
import { officialActor } from '../../_lib/record/official';

/** A link to the LRS's own view of the learner's record, minted for their official actor. */
export const POST: Handler = (req, ctx) =>
  recordRoute(req, ctx, async (session) => {
    const url = await new LrsClient(ctx.env).mintViewLink(officialActor(session.actorName) as Actor);
    return json({ url });
  });
