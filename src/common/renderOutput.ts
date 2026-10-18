import type { APRenderComposite } from "@abstractplay/renderer";
import type { APRenderRep } from "@abstractplay/renderer/build/schemas/schema.js";

/** Value returned from `GameBase.render()` — single board or composite layout, or animation frames of either. */
export type APRenderGameOutput = APRenderRep | APRenderRep[] | APRenderComposite | APRenderComposite[];

/** True when `rep` is a composite document (`kind: "composite"`). Arrays are always frame stacks, never composites. */
export const isAPRenderComposite = (rep: unknown): rep is APRenderComposite =>
    typeof rep === "object"
    && rep !== null
    && !Array.isArray(rep)
    && (rep as { kind?: string }).kind === "composite";
