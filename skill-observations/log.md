# Skill Observation Log

Observations captured during task-oriented work.

**Status key:** OPEN = not yet actioned | ACTIONED (YYYY-MM-DD) = skill updated/created | DECLINED (YYYY-MM-DD) = user decided not to pursue

---

## 2026-09-02

### Observation 1: Search-tool fallback is useful in restricted environments

**Status:** OPEN
**Date:** 2026-09-02
**Session context:** Built and verified a browser PWA with an explicit UI design skill.
**Skill:** ui-ux-pro-max
**Type:** open-source
**Phase/Area:** Design-system search workflow

**Issue:** The skill's recommended Python search command was blocked by the active command allowlist, despite the design task otherwise being fully local.

**Suggested improvement:** Add a short fallback path that points to the built-in priority rules and asks the agent to label the result as a fallback when the search executable is unavailable.

**Principle:** A design-guidance workflow should retain a truthful local fallback when its optional search executable is unavailable.

### Observation 2: Review responsive CTA ownership separately

**Status:** OPEN
**Date:** 2026-09-02
**Session context:** Release-readiness redesign of a responsive PWA.
**Skill:** New skill candidate: responsive finish review
**Type:** open-source
**Phase/Area:** Desktop responsive QA

**Issue:** A mobile floating creation action remained visible after the desktop layout already provided an in-context primary action.

**Suggested improvement:** Add a desktop CTA ownership check that verifies each route exposes one primary creation action after responsive layout rules apply.

**Principle:** Responsive UI must be reviewed for duplicated intent, not only for overflow and alignment.
