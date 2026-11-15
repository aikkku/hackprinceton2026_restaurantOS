import { createCashHandler, memoryCashStore, mongoCashStore } from "../../../../features/tactical/backend/cash-calendar-service";
import { loadDataset } from "../../../../features/tactical/backend/load-dataset";
export const runtime="nodejs";
const cloud=process.env.TACTICAL_DATA_SOURCE==="mongodb";
const handle=createCashHandler({load:async()=>(await loadDataset()).dataset,store:cloud?mongoCashStore:memoryCashStore(),cloud});
export const GET=handle;
export const POST=handle;
